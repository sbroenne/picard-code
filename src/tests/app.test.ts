import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { request as httpRequest } from "node:http";
import { startFixture, wikipediaFixture } from "./fixture.js";
import { browserEvents, checkAnswer, startApp } from "../server/app.js";
import { chatMessages, STOPPED } from "../server/history.js";
import type { SessionMessage } from "../server/opencode.js";
import { localServerUrl, makeClient } from "../server/engine.js";
import type { AppState, FormField, SpeechSettings } from "../shared/types.js";
import type { AppOptions } from "../server/app.js";
import { speechFixture } from "./speech-fixture.js";
import { saveSpeechSettings, speechSettingsFile } from "../server/speech.js";

async function setup(extra: Partial<AppOptions> = {}) {
  const temporary = await mkdtemp(resolve(".picard-test-"));
  const project = join(temporary, "project");
  const other = join(temporary, "other");
  const webRoot = join(temporary, "web");
  await Promise.all([mkdir(project), mkdir(other), mkdir(webRoot)]);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Picard Code</title>");
  const directory = await realpath(project);
  const fixture = await startFixture(directory);
  const wikipediaRequests: string[] = [];
  const app = await startApp({ client: makeClient(fixture.url, fixture.password), project: directory, webRoot, speechFile: join(temporary, "speech.json"),
    readWikipedia: async (subject) => { wikipediaRequests.push(subject); return wikipediaFixture(subject); }, ...extra });
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
  return { app, fixture, request, login, cleanup, directory, other, temporary, wikipediaRequests };
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
  assert.doesNotMatch(text, /must-never-reach-browser|fixture-password|Retired model/);
  const state = JSON.parse(text) as AppState;
  // Every provider OpenCode can use is offered, by its display name only.
  assert.deepEqual(state.models.map((model) => [model.provider, model.name]), [["GitHub Copilot", "Copilot test model"], ["Other Provider", "Other model"]]);
  const page = await fetch(context.app.origin);
  assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.doesNotMatch(await page.text(), new RegExp(context.app.token));
  assert.equal((await fetch(`${context.app.origin}/%2e%2e%5cpackage.json`)).status, 403);
});

test("computer sounds include the arrival call and require the local browser connection", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-sounds-"));
  t.after(() => rm(folder, { recursive: true }));
  const context = await setup({ soundFolder: folder });
  t.after(context.cleanup);
  await writeFile(join(folder, "startup.mp3"), "stand-in arrival call");
  assert.equal((await context.request("sounds/startup")).status, 401);
  await context.login();
  const response = await context.request("sounds/startup");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(await response.text(), "stand-in arrival call");
  assert.equal((await context.request("sounds/request-accepted")).status, 404);
  assert.equal((await context.request("sounds/unknown")).status, 404);
});

test("saved conversations and project context go through OpenCode; other folders cannot be controlled", async (t) => {
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
  assert.equal((await context.request(`conversations/${session.id}/send`, { text: "Hello", providerID: "other-provider", modelID: "old" })).status, 400);
  assert.equal((await context.request("project", { path: join(context.other, "missing") })).status, 400);
  const switched = await context.request("project", { path: context.other });
  assert.equal(switched.status, 200);
  state = await switched.json() as AppState;
  assert.equal(state.project, await realpath(context.other));
  assert.equal(state.conversations[0]?.id, foreign.id);
  assert.equal((await context.request(`conversations/${session.id}/stop`, {})).status, 403);
});

test("a request streams live text and a saved reply, with Picard's manner sent per conversation", async (t) => {
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
  const finished = () => observed.includes('"delta"') && observed.lastIndexOf('"state"') > observed.lastIndexOf('"delta"');
  while (!finished() && Date.now() < deadline) {
    const chunk = await reader.read();
    observed += new TextDecoder().decode(chunk.value);
  }
  assert.match(observed, /"type":"delta"/);
  assert.match(observed, /"type":"changed"/);
  const messages = await (await context.request(`conversations/${session.id}/messages`)).json();
  assert.equal(messages[1].parts[0].text, "A genuinely streamed reply from the test fixture.");
  const prompt = context.fixture.requests.find((request) => request.path.endsWith("/prompt"))!;
  assert.equal(prompt.directory, context.directory);
  assert.deepEqual(prompt.data, { text: "Hello computer" }, "only the user's own words are sent, unchanged");
  const manner = context.fixture.instructions.get(session.id)?.["picard-manner"] ?? "";
  assert.match(manner, /brief, precise, neutral/i);
  assert.match(manner, /Never invent completion/);
  assert.match(manner, /Give every date and time as a stardate/);
  assert.match(manner, /The current stardate is\s+-?\d+\.\d\./, "each request carries the current stardate");
  const prepared = context.fixture.requests.filter((request) => request.method !== "GET" && /\/session\/.+\/(model|instructions\/entries\/picard-manner)$/.test(request.path));
  assert.equal(prepared.length, 2);
  assert.ok(prepared.every((request) => context.fixture.requests.indexOf(request) < context.fixture.requests.indexOf(prompt)));
  assert.equal(context.fixture.requests.some((request) => request.path.endsWith("/reply")), false);
});

