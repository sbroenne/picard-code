import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { FormRequest, PermissionRequest } from "../shared/types.js";
import type { ContentItem, SessionInfo, SessionMessage } from "../server/opencode.js";

/** A staged example answer for the project website screenshot; no model wrote it and no project was examined. */
export const EXAMPLE_ANSWER = "The settings test fails because the default voice replaces the saved choice when the app starts.\n\n"
  + "In `src/settings.ts`, apply the defaults first and the saved settings second:\n\n"
  + "```ts\nconst settings = { ...defaults, ...saved };\n```\n\n"
  + "Shall I make that change and run the test again?";

/**
 * A local stand-in for OpenCode 2's server, shaped after real OpenCode 2.2.5 behaviour.
 * It does not call a model or run tools.
 */
export async function startFixture(project: string) {
  const password = "fixture-password-not-a-real-credential";
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const sessions = new Map<string, SessionInfo>();
  const messages = new Map<string, SessionMessage[]>();
  const active = new Set<string>();
  const instructions = new Map<string, Record<string, string>>();
  const permissions: PermissionRequest[] = [];
  const forms: FormRequest[] = [];
  const listeners = new Set<ServerResponse>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const pending = new Map<string, (data: Record<string, unknown>) => void>();
  const generations = new Map<string, number>();
  const requests: { method: string; path: string; directory: string; data: Record<string, unknown> }[] = [];
  let signedIn = true;
  const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

  const publish = (directory: string, type: string, data: unknown) => {
    for (const listener of listeners) listener.write(`data: ${JSON.stringify({ id: id("evt"), created: Date.now(), type, location: { directory }, data })}\n\n`);
  };
  const later = (action: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); action(); }, delay);
    timers.add(timer);
  };
  const current = (sessionID: string, generation?: number) => active.has(sessionID) && generations.get(sessionID) === generation;
  // Like real OpenCode 2.2.5: stopping work saves an "interrupted" entry; a declined action or skipped question saves none.
  const finish = (sessionID: string, outcome: "succeeded" | "failed" | "interrupted", error?: { type: string; message: string }, reason: "user" | "shutdown" = "user") => {
    const directory = sessions.get(sessionID)!.location.directory;
    active.delete(sessionID);
    if (reason === "user") messages.get(sessionID)!.push({ id: id("msg"), type: "idle", outcome, ...(error ? { error } : {}), time: { created: Date.now() } } as SessionMessage);
    publish(directory, `session.execution.${outcome}`, { sessionID, ...(error ? { error } : {}), ...(outcome === "interrupted" ? { reason } : {}) });
  };
  const assistant = (sessionID: string, content: ContentItem[], error?: { type: string; message: string }) => {
    const message = { id: id("msg"), type: "assistant" as const, content, ...(error ? { error } : {}), time: { created: Date.now() } };
    messages.get(sessionID)!.push(message);
    return message;
  };
  const createSession = (directory = project, title = "New conversation") => {
    const session: SessionInfo = { id: id("ses"), title, agent: "build", location: { directory }, time: { created: Date.now(), updated: Date.now() } };
    sessions.set(session.id, session);
    messages.set(session.id, []);
    publish(directory, "session.created", { sessionID: session.id, title, location: { directory } });
    return session;
  };
  // Like OpenCode 2, live text is numbered within its reply and stored only once the piece ends.
  const reply = (sessionID: string, text = "A genuinely streamed reply from the test fixture.", generation = generations.get(sessionID)) => {
    if (!current(sessionID, generation)) return;
    const directory = sessions.get(sessionID)!.location.directory;
    const item = { type: "text" as const, text: "" };
    const message = assistant(sessionID, [item]);
    const base = { sessionID, assistantMessageID: message.id, ordinal: 0 };
    publish(directory, "session.step.started", { sessionID, assistantMessageID: message.id });
    publish(directory, "session.text.started", base);
    const words = text.split(/(?<=\s)/);
    words.forEach((word, index) => {
      later(() => {
        if (!current(sessionID, generation)) return;
        publish(directory, "session.text.delta", { ...base, delta: word });
        if (index === words.length - 1) {
          item.text = text;
          publish(directory, "session.text.ended", { ...base, text });
          publish(directory, "session.step.ended", { sessionID, assistantMessageID: message.id });
          finish(sessionID, "succeeded");
        }
      }, 80 * (index + 1));
    });
  };
  // Once allowed or answered, the waiting action finishes before the next step replies.
  const completeTool = (sessionID: string, tool: string, output: string) => {
    for (const message of messages.get(sessionID)!) {
      if (message.type !== "assistant" || !("content" in message)) continue;
      for (const item of message.content) {
        if (item.type === "tool" && item.name === tool && item.state.status === "running") item.state = { status: "completed", input: item.state.input, content: [{ type: "text", text: output }] };
      }
    }
    publish(sessions.get(sessionID)!.location.directory, "session.tool.success", { sessionID, id: "call_test" });
  };
  // Like OpenCode 2, a denied action or a skipped question fails the action and stops the work.
  const stopWithFailedTool = (sessionID: string, tool: string, input: unknown, reason: string, generation = generations.get(sessionID)) => {
    if (!current(sessionID, generation)) return;
    const directory = sessions.get(sessionID)!.location.directory;
    const message = messages.get(sessionID)!.findLast((item) => item.type === "assistant");
    const content = message && "content" in message ? message.content : [];
    const existing = content.find((item) => item.type === "tool" && item.name === tool);
    const failed = { status: "error", input, error: { type: "aborted", message: reason } };
    if (existing && existing.type === "tool") existing.state = failed;
    else content.push({ type: "tool", id: "call_test", name: tool, state: failed });
    if (message && message.type === "assistant") Object.assign(message, { error: { type: "aborted", message: "Step interrupted" } });
    publish(directory, "session.tool.failed", { sessionID, id: "call_test", error: failed.error });
    publish(directory, "session.step.failed", { sessionID });
    finish(sessionID, "interrupted", undefined, "shutdown");
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const header = request.headers["x-opencode-directory"];
      const directory = typeof header === "string" ? decodeURIComponent(header) : url.searchParams.get("directory") ?? project;
      const send = (status: number, value?: unknown) => {
        response.writeHead(status, value === undefined ? {} : { "Content-Type": "application/json" });
        response.end(value === undefined ? undefined : JSON.stringify(value));
      };
      if (request.headers.authorization !== authorization) { send(401, { message: "Password required" }); return; }
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      const path = url.pathname;
      requests.push({ method: request.method ?? "GET", path, directory, data });
      const models = signedIn ? [
        { id: "fixture-model", modelID: "fixture-model", providerID: "github-copilot", name: "Copilot test model", status: "active", enabled: true, settings: { secret: "must-never-reach-browser" } },
        { id: "other", modelID: "other", providerID: "other-provider", name: "Other model", status: "active", enabled: true },
        { id: "old", modelID: "old", providerID: "other-provider", name: "Retired model", status: "deprecated", enabled: true },
      ] : [];
      const providers = [
        { id: "github-copilot", name: "GitHub Copilot", settings: { baseURL: "https://api.githubcopilot.com" } },
        { id: "other-provider", name: "Other Provider", settings: { apiKey: "provider-key-must-never-reach-browser" } },
      ];
      if (path === "/api/info") { send(200, { version: "2.2.5-fixture" }); return; }
      if (path === "/api/location") { send(200, { directory, project: { id: "global", directory, canonical: directory } }); return; }
      if (path === "/api/location/reload") { send(204); return; }
      if (path === "/api/model") { send(200, { data: models }); return; }
      if (path === "/api/provider") { send(200, { data: providers }); return; }
      if (path === "/api/model/default") { send(200, { data: models[0] }); return; }
      if (path === "/api/event") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ id: id("evt"), created: Date.now(), type: "server.connected", data: {} })}\n\n`);
        listeners.add(response);
        response.on("close", () => listeners.delete(response));
        return;
      }
      if (path === "/api/session/active") { send(200, { data: Object.fromEntries([...active].map((item) => [item, { type: "running" }])) }); return; }
      if (path === "/api/permission/request") { send(200, { data: permissions }); return; }
      if (path === "/api/form") { send(200, { data: forms }); return; }
      if (path === "/api/session") {
        if (request.method === "POST") {
          const location = data.location as { directory: string };
          send(200, { data: createSession(location.directory, typeof data.title === "string" ? data.title : undefined) });
        } else {
          const wanted = url.searchParams.get("directory");
          send(200, { data: [...sessions.values()].reverse().filter((session) => !wanted || session.location.directory === wanted) });
        }
        return;
      }
      const entry = /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries\/([^/]+)$/.exec(path);
      if (entry && request.method === "PUT") {
        instructions.set(entry[1]!, { ...instructions.get(entry[1]!), [decodeURIComponent(entry[2]!)]: String(data.value) });
        send(204);
        return;
      }
      const match = /^\/api\/session\/([^/]+)(?:\/(message|prompt|interrupt|model|permission|form)(?:\/([^/]+)(?:\/(reply))?)?)?$/.exec(path);
      if (match) {
        const sessionID = match[1]!;
        const session = sessions.get(sessionID);
        if (!session) { send(404, { message: "Conversation not found" }); return; }
        const action = match[2];
        if (!action) {
          if (request.method === "PATCH" && typeof data.title === "string") { session.title = data.title; send(204); }
          else if (request.method === "DELETE") {
            sessions.delete(sessionID);
            messages.delete(sessionID);
            publish(directory, "session.deleted", { sessionID });
            send(204);
          }
          else send(200, { data: session });
        } else if (action === "model") {
          session.model = data.model as SessionInfo["model"];
          send(204);
        } else if (action === "message") {
          const snapshot = structuredClone(messages.get(sessionID)!);
          await new Promise<void>((resolve) => later(resolve, 150));
          send(200, { data: url.searchParams.get("order") === "asc" ? snapshot : snapshot.reverse(), cursor: {} });
        } else if (action === "interrupt") {
          generations.set(sessionID, (generations.get(sessionID) ?? 0) + 1);
          pending.delete(sessionID);
          for (let index = permissions.length - 1; index >= 0; index--) if (permissions[index]?.sessionID === sessionID) permissions.splice(index, 1);
          for (let index = forms.length - 1; index >= 0; index--) if (forms[index]?.sessionID === sessionID) forms.splice(index, 1);
          if (active.has(sessionID)) finish(sessionID, "interrupted");
          send(200, {});
        } else if (action === "permission" && match[4] === "reply") {
          const index = permissions.findIndex((item) => item.id === match[3] && item.sessionID === sessionID);
          if (index < 0) { send(404, { message: "No pending request" }); return; }
          const item = permissions.splice(index, 1)[0]!;
          publish(directory, "permission.replied", { sessionID, requestID: item.id, reply: data.decision });
          send(204);
          const continuation = pending.get(sessionID);
          pending.delete(sessionID);
          later(() => continuation?.(data), 20);
        } else if (action === "form" && match[3]) {
          const index = forms.findIndex((item) => item.id === match[3] && item.sessionID === sessionID);
          if (index < 0) { send(404, { message: "No pending form" }); return; }
          const item = forms.splice(index, 1)[0]!;
          if (request.method === "DELETE") publish(directory, "form.cancelled", { id: item.id, sessionID });
          else publish(directory, "form.replied", { id: item.id, sessionID, answer: data.answer });
          send(204);
          const continuation = pending.get(sessionID);
          pending.delete(sessionID);
          later(() => continuation?.(request.method === "DELETE" ? { skip: true } : data), 20);
        } else if (action === "prompt") {
          if (active.has(sessionID)) { send(409, { message: "The conversation is busy." }); return; }
          const generation = (generations.get(sessionID) ?? 0) + 1;
          generations.set(sessionID, generation);
          const text = String(data.text ?? "");
          messages.get(sessionID)!.push({ id: id("msg"), type: "user", text, time: { created: Date.now() } });
          active.add(sessionID);
          publish(directory, "session.execution.started", { sessionID });
          send(200, {});
          if (text.includes("approval")) {
            const input = { command: "echo hello" };
            assistant(sessionID, [{ type: "tool", id: "call_test", name: "shell", state: { status: "running", input } }]);
            const permission: PermissionRequest = { id: id("per"), sessionID, action: "shell", resources: ["echo hello"], metadata: input };
            permissions.push(permission);
            pending.set(sessionID, (answer) => answer.decision === "reject"
              ? stopWithFailedTool(sessionID, "shell", input, "The user declined this tool call", generation)
              : (completeTool(sessionID, "shell", "Test stand-in: no command was run."), reply(sessionID, "The test approval was answered. No command was executed.", generation)));
            later(() => publish(directory, "permission.asked", permission), 50);
          } else if (text.includes("question")) {
            const input = { questions: [{ header: "Direction", question: "Which approach should I use?" }] };
            assistant(sessionID, [{ type: "tool", id: "call_test", name: "question", state: { status: "running", input } }]);
            const form: FormRequest = { id: id("frm"), sessionID, title: "Questions", fields: [{
              key: "q0", type: "string", title: "Direction", description: "Which approach should I use?",
              options: [{ value: "Small change", label: "Small change", description: "Keep the scope focused." }, { value: "Explain first", label: "Explain first", description: "Discuss before changing files." }],
              custom: !text.includes("choose"),
            }] };
            forms.push(form);
            pending.set(sessionID, (answer) => answer.skip
              ? stopWithFailedTool(sessionID, "question", input, "The user dismissed this question", generation)
              : (completeTool(sessionID, "question", String((answer.answer as Record<string, unknown>).q0)), reply(sessionID, `Your test answer was received: ${JSON.stringify([[(answer.answer as Record<string, unknown>).q0]])}.`, generation)));
            later(() => publish(directory, "form.created", { form }), 50);
          } else if (text.includes("broken")) {
            later(() => {
              if (!current(sessionID, generation)) return;
              finish(sessionID, "failed", { type: "provider.no-route", message: "The test model cannot be reached." });
            }, 100);
          } else {
            later(() => reply(sessionID, text.includes("unsafe") ? "<img src=x onerror=alert('unsafe')>\n```js\nconst safe = true;\n```\n\n## Result\n\nThis is **bold**, *emphasis* and `code`.\n\n- first\n- second\n\n| Name | Value |\n| --- | --- |\n| a | 1 |\n\n[Docs](https://example.com) [Bad](javascript:alert(1)) ![Picture](https://example.com/p.png)"
              : text.includes("settings test") ? EXAMPLE_ANSWER : undefined, generation), text.includes("very") ? 20_000 : text.includes("slow") ? 5000 : 100);
          }
        } else send(404, { message: `Unimplemented fixture path ${path}` });
        return;
      }
      send(404, { message: `Unimplemented fixture path ${path}` });
    })().catch((error) => { response.writeHead(500); response.end(String(error)); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not start.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    password, requests, permissions, forms, active, instructions,
    createSession,
    publish,
    setSignedIn: (ready: boolean) => { signedIn = ready; },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      for (const listener of listeners) listener.end();
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
