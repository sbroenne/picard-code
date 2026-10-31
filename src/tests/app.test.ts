import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { request as httpRequest } from "node:http";
import { startFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { localServerUrl, makeClient } from "../server/engine.js";
import type { AppState } from "../shared/types.js";

async function setup() {
  const temporary = await mkdtemp(resolve(".picard-test-"));
  const project = join(temporary, "project");
  const other = join(temporary, "other");
  const webRoot = join(temporary, "web");
  await Promise.all([mkdir(project), mkdir(other), mkdir(webRoot)]);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Picard Code</title>");
  const directory = await realpath(project);
  const fixture = await startFixture(directory);
  const app = await startApp({ client: makeClient(fixture.url, fixture.password), project: directory, webRoot });
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
  return { app, fixture, request, login, cleanup, directory, other };
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
  assert.equal((await context.request(`conversations/${session.id}/send`, { text: "Hello", providerID: "other-provider", modelID: "other", agent: "build" })).status, 400);
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
  const accepted = await context.request(`conversations/${session.id}/send`, { text: "Hello computer", providerID: "github-copilot", modelID: "fixture-model", agent: "plan" });
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
  assert.equal(prompt.data.agent, "plan");
  assert.equal(prompt.data.tools, undefined);
  assert.equal(prompt.data.permission, undefined);
  assert.match(String(prompt.data.system), /brief, precise, neutral/i);
  assert.match(String(prompt.data.system), /Never invent completion/);
});

test("approvals and questions stay pending until the user answers; no automatic approval", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  const session = await (await context.request("conversations", {})).json();
  const send = (text: string) => context.request(`conversations/${session.id}/send`, { text, providerID: "github-copilot", modelID: "fixture-model", agent: "build" });
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
