/**
 * A small client for the parts of OpenCode 2's local server that Picard Code uses.
 * Shapes follow OpenCode 2.2.5's published server description; only the fields
 * Picard Code reads are listed.
 */
import type { FormRequest, FormValue, PermissionRequest } from "../shared/types.js";

export type { FormRequest, FormValue, PermissionRequest };

export interface ModelRef { id: string; providerID: string; variant?: string }

export interface ModelInfo {
  id: string;
  modelID?: string;
  providerID: string;
  name: string;
  status?: string;
  enabled?: boolean;
}

export interface ProviderInfo { id: string; name: string; integrationID?: string }
export interface IntegrationInfo { id: string; connections: { type: "credential" | "env" }[] }
export interface PermissionRule { action: string; resource: string; effect: "allow" | "deny" | "ask" }
export interface AgentInfo { id: string; mode: "primary" | "subagent" | "all"; system?: string; model?: unknown; permissions: PermissionRule[] }

export interface SessionInfo {
  id: string;
  title: string;
  agent?: string;
  model?: ModelRef;
  parentID?: string | null;
  location: { directory: string };
  time: { created: number; updated: number; archived?: number };
}

export interface OpenCodeError { type: string; message: string }

export type ToolContent = { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string | null };

export type ContentItem =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; state: { status: string; input?: unknown; content?: ToolContent[]; metadata?: Record<string, unknown>; error?: OpenCodeError } };

export type SessionMessage =
  | { id: string; type: "user"; text: string; time: { created: number } }
  | { id: string; type: "assistant"; agent?: string; content: ContentItem[]; error?: OpenCodeError; finish?: string; time: { created: number; completed?: number } }
  | { id: string; type: "idle"; outcome: "succeeded" | "failed" | "interrupted"; error?: OpenCodeError; time: { created: number } }
  | { id: string; type: "shell"; command: string; status: string; exit?: number; output?: { output: string; cursor: number; size: number; truncated: boolean }; time: { created: number } }
  | { id: string; type: "system" | "synthetic"; text: string; description?: string; time: { created: number } }
  | { id: string; type: "skill"; name: string; time: { created: number } }
  | { id: string; type: "compaction"; status: string; summary?: string; error?: OpenCodeError; time: { created: number } }
  | { id: string; type: string; time: { created: number } };

/** One event from OpenCode's live stream. */
export interface OpenCodeEvent { id?: string; type: string; data: Record<string, unknown> }

export class OpenCodeRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function describe(status: number, text: string) {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message
      : typeof body.error === "string" ? body.error
      : body.error && typeof body.error === "object" && "message" in body.error ? String(body.error.message) : undefined;
    if (message) return message;
  } catch { /* Not JSON; fall through. */ }
  if (status === 401) return "OpenCode refused the password.";
  return `OpenCode answered with status ${status}.`;
}

export class OpenCode {
  private readonly authorization: string;

