import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AppState, BrowserEvent, FormField, FormValue, ModelSelection } from "../shared/types.js";
import { chatMessages, availableModels, errorMessage } from "./engine.js";
import { partID } from "./history.js";
import { modelSettingsFile, readModelSettings, saveModelSettings, modelSelection } from "./model-settings.js";
import { mediaReferences, replyMedia } from "../shared/media.js";
import { MediaError, serveMedia } from "./media.js";
import type { OpenCode, OpenCodeEvent, SessionInfo } from "./opencode.js";
import { projectDirectory } from "./process.js";
import { computerManner, crewChoice } from "./instructions.js";
import { checkTributeRequest, explicitStorySubject, storyAcceptance, tributeSubject } from "../shared/tribute.js";
import { TRIBUTE_ENTRIES } from "../shared/tribute-data.js";
import { SPEAKING_SPEEDS } from "../shared/wake.js";
import { wikipediaReader, type WikipediaArticle } from "./wikipedia.js";
import { addressedOfficers, chosenCrew, continuesOfficer, crewMember, type CrewID } from "../shared/crew.js";
import { requireCrew, verifiedCrew } from "./crew.js";
import { attachSpeech } from "./speech-bridge.js";
import type { SpeechSelection, SpeechService } from "./speech-types.js";
import { canSetUpLocalSpeech, describeSpeechSettings, localSpeechReady, mergeSpeechSettings, needsListenerMigration, readSpeechSettings, saveSpeechSettings, setUpLocalSpeech, speechFromSettings, speechSettingsFile } from "./speech.js";

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

/** Checks a form answer against the form, so only answers OpenCode asked for are passed on. */
export function checkAnswer(fields: FormField[], answer: unknown): Record<string, FormValue> {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new HttpError(400, "Answer the question before continuing.");
  const given = answer as Record<string, unknown>;
  if (!Object.keys(given).length) throw new HttpError(400, "Answer the question before continuing.");
  const result: Record<string, FormValue> = {};
  for (const [key, value] of Object.entries(given)) {
    const field = fields.find((item) => item.key === key);
    if (!field || field.type === "external") throw new HttpError(400, "That answer does not match the question.");
    const label = field.title || field.description || "this question";
    if (field.type === "string") {
      if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new HttpError(400, `Write an answer for ${label}.`);
      if (field.options?.length && field.custom !== true && !field.options.some((option) => option.value === value)) throw new HttpError(400, "Choose one of the offered answers.");
    } else if (field.type === "multiselect") {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() && item.length <= 4096)) throw new HttpError(400, `Choose answers for ${label}.`);
      if (field.custom !== true && value.some((item) => !field.options.some((option) => option.value === item))) throw new HttpError(400, "Choose only the offered answers.");
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new HttpError(400, `Answer yes or no for ${label}.`);
    } else if (typeof value !== "number" || !Number.isFinite(value) || field.type === "integer" && !Number.isInteger(value)) {
      throw new HttpError(400, `Enter a number for ${label}.`);
    }
    result[key] = value as FormValue;
  }
  return result;
}

const SESSION_CHANGES = /^session\.(text\.ended|reasoning\.ended|step\.(started|ended|failed)|tool\.(input\.started|called|success|failed)|compaction\.ended)$/;

/** Turns one OpenCode event for a known conversation into what the browser needs. */
export function browserEvents(event: OpenCodeEvent): BrowserEvent[] {
  const data = event.data;
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : "";
  const delta = /^session\.(text|reasoning)\.delta$/.exec(event.type);
  if (delta && typeof data.assistantMessageID === "string" && typeof data.ordinal === "number" && typeof data.delta === "string") {
    const kind = delta[1] as "text" | "reasoning";
    return [{ type: "delta", sessionID, messageID: data.assistantMessageID, partID: partID(data.assistantMessageID, kind, data.ordinal), partType: kind, delta: data.delta }];
  }
  if (SESSION_CHANGES.test(event.type)) return [{ type: "changed", sessionID }];
  if (event.type === "session.execution.started") return [{ type: "state" }];
  if (event.type === "session.execution.succeeded" || event.type === "session.execution.interrupted") return [
    { type: "state" }, { type: "changed", sessionID },
    { type: "finished", sessionID, outcome: event.type === "session.execution.succeeded" ? "succeeded" : "interrupted" },
  ];
  if (event.type === "session.execution.failed") {
    return [{ type: "state" }, { type: "changed", sessionID }, { type: "finished", sessionID, outcome: "failed" }, { type: "error", sessionID, message: errorMessage(data.error) }];
  }
  if (event.type === "session.retry.scheduled") return [{ type: "retry", sessionID, message: errorMessage(data.error) }];
  if (/^(permission\.(asked|replied)|form\.(created|replied|cancelled)|session\.(created|renamed|deleted|archived))$/.test(event.type)) return [{ type: "state" }];
  return [];
}