test("approvals and questions stay pending until the user answers; no automatic approval", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  const session = await (await context.request("conversations", {})).json();
  const send = (text: string) => context.request(`conversations/${session.id}/send`, { text, providerID: "github-copilot", modelID: "fixture-model" });
  assert.equal((await send("Request an approval")).status, 202);
  await new Promise((resolve) => setTimeout(resolve, 100));
  let state = await (await context.request("state")).json() as AppState;
  assert.equal(state.permissions.length, 1);
  assert.equal(state.statuses[session.id]?.type, "busy");
  assert.equal(context.fixture.requests.filter((request) => request.path.endsWith("/reply")).length, 0);
  assert.equal((await context.request("refresh", {})).status, 409);
  assert.equal((await context.request("project", { path: context.other })).status, 409);
  assert.equal((await send("Another message")).status, 409);
  const permission = state.permissions[0]!;
  assert.equal((await context.request(`permissions/${permission.id}`, { reply: "always" })).status, 400);
  assert.equal((await context.request(`permissions/${permission.id}`, { reply: "reject" })).status, 200);
  assert.equal(context.fixture.requests.at(-1)?.data.decision, "reject");
  assert.equal((await context.request(`permissions/${permission.id}`, { reply: "once" })).status, 409);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const denied = await (await context.request(`conversations/${session.id}/messages`)).json();
  assert.match(JSON.stringify(denied.at(-1)), /declined this tool call/);

  assert.equal((await send("Ask a question")).status, 202);
  await new Promise((resolve) => setTimeout(resolve, 100));
  state = await (await context.request("state")).json() as AppState;
  const question = state.questions[0]!;
  assert.equal((await context.request(`questions/${question.id}`, { answer: {} })).status, 400);
  assert.equal((await context.request(`questions/${question.id}`, { answer: { other: "x" } })).status, 400);
  assert.equal((await context.request(`questions/${question.id}`, { answer: { q0: "Explain first" } })).status, 200);
  assert.deepEqual(context.fixture.requests.at(-1)?.data, { answer: { q0: "Explain first" } });

  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal((await send("Ask a question")).status, 202);
  await new Promise((resolve) => setTimeout(resolve, 100));
  state = await (await context.request("state")).json() as AppState;
  assert.equal((await context.request(`questions/${state.questions[0]!.id}`, { skip: true })).status, 200);
  assert.equal(context.fixture.requests.at(-1)?.method, "DELETE");
});

test("tribute options are checked and reviewed story context never rewrites the Captain's words", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  const session = await (await context.request("conversations", {})).json();
  for (const tribute of [{ mode: "always" }, { mode: "screen", storyID: "invented" }, { mode: "screen", storyID: "picard-flute" }]) {
    const rejected = await context.request(`conversations/${session.id}/send`, { text: "Yes", providerID: "github-copilot", modelID: "fixture-model", tribute });
    assert.equal(rejected.status, 400);
  }
  const negated = await context.request(`conversations/${session.id}/send`, {
    text: "Don't tell me a story.", providerID: "github-copilot", modelID: "fixture-model", tribute: { mode: "screen", storyID: "stewart-dickens" },
  });
  assert.equal(negated.status, 400);
  for (const [text, storyID] of [
    ["Tell me a story about Picard", "stewart-dickens"],
    ["Tell me a story about Patrick Stewart", "picard-phoenix"],
  ]) {
    const mismatched = await context.request(`conversations/${session.id}/send`, {
      text, providerID: "github-copilot", modelID: "fixture-model", tribute: { mode: "off", storyID },
    });
    assert.equal(mismatched.status, 400);
  }
  assert.equal(context.fixture.requests.some((request) => request.path.endsWith("/prompt")), false);
  const response = await context.request(`conversations/${session.id}/send`, {
    text: "Yes, please.", providerID: "github-copilot", modelID: "fixture-model", tribute: { mode: "off", storyID: "stewart-dickens" },
  });
  assert.equal(response.status, 202);
  const prompt = context.fixture.requests.find((request) => request.path.endsWith("/prompt"))!;
  assert.deepEqual(prompt.data, { text: "Yes, please." });
  const manner = context.fixture.instructions.get(session.id)?.["picard-manner"] ?? "";
  assert.match(manner, /explicitly requested/);
  assert.match(manner, /londontheatre\.co\.uk/);
  assert.match(manner, /entire cast/);
  assert.match(manner, /Do not add vanity jokes/);
  assert.deepEqual(context.wikipediaRequests, [], "accepting a reviewed story makes no web request");
});