  constructor(readonly baseUrl: string, password: string, username = "opencode") {
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  private async call<T>(method: string, path: string, options: { directory?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: this.authorization };
    if (options.directory) headers["x-opencode-directory"] = encodeURIComponent(options.directory);
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeout ?? 15_000),
    });
    const text = await response.text();
    if (!response.ok) throw new OpenCodeRequestError(response.status, describe(response.status, text));
    return (text ? JSON.parse(text) : undefined) as T;
  }

  info(timeout = 5000) {
    return this.call<{ version: string }>("GET", "/api/info", { timeout });
  }

  async location(directory: string) {
    const result = await this.call<{ directory: string; project?: { canonical?: string } }>("GET", "/api/location", { directory });
    return result;
  }

  reload(directory: string) {
    return this.call<void>("POST", "/api/location/reload", { directory });
  }

  async models(directory: string) {
    return (await this.call<{ data: ModelInfo[] }>("GET", "/api/model", { directory })).data;
  }

  async providers(directory: string) {
    return (await this.call<{ data: ProviderInfo[] }>("GET", "/api/provider", { directory })).data;
  }

  async integrations(directory: string) {
    return (await this.call<{ data: IntegrationInfo[] }>("GET", "/api/integration", { directory })).data;
  }

  async mcpServers(directory: string) {
    return (await this.call<{ data: { name: string; status: { status: string; error?: string } }[] }>("GET", "/api/mcp", { directory })).data;
  }

  async agents(directory: string) {
    return (await this.call<{ data: AgentInfo[] }>("GET", "/api/agent", { directory })).data;
  }

  async defaultModel(directory: string) {
    return (await this.call<{ data: ModelInfo | null }>("GET", "/api/model/default", { directory })).data;
  }

  /** Models the user set in their OpenCode settings. Only the model names are kept: the settings can hold keys. */
  async configuredModels(directory: string) {
    const documents = await this.call<{ info?: { model?: unknown } }[]>("GET", "/api/config", { directory });
    const models: { providerID: string; id: string }[] = [];
    for (const document of Array.isArray(documents) ? documents : []) {
      const model = document.info?.model;
      if (typeof model === "string" && model.includes("/")) {
        const split = model.indexOf("/");
        models.push({ providerID: model.slice(0, split), id: model.slice(split + 1) });
      } else if (model && typeof model === "object" && "providerID" in model && "model" in model
        && typeof model.providerID === "string" && typeof model.model === "string") {
        models.push({ providerID: model.providerID, id: model.model });
      }
    }
    return models;
  }

  async sessions(directory: string, parentID?: string) {
    const query = new URLSearchParams({ directory, parentID: parentID ?? "null", archived: "false", limit: "100" });
    const all: SessionInfo[] = [];
    const cursors = new Set<string>();
    for (;;) {
      const page = await this.call<{ data: SessionInfo[]; cursor?: { next?: string | null } }>("GET", `/api/session?${query}`, { directory });
      all.push(...page.data);
      if (!parentID || !page.cursor?.next) return all;
      if (cursors.has(page.cursor.next)) throw new Error("OpenCode returned the same page of crew entries twice.");
      cursors.add(page.cursor.next);
      query.set("cursor", page.cursor.next);
    }
  }

  async session(id: string, directory: string) {
    return (await this.call<{ data: SessionInfo }>("GET", `/api/session/${encodeURIComponent(id)}`, { directory })).data;
  }

  async createSession(directory: string, title: string, model?: ModelRef, options: { agent?: string; parentID?: string } = {}) {
    return (await this.call<{ data: SessionInfo }>("POST", "/api/session", {
      directory,
      body: { title, agent: options.agent ?? "build", ...(options.parentID ? { parentID: options.parentID } : {}), ...(model ? { model } : {}), location: { directory } },
    })).data;
  }

  deleteSession(id: string, directory: string) {
    return this.call<void>("DELETE", `/api/session/${encodeURIComponent(id)}`, { directory });
  }

  rename(id: string, directory: string, title: string) {
    return this.call<void>("PATCH", `/api/session/${encodeURIComponent(id)}`, { directory, body: { title } });
  }

  setModel(id: string, directory: string, model: ModelRef) {
    return this.call<void>("POST", `/api/session/${encodeURIComponent(id)}/model`, { directory, body: { model } });
  }

  setAgent(id: string, directory: string, agent: string) {
    return this.call<void>("POST", `/api/session/${encodeURIComponent(id)}/agent`, { directory, body: { agent } });
  }

  /** Conversation instructions sent with the session; an unchanged value is ignored by OpenCode. */
  setInstructions(id: string, directory: string, key: string, value: string) {
    return this.call<void>("PUT", `/api/experimental/session/${encodeURIComponent(id)}/instructions/entries/${encodeURIComponent(key)}`, { directory, body: { value } });
  }

  prompt(id: string, directory: string, text: string) {
    return this.call<unknown>("POST", `/api/session/${encodeURIComponent(id)}/prompt`, { directory, body: { text } });
  }

  /** One short answer from the log entry's context, without adding to it or using tools. */
  async generate(id: string, directory: string, prompt: string) {
    return (await this.call<{ data: { text: string } }>("POST", `/api/session/${encodeURIComponent(id)}/generate`, { directory, body: { prompt } })).data.text;
  }

  interrupt(id: string, directory: string) {
    return this.call<unknown>("POST", `/api/session/${encodeURIComponent(id)}/interrupt`, { directory });
  }

  /** Conversations that are working right now; anything missing is idle. */
  async active(directory: string) {
    return Object.keys((await this.call<{ data: Record<string, unknown> }>("GET", "/api/session/active", { directory })).data);
  }

  async messages(id: string, directory: string) {
    const all: SessionMessage[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    // Pages come oldest first; read them all so the newest messages are never left out.
    for (;;) {
      const query = new URLSearchParams({ order: "asc", limit: "200", ...(cursor ? { cursor } : {}) });
      const result = await this.call<{ data: SessionMessage[]; cursor?: { next?: string } }>("GET", `/api/session/${encodeURIComponent(id)}/message?${query}`, { directory });
      all.push(...result.data);
      if (result.data.length < 200 || !result.cursor?.next) return all;
      if (seen.has(result.cursor.next)) throw new Error("OpenCode returned the same page of this log entry twice, so its newest messages could not be read.");
      seen.add(result.cursor.next);
      cursor = result.cursor.next;
    }
  }

  async permissions(directory: string) {
    return (await this.call<{ data: PermissionRequest[] }>("GET", "/api/permission/request", { directory })).data;
  }

  replyPermission(sessionID: string, requestID: string, directory: string, decision: "once" | "reject") {
    return this.call<void>("POST", `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, { directory, body: { decision } });
  }

  async forms(directory: string) {
    return (await this.call<{ data: FormRequest[] }>("GET", "/api/form", { directory })).data;
  }

  replyForm(sessionID: string, formID: string, directory: string, answer: Record<string, FormValue>) {
    return this.call<void>("POST", `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}/reply`, { directory, body: { answer } });
  }

  cancelForm(sessionID: string, formID: string, directory: string) {
    return this.call<void>("DELETE", `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}`, { directory });
  }

  /** OpenCode's live event stream for every folder. The first event is `server.connected`. */
  async *events(signal: AbortSignal): AsyncGenerator<OpenCodeEvent> {
    const response = await fetch(`${this.baseUrl}/api/event`, { headers: { Authorization: this.authorization, Accept: "text/event-stream" }, redirect: "error", signal });
    if (!response.ok || !response.body) throw new OpenCodeRequestError(response.status, describe(response.status, await response.text()));
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        let event: unknown;
        try { event = JSON.parse(data); } catch { continue; }
        if (event && typeof event === "object" && "type" in event && typeof event.type === "string") {
          const data = "data" in event && event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
          yield { type: event.type, data, ...("id" in event && typeof event.id === "string" ? { id: event.id } : {}) };
        }
      }
    }
  }
}