function eventSession(event: OpenCodeEvent) {
  const data = event.data;
  if (typeof data.sessionID === "string") return data.sessionID;
  for (const key of ["form", "request", "info"]) {
    const inner = data[key];
    if (inner && typeof inner === "object" && "sessionID" in inner && typeof inner.sessionID === "string") return inner.sessionID;
  }
  return undefined;
}

export interface AppOptions {
  client: OpenCode;
  project: string;
  webRoot: string;
  port?: number;
  speech?: SpeechService;
  /** Why speech could not start, shown on the settings page instead of stopping the app. */
  speechError?: string;
  speechOverrides?: { listening?: string; speaking?: string };
  /** Where speech settings are read and saved. Defaults to the usual settings file. */
  speechFile?: string;
  modelFile?: string;
  /** Starts speech from saved settings; replaceable in tests so no real service is called. */
  startSpeech?: (settings: Record<string, unknown>, signal?: AbortSignal) => Promise<SpeechService>;
  localSpeechReady?: (settings: Record<string, unknown> | undefined, listening?: boolean, speaking?: boolean) => Promise<boolean>;
  setUpLocalSpeech?: (onStep: (step: string) => void, signal?: AbortSignal, selection?: SpeechSelection) => Promise<void>;
  /** Folder holding the computer sounds downloaded at startup. */
  soundFolder?: string;
  /** Reads Wikipedia for requested tribute questions; tests supply a labelled stand-in. */
  readWikipedia?: (subject: WikipediaArticle["subject"]) => Promise<WikipediaArticle>;
  prepareCrew?: (directory: string) => Promise<unknown>;
}