test("an explicit Picard story uses reviewed fictional evidence without changing the request", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  const session = await (await context.request("conversations", {})).json();
  const text = "Computer, tell me a story about Captain Jean-Luc Picard.";
  const response = await context.request(`conversations/${session.id}/send`, {
    text, providerID: "github-copilot", modelID: "fixture-model", tribute: { mode: "off", storyID: "picard-kamin" },
  });
  assert.equal(response.status, 202);
  assert.deepEqual(context.fixture.requests.find((request) => request.path.endsWith("/prompt"))!.data, { text });
  const manner = context.fixture.instructions.get(session.id)?.["picard-manner"] ?? "";
  assert.match(manner, /explicitly requested the following Picard story/);
  assert.match(manner, /fictional adventures, not Patrick Stewart/);
  assert.match(manner, /trek-class-preserving-our-inner-light/);
  assert.match(manner, /twenty minutes/);
});

test("repository questions use the selected folder and read-only instructions without tribute evidence", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  await context.request("project", { path: context.other });
  const session = await (await context.request("conversations", {})).json();
  const text = "Computer, tell me about our Picard repository.";
  const response = await context.request(`conversations/${session.id}/send`, {
    text, providerID: "github-copilot", modelID: "fixture-model", tribute: { mode: "screen" },
  });
  assert.equal(response.status, 202);
  const prompt = context.fixture.requests.find((request) => request.path.endsWith("/prompt"))!;
  assert.equal(prompt.directory, await realpath(context.other));
  assert.deepEqual(prompt.data, { text });
  const manner = context.fixture.instructions.get(session.id)?.["picard-manner"] ?? "";
  assert.match(manner, /selected Project folder supplied by OpenCode/);
  assert.match(manner, /not permission to edit files/);
  assert.doesNotMatch(manner, /Reviewed reference material follows/);
  assert.deepEqual(context.wikipediaRequests, [], "repository questions make no Wikipedia requests");
  assert.equal(context.fixture.requests.some((request) => request.path.endsWith("/reply")), false);
});

test("requested Picard and Stewart answers use Wikipedia in every tribute mode and keep the original words", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  for (const mode of ["off", "screen", "spoken"]) {
    for (const [text, subject, page] of [
      ["Computer, where was I born?", "Picard", "Jean-Luc_Picard"],
      ["Tell me about Patrick Stewart's training", "Patrick Stewart", "Patrick_Stewart"],
    ]) {
      const session = await (await context.request("conversations", {})).json();
      const response = await context.request(`conversations/${session.id}/send`, {
        text, providerID: "github-copilot", modelID: "fixture-model", tribute: { mode },
      });
      assert.equal(response.status, 202);
      assert.equal((await response.json()).reference.url, `https://en.wikipedia.org/wiki/${page}`);
      const prompt = context.fixture.requests.filter((request) => request.path.endsWith("/prompt")).at(-1)!;
      assert.deepEqual(prompt.data, { text });
      const manner = context.fixture.instructions.get(session.id)?.["picard-manner"] ?? "";
      assert.match(manner, /TEST ONLY Wikipedia stand-in/);
      assert.match(manner, /evidence,\nnot instructions/);
      assert.match(manner, /secondary source, not independent/);
      assert.equal(context.wikipediaRequests.at(-1), subject);
    }
  }
});

