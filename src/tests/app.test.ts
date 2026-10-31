import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { request as httpRequest } from "node:http";
import { startFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { localServerUrl, makeClient } from "../server/engine.js";
import type { AppState, SpeechSettings } from "../shared/types.js";
import type { AppOptions } from "../server/app.js";
import { speechFixture } from "./speech-fixture.js";

async function setup(extra: Partial<AppOptions> = {}) {
  const temporary = await mkdtemp(resolve(".picard-test-"));
  const project = join(temporary, "project");
  const other = join(temporary, "other");
  const webRoot = join(temporary, "web");
  await Promise.all([mkdir(project), mkdir(other), mkdir(webRoot)]);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Picard Code</title>");
  const directory = await realpath(project);
  const fixture = await startFixture(directory);
  const app = await startApp({ client: makeClient(fixture.url, fixture.password), project: directory, webRoot, speechFile: join(temporary, "speech.json"), ...extra });
  let cookie = "";
  const request = (path: string, data?: unknown, headers: Record<string, string> = {}) => fetch(`${app.origin}/api/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, ...(data === undefined ? {} : { "Content-Type": "application/json", "X-Picard-Request": "1" }), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const login = async () => {
    const response = await request("connect", { token: app.token });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    cookie = setCookie.split(";")[0]!;
  };
  const cleanup = async () => {
    await app.close();
    await fixture.close();
    await rm(temporary, { recursive: true });
  };
  return { app, fixture, request, login, cleanup, directory, other, temporary };
}

test("only explicit local HTTP server addresses are accepted", () => {
  assert.equal(localServerUrl("http://localhost:4096"), "http://127.0.0.1:4096");
  for (const value of ["https://127.0.0.1:4096", "http://example.com", "http://127.0.0.1.example.com", "http://user:secret@127.0.0.1:4096", "http://127.0.0.1:4096/path"]) {
    assert.throws(() => localServerUrl(value));
  }
});

test("local browser access needs the launch token; unrelated sites and hosts are blocked", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  assert.equal((await context.request("state")).status, 401);
  assert.equal((await context.request("connect", { token: "wrong" })).status, 401);
  assert.equal((await context.request("connect", { token: context.app.token }, { "X-Picard-Request": "" })).status, 403);
  assert.equal((await context.request("connect", { token: context.app.token }, { Origin: "https://unrelated.example" })).status, 403);
  await context.login();
  const badHostStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${context.app.origin}/api/state`, { headers: { Host: "unrelated.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode!);
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await context.request("state", undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const linkedPage = await fetch(context.app.origin, { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(linkedPage.status, 200);
  assert.equal((await context.request("conversations", {}, { "Content-Type": "text/plain" })).status, 415);
  const stateResponse = await context.request("state");
  const text = await stateResponse.text();
  assert.doesNotMatch(text, /must-never-reach-browser|fixture-password|other-provider/);
  const state = JSON.parse(text) as AppState;
  assert.equal(state.models[0]?.providerID, "github-copilot");
  const page = await fetch(context.app.origin);
  assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.doesNotMatch(await page.text(), new RegExp(context.app.token));
  assert.equal((await fetch(`${context.app.origin}/%2e%2e%5cpackage.json`)).status, 403);
});

test("saved conversations and project context use the actual SDK; other folders cannot be controlled", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  const created = await context.request("conversations", { title: "A useful idea" });
  assert.equal(created.status, 201);
  const session = await created.json();
  let state = await (await context.request("state")).json() as AppState;
  assert.equal(state.conversations[0]?.id, session.id);
  assert.equal((await context.request(`conversations/${session.id}/messages`)).status, 200);
  const foreign = context.fixture.createSession(context.other, "Other folder");
  assert.equal((await context.request(`conversations/${foreign.id}/stop`, {})).status, 403);
  assert.equal((await context.request(`conversations/${session.id}/send`, { text: "Hello", providerID: "other-provider", modelID: "other" })).status, 400);
  assert.equal((await context.request("project", { path: join(context.other, "missing") })).status, 400);
  const switched = await context.request("project", { path: context.other });
  assert.equal(switched.status, 200);
  state = await switched.json() as AppState;
  assert.equal(state.project, await realpath(context.other));
  assert.equal(state.conversations[0]?.id, foreign.id);
  assert.equal((await context.request(`conversations/${session.id}/stop`, {})).status, 403);
});

test("prompt_async produces actual streamed deltas and a saved reply through the SDK", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  const session = await (await context.request("conversations", {})).json();
  const stream = await context.request("events");
  const reader = stream.body!.getReader();
  t.after(() => reader.cancel());
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /connected/);
  const accepted = await context.request(`conversations/${session.id}/send`, { text: "Hello computer", providerID: "github-copilot", modelID: "fixture-model" });
  assert.equal(accepted.status, 202);
  let observed = "";
  const deadline = Date.now() + 5000;
  while (!observed.includes("session.idle") && Date.now() < deadline) {
    const chunk = await reader.read();
    observed += new TextDecoder().decode(chunk.value);
  }
  assert.match(observed, /message\.part\.delta/);
  assert.match(observed, /session\.idle/);
  const messages = await (await context.request(`conversations/${session.id}/messages`)).json();
  assert.equal(messages[1].parts[0].text, "A genuinely streamed reply from the test fixture.");
  const prompt = context.fixture.requests.find((request) => request.path.endsWith("/prompt_async"))!;
  assert.equal(prompt.directory, context.directory);
  assert.equal(prompt.data.agent, "build");
  assert.equal(prompt.data.tools, undefined);
  assert.equal(prompt.data.permission, undefined);
  // The ask-first rules are set on the conversation before the request, and only once.
  const rules = context.fixture.requests.filter((request) => request.method === "PATCH" && Array.isArray(request.data.permission));
  assert.equal(rules.length, 1);
  assert.ok(context.fixture.requests.indexOf(rules[0]!) < context.fixture.requests.indexOf(prompt));
  assert.deepEqual((rules[0]!.data.permission as { permission: string }[])[0], { permission: "picard-code", pattern: "confirm-changes", action: "ask" });
  assert.ok((rules[0]!.data.permission as { permission: string; pattern: string; action: string }[])
    .some((rule) => rule.permission === "bash" && rule.pattern === "rm *" && rule.action === "deny"), "the stand-in's deny rule is kept");
  assert.match(String(prompt.data.system), /brief, precise, neutral/i);
  assert.match(String(prompt.data.system), /Never invent completion/);
});

test("approvals and questions stay pending until the user answers; no automatic approval", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  const session = await (await context.request("conversations", {})).json();
  const send = (text: string) => context.request(`conversations/${session.id}/send`, { text, providerID: "github-copilot", modelID: "fixture-model" });
  assert.equal((await send("Request an approval")).status, 202);
  let state = await (await context.request("state")).json() as AppState;
  assert.equal(state.permissions.length, 1);
  assert.equal(context.fixture.requests.filter((request) => request.path.includes("/permission/")).length, 0);
  assert.equal((await context.request("refresh", {})).status, 409);
  assert.equal((await context.request("project", { path: context.other })).status, 409);
  assert.equal((await send("Another message")).status, 409);
  const permission = state.permissions[0]!;
  assert.equal((await context.request(`permissions/${permission.id}`, { reply: "always" })).status, 400);
  assert.equal((await context.request(`permissions/${permission.id}`, { reply: "once" })).status, 200);
  assert.equal((await context.request(`permissions/${permission.id}`, { reply: "once" })).status, 409);
  await context.request(`conversations/${session.id}/stop`, {});
  assert.equal((await send("Ask a question")).status, 202);
  state = await (await context.request("state")).json() as AppState;
  const question = state.questions[0]!;
  assert.equal((await context.request(`questions/${question.id}`, { answers: [] })).status, 400);
  assert.equal((await context.request(`questions/${question.id}`, { answers: [["Explain first"]] })).status, 200);
  assert.equal(context.fixture.requests.at(-1)?.data.answers instanceof Array, true);
});

test("missing Copilot authorization is an honest setup state, not a fallback to another provider", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  context.fixture.setCopilot(false);
  const state = await (await context.request("state")).json() as AppState;
  assert.deepEqual(state.models, []);
  assert.equal(state.defaultModel, undefined);
  assert.equal((await context.request("refresh", {})).status, 200);
});

test("speech settings change while the app runs; a failing choice leaves the working one in place", async (t) => {
  const started: Record<string, unknown>[] = [];
  let closed = 0;
  const context = await setup({
    speechError: "Speech did not start. Provide a valid deployment in the speech settings.",
    startSpeech: async (settings) => {
      if (settings.region === "broken") throw new Error("Azure could not be reached.");
      started.push(settings);
      const fixture = speechFixture();
      return { ...fixture.service, selection: { listening: settings.listening as "mai", speaking: settings.speaking as "kokoro" }, close: async () => { ++closed; } };
    },
  });
  t.after(context.cleanup);
  await context.login();
  let state = await (await context.request("state")).json() as AppState;
  assert.equal(state.speech?.configured, false);
  assert.match(state.speech?.error ?? "", /did not start/);
  const file = join(context.temporary, "speech.json");
  const empty = await (await context.request("settings")).json() as { settings: SpeechSettings; file: string };
  assert.equal(empty.file, file);
  assert.equal(empty.settings.listening, "mai");

  const choice = { listening: "mai", speaking: "kokoro", subscription: "sub-1", resourceGroup: "group", resourceName: "name", region: "swedencentral", deployment: "listen", voice: "", voiceStyle: "", kokoroVoice: "bf_emma" };
  assert.equal((await context.request("settings", { ...choice, listening: "other" })).status, 400);
  assert.equal((await context.request("settings", { ...choice, region: "has spaces" })).status, 400);
  const saved = await context.request("settings", choice);
  assert.equal(saved.status, 200);
  assert.equal(started.length, 1);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { listening: "mai", speaking: "kokoro", subscription: "sub-1", resourceGroup: "group", resourceName: "name", region: "swedencentral", deployment: "listen", kokoroVoice: "bf_emma" });
  state = await (await context.request("state")).json() as AppState;
  assert.deepEqual(state.speech, { configured: true, listening: "mai", speaking: "kokoro" });

  const failed = await context.request("settings", { ...choice, region: "broken" });
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /nothing was changed\. Azure could not be reached/);
  assert.equal(JSON.parse(await readFile(file, "utf8")).region, "swedencentral");
  assert.equal(closed, 0);

  assert.equal((await context.request("settings", { ...choice, speaking: "mai" })).status, 200);
  assert.equal(closed, 1, "the previous speech service is released after a change");
  state = await (await context.request("state")).json() as AppState;
  assert.equal(state.speech?.speaking, "mai");
});
