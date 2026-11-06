import type { ContentItem, OpenCodeError, SessionMessage } from "./opencode.js";
import type { ChatMessage, ChatPart } from "../shared/types.js";
import { crewMember } from "../shared/crew.js";
import { stripVTControlCharacters } from "node:util";
import { replyMedia } from "../shared/media.js";

export const STOPPED = "Work stopped before it finished.";

/** Stable names for the pieces of a reply; live text uses the same names, so it lines up with stored history. */
export function partID(messageID: string, kind: "text" | "reasoning" | "tool", key: string | number) {
  return `${messageID}:${kind}:${key}`;
}

type Tool = Extract<ContentItem, { type: "tool" }>;

function inputText(input: unknown) {
  return JSON.stringify(input ?? {}, (key, value: unknown) =>
    /^(?:authorization|password|passwd|secret|token|access[_-]?token|api[_-]?key|credential|cookie)$/i.test(key) ? "[not shown]" : value, 2);
}

function toolPart(messageID: string, item: Tool): ChatPart {
  const { state } = item;
  const output = (state.content ?? []).flatMap((piece) => piece.type === "text" ? [piece.text] : []).join("\n");
  const detail = state.status === "error" ? state.error?.message ?? "The action failed."
    : state.status === "completed" ? output
    : inputText(state.input);
  const fileMetadata = Array.isArray(state.metadata?.files) ? state.metadata.files
    : state.metadata?.filediff ? [state.metadata.filediff] : [];
  const changes = fileMetadata.flatMap((file) => {
    if (!file || typeof file !== "object" || typeof file.file !== "string") return [];
    return [{ file: file.file, ...(typeof file.before === "string" ? { before: file.before } : {}),
      ...(typeof file.after === "string" ? { after: file.after } : {}), ...(typeof file.patch === "string" ? { patch: file.patch } : {}) }];
  });
  return { id: partID(messageID, "tool", item.id), type: "tool", text: `${item.name}\n${detail}`, status: state.status === "streaming" ? "pending" : state.status,
    tool: { name: item.name, input: inputText(state.input), output: stripVTControlCharacters(output), changes,
      ...(state.status === "error" ? { error: state.error?.message ?? "The action failed." } : {}),
      ...(typeof state.metadata?.exit === "number" ? { exit: state.metadata.exit } : {}) } };
}

function parts(messageID: string, content: ContentItem[]) {
  const count = { text: 0, reasoning: 0 };
  return content.flatMap((item): ChatPart[] => {
    if (item.type !== "tool") return [{ id: partID(messageID, item.type, count[item.type]++), type: item.type, text: item.text }];
    const files: ChatPart[] = (item.state.content ?? []).flatMap((piece, index) =>
      piece.type === "file"
        ? [{ id: `${messageID}:file:${item.id}:${index}`, type: replyMedia(piece.uri, piece.name ?? "", piece.mime.startsWith("image/")) ? "media" : "file",
          text: piece.name || "Result file", href: piece.uri, mime: piece.mime }] : []);
    return [toolPart(messageID, item), ...files];
  });
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
export function chatMessages(history: SessionMessage[], agent?: string): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const entry of history) {
    if (entry.type === "user" && "text" in entry) {
      result.push({ id: entry.id, role: "user", parts: [{ id: partID(entry.id, "text", 0), type: "text", text: entry.text }], created: entry.time.created });
    } else if (entry.type === "assistant" && "content" in entry) {
      const message: ChatMessage = { id: entry.id, role: "assistant", parts: parts(entry.id, entry.content) };
      message.created = entry.time.created;
      const officer = crewMember(entry.agent);
      if (officer) message.speaker = officer.id;
      const error = describe(entry.error, message);
      if (error) message.error = error;
      if (entry.error) message.outcome = entry.error.type === "aborted" ? "interrupted" : "failed";
      result.push(message);
    } else if (entry.type === "shell" && "command" in entry) {
      result.push({ id: entry.id, role: "assistant", created: entry.time.created,
        parts: [{ id: partID(entry.id, "tool", "shell"), type: "tool", status: entry.status === "running" ? "running"
          : entry.status === "exited" && entry.exit === 0 ? "completed" : "error",
          text: `shell\n${entry.output?.output ?? ""}`,
          tool: { name: "shell", input: entry.command, output: `${stripVTControlCharacters(entry.output?.output ?? "")}${entry.output?.truncated ? "\nMore command output is available in OpenCode; this saved result is incomplete." : ""}`, exit: entry.exit } }] });
    } else if ((entry.type === "system" || entry.type === "synthetic") && "description" in entry && entry.description
      || entry.type === "skill" && "name" in entry || entry.type === "compaction" && "status" in entry) {
      const description = "description" in entry ? entry.description ?? "" : "name" in entry ? `Instructions loaded: ${entry.name}` :
        "error" in entry && entry.error ? entry.error.message : "summary" in entry ? entry.summary ?? "Preparing earlier context." : "Preparing earlier context.";
      const status = "status" in entry ? entry.status === "failed" ? "error" : entry.status === "running" ? "running" : "completed" : "completed";
      result.push({ id: entry.id, role: "assistant", created: entry.time.created,
        parts: [{ id: partID(entry.id, "tool", "notice"), type: "tool", status, text: description,
          tool: { name: "OpenCode notice", output: description } }] });
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
        result.push({ id: entry.id, role: "assistant", parts: [], error, created: entry.time.created, outcome: entry.outcome, speaker: crewMember(agent)?.id });
      }
    }
  }
  return result;
}