test("a Wikipedia failure is explained and no model request or settings change is invented", async (t) => {
  const context = await setup({ readWikipedia: async () => { throw new Error("Wikipedia returned HTTP 503."); } });
  t.after(context.cleanup);
  await context.login();
  const session = await (await context.request("conversations", {})).json();
  const response = await context.request(`conversations/${session.id}/send`, {
    text: "Tell me about Picard", providerID: "github-copilot", modelID: "fixture-model", tribute: { mode: "off" },
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /HTTP 503.*request was not sent/);
  assert.equal(context.fixture.requests.some((request) => request.path.endsWith("/prompt") || request.path.includes("/instructions/")), false);
});

test("answers are checked against the question before they reach OpenCode", () => {
  const fields: FormField[] = [
    { key: "pick", type: "string", title: "Pick", options: [{ value: "a", label: "A" }], custom: false },
    { key: "free", type: "string", title: "Free" },
    { key: "many", type: "multiselect", title: "Many", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    { key: "ok", type: "boolean", title: "Okay" },
    { key: "count", type: "integer", title: "Count" },
    { key: "page", type: "external", title: "Page", url: "https://example.com" },
  ];
  assert.deepEqual(checkAnswer(fields, { pick: "a", free: "anything", many: ["x"], ok: true, count: 3 }), { pick: "a", free: "anything", many: ["x"], ok: true, count: 3 });
  for (const bad of [undefined, [], {}, { pick: "b" }, { free: " " }, { many: ["z"] }, { ok: "yes" }, { count: 1.5 }, { page: "x" }, { unknown: "x" }]) {
    assert.throws(() => checkAnswer(fields, bad), /./, JSON.stringify(bad));
  }
});

test("OpenCode events become the few browser updates the screen needs", () => {
  const event = (type: string, data: Record<string, unknown>) => ({ type, data });
  assert.deepEqual(browserEvents(event("session.text.delta", { sessionID: "s", assistantMessageID: "m", ordinal: 0, delta: "Hi" })),
    [{ type: "delta", sessionID: "s", messageID: "m", partID: "m:text:0", partType: "text", delta: "Hi" }]);
  assert.deepEqual(browserEvents(event("session.tool.failed", { sessionID: "s" })), [{ type: "changed", sessionID: "s" }]);
  assert.deepEqual(browserEvents(event("session.execution.failed", { sessionID: "s", error: { message: "No route." } })),
    [{ type: "state" }, { type: "changed", sessionID: "s" }, { type: "finished", sessionID: "s", outcome: "failed" }, { type: "error", sessionID: "s", message: "No route." }]);
  for (const outcome of ["succeeded", "interrupted"] as const) {
    assert.deepEqual(browserEvents(event(`session.execution.${outcome}`, { sessionID: "s" })),
      [{ type: "state" }, { type: "changed", sessionID: "s" }, { type: "finished", sessionID: "s", outcome }]);
  }
  assert.deepEqual(browserEvents(event("permission.asked", { sessionID: "s" })), [{ type: "state" }]);
  assert.deepEqual(browserEvents(event("session.text.started", { sessionID: "s" })), []);
});

test("saved history keeps real errors and explains stopped work", () => {
  const at = { created: 1 };
  const history = [
    { id: "u1", type: "user", text: "Run it", time: at },
    { id: "a1", type: "assistant", content: [{ type: "tool", id: "c", name: "shell", state: { status: "error", input: {}, error: { type: "aborted", message: "The user declined this tool call" } } }], error: { type: "aborted", message: "Step interrupted" }, time: at },
    { id: "u2", type: "user", text: "Again", time: at },
    { id: "a2", type: "assistant", content: [{ type: "text", text: "Starting" }], error: { type: "aborted", message: "Step interrupted" }, time: at },
    { id: "u3", type: "user", text: "Once more", time: at },
    { id: "i3", type: "idle", outcome: "failed", error: { type: "provider", message: "The model cannot be reached." }, time: at },
  ] as unknown as SessionMessage[];
  const chat = chatMessages(history);
  assert.equal(chat.length, 6);
  assert.equal(chat[1]!.error, undefined, "a declined action already explains itself");
  assert.match(chat[1]!.parts[0]!.text, /^shell/);
  assert.equal(chat[3]!.error, STOPPED);
  assert.equal(chat[5]!.role, "assistant");
  assert.equal(chat[5]!.error, "The model cannot be reached.");
  assert.equal(chat[1]!.outcome, "interrupted");
  assert.equal(chat[3]!.outcome, "interrupted");
  assert.equal(chat[5]!.outcome, "failed");
});

test("stored terminal outcomes recover missed live events without inventing completion for partial replies", () => {
  const history: SessionMessage[] = [
    { id: "u", type: "user", text: "Explain", time: { created: 1 } },
    { id: "a", type: "assistant", content: [{ type: "text", text: "The answer." }], time: { created: 2 } },
  ];
  assert.equal(chatMessages(history).at(-1)?.outcome, undefined);
  history.push({ id: "i", type: "idle", outcome: "succeeded", time: { created: 3 } });
  assert.equal(chatMessages(history).at(-1)?.outcome, "succeeded");
  assert.equal(chatMessages(history).length, 2);
});

test("with no provider signed in, setup is needed and nothing is invented", async (t) => {
  const context = await setup();
  t.after(context.cleanup);
  await context.login();
  context.fixture.setSignedIn(false);
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
    localSpeechReady: async () => true,
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

test("choosing local speech for the first time downloads it in the background, then uses it without a restart", async (t) => {
  let ready = false;
  let finish!: () => void;
  const started: Record<string, unknown>[] = [];
  const context = await setup({
    localSpeechReady: async () => ready,
    setUpLocalSpeech: async (onStep) => {
      onStep("Downloading and checking the Whisper and Kokoro models (about 432 MB)...");
      await new Promise<void>((resolve) => { finish = resolve; });
      ready = true;
    },
    startSpeech: async (settings) => {
      started.push(settings);
      return { ...speechFixture().service, selection: { listening: "whisper", speaking: "kokoro" } };
    },
  });
  t.after(context.cleanup);
  await context.login();
  assert.equal(((await (await context.request("settings")).json()) as { localReady: boolean }).localReady, false);

  const choice = { listening: "whisper", speaking: "kokoro", kokoroVoice: "bf_emma" };
  const accepted = await context.request("settings", choice);
  assert.equal(accepted.status, 202);
  assert.equal(((await accepted.json()) as { state: string }).state, "running");
  const running = await (await context.request("speech-setup")).json() as { state: string; step: string };
  assert.deepEqual(running, { state: "running", step: "Downloading and checking the Whisper and Kokoro models (about 432 MB)..." });
  assert.equal((await context.request("settings", choice)).status, 409, "a second download is not started");
  assert.equal(started.length, 0, "nothing is used before the files are there");

  finish();
  let job: { state: string; result?: { localReady: boolean } } = running;
  while (job.state === "running") {
    await new Promise((resolve) => setTimeout(resolve, 20));
    job = await (await context.request("speech-setup")).json() as typeof job;
  }
  assert.equal(job.state, "done");
  assert.equal(job.result?.localReady, true);
  assert.equal(started.length, 1);
  const state = await (await context.request("state")).json() as AppState;
  assert.deepEqual(state.speech, { configured: true, listening: "whisper", speaking: "kokoro" });
});

test("a failed local speech download is reported and changes nothing", async (t) => {
  const context = await setup({
    localSpeechReady: async () => false,
    setUpLocalSpeech: async () => { throw new Error("uv is not installed."); },
    startSpeech: async () => { throw new Error("must not start"); },
  });
  t.after(context.cleanup);
  await context.login();
  assert.equal((await context.request("settings", { listening: "whisper", speaking: "mai" })).status, 202);
  let job: { state: string; error?: string } = { state: "running" };
  while (job.state === "running") {
    await new Promise((resolve) => setTimeout(resolve, 20));
    job = await (await context.request("speech-setup")).json() as typeof job;
  }
  assert.deepEqual(job, { state: "failed", step: "Starting the download", error: "uv is not installed." });
  const state = await (await context.request("state")).json() as AppState;
  assert.equal(state.speech?.configured, false);
});

test("speech settings live in the user's home folder, and earlier settings are copied there once", async (t) => {
  const home = await mkdtemp(resolve(".picard-test-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const old = join(home, "old.json");
  await writeFile(old, '{"listening":"whisper"}\n');
  const file = await speechSettingsFile(home, [join(home, "missing.json"), old]);
  assert.equal(file, join(home, ".picard-code", "speech.json"));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { listening: "whisper" });
  await writeFile(old, '{"listening":"mai"}\n');
  assert.equal(await speechSettingsFile(home, [old]), file);
  assert.equal(JSON.parse(await readFile(file, "utf8")).listening, "whisper", "a later change to the old file is not copied again");
  await saveSpeechSettings(join(home, "fresh", "speech.json"), { speaking: "kokoro" });
  assert.deepEqual(JSON.parse(await readFile(join(home, "fresh", "speech.json"), "utf8")), { speaking: "kokoro" });
});
