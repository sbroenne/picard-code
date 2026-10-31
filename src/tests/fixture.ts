import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { PermissionRequest, PermissionRule, QuestionRequest } from "@opencode-ai/sdk/v2";
import { rulesToAdd } from "../server/confirm.js";

interface FixtureSession {
  id: string;
  title: string;
  directory: string;
  time: { created: number; updated: number };
  permission?: PermissionRule[];
}
interface FixtureMessage {
  info: { id: string; sessionID: string; role: "user" | "assistant"; time: { created: number } };
  parts: { id: string; messageID: string; sessionID: string; type: "text"; text: string }[];
}

/** A local OpenCode-protocol fixture; it does not call a model or execute tools. */
export async function startFixture(project: string) {
  const password = "fixture-password-not-a-real-credential";
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const sessions = new Map<string, FixtureSession>();
  const messages = new Map<string, FixtureMessage[]>();
  const statuses: Record<string, { type: string }> = {};
  const permissions: PermissionRequest[] = [];
  const questions: QuestionRequest[] = [];
  const listeners = new Set<{ directory: string; response: ServerResponse }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const pending = new Map<string, (data: Record<string, unknown>) => void>();
  const generations = new Map<string, number>();
  const requests: { method: string; path: string; directory: string; data: Record<string, unknown> }[] = [];
  let copilot = true;
  // Shaped like OpenCode's own build agent: allow everything, with a few asks and denies.
  const buildRules: PermissionRule[] = [
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "doom_loop", pattern: "*", action: "ask" },
    { permission: "external_directory", pattern: "*", action: "ask" },
    { permission: "read", pattern: "*.env", action: "ask" },
    { permission: "bash", pattern: "rm *", action: "deny" },
  ];

  const publish = (directory: string, type: string, properties: unknown) => {
    for (const listener of listeners) {
      if (listener.directory === directory) listener.response.write(`data: ${JSON.stringify({ id: randomUUID(), type, properties })}\n\n`);
    }
  };
  const later = (action: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); action(); }, delay);
    timers.add(timer);
  };
  const setStatus = (id: string, type: string) => {
    statuses[id] = { type };
    const session = sessions.get(id)!;
    publish(session.directory, "session.status", { sessionID: id, status: { type } });
    if (type === "idle") publish(session.directory, "session.idle", { sessionID: id });
  };
  const createSession = (directory = project, title = "New conversation") => {
    const session = { id: `ses_${randomUUID()}`, title, directory, time: { created: Date.now(), updated: Date.now() } };
    sessions.set(session.id, session);
    messages.set(session.id, []);
    publish(directory, "session.created", { sessionID: session.id, info: session });
    return session;
  };
  const reply = (id: string, text = "A genuinely streamed reply from the test fixture.", generation = generations.get(id)) => {
    if (generations.get(id) !== generation || statuses[id]?.type === "idle") return;
    const session = sessions.get(id)!;
    const messageID = `msg_${randomUUID()}`;
    const part = { id: `prt_${randomUUID()}`, messageID, sessionID: id, type: "text" as const, text: "" };
    const message: FixtureMessage = { info: { id: messageID, sessionID: id, role: "assistant", time: { created: Date.now() } }, parts: [part] };
    messages.get(id)!.push(message);
    publish(session.directory, "message.updated", { sessionID: id, info: message.info });
    publish(session.directory, "message.part.updated", { sessionID: id, part, time: Date.now() });
    const words = text.split(/(?<=\s)/);
    words.forEach((word, index) => {
      later(() => {
        if (statuses[id]?.type === "idle" || generations.get(id) !== generation) return;
        part.text += word;
        publish(session.directory, "message.part.delta", { sessionID: id, messageID, partID: part.id, field: "text", delta: word });
        if (index === words.length - 1) {
          publish(session.directory, "message.part.updated", { sessionID: id, part, time: Date.now() });
          setStatus(id, "idle");
        }
      }, 80 * (index + 1));
    });
  };
  // Like real OpenCode, a denied action ends the turn with a failed tool and no written reply.
  const refuse = (id: string, generation = generations.get(id)) => {
    if (generations.get(id) !== generation || statuses[id]?.type === "idle") return;
    const session = sessions.get(id)!;
    const messageID = `msg_${randomUUID()}`;
    const part = { id: `prt_${randomUUID()}`, messageID, sessionID: id, type: "tool" as const, callID: "call_test", tool: "bash",
      state: { status: "error" as const, input: { command: "echo hello" }, error: "The user rejected permission to use this specific tool call.", time: { start: Date.now(), end: Date.now() } } };
    const message = { info: { id: messageID, sessionID: id, role: "assistant", time: { created: Date.now() } }, parts: [part] } as unknown as FixtureMessage;
    messages.get(id)!.push(message);
    publish(session.directory, "message.updated", { sessionID: id, info: message.info });
    publish(session.directory, "message.part.updated", { sessionID: id, part, time: Date.now() });
    setStatus(id, "idle");
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const directory = url.searchParams.get("directory") ?? project;
      const send = (status: number, value?: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(value === undefined ? undefined : JSON.stringify(value));
      };
      if (request.headers.authorization !== authorization) { send(401, { error: "Password required" }); return; }
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      requests.push({ method: request.method ?? "GET", path: url.pathname, directory, data });
      if (url.pathname === "/global/health") { send(200, { healthy: true, version: "1.19.5-fixture" }); return; }
      if (url.pathname === "/path") { send(200, { directory, worktree: directory }); return; }
      if (url.pathname === "/provider") {
        send(200, {
          all: [
            { id: "github-copilot", name: "GitHub Copilot", models: { "fixture-model": { id: "fixture-model", name: "Copilot test model", status: "active" } }, options: { secret: "must-never-reach-browser" } },
            { id: "other-provider", name: "Other", models: { other: { id: "other", name: "Other model" } } },
          ],
          connected: copilot ? ["github-copilot", "other-provider"] : ["other-provider"],
          default: { "github-copilot": "fixture-model" },
        });
        return;
      }
      if (url.pathname === "/event") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
        const listener = { directory, response };
        listeners.add(listener);
        response.on("close", () => listeners.delete(listener));
        return;
      }
      if (url.pathname === "/session/status") { send(200, statuses); return; }
      if (url.pathname === "/permission") { send(200, permissions); return; }
      if (url.pathname === "/question") { send(200, questions); return; }
      if (url.pathname === "/instance/dispose") { send(200, true); return; }
      if (url.pathname === "/agent") { send(200, [{ name: "build", mode: "primary", options: {}, permission: buildRules }]); return; }
      if (url.pathname === "/session") {
        if (request.method === "POST") send(200, createSession(directory, typeof data.title === "string" ? data.title : undefined));
        else send(200, Array.from(sessions.values()).reverse());
        return;
      }
      const match = /^\/session\/([^/]+)(?:\/(message|prompt_async|abort))?$/.exec(url.pathname);
      if (match) {
        const id = match[1]!;
        const session = sessions.get(id);
        if (!session) { send(404, { message: "Conversation not found" }); return; }
        if (!match[2]) {
          if (request.method === "PATCH" && typeof data.title === "string") session.title = data.title;
          if (request.method === "PATCH" && Array.isArray(data.permission)) session.permission = [...session.permission ?? [], ...data.permission as PermissionRule[]];
          send(200, session);
        } else if (match[2] === "message") {
          const snapshot = structuredClone(messages.get(id));
          await new Promise<void>((resolve) => later(resolve, 150));
          send(200, snapshot);
        }
        else if (match[2] === "abort") {
          generations.set(id, (generations.get(id) ?? 0) + 1);
          pending.delete(id);
          for (let index = permissions.length - 1; index >= 0; index--) if (permissions[index]?.sessionID === id) permissions.splice(index, 1);
          for (let index = questions.length - 1; index >= 0; index--) if (questions[index]?.sessionID === id) questions.splice(index, 1);
          setStatus(id, "idle");
          send(200, true);
        } else {
          // Picard Code must make changes ask first before sending anything.
          if (data.agent !== "build" || rulesToAdd(buildRules, session.permission ?? [])) {
            send(400, { message: "The test stand-in refused: changes were not set to ask first." });
            return;
          }
          const generation = (generations.get(id) ?? 0) + 1;
          generations.set(id, generation);
          const parts = data.parts as { text: string }[];
          const text = parts[0]?.text ?? "";
          const messageID = `msg_${randomUUID()}`;
          const part = { id: `prt_${randomUUID()}`, messageID, sessionID: id, type: "text" as const, text };
          const message: FixtureMessage = { info: { id: messageID, sessionID: id, role: "user", time: { created: Date.now() } }, parts: [part] };
          messages.get(id)!.push(message);
          setStatus(id, "busy");
          publish(directory, "message.updated", { sessionID: id, info: message.info });
          publish(directory, "message.part.updated", { sessionID: id, part, time: Date.now() });
          send(204);
          if (text.includes("approval")) {
            const permission = { id: `per_${randomUUID()}`, sessionID: id, permission: "bash", patterns: ["echo hello"], metadata: { command: "echo hello" }, always: ["echo *"] };
            permissions.push(permission);
            pending.set(id, (answer) => answer.reply === "reject" ? refuse(id, generation)
              : reply(id, "The test approval was answered. No command was executed.", generation));
            later(() => publish(directory, "permission.asked", permission), 50);
          } else if (text.includes("question")) {
            const question = { id: `que_${randomUUID()}`, sessionID: id, questions: [{ header: "Direction", question: "Which approach should I use?", options: [{ label: "Small change", description: "Keep the scope focused." }, { label: "Explain first", description: "Discuss before changing files." }], custom: !text.includes("choose") }] };
            questions.push(question);
            pending.set(id, (answer) => reply(id, `Your test answer was received: ${JSON.stringify(answer.answers ?? "skipped")}.`, generation));
            later(() => publish(directory, "question.asked", question), 50);
          } else {
            later(() => reply(id, text.includes("unsafe") ? "<img src=x onerror=alert('unsafe')>\n```js\nconst safe = true;\n```" : undefined, generation), text.includes("very") ? 20_000 : text.includes("slow") ? 5000 : 100);
          }
        }
        return;
      }
      const approval = /^\/(permission|question)\/([^/]+)\/(reply|reject)$/.exec(url.pathname);
      if (approval) {
        const items = approval[1] === "permission" ? permissions : questions;
        const index = items.findIndex((item) => item.id === approval[2]);
        if (index < 0) { send(404, { message: "No pending request" }); return; }
        const item = items[index]!;
        items.splice(index, 1);
        publish(directory, `${approval[1]}.replied`, { requestID: item.id, sessionID: item.sessionID });
        send(200, true);
        const continuation = pending.get(item.sessionID);
        pending.delete(item.sessionID);
        later(() => continuation?.(data), 20);
        return;
      }
      send(404, { message: `Unimplemented fixture path ${url.pathname}` });
    })().catch((error) => { response.writeHead(500); response.end(String(error)); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not start.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    password, requests, permissions, questions, statuses,
    createSession,
    publish,
    setCopilot: (ready: boolean) => { copilot = ready; },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      for (const listener of listeners) listener.response.end();
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
