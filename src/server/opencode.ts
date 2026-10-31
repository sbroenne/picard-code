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

export type ContentItem =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; state: { status: string; input?: unknown; content?: { type: string; text?: string }[]; error?: OpenCodeError } };

export type SessionMessage =
  | { id: string; type: "user"; text: string; time: { created: number } }
  | { id: string; type: "assistant"; content: ContentItem[]; error?: OpenCodeError; finish?: string; time: { created: number; completed?: number } }
  | { id: string; type: "idle"; outcome: "succeeded" | "failed" | "interrupted"; error?: OpenCodeError; time: { created: number } }
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

  async defaultModel(directory: string) {
    return (await this.call<{ data: ModelInfo | null }>("GET", "/api/model/default", { directory })).data;
  }

  async sessions(directory: string) {
    const query = new URLSearchParams({ directory, parentID: "null", archived: "false", limit: "100" });
    return (await this.call<{ data: SessionInfo[] }>("GET", `/api/session?${query}`, { directory })).data;
  }

  async session(id: string, directory: string) {
    return (await this.call<{ data: SessionInfo }>("GET", `/api/session/${encodeURIComponent(id)}`, { directory })).data;
  }

  async createSession(directory: string, title: string, model?: ModelRef) {
    return (await this.call<{ data: SessionInfo }>("POST", "/api/session", {
      directory,
      body: { title, agent: "build", ...(model ? { model } : {}), location: { directory } },
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

  /** Conversation instructions sent with the session; an unchanged value is ignored by OpenCode. */
  setInstructions(id: string, directory: string, key: string, value: string) {
    return this.call<void>("PUT", `/api/experimental/session/${encodeURIComponent(id)}/instructions/entries/${encodeURIComponent(key)}`, { directory, body: { value } });
  }

  prompt(id: string, directory: string, text: string) {
    return this.call<unknown>("POST", `/api/session/${encodeURIComponent(id)}/prompt`, { directory, body: { text } });
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
    // Pages come oldest first; long conversations take several pages.
    for (let page = 0; page < 50; page++) {
      const query = new URLSearchParams({ order: "asc", limit: "200", ...(cursor ? { cursor } : {}) });
      const result = await this.call<{ data: SessionMessage[]; cursor?: { next?: string } }>("GET", `/api/session/${encodeURIComponent(id)}/message?${query}`, { directory });
      all.push(...result.data);
      if (result.data.length < 200 || !result.cursor?.next) break;
      cursor = result.cursor.next;
    }
    return all;
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
