import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { FormRequest, PermissionRequest } from "../shared/types.js";
import type { ContentItem, IntegrationInfo, ModelInfo, OpenCode, ProviderInfo, SessionInfo, SessionMessage } from "../server/opencode.js";
import type { WikipediaArticle } from "../server/wikipedia.js";

export async function wikipediaFixture(subject: WikipediaArticle["subject"]): Promise<WikipediaArticle> {
  const title = subject === "Picard" ? "Jean-Luc Picard" : "Patrick Stewart";
  return {
    subject, title: `Wikipedia: ${title}`, url: `https://en.wikipedia.org/wiki/${title.replaceAll(" ", "_")}`,
    text: `TEST ONLY Wikipedia stand-in, not a downloaded article. ${subject === "Picard"
      ? "Picard was born in La Barre and enjoys archaeology."
      : "Patrick Stewart trained at the Bristol Old Vic Theatre School."}`,
  };
}
import { crewConfiguration } from "../server/crew.js";
import type { AgentInfo, PermissionRule } from "../server/opencode.js";

/** A staged example answer for the project website screenshot; no model wrote it and no project was examined. */
const EXAMPLE_ANSWER = "The settings test fails because the default voice replaces the saved choice when the app starts.\n\n"
  + "Shall I make that change and run the test again?\n\n### On screen\n\n"
  + "In `src/settings.ts`, apply the defaults first and the saved settings second:\n\n"
  + "```ts\nconst settings = { ...defaults, ...saved };\n```";
// Staged officer answers for the website screenshot, written in each officer's manner.
const DATA_EXAMPLE = "Captain, there is one cause. The shield level is rounded before the warning check, so 99.6% reads as full.\n\n"
  + "I have not changed any files.\n\n### On screen\n\n"
  + "In `src/tactical/shields.ts`, the warning must use the exact reading:\n\n"
  + "```ts\nconst failing = reading.level < 100;\nconst shown = Math.round(reading.level);\n```";