export async function startApp(options: AppOptions) {
  const { client } = options;
  let directory = options.project;
  const token = randomBytes(32).toString("hex");
  const cookie = randomBytes(32).toString("hex");
  const streams = new Set<ServerResponse>();
  const notifyState = () => {
    for (const stream of streams) stream.write(`data: ${JSON.stringify({ type: "state" })}\n\n`);
  };
  let mutationBusy = false;
  let origin = "";
  const webRoot = await realpath(options.webRoot);
  let speech = options.speech;
  let speechError = options.speechError;
  const speechFile = options.speechFile ?? await speechSettingsFile();
  const modelFile = options.modelFile ?? modelSettingsFile;
  const savedSpeech = !speech && !speechError ? await readSpeechSettings(speechFile) : undefined;
  const startSpeech = options.startSpeech ?? ((settings, signal) => speechFromSettings(settings, {}, signal));
  const localReady = options.localSpeechReady ?? localSpeechReady;
  const migrationSettings = savedSpeech && needsListenerMigration(savedSpeech) && !options.speechOverrides?.listening
    ? mergeSpeechSettings(savedSpeech, {
      ...describeSpeechSettings(savedSpeech),
      speaking: savedSpeech.speaking ?? "kokoro",
    }) : undefined;
  const migration = migrationSettings && options.speechOverrides?.speaking
    ? { ...migrationSettings, speaking: options.speechOverrides.speaking } : migrationSettings;
  const migrationDownload = migration ? !await localReady(migration) : false;
  const setUpLocal = options.setUpLocalSpeech ?? setUpLocalSpeech;
  const localFiles = async (record: Record<string, unknown> | undefined) => ({
    nemotron: await localReady({ ...record, listening: "nemotron" }, true, false),
    kokoro: await localReady(record, false, true),
  });
  const localDownload = async (record: Record<string, unknown>): Promise<SpeechSelection> => {
    const files = await localFiles(record);
    const listening = record.listening !== "mai" && !files.nemotron;
    const speaking = record.speaking !== "mai" && !files.kokoro;
    if (!canSetUpLocalSpeech(record, listening, speaking)) throw new HttpError(400, "The new speech settings did not work, so nothing was changed. A configured local speech file is missing. Check the paths in the speech settings file.");
    return { listening: listening ? "nemotron" : "mai", speaking: speaking ? "kokoro" : "mai" };
  };
  const readWikipedia = options.readWikipedia ?? wikipediaReader();
  /** The one-time local speech download runs in the background, because it takes minutes. */
  let localSetup: { state: "running" | "done" | "failed"; step: string; error?: string; result?: unknown } | undefined;
  let localSetupChoice: { record: Record<string, unknown>; savedRecord: Record<string, unknown> } | undefined;
  /** Stops a running speech download on shutdown, so it cannot keep installing or change settings afterwards. */
  const closing = new AbortController();
  let localSetupRun: Promise<void> | undefined;

  const applySpeech = async (record: Record<string, unknown>, savedRecord = record) => {
    let next: SpeechService;
    // Start the new services first, so a mistake leaves the working ones in place.
    try { next = await startSpeech(record, closing.signal); }
    catch (error) { throw new HttpError(400, `The new speech settings did not work, so nothing was changed. ${errorMessage(error)}`); }
    try { closing.signal.throwIfAborted(); await saveSpeechSettings(speechFile, savedRecord); }
    catch (error) {
      await next.close?.();
      throw new HttpError(500, `Could not save the speech settings. ${errorMessage(error)}`);
    }
    const previous = speech;
    speech = next;
    speechError = undefined;
    closeSpeech.disconnect();
    try { await previous?.close?.(); }
    catch (error) { console.error(`Could not fully stop the previous speech service: ${errorMessage(error)}`); }
    return { settings: describeSpeechSettings(savedRecord), file: speechFile, localReady: true, localFiles: await localFiles(record), speech: { configured: true, listening: next.selection?.listening ?? "nemotron", speaking: next.selection?.speaking ?? "kokoro" } };
  };

  const beginSpeechSetup = (record: Record<string, unknown>, download: boolean, savedRecord = record) => {
    const job: NonNullable<typeof localSetup> = { state: "running", step: download ? "Starting the download" : "Starting local speech" };
    localSetup = job;
    localSetupChoice = { record, savedRecord };
    notifyState();
    localSetupRun = (async () => {
      try {
        if (download) {
          const selection = await localDownload(record);
          closing.signal.throwIfAborted();
          await setUpLocal((step) => { job.step = step; }, closing.signal, selection);
        }
        closing.signal.throwIfAborted();
        job.step = "Starting the selected speech services";
        job.result = await applySpeech(record, savedRecord);
        job.state = "done";
        localSetupChoice = undefined;
      } catch (error) {
        job.state = "failed";
        job.error = errorMessage(error);
        if (!speech) speechError = job.error;
      } finally {
        notifyState();
      }
    })();
    return job;
  };

  // OpenCode reports only whether work runs; a scheduled retry is remembered from its event.
  const retrying = new Map<string, string>();

  const sessions = async (project: string) => {
    const result = await client.sessions(project);
    return result.filter((session) => sameDirectory(session.location.directory, project) && !session.parentID && !session.time.archived);
  };

  const assertSession = async (id: string, project: string) => {
    const result = await client.session(id, project);
    if (!sameDirectory(result.location.directory, project) || result.parentID) throw new HttpError(403, "That log entry belongs to another project folder.");
    return result;
  };

  const rootSession = async (id: string, project: string): Promise<SessionInfo | undefined> => {
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(id)) throw new Error("OpenCode reported a crew entry that points back to itself.");
      seen.add(id);
      const session = await client.session(id, project);
      if (!sameDirectory(session.location.directory, project) || session.time.archived) return undefined;
      if (!session.parentID) return session;
      id = session.parentID;
    }
  };

  const family = async (root: SessionInfo, project: string) => {
    const result = [root];
    const seen = new Set([root.id]);
    for (let index = 0; index < result.length; index++) {
      const parent = result[index]!;
      for (const child of await client.sessions(project, parent.id)) {
        if (!sameDirectory(child.location.directory, project) || child.parentID !== parent.id || child.time.archived) continue;
        if (seen.has(child.id)) throw new Error("OpenCode repeated a crew entry relationship.");
        seen.add(child.id);
        result.push(child);
      }
    }
    return result;
  };

  const families = async (roots: SessionInfo[], project: string) => (await Promise.all(roots.map(async (root) =>
    (await family(root, project)).map((session) => ({ session, logEntryID: root.id }))
  ))).flat();

  const working = async (project: string) => {
    const active = await client.active(project);
    const owned = await Promise.all(active.map(async (id) => (await rootSession(id, project)) ? id : undefined));
    return owned.filter((id): id is string => !!id);
  };

  const state = async (project: string): Promise<AppState> => {
    const [info, models, conversations, active, permissions, questions, agents] = await Promise.all([
      client.info(),
      availableModels(client, project),
      sessions(project),
      client.active(project),
      client.permissions(project),
      client.forms(project),
      client.agents(project),
    ]);
    const related = await families(conversations, project);
    const entries = new Map(related.map((entry) => [entry.session.id, entry]));
    const activity = related.filter((entry) => active.includes(entry.session.id)).map(({ session, logEntryID }) => ({
      sessionID: session.id, logEntryID,
      ...(crewMember(session.agent) ? { officer: crewMember(session.agent)!.id } : {}),
      status: retrying.has(session.id) ? "retry" as const : "busy" as const,
      ...(retrying.has(session.id) ? { message: retrying.get(session.id) } : {}),
    }));
    const statuses: AppState["statuses"] = {};
    for (const entry of activity) {
      if (!statuses[entry.logEntryID] || entry.status === "retry") statuses[entry.logEntryID] = {
        type: entry.status, ...(entry.message ? { message: entry.message } : {}),
      };
    }
    for (const id of retrying.keys()) if (!active.includes(id)) retrying.delete(id);
    let savedModel: ModelSelection | undefined;
    let modelError: string | undefined;
    try { savedModel = await readModelSettings(modelFile); }
    catch (error) { modelError = errorMessage(error); }
    const selectedModel = models.models.find((model) => model.providerID === savedModel?.providerID && model.modelID === savedModel.modelID);
    return {
      project,
      version: info.version,
      ...models,
      savedModel, selectedModel, modelError,
      conversations: conversations.map((session) => ({ id: session.id, title: session.title, created: session.time.created, updated: session.time.updated })),
      statuses,
      permissions: permissions.filter((request) => entries.has(request.sessionID)).map((request) => ({
        ...request, logEntryID: entries.get(request.sessionID)!.logEntryID,
        officer: crewMember(entries.get(request.sessionID)!.session.agent)?.id,
      })),
      questions: questions.filter((request) => entries.has(request.sessionID)).map((request) => ({
        ...request, logEntryID: entries.get(request.sessionID)!.logEntryID,
        officer: crewMember(entries.get(request.sessionID)!.session.agent)?.id,
      })),
      crew: { available: verifiedCrew(agents), activity },
      speech: { configured: !!speech,
        listening: speech?.selection?.listening ?? "nemotron",
        speaking: speech?.selection?.speaking ?? "kokoro",
        ...(speechError ? { error: speechError } : {}),
        ...(localSetup && localSetup.state !== "done" ? { setup: { state: localSetup.state, step: localSetup.step, ...(localSetup.error ? { error: localSetup.error } : {}) } } : {}) },
    };
  };

  const eventStream = async (response: ServerResponse, project: string) => {
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    const related = await families(await sessions(project), project);
    const entries = new Map(related.map((entry) => [entry.session.id, entry]));
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
      const stream = client.events(controller.signal);
      // The first event confirms OpenCode's live connection is open.
      const first = await stream.next();
      if (first.done) throw new Error("OpenCode closed its live connection before it was ready.");
      clearTimeout(startup);
      send({ type: "connection", connected: true });
      for await (const event of stream) {
        if (controller.signal.aborted || directory !== project) break;
        const id = eventSession(event);
        if (!id || event.type === "session.deleted" && !entries.has(id)) continue;
        if (event.type === "session.moved") {
          const previous = entries.get(id);
          if (previous) for (const [key, entry] of entries) if (entry.logEntryID === previous.logEntryID) entries.delete(key);
          send({ type: "state" });
        }
        if (event.type === "session.created" || event.type === "session.agent.selected" || !entries.has(id)) {
          const root = await rootSession(id, project);
          if (!root) continue;
          entries.set(id, { session: await client.session(id, project), logEntryID: root.id });
        }
        const entry = entries.get(id);
        if (!entry) continue;
        if (event.type === "session.retry.scheduled") retrying.set(id, errorMessage(event.data.error));
        else if (/^session\.(step\.started|execution\.)/.test(event.type)) retrying.delete(id);
        for (const item of browserEvents(event)) {
          if ("sessionID" in item) item.sessionID = entry.logEntryID;
          if (item.type === "delta") {
            item.speaker = crewMember(entry.session.agent)?.id;
            item.background = !!entry.session.parentID;
          }
          send(item);
        }
        if (event.type === "session.deleted") entries.delete(id);
      }
      if (!controller.signal.aborted && directory === project) throw new Error("OpenCode closed its live connection.");
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
      response.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' ${origin.replace("http:", "ws:")}; worker-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
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
        if (path === "/api/model" && method === "POST") {
          const data = await body(request);
          let choice;
          try { choice = modelSelection(data); }
          catch (error) { throw new HttpError(400, errorMessage(error)); }
          if ((await working(project)).length) throw new HttpError(409, "Stop the current work before changing the model.");
          const { models } = await availableModels(client, project);
          if (!models.some((model) => model.providerID === choice.providerID && model.modelID === choice.modelID)) {
            throw new HttpError(400, "That model is not available. Refresh the provider connection and choose an available model.");
          }
          await saveModelSettings(modelFile, choice);
          notifyState();
          json(response, 200, await state(project));
          return;
        }
        const soundName = /^\/api\/sounds\/(startup|request-accepted|input-failed|request-failed|tribute-fact)$/.exec(path)?.[1];
        if (soundName && method === "GET") {
          let sound: Buffer;
          try {
            if (!options.soundFolder) throw new Error();
            sound = await readFile(resolve(options.soundFolder, `${soundName}.mp3`));
          } catch { throw new HttpError(404, "This sound is not set up."); }
          response.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
          response.end(sound);
          return;
        }
        if (path === "/api/events" && method === "GET") {
          await eventStream(response, project);
          return;
        }
        if (path === "/api/settings" && method === "GET") {
          const saved = await readSpeechSettings(speechFile);
          json(response, 200, { settings: describeSpeechSettings(saved), file: speechFile, localReady: await localReady(saved), localFiles: await localFiles(saved) });
          return;
        }
        if (path === "/api/speech-setup" && method === "GET") {
          json(response, 200, localSetup ?? { state: "none", step: "" });
          return;
        }
        if (path === "/api/speech-setup" && method === "POST") {
          await body(request);
          if (localSetup?.state !== "failed" || !localSetupChoice) throw new HttpError(409, "There is no failed speech preparation to retry.");
          const { record, savedRecord } = localSetupChoice;
          const download = !await localReady(record);
          json(response, 202, beginSpeechSetup(record, download, savedRecord));
          return;
        }
        if (path === "/api/settings" && method === "POST") {
          const data = await body(request);
          let record: Record<string, unknown>;
          try { record = mergeSpeechSettings(await readSpeechSettings(speechFile), data); }
          catch (error) { throw new HttpError(400, errorMessage(error)); }
          if (localSetup?.state === "running") throw new HttpError(409, "The speech download is still running. Wait for it to finish.");
          const listening = record.listening !== "mai", speaking = record.speaking === "kokoro";
          if ((listening || speaking) && !await localReady(record, listening, speaking)) {
            await localDownload(record);
            json(response, 202, beginSpeechSetup(record, true));
            return;
          }
          const result = await applySpeech(record);
          localSetup = undefined;
          localSetupChoice = undefined;
          notifyState();
          json(response, 200, result);
          return;
        }
        if (path === "/api/refresh" && method === "POST") {
          await body(request);
          if ((await working(project)).length) throw new HttpError(409, "Stop the current work before refreshing the provider connection.");
          for (const stream of streams) stream.end();
          await client.reload(project);
          await options.prepareCrew?.(project);
          json(response, 200, { refreshed: true });
          return;
        }
        if (path === "/api/project" && method === "POST") {
          const data = await body(request);
          if ((await working(project)).length) throw new HttpError(409, "Stop the current work before changing the project folder.");
          let next: string;
          try { next = await projectDirectory(textField(data, "path", 4096)); }
          catch (error) { throw new HttpError(400, `Could not open that folder. ${errorMessage(error)}`); }
          const check = await client.location(next);
          if (!sameDirectory(check.directory, next)) throw new HttpError(409, "OpenCode did not select that folder. Restart Picard Code with --project instead.");
          try { await options.prepareCrew?.(next); }
          catch (error) {
            try { await options.prepareCrew?.(project); }
            catch (restoreError) { throw new Error(`Could not set up the bridge crew or restore the previous settings. ${errorMessage(error)} ${errorMessage(restoreError)}`); }
            throw error;
          }
          directory = next;
          for (const stream of streams) stream.end();
          json(response, 200, await state(next));
          return;
        }
        if (path === "/api/conversations" && method === "POST") {
          const data = await body(request);
          const result = await client.createSession(project, typeof data.title === "string" ? data.title.trim().slice(0, 120) || "New log entry" : "New log entry");
          json(response, 201, { id: result.id, title: result.title, created: result.time.created, updated: result.time.updated });
          return;
        }
        const media = /^\/api\/conversations\/([^/]+)\/media\/([^/]+)$/.exec(path);
        if (media && (method === "GET" || method === "HEAD")) {
          if (url.searchParams.get("project") !== project) throw new HttpError(403, "That media belongs to another Project.");
          const sessionID = decodeURIComponent(media[1]!);
          if (!await rootSession(sessionID, project)) throw new HttpError(403, "That media belongs to another Project.");
          const message = chatMessages(await client.messages(sessionID, project)).find((item) => item.id === decodeURIComponent(media[2]!) && item.role === "assistant");
          const href = url.searchParams.get("href");
          const references = message?.parts.flatMap((part) => part.type === "text" ? mediaReferences(part.text)
            : part.type === "media" && part.href ? [replyMedia(part.href, part.text)].filter((item) => item !== undefined) : []) ?? [];
          if (!href || !references.some((item) => item.local && item.href === href)) throw new HttpError(403, "That media is not part of this reply.");
          await serveMedia(request, response, project, href);
          return;
        }
        const match = /^\/api\/conversations\/([^/]+)\/(messages|send|stop|delete)$/.exec(path);
        if (match) {
          const id = match[1]!;
          const session = await assertSession(id, project);
          if (match[2] === "messages" && method === "GET") {
            const related = await family(session, project);
            const history = (await Promise.all(related.map(async (entry) =>
              chatMessages(await client.messages(entry.id, project), entry.agent).filter((message) => !entry.parentID || message.role === "assistant").map((message) => ({
                ...message,
                ...(entry.parentID ? { background: true, sourceSessionID: entry.id, speaker: message.speaker ?? crewMember(entry.agent)?.id } : {}),
              }))
            ))).flat().sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
            json(response, 200, history);
            return;
          }
          if (match[2] === "stop" && method === "POST") {
            await body(request);
            await client.interrupt(id, project);
            const related = await family(session, project);
            await Promise.all(related.filter((entry) => entry.parentID).map((entry) => client.interrupt(entry.id, project)));
            json(response, 200, { stopped: true });
            return;
          }
          if (match[2] === "delete" && method === "POST") {
            await body(request);
            const related = await family(session, project);
            const active = await client.active(project);
            if (related.some((entry) => active.includes(entry.id))) throw new HttpError(409, "This log entry is still working. Stop it before deleting it.");
            for (const entry of related.slice(1).reverse()) await client.deleteSession(entry.id, project);
            await client.deleteSession(id, project);
            json(response, 200, { deleted: true });
            return;
          }
          if (match[2] === "send" && method === "POST") {
            const data = await body(request);
            const text = textField(data, "text");
            const modelID = textField(data, "modelID", 256);
            const providerID = textField(data, "providerID", 256);
            let tribute;
            try { tribute = checkTributeRequest(data.tribute); }
            catch (error) { throw new HttpError(400, errorMessage(error)); }
            if (data.bridge !== undefined && typeof data.bridge !== "boolean") throw new HttpError(400, "Choose whether the Bridge crew is on or off.");
            const bridge = data.bridge !== false;
            if (data.speed !== undefined && !SPEAKING_SPEEDS.includes(data.speed as typeof SPEAKING_SPEEDS[number])) throw new HttpError(400, "The speaking speed must be between 0.8 and 1.2.");
            const speed = data.speed as number | undefined;
            if (tribute.storyID) {
              const subject = explicitStorySubject(text);
              if (!subject && !storyAcceptance(text)) throw new HttpError(400, "That response did not request a tribute story.");
              if (subject && TRIBUTE_ENTRIES.find((entry) => entry.id === tribute.storyID)?.subject !== subject) {
                throw new HttpError(400, "That story does not match the person you requested.");
              }
            }
            const { models } = await availableModels(client, project);
            if (!models.some((model) => model.providerID === providerID && model.modelID === modelID)) {
              notifyState();
              throw new HttpError(400, "Sign in to a model provider in OpenCode and choose an available model.");
            }
            let confirmed;
            try { confirmed = await readModelSettings(modelFile); }
            catch (error) { notifyState(); throw error; }
            if (!confirmed) {
              notifyState();
              throw new HttpError(409, "Open Computer intelligence and confirm a model before sending a request.");
            }
            if (confirmed.providerID !== providerID || confirmed.modelID !== modelID) {
              notifyState();
              throw new HttpError(409, "The model choice has changed or is unavailable. Open Computer intelligence and confirm the model before sending a request.");
            }
            const related = await family(session, project);
            const active = await client.active(project);
            if (related.some((entry) => active.includes(entry.id))) throw new HttpError(409, "Wait for the current reply, or stop it before sending another message.");
            const subject = tributeSubject(text);
            let wikipedia: WikipediaArticle | undefined;
            if (subject && !tribute.storyID) {
              try { wikipedia = await readWikipedia(subject); }
              catch (error) { throw new HttpError(502, `${errorMessage(error)} The request was not sent. Try again when Wikipedia is available.`); }
            }
            const named = bridge ? addressedOfficers(text) : [];
            const officer = named.length === 1 ? crewMember(named[0]) : undefined;
            if (bridge && (named.length || crewMember(session.agent))) await requireCrew(client, project);
            if (session.model?.id !== modelID || session.model.providerID !== providerID) await client.setModel(id, project, { id: modelID, providerID });
            // When the Captain names no officer, Picard Code itself asks who should handle the request and hands it
            // over, instead of relying on the computer to decide to call an officer. This needs the crew really loaded.
            const onDuty = bridge && !officer && verifiedCrew(await client.agents(project));
            let chosen: CrewID[] = named.length > 1 ? named : [];
            if (onDuty && !named.length) {
              const previous = crewMember(session.agent);
              if (previous && continuesOfficer(text)) chosen = [previous.id];
              else {
                try { chosen = chosenCrew(await client.generate(id, project, crewChoice(text, previous?.name))); }
                catch (error) { throw new HttpError(502, `Could not decide which officer should handle this request. ${errorMessage(error)} The request was not sent.`); }
              }
            }
            // A named officer answers directly; several report to the Captain in the same log entry.
            // With the Bridge crew off, every request goes to the computer, including follow-ups in an officer's log entry.
            const agent = !bridge ? "build" : officer?.id ?? (chosen.length === 1 ? chosen[0]! : crewMember(session.agent) ? "build" : session.agent);
            if (agent && session.agent !== agent) await client.setAgent(id, project, agent);
            if (session.title === "New log entry" || session.title === "New conversation") await client.rename(id, project, text.slice(0, 60));
            // Picard Code's conversation manner travels with the conversation, not as a file in the project.
            await client.setInstructions(id, project, "picard-manner", computerManner(text, tribute, wikipedia, { agent, onDuty, briefing: chosen.length > 1 ? chosen : undefined, offDuty: !bridge, speed }));
            await client.prompt(id, project, text);
            json(response, 202, { accepted: true, ...(wikipedia ? { reference: { title: wikipedia.title, url: wikipedia.url } } : {}) });
            return;
          }
        }
        const approval = /^\/api\/(permissions|questions)\/([^/]+)$/.exec(path);
        if (approval && method === "POST") {
          const data = await body(request);
          const requestID = approval[2]!;
          if (approval[1] === "permissions") {
            const item = (await client.permissions(project)).find((item) => item.id === requestID);
            if (!item) throw new HttpError(409, "That approval is no longer waiting. Refresh the log entry.");
            if (!await rootSession(item.sessionID, project)) throw new HttpError(403, "That approval belongs to another project folder.");
            if (data.reply !== "once" && data.reply !== "reject") throw new HttpError(400, "Choose Allow once or Deny.");
            await client.replyPermission(item.sessionID, requestID, project, data.reply);
          } else {
            const item = (await client.forms(project)).find((item) => item.id === requestID);
            if (!item) throw new HttpError(409, "That question is no longer waiting. Refresh the log entry.");
            if (!await rootSession(item.sessionID, project)) throw new HttpError(403, "That question belongs to another project folder.");
            if (data.skip === true) await client.cancelForm(item.sessionID, requestID, project);
            else await client.replyForm(item.sessionID, requestID, project, checkAnswer(item.fields, data.answer));
          }
          json(response, 200, { answered: true });
          return;
        }
        throw new HttpError(404, "That action is not available.");
      }
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "This page only supports viewing.");
      const decoded = decodeURIComponent(path);
      if (decoded.includes("\\") || decoded.split("/").includes("..")) throw new HttpError(403, "That file is not part of Picard Code.");
      const relative = decoded === "/" ? "index.html" : `.${decoded}`;
      const file = resolve(webRoot, relative);
      if (!file.startsWith(`${webRoot}${sep}`)) throw new HttpError(403, "That file is not part of Picard Code.");
      let resolved: string;
      try { resolved = await realpath(file); }
      catch { throw new HttpError(404, "That page was not found."); }
      if (!resolved.startsWith(`${webRoot}${sep}`)) throw new HttpError(403, "That file is not part of Picard Code.");
      const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml; charset=utf-8", ".wasm": "application/wasm" };
      const content = await readFile(resolved);
      response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
      response.end(method === "HEAD" ? undefined : content);
    })().catch((error: unknown) => {
      if (response.headersSent) { response.destroy(); return; }
      json(response, error instanceof HttpError || error instanceof MediaError ? error.status : 502, {
        error: error instanceof HttpError || error instanceof MediaError ? error.message : `OpenCode could not complete this request. ${errorMessage(error)}`,
      });
    }).finally(() => {
      if (ownsMutation) mutationBusy = false;
    });
  });
  const closeSpeech = attachSpeech(server, () => speech, (request) => {
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
  if (migration) beginSpeechSetup(migration, migrationDownload, migrationSettings);
  return {
    origin, token,
    url: `${origin}/#token=${token}`,
    close: async () => {
      closing.abort();
      await localSetupRun;
      closeSpeech();
      for (const stream of streams) stream.end();
      try { await speech?.close?.(); }
      finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      }
    },
  };
}
