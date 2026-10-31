import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { OpencodeClient, Event } from "@opencode-ai/sdk/v2";
import type { AppState, BrowserEvent } from "../shared/types.js";
import { chatMessage, copilotModels, errorMessage } from "./engine.js";
import { projectDirectory } from "./process.js";
import { COMPUTER_MANNER } from "./instructions.js";
import { attachSpeech } from "./speech-bridge.js";
import type { SpeechService } from "./speech-types.js";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function sameDirectory(a: string, b: string) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function equalSecret(a: string, b: string) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new HttpError(415, "Send this request as JSON.");
  }
  let text = "";
  for await (const chunk of request) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > 128_000) throw new HttpError(413, "That message is too long. Keep it under 128 KB.");
  }
  let result: unknown;
  try { result = JSON.parse(text); }
  catch { throw new HttpError(400, "The request is not valid JSON."); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new HttpError(400, "The request must be a JSON object.");
  return result as Record<string, unknown>;
}

function textField(data: Record<string, unknown>, key: string, max = 32_000): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new HttpError(400, `Provide a valid ${key}.`);
  }
  return value.trim();
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export interface AppOptions {
  client: OpencodeClient;
  project: string;
  webRoot: string;
  port?: number;
  speech?: SpeechService;
}

export async function startApp(options: AppOptions) {
  const { client } = options;
  let directory = options.project;
  const token = randomBytes(32).toString("hex");
  const cookie = randomBytes(32).toString("hex");
  const streams = new Set<ServerResponse>();
  let mutationBusy = false;
  let origin = "";
  const webRoot = await realpath(options.webRoot);

  const sessions = async (project: string) => {
    const result = await client.session.list({ directory: project, limit: 100 }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
    return result.data.filter((session) => sameDirectory(session.directory, project) && !session.parentID && !session.time.archived);
  };

  const assertSession = async (id: string, project: string) => {
    const result = await client.session.get({ sessionID: id, directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
    if (!sameDirectory(result.data.directory, project)) throw new HttpError(403, "That conversation belongs to another project folder.");
    return result.data;
  };

  const state = async (project: string): Promise<AppState> => {
    const [health, models, conversations, statuses, permissions, questions] = await Promise.all([
      client.global.health({ throwOnError: true, signal: AbortSignal.timeout(5000) }),
      copilotModels(client, project),
      sessions(project),
      client.session.status({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) }),
      client.permission.list({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) }),
      client.question.list({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) }),
    ]);
    const ids = new Set(conversations.map((session) => session.id));
    return {
      project,
      version: health.data.version,
      ...models,
      conversations: conversations.map((session) => ({ id: session.id, title: session.title, updated: session.time.updated })),
      statuses: Object.fromEntries(Object.entries(statuses.data).filter(([id]) => ids.has(id))),
      permissions: permissions.data.filter((request) => ids.has(request.sessionID)),
      questions: questions.data.filter((request) => ids.has(request.sessionID)),
      speech: { configured: !!options.speech,
        listening: options.speech?.selection?.listening ?? "mai",
        speaking: options.speech?.selection?.speaking ?? "mai" },
    };
  };

  const eventStream = async (request: IncomingMessage, response: ServerResponse, project: string) => {
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    const ids = new Set((await sessions(project)).map((session) => session.id));
    response.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    response.flushHeaders();
    streams.add(response);
    const send = (event: BrowserEvent) => {
      if (!response.destroyed) response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => { if (!response.destroyed) response.write(": keep-alive\n\n"); }, 10_000);
    const startup = setTimeout(() => {
      send({ type: "connection", connected: false, message: "OpenCode did not open its live connection. Check its terminal and try again." });
      controller.abort();
    }, 15_000);
    try {
      const result = await client.event.subscribe({ directory: project }, {
        signal: controller.signal,
        sseMaxRetryAttempts: 0,
        onSseError: (error: unknown) => {
          send({ type: "connection", connected: false, message: `OpenCode's live connection stopped. ${errorMessage(error)}` });
        },
      });
      // The SDK's stream is lazy; its first read establishes the upstream connection.
      const first = await result.stream.next();
      if (first.done) throw new Error("OpenCode closed its live connection before it was ready.");
      clearTimeout(startup);
      send({ type: "connection", connected: true });
      for await (const event of result.stream) {
        if (controller.signal.aborted || directory !== project) break;
        if (event.type === "session.created" && sameDirectory(event.properties.info.directory, project)) {
          ids.add(event.properties.info.id);
        }
        const properties = event.properties;
        const part = "part" in properties ? properties.part : undefined;
        const info = "info" in properties ? properties.info : undefined;
        const id = "sessionID" in properties ? properties.sessionID :
          part && typeof part === "object" && "sessionID" in part ? part.sessionID :
          info && typeof info === "object" && "sessionID" in info ? info.sessionID : undefined;
        if (typeof id !== "string" || !ids.has(id)) continue;
        if (!/^(message\.|session\.(created|updated|deleted|status|idle|error)$|permission\.|question\.)/.test(event.type)) continue;
        send({ type: "opencode", event });
      }
    } catch (error) {
      if (!controller.signal.aborted) send({ type: "connection", connected: false, message: errorMessage(error) });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(startup);
      streams.delete(response);
      response.end();
    }
  };

  const server = createServer((request, response) => {
    let ownsMutation = false;
    void (async () => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${origin.replace("http:", "ws:")}; worker-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
      response.setHeader("Permissions-Policy", "microphone=(self), camera=()");
      if (request.headers.host !== new URL(origin).host) throw new HttpError(403, "Use the local address printed by Picard Code.");
      if (request.headers.origin && request.headers.origin !== origin) throw new HttpError(403, "Requests from other websites are not allowed.");
      const url = new URL(request.url ?? "/", origin);
      const path = url.pathname;
      const method = request.method;
      if (path.startsWith("/api/")) {
        if (request.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(request.headers["sec-fetch-site"]))) {
          throw new HttpError(403, "Open Picard Code directly from its local address.");
        }
        if (method === "POST" && request.headers["x-picard-request"] !== "1") throw new HttpError(403, "The local request check failed. Reload Picard Code.");
        if (path === "/api/connect" && method === "POST") {
          const data = await body(request);
          if (typeof data.token !== "string" || !equalSecret(data.token, token)) throw new HttpError(401, "Open the full launch address from your terminal.");
          response.setHeader("Set-Cookie", `picard=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
          json(response, 200, { connected: true });
          return;
        }
        const cookies = request.headers.cookie?.split(";").map((part) => part.trim()) ?? [];
        if (!cookies.some((part) => part.startsWith("picard=") && equalSecret(part.slice(7), cookie))) {
          throw new HttpError(401, "Open the full launch address printed in your terminal to connect this browser.");
        }
        const project = directory;
        if (method === "POST") {
          if (mutationBusy) throw new HttpError(409, "Another action is still finishing. Wait a moment and try again.");
          mutationBusy = true;
          ownsMutation = true;
        }
        if (path === "/api/state" && method === "GET") {
          json(response, 200, await state(project));
          return;
        }
        if (path === "/api/events" && method === "GET") {
          await eventStream(request, response, project);
          return;
        }
        if (path === "/api/refresh" && method === "POST") {
          await body(request);
          const statuses = await client.session.status({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
          const current = new Set((await sessions(project)).map((session) => session.id));
          if (Object.entries(statuses.data).some(([id, status]) => current.has(id) && status.type !== "idle")) {
            throw new HttpError(409, "Stop the current work before refreshing the Copilot connection.");
          }
          for (const stream of streams) stream.end();
          await client.instance.dispose({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
          json(response, 200, { refreshed: true });
          return;
        }
        if (path === "/api/project" && method === "POST") {
          const data = await body(request);
          const statuses = await client.session.status({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
          const current = new Set((await sessions(project)).map((session) => session.id));
          if (Object.entries(statuses.data).some(([id, status]) => current.has(id) && status.type !== "idle")) {
            throw new HttpError(409, "Stop the current work before changing the project folder.");
          }
          let next: string;
          try { next = await projectDirectory(textField(data, "path", 4096)); }
          catch (error) { throw new HttpError(400, `Could not open that folder. ${errorMessage(error)}`); }
          const check = await client.path.get({ directory: next }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
          if (!sameDirectory(check.data.directory, next)) throw new HttpError(409, "OpenCode did not select that folder. Restart Picard Code with --project instead.");
          directory = next;
          for (const stream of streams) stream.end();
          json(response, 200, await state(next));
          return;
        }
        if (path === "/api/conversations" && method === "POST") {
          const data = await body(request);
          const result = await client.session.create({
            directory: project,
            title: typeof data.title === "string" ? data.title.trim().slice(0, 120) || "New conversation" : "New conversation",
          }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
          json(response, 201, { id: result.data.id, title: result.data.title, updated: result.data.time.updated });
          return;
        }
        const match = /^\/api\/conversations\/([^/]+)\/(messages|send|stop)$/.exec(path);
        if (match) {
          const id = match[1]!;
          const session = await assertSession(id, project);
          if (match[2] === "messages" && method === "GET") {
            const result = await client.session.messages({ directory: project, sessionID: id }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            json(response, 200, result.data.map(chatMessage));
            return;
          }
          if (match[2] === "stop" && method === "POST") {
            await body(request);
            await client.session.abort({ directory: project, sessionID: id }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            json(response, 200, { stopped: true });
            return;
          }
          if (match[2] === "send" && method === "POST") {
            const data = await body(request);
            const text = textField(data, "text");
            const modelID = textField(data, "modelID", 256);
            const providerID = textField(data, "providerID", 256);
            const { models } = await copilotModels(client, project);
            if (!models.some((model) => model.providerID === providerID && model.modelID === modelID)) {
              throw new HttpError(400, "Connect GitHub Copilot in OpenCode and choose an available model.");
            }
            const status = await client.session.status({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            if (status.data[id] && status.data[id]?.type !== "idle") throw new HttpError(409, "Wait for the current reply, or stop it before sending another message.");
            if (data.agent !== "plan" && data.agent !== "build") throw new HttpError(400, "Choose Discuss or Make changes.");
            if (session.title === "New conversation") {
              await client.session.update({ directory: project, sessionID: id, title: text.slice(0, 60) }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            }
            await client.session.promptAsync({
              directory: project,
              sessionID: id,
              agent: data.agent,
              system: COMPUTER_MANNER,
              model: { providerID, modelID },
              parts: [{ type: "text", text }],
            }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            json(response, 202, { accepted: true });
            return;
          }
        }
        const approval = /^\/api\/(permissions|questions)\/([^/]+)$/.exec(path);
        if (approval && method === "POST") {
          const data = await body(request);
          const requestID = approval[2]!;
          if (approval[1] === "permissions") {
            const pending = await client.permission.list({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            const item = pending.data.find((item) => item.id === requestID);
            if (!item) throw new HttpError(409, "That approval is no longer waiting. Refresh the conversation.");
            await assertSession(item.sessionID, project);
            if (data.reply !== "once" && data.reply !== "reject") throw new HttpError(400, "Choose Allow once or Deny.");
            await client.permission.reply({ directory: project, requestID, reply: data.reply }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
          } else {
            const pending = await client.question.list({ directory: project }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            const item = pending.data.find((item) => item.id === requestID);
            if (!item) throw new HttpError(409, "That question is no longer waiting. Refresh the conversation.");
            await assertSession(item.sessionID, project);
            if (data.reject === true) {
              await client.question.reject({ directory: project, requestID }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            } else {
              const answers = data.answers;
              if (!Array.isArray(answers) || answers.length !== item.questions.length ||
                !answers.every((answer) => Array.isArray(answer) && answer.length > 0 && answer.every((value) => typeof value === "string" && value.trim() && value.length <= 4096))) {
                throw new HttpError(400, "Answer each question before continuing.");
              }
              for (let index = 0; index < item.questions.length; index++) {
                const question = item.questions[index]!;
                const answer: string[] = answers[index];
                if (!question.multiple && answer.length !== 1) throw new HttpError(400, "Choose one answer for this question.");
                if (question.custom === false && answer.some((value) => !question.options.some((option) => option.label === value))) {
                  throw new HttpError(400, "Choose one of the offered answers.");
                }
              }
              await client.question.reply({ directory: project, requestID, answers }, { throwOnError: true, signal: AbortSignal.timeout(15_000) });
            }
          }
          json(response, 200, { answered: true });
          return;
        }
        throw new HttpError(404, "That action is not available.");
      }
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "This page only supports viewing.");
      const relative = decodeURIComponent(path) === "/" ? "index.html" : `.${decodeURIComponent(path)}`;
      const file = resolve(webRoot, relative);
      if (!file.startsWith(`${webRoot}${sep}`)) throw new HttpError(403, "That file is not part of Picard Code.");
      let resolved: string;
      try { resolved = await realpath(file); }
      catch { throw new HttpError(404, "That page was not found."); }
      if (!resolved.startsWith(`${webRoot}${sep}`)) throw new HttpError(403, "That file is not part of Picard Code.");
      const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
      const content = await readFile(resolved);
      response.writeHead(200, { "Content-Type": `${mime[extname(file)] ?? "application/octet-stream"}; charset=utf-8` });
      response.end(method === "HEAD" ? undefined : content);
    })().catch((error: unknown) => {
      if (response.headersSent) { response.destroy(); return; }
      json(response, error instanceof HttpError ? error.status : 502, {
        error: error instanceof HttpError ? error.message : `OpenCode could not complete this request. ${errorMessage(error)}`,
      });
    }).finally(() => {
      if (ownsMutation) mutationBusy = false;
    });
  });
  const closeSpeech = attachSpeech(server, options.speech, (request) => {
    const cookies = request.headers.cookie?.split(";").map((part) => part.trim()) ?? [];
    return request.headers.host === new URL(origin).host && request.headers.origin === origin
      && (!request.headers["sec-fetch-site"] || request.headers["sec-fetch-site"] === "same-origin")
      && cookies.some((part) => part.startsWith("picard=") && equalSecret(part.slice(7), cookie));
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the local browser app.");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin, token,
    url: `${origin}/#token=${token}`,
    close: async () => {
      closeSpeech();
      for (const stream of streams) stream.end();
      try { await options.speech?.close?.(); }
      finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      }
    },
  };
}
