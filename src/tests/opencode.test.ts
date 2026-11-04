import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenCode } from "../server/opencode.js";

type Seen = { method: string; url: string; type?: string; directory?: string; body: string };

/** A labelled stand-in for OpenCode's HTTP interface that answers each request with the given handler. */
async function stub(t: import("node:test").TestContext, answer: (request: IncomingMessage, response: ServerResponse, seen: Seen) => void) {
  const seen: Seen[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const entry = { method: request.method!, url: request.url!, type: request.headers["content-type"], directory: request.headers["x-opencode-directory"] as string | undefined, body };
    seen.push(entry);
    answer(request, response, entry);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }));
  return { client: new OpenCode(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "test"), seen };
}

test("OpenCode errors keep its own words, and plain failures are explained without inventing a cause", async (t) => {
  const answers: [number, string][] = [
    [401, "Unauthorized"],
    [500, "<html>Internal error</html>"],
    [400, JSON.stringify({ message: "Unknown model." })],
    [409, JSON.stringify({ error: "The session is busy." })],
    [422, JSON.stringify({ error: { message: "The folder is not a Project." } })],
    [503, JSON.stringify({ error: {} })],
  ];
  let next = 0;
  const { client } = await stub(t, (_request, response) => {
    const [status, body] = answers[next++]!;
    response.writeHead(status).end(body);
  });
  for (const [status, message] of [
    [401, "OpenCode refused the password."],
    [500, "OpenCode answered with status 500."],
    [400, "Unknown model."],
    [409, "The session is busy."],
    [422, "The folder is not a Project."],
    [503, "OpenCode answered with status 503."],
  ] as const) await assert.rejects(client.info(), { status, message });
});

test("requests send JSON only with a body, and use OpenCode's routes for reloading and renaming", async (t) => {
  const { client, seen } = await stub(t, (_request, response) => response.end());
  await client.reload("/project one");
  await client.rename("entry/1", "/project one", "Warp core report");
  assert.deepEqual(seen, [
    { method: "POST", url: "/api/location/reload", type: undefined, directory: "%2Fproject%20one", body: "" },
    { method: "PATCH", url: "/api/session/entry%2F1", type: "application/json", directory: "%2Fproject%20one", body: JSON.stringify({ title: "Warp core report" }) },
  ]);
});

test("models set in OpenCode's settings are read in either form, and anything else is ignored", async (t) => {
  let documents: unknown = [
    { info: { model: "anthropic/claude-sonnet/latest" } },
    { info: { model: { providerID: "openai", model: "gpt-test" } } },
    { info: { model: "no-provider" } },
    { info: { model: { providerID: "openai" } } },
    { info: { model: { providerID: 3, model: "x" } } },
    { info: {} },
    {},
  ];
  const { client } = await stub(t, (_request, response) => response.end(JSON.stringify(documents)));
  assert.deepEqual(await client.configuredModels("/project"), [
    { providerID: "anthropic", id: "claude-sonnet/latest" },
    { providerID: "openai", id: "gpt-test" },
  ]);
  documents = { info: { model: "anthropic/claude" } };
  assert.deepEqual(await client.configuredModels("/project"), []);
});

test("crew entries are read page by page, and a repeated page is reported instead of looping", async (t) => {
  const session = (id: string) => ({ id });
  let pages: Record<string, { data: { id: string }[]; cursor?: { next?: string | null } }> = {};
  const { client, seen } = await stub(t, (request, response) => {
    const url = new URL(request.url!, "http://stub");
    response.end(JSON.stringify(pages[url.searchParams.get("cursor") ?? "first"]));
  });
  pages = { first: { data: [session("a")], cursor: { next: "two" } }, two: { data: [session("b")], cursor: { next: "three" } }, three: { data: [session("c")], cursor: { next: null } } };
  assert.deepEqual(await client.sessions("/project"), [session("a")], "top-level entries use one page");
  assert.deepEqual(await client.sessions("/project", "parent"), [session("a"), session("b"), session("c")]);
  assert.deepEqual(seen.slice(1).map(({ url }) => new URL(url, "http://stub").searchParams.get("cursor")), [null, "two", "three"]);
  pages = { first: { data: [session("a")], cursor: { next: "two" } }, two: { data: [session("b")], cursor: { next: "two" } } };
  await assert.rejects(client.sessions("/project", "parent"), { message: "OpenCode returned the same page of crew entries twice." });
});

test("the live event stream skips comments and broken events, and a refused stream is a real error", async (t) => {
  let refuse = false;
  const { client } = await stub(t, (_request, response) => {
    if (refuse) { response.writeHead(401).end(); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end([
      ": keep-alive\n\n",
      "event: ping\n\n",
      "data: not json\n\n",
      "data: {\"data\":{}}\n\n",
      "data: {\"type\":\"server.connected\",\"id\":\"e1\"}\r\n\r\n",
      "data: {\"type\":\"session.updated\",\n",
      "data: \"data\":{\"sessionID\":\"s\"}}\n\n",
    ].join(""));
  });
  const events = [];
  for await (const event of client.events(AbortSignal.timeout(5000))) events.push(event);
  assert.deepEqual(events, [
    { type: "server.connected", data: {}, id: "e1" },
    { type: "session.updated", data: { sessionID: "s" } },
  ]);
  refuse = true;
  await assert.rejects(async () => { for await (const event of client.events(AbortSignal.timeout(5000))) void event; }, { status: 401, message: "OpenCode refused the password." });
});
