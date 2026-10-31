import type { Part, Message } from "@opencode-ai/sdk/v2";
import type { ChatMessage, ChatPart } from "./types.js";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    if ("data" in error) return errorMessage(error.data);
    if ("message" in error && typeof error.message === "string") return error.message;
    if ("name" in error && typeof error.name === "string") return error.name;
  }
  return "OpenCode could not complete the request. Check its setup and try again.";
}

export function chatPart(part: Part): ChatPart | undefined {
  if (part.type === "text" || part.type === "reasoning") {
    return { id: part.id, type: part.type, text: part.text };
  }
  if (part.type === "tool") {
    const state = part.state;
    const title = "title" in state ? state.title : part.tool;
    const detail = state.status === "error" ? state.error :
      state.status === "completed" ? state.output : JSON.stringify(state.input, null, 2);
    return { id: part.id, type: "tool", text: `${title || part.tool}\n${detail}`, status: state.status };
  }
  return undefined;
}

export function chatMessage(entry: { info: Message; parts: Part[] }): ChatMessage {
  return {
    id: entry.info.id,
    role: entry.info.role,
    parts: entry.parts.map(chatPart).filter((part): part is ChatPart => !!part),
    error: entry.info.role === "assistant" && entry.info.error ? errorMessage(entry.info.error) : undefined,
  };
}