const RIKER_EXAMPLE = "Captain, I'd fix it now. A false shield reading is the last thing we need before Starbase 74. "
  + "Let Data make the change and run the tests.";

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
  // Answers to Picard Code's question about who should handle a request, used before the fixed words below; null fails.
  const crewChoices: (string | null)[] = [];
  let signedIn = true;
  let listedModels: ModelInfo[] | undefined;
  let listedProviders: ProviderInfo[] | undefined;
  let listedIntegrations: IntegrationInfo[] = [];
  // The model the user set in their OpenCode settings, if any.
  let configuredModel: { providerID: string; model: string } | undefined = { providerID: "github-copilot", model: "fixture-model" };
  let providerError: string | undefined;
  let integrationError: string | undefined;
  const mcpServers = new Map<string, Awaited<ReturnType<OpenCode["mcpServers"]>>>();
  let mcpError: string | undefined;
  let mcpSignIn: { mode: string; url: string; instructions?: string } = { mode: "auto", url: "https://example.test/authorize" };
  let mcpAttempt: { status: string; message?: string } = { status: "pending" };
  let mcpMethods: { id: string; type: string; form: unknown[] }[] = [{ id: "browser", type: "oauth", form: [] }];
  const buildPermissions: PermissionRule[] = [{ action: "*", resource: "*", effect: "allow" }, { action: "read", resource: "*.env", effect: "ask" }];
  const agents: AgentInfo[] = [
    { id: "build", mode: "primary", permissions: buildPermissions },
    ...Object.entries(crewConfiguration(buildPermissions).agents).map(([id, agent]): AgentInfo => ({ ...agent, id, mode: "all", permissions: buildPermissions })),
  ];
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
    const message = { id: id("msg"), type: "assistant" as const, agent: sessions.get(sessionID)?.agent, content, ...(error ? { error } : {}), time: { created: Date.now() } };
    messages.get(sessionID)!.push(message);
    return message;
  };
  const createSession = (directory = project, title = "New conversation", parentID?: string, agent = "build") => {
    const session: SessionInfo = { id: id("ses"), title, agent, ...(parentID ? { parentID } : {}), location: { directory }, time: { created: Date.now(), updated: Date.now() } };
    sessions.set(session.id, session);
    messages.set(session.id, []);
    publish(directory, "session.created", { sessionID: session.id, title, parentID, location: { directory } });
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
      const models = signedIn ? listedModels ?? [
        { id: "fixture-model", modelID: "fixture-model", providerID: "github-copilot", name: "Copilot test model", status: "active", enabled: true, settings: { secret: "must-never-reach-browser" } },
        { id: "other", modelID: "other", providerID: "other-provider", name: "Other model", status: "active", enabled: true },
        { id: "old", modelID: "old", providerID: "other-provider", name: "Retired model", status: "deprecated", enabled: true },
      ] : [];
      const providers = signedIn ? listedProviders ?? [
        { id: "github-copilot", name: "GitHub Copilot", settings: { baseURL: "https://api.githubcopilot.com" } },
        { id: "other-provider", name: "Other Provider", settings: { apiKey: "provider-key-must-never-reach-browser" } },
      ] : [];
      if (path === "/api/info") { send(200, { version: "2.2.5-fixture" }); return; }
      if (path === "/api/location") { send(200, { directory, project: { id: "global", directory, canonical: directory } }); return; }
      if (path === "/api/location/reload") { send(204); return; }
      if (path === "/api/model") { send(200, { data: models }); return; }
      if (path === "/api/provider") { send(providerError ? 502 : 200, providerError ? { message: providerError } : { data: providers }); return; }
      if (path === "/api/integration") { send(integrationError ? 502 : 200, integrationError ? { message: integrationError } : { data: listedIntegrations }); return; }
      if (path === "/api/mcp") { send(mcpError ? 502 : 200, mcpError ? { message: mcpError } : { data: mcpServers.get(directory) ?? [] }); return; }
      if (path === "/api/integration/mcp-fixture") { send(200, { data: { methods: mcpMethods } }); return; }
      if (path === "/api/integration/mcp-fixture/connect/oauth") {
        send(200, { data: { attemptID: "test-attempt", instructions: "Test-only sign-in instructions.", ...mcpSignIn } }); return;
      }
      if (path === "/api/integration/mcp-fixture/connect/oauth/test-attempt" && request.method === "DELETE") { send(204); return; }
      if (path === "/api/integration/mcp-fixture/connect/oauth/test-attempt" && request.method === "GET") { send(200, { data: mcpAttempt }); return; }
      const mcpConnect = /^\/api\/experimental\/mcp\/([^/]+)\/connect$/.exec(path);
      if (mcpConnect && request.method === "POST") {
        const server = mcpServers.get(directory)?.find(({ name }) => name === decodeURIComponent(mcpConnect[1]!));
        if (!server) { send(404, { message: "Test MCP server not found." }); return; }
        server.status = { status: "connected" };
        publish(directory, "mcp.status.changed", { server: server.name });
        send(204); return;
      }
      if (path === "/api/agent") { send(200, { data: agents }); return; }
      // Like OpenCode, name the user's model when set, otherwise pick one of the listed models itself.
      if (path === "/api/model/default") { send(200, { data: models.find((model) => model.providerID === configuredModel?.providerID && model.id === configuredModel.model) ?? models[0] ?? null }); return; }
      if (path === "/api/config") {
        send(200, [{ type: "document", path: "/fixture/opencode.json", info: { ...(configuredModel ? { model: configuredModel } : {}), providers: { "other-provider": { settings: { apiKey: "config-key-must-never-reach-browser" } } } } }, { type: "directory", path: "/fixture" }]);
        return;
      }
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
          send(200, { data: createSession(location.directory, typeof data.title === "string" ? data.title : undefined, typeof data.parentID === "string" ? data.parentID : undefined, typeof data.agent === "string" ? data.agent : "build") });
        } else {
          const wanted = url.searchParams.get("directory");
          const parentID = url.searchParams.get("parentID");
          const entries = [...sessions.values()].reverse().filter((session) => (!wanted || session.location.directory === wanted) && (parentID === "null" ? !session.parentID : !parentID || session.parentID === parentID));
          const offset = Number(url.searchParams.get("cursor") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 100);
          send(200, { data: entries.slice(offset, offset + limit), cursor: { next: offset + limit < entries.length ? String(offset + limit) : null } });
        }
        return;
      }
      const entry = /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries\/([^/]+)$/.exec(path);
      if (entry && request.method === "PUT") {
        instructions.set(entry[1]!, { ...instructions.get(entry[1]!), [decodeURIComponent(entry[2]!)]: String(data.value) });
        send(204);
        return;
      }
      const match = /^\/api\/session\/([^/]+)(?:\/(message|prompt|generate|interrupt|model|agent|permission|form)(?:\/([^/]+)(?:\/(reply))?)?)?$/.exec(path);
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
        } else if (action === "generate") {
          // Like OpenCode's one-off answer: it reads the log entry but adds nothing to it. This stand-in picks officers by fixed words.
          const request = /"""\n([\s\S]*)\n"""$/.exec(String(data.prompt ?? ""))?.[1] ?? "";
          if (crewChoices[0] === null) { crewChoices.shift(); send(500, { message: "The test model cannot be reached." }); return; }
          const chosen = crewChoices.length ? crewChoices.shift()!
            : /\bData and Geordi\b/.test(request) ? "picard-data, picard-geordi"
            : /\bData and Riker\b/.test(request) ? "picard-data, picard-riker"
            : /\bfrom Data\b/i.test(request) ? "picard-data" : "computer";
          send(200, { data: { text: chosen } });
        } else if (action === "agent") {
          session.agent = String(data.agent);
          publish(directory, "session.agent.selected", { sessionID, agent: session.agent });
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
          const manner = instructions.get(sessionID)?.["picard-manner"] ?? "";
          // A briefing exists only when Picard Code really requested the officer calls.
          if (manner.includes("The Captain leads this briefing") && /\bData and Riker\b/.test(text)) {
            const denied = text.includes("Data's action is denied");
            const parentDenied = text.includes("computer's action is denied");
            const noClose = text.includes("no computer close");
            if (parentDenied) assistant(sessionID, [
              { type: "text", text: "Test stand-in: I recommend the smaller repair, Captain." },
              { type: "tool", id: "call_parent", name: "shell", state: { status: "error", input: { command: "echo crew" }, error: { type: "aborted", message: "The user declined this tool call" } } },
            ], { type: "aborted", message: "Step interrupted" });
            else if (!noClose) reply(sessionID, text.includes("repeated close")
              ? "Test stand-in: I recommend the smaller repair, Captain."
              : denied
              ? "Test stand-in: Data's action was denied. No command was run."
              : "The reports are on screen.", generation);
            later(() => {
              if (!current(sessionID, generation)) return;
              const rikerReport = () => {
                const riker = createSession(directory, "Riker recommendation", sessionID, "picard-riker");
                riker.model = session.model;
                const question = text.includes("retry_policy.ts") ? "\n\nShall I update retry_policy.ts?" : "";
                const report = assistant(riker.id, [{ type: "text", text: `Test stand-in: I recommend the smaller repair, Captain.${question}` }]);
                report.time.created += text.includes("Riker first") ? -1 : 1;
              };
              if (text.includes("Riker first")) rikerReport();
              const data = createSession(directory, "Data investigation", sessionID, "picard-data");
              data.model = session.model;
              if (denied && text.includes("after a successful step")) {
                assistant(data.id, [{ type: "text", text: "Test stand-in: Data completed an earlier step." }]);
              }
              if (denied || text.includes("recovered action")) {
                assistant(data.id, [
                  ...denied ? [{ type: "text" as const, text: "Test stand-in: Data began an investigation." }] : [],
                  { type: "tool", id: "call_test", name: "shell", state: { status: "error", input: { command: "echo crew" }, error: { type: "aborted", message: "The user declined this tool call" } } },
                ], { type: "aborted", message: "Step interrupted" });
              }
              if (!denied) assistant(data.id, [{ type: "text", text: "Test stand-in: Data found a small repair." }]);
              if (denied && text.includes("second succeeds")) {
                const retry = createSession(directory, "Data second investigation", sessionID, "picard-data");
                retry.model = session.model;
                assistant(retry.id, [{ type: "text", text: "Test stand-in: Data found a small repair." }]);
              }
              if (!text.includes("Riker first")) rikerReport();
              if (noClose || parentDenied) finish(sessionID, parentDenied ? "interrupted" : "succeeded");
            }, 50);
          } else if (manner.includes("The Captain leads this briefing") && /\bData and Geordi\b/.test(text)) {
            const data = createSession(directory, "Data investigation", sessionID, "picard-data");
            data.model = session.model;
            assistant(data.id, [{ type: "text", text: "Test stand-in: Data supplied an investigation report." }]);
            const geordi = createSession(directory, "Geordi repair", sessionID, "picard-geordi");
            geordi.model = session.model;
            active.add(geordi.id);
            generations.set(geordi.id, generation);
            publish(directory, "session.execution.started", { sessionID: geordi.id });
            const input = { command: "echo crew" };
            assistant(geordi.id, [{ type: "tool", id: "call_test", name: "shell", state: { status: "running", input } }]);
            const permission: PermissionRequest = { id: id("per"), sessionID: geordi.id, action: "shell", resources: ["echo crew"], metadata: input };
            permissions.push(permission);
            pending.set(geordi.id, (answer) => {
              if (answer.decision === "reject") stopWithFailedTool(geordi.id, "shell", input, "The user declined this tool call", generation);
              else { completeTool(geordi.id, "shell", "Test stand-in: no command was run."); finish(geordi.id, "succeeded"); }
              reply(sessionID, answer.decision === "reject"
                ? "Test stand-in: Geordi's action was denied. No command was run."
                : "The reports are on screen.", generation);
            });
            later(() => publish(directory, "permission.asked", permission), 50);
          } else if (session.agent === "picard-data" && text.includes("shields")) {
            reply(sessionID, DATA_EXAMPLE, generation);
          } else if (session.agent === "picard-riker" && text.includes("Starbase")) {
            reply(sessionID, RIKER_EXAMPLE, generation);
          } else if (session.agent === "picard-data" && /\ban answer from Data\b/i.test(text)) {
            reply(sessionID, "Test stand-in: Captain, the cache is stale. No command was run.", generation);
          } else if (session.agent === "picard-data" && /\bnews from Data\b/i.test(text)) {
            // Like a real run: one web page refuses Data, then Data searches and reports.
            assistant(sessionID, [{ type: "tool", id: "call_fetch", name: "webfetch", state: { status: "error", input: { url: "https://example.com/news" }, error: { type: "unknown", message: "StatusCode: non 2xx status code (403 GET https://example.com/news)" } } }]);
            const input = { query: "news today" };
            assistant(sessionID, [{ type: "tool", id: "call_search", name: "websearch", state: { status: "running", input } }]);
            publish(directory, "session.tool.called", { sessionID, id: "call_search" });
            later(() => {
              if (!current(sessionID, generation)) return;
              completeTool(sessionID, "websearch", "Test stand-in: no web search was made.");
              reply(sessionID, "Test stand-in: Captain, no real news was searched.", generation);
            }, 4000);
          } else if (text.includes("full spoken answer")) {
            reply(sessionID, `Test stand-in: Here is the full explanation.\n\n${"A pause between paragraphs should not end the answer. ".repeat(24)}\n\nThe final point is to hear the complete explanation.\n\n### On screen\n\nAPPENDIX_SENTINEL is a technical detail.\n\n\`\`\`ts\nconst value = 42;\n\`\`\`\n\n| Setting | Value |\n| --- | --- |\n| count | 42 |`, generation);
          } else if (text.includes("multi-message")) {
            assistant(sessionID, [{ type: "text", text: "An intermediate test reply, not a finished answer." }]);
            publish(directory, "session.text.ended", { sessionID });
            reply(sessionID, undefined, generation);
          } else if (manner.includes("The Captain has explicitly requested")) {
            const story = manner.includes("explicitly requested the following Picard story")
              ? "In First Contact, Picard touches the historic Phoenix he knew from the Smithsonian."
              : "Patrick Stewart performed every character in his solo A Christmas Carol.";
            reply(sessionID, `${story}\n\nThis is a test stand-in for the reviewed story, not a model response.`, generation);
          } else if (/tell me about myself/i.test(text)) {
            reply(sessionID, "You are Captain Jean-Luc Picard, whose interests include archaeology.\n\nThis is a test stand-in, not a model response.", generation);
          } else if (/tell me about patrick stewart/i.test(text)) {
            reply(sessionID, "Patrick Stewart's career includes the Royal Shakespeare Company and Captain Picard.\n\nThis is a test stand-in, not a model response.", generation);
          } else if (/tell me about our picard repo/i.test(text)) {
            reply(sessionID, "This test repository has a retry helper in src/retry.ts.\n\nThis is a test stand-in, not a model response or a real repository inspection.", generation);
          } else if (text.includes("approval")) {
            const input = { command: "echo hello" };
            assistant(sessionID, [{ type: "tool", id: "call_test", name: "shell", state: { status: "running", input } }]);
            const permission: PermissionRequest = { id: id("per"), sessionID, action: "shell", resources: ["echo hello"], metadata: input };
            permissions.push(permission);
            pending.set(sessionID, (answer) => answer.decision === "reject"
              ? stopWithFailedTool(sessionID, "shell", input, "The user declined this tool call", generation)
              : (completeTool(sessionID, "shell", "Test stand-in: no command was run."), reply(sessionID, "The test approval was answered. No command was executed.", generation)));
            later(() => publish(directory, "permission.asked", permission), 50);
          } else if (text.includes("question")) {
            const paused = text.includes("paused question");
            const multiple = text.includes("two answers");
            const free = text.includes("free text");
            const input = { questions: [{ header: "Direction", question: "Which approach should I use?" }] };
            assistant(sessionID, [
              ...(paused ? [{ type: "text" as const, text: "Which approach should I use?" }] : []),
              { type: "tool", id: "call_test", name: "question", state: { status: "running", input } },
            ]);
            const form: FormRequest = { id: id("frm"), sessionID, title: "Questions", fields: [{
              key: "q0", type: "string", title: "Direction", description: "Which approach should I use?",
              options: free ? [] : [{ value: "Small change", label: "Small change", description: "Keep the scope focused." }, { value: "Explain first", label: "Explain first", description: "Discuss before changing files." }],
              custom: !text.includes("choose"),
            }] };
            if (multiple) form.fields.push({ key: "topic", type: "string", description: "Which topic should I cover?", required: true });
            forms.push(form);
            pending.set(sessionID, (answer) => {
              if (answer.skip) {
                if (paused) active.add(sessionID);
                stopWithFailedTool(sessionID, "question", input, "The user dismissed this question", generation);
                return;
              }
              completeTool(sessionID, "question", String((answer.answer as Record<string, unknown>).q0));
              const resume = () => {
                if (paused) {
                  active.add(sessionID);
                  publish(directory, "session.execution.started", { sessionID });
                }
                reply(sessionID, multiple
                  ? `Your test answers were received: ${JSON.stringify(answer.answer)}.`
                  : `Your test answer was received: ${JSON.stringify([[(answer.answer as Record<string, unknown>).q0]])}.`, generation);
              };
              if (paused) later(resume, 1500);
              else resume();
            });
            later(() => {
              publish(directory, "form.created", { form });
              if (paused) finish(sessionID, "succeeded");
            }, 50);
          } else if (text.includes("broken")) {
            later(() => {
              if (!current(sessionID, generation)) return;
              finish(sessionID, "failed", { type: "provider.no-route", message: "The test model cannot be reached." });
            }, 100);
          } else if (text.includes("without an ending")) {
            later(() => {
              if (!current(sessionID, generation)) return;
              assistant(sessionID, [{ type: "text", text: "Test stand-in: a saved reply without a terminal outcome." }]);
              active.delete(sessionID);
              publish(directory, "session.step.ended", { sessionID });
              publish(directory, "session.created", { sessionID });
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
    password, requests, crewChoices, permissions, forms, active, instructions, agents, sessions, messages,
    createSession,
    publish,
    setSignedIn: (ready: boolean) => { signedIn = ready; },
    setModels: (models: ModelInfo[]) => { listedModels = models; },
    setConfiguredModel: (model?: { providerID: string; model: string }) => { configuredModel = model; },
    setProviders: (providers: ProviderInfo[]) => { listedProviders = providers; },
    setIntegrations: (integrations: IntegrationInfo[]) => { listedIntegrations = integrations; },
    setProviderError: (message?: string) => { providerError = message; },
    setIntegrationError: (message?: string) => { integrationError = message; },
    setMcpServers: (servers: Awaited<ReturnType<OpenCode["mcpServers"]>>, directory = project) => { mcpServers.set(directory, servers); },
    setMcpError: (message?: string) => { mcpError = message; },
    setMcpSignIn: (attempt: typeof mcpSignIn) => { mcpSignIn = attempt; },
    setMcpAttempt: (attempt: typeof mcpAttempt) => { mcpAttempt = attempt; },
    setMcpMethods: (methods: typeof mcpMethods) => { mcpMethods = methods; },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      for (const listener of listeners) listener.end();
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
