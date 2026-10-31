import type { ContentItem, OpenCodeError, SessionMessage } from "./opencode.js";
import type { ChatMessage, ChatPart } from "../shared/types.js";

export const STOPPED = "Work stopped before it finished.";

/** Stable names for the pieces of a reply; live text uses the same names, so it lines up with stored history. */
export function partID(messageID: string, kind: "text" | "reasoning" | "tool", key: string | number) {
  return `${messageID}:${kind}:${key}`;
}

type Tool = Extract<ContentItem, { type: "tool" }>;

function toolPart(messageID: string, item: Tool): ChatPart {
  const { state } = item;
  const detail = state.status === "error" ? state.error?.message ?? "The action failed."
    : state.status === "completed" ? (state.content ?? []).map((piece) => piece.text ?? "").join("\n")
    : JSON.stringify(state.input ?? {}, null, 2);
  return { id: partID(messageID, "tool", item.id), type: "tool", text: `${item.name}\n${detail}`, status: state.status === "streaming" ? "pending" : state.status };
}

function parts(messageID: string, content: ContentItem[]) {
  const count = { text: 0, reasoning: 0 };
  return content.map((item): ChatPart => item.type === "tool"
    ? toolPart(messageID, item)
    : { id: partID(messageID, item.type, count[item.type]++), type: item.type, text: item.text });
}

function failedTool(message: ChatMessage) {
  return message.parts.some((part) => part.type === "tool" && part.status === "error");
}

function describe(error: OpenCodeError | undefined, message: ChatMessage) {
  if (!error) return undefined;
  if (error.type === "aborted") {
    // A declined approval or skipped question already explains itself in the failed action.
    return failedTool(message) ? undefined : STOPPED;
  }
  return error.message || "OpenCode could not complete the request.";
}

/** Turns OpenCode 2's stored conversation, oldest first, into what Picard Code shows and speaks. */
export function chatMessages(history: SessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const entry of history) {
    if (entry.type === "user" && "text" in entry) {
      result.push({ id: entry.id, role: "user", parts: [{ id: partID(entry.id, "text", 0), type: "text", text: entry.text }] });
    } else if (entry.type === "assistant" && "content" in entry) {
      const message: ChatMessage = { id: entry.id, role: "assistant", parts: parts(entry.id, entry.content) };
      const error = describe(entry.error, message);
      if (error) message.error = error;
      if (entry.error) message.outcome = entry.error.type === "aborted" ? "interrupted" : "failed";
      result.push(message);
    } else if (entry.type === "idle" && "outcome" in entry) {
      // A run can fail before any reply exists, for example when the model cannot be reached.
      const last = result.at(-1);
      if (entry.outcome === "succeeded") {
        if (last?.role === "assistant") last.outcome = "succeeded";
        continue;
      }
      const error = entry.outcome === "failed" ? entry.error?.message || "OpenCode could not complete the request." : STOPPED;
      if (last?.role === "assistant") {
        last.outcome = entry.outcome;
        if (!last.error && !failedTool(last)) last.error = error;
      } else {
        result.push({ id: entry.id, role: "assistant", parts: [], error, outcome: entry.outcome });
      }
    }
  }
  return result;
}
