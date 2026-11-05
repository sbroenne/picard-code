export type VoicePhase = "off" | "listening" | "thinking" | "speaking";

export type SpeechEvent =
  // `id` repeats the number of the listen request that is now open.
  | { type: "state"; phase: VoicePhase; id?: number }
  | { type: "partial"; text: string }
  | { type: "transcript"; text: string }
  | { type: "audio-start"; rate: number; id: number }
  // The audio that follows begins this part of the spoken reply, counted from 0.
  | { type: "part-start"; id: number; index: number }
  | { type: "audio-end"; id: number }
  | { type: "turn-result"; id: number; complete: boolean }
  | { type: "error"; message: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FILE_TYPES = "ts|tsx|js|jsx|mjs|cjs|json|md|py|toml|ya?ml|txt|html|css|lock|sh|ps1|cs|go|rs|java|wav|env";
const ABBREVIATIONS = new Set(["AI", "API", "CD", "CI", "CLI", "CPU", "CSS", "CSV", "DNS", "GPU", "HTML", "HTTP", "HTTPS", "ID", "IP", "JSON", "JWT", "OS", "PDF", "PR", "SDK", "SQL", "SSH", "TCP", "TTS", "UI", "URI", "URL", "UTC", "UUID", "UX", "XML", "YAML"]);

function speakableCode(code: string) {
  return code.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b[A-Z][a-z]+\b/g, (word) => word.toLowerCase());
}

/** Rewrites text for listening only; the written reply on screen is never changed. */
export function speakable(text: string) {
  return text
    .replace(/\bhttps?:\/\/[^\s)>\]]*[^\s)>\].,;:!?]/g, "the link on screen")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\b/g,
      (whole, year: string, month: string, day: string, hour?: string, minute?: string, zone?: string) => {
        const name = MONTHS[Number(month) - 1];
        if (!name || Number(day) < 1 || Number(day) > 31) return whole;
        const time = hour === undefined ? "" : hour === "00" && minute === "00" ? " at midnight" : ` at ${Number(hour)}:${minute}`;
        return `${name} ${Number(day)}, ${year}${time}${zone === "Z" ? " UTC" : zone ? ` ${zone}` : ""}`;
      })
    .replace(new RegExp(`([\\w./\\\\-]+\\.(?:${FILE_TYPES})):(\\d+)(?:-(\\d+))?\\b`, "g"),
      (_whole, file: string, start: string, end?: string) => end ? `${file}, lines ${start} to ${end}` : `${file}, line ${start}`)
    .replace(/(?<![\w/\\])(?:\.\.?[/\\])?[\w.-]+(?:[/\\][\w.-]+)+[/\\]?/g, (path) =>
      !/\.\w/.test(path) && (path.match(/[/\\]/g) ?? []).length < 2 ? path : path
        .replace(/^\.[/\\]/, "")
        .replace(/(\w)\.(?=\w)/g, "$1 dot ")
        .replace(/[/\\]/g, " slash ").replace(/\s+/g, " ").trim())
    .replace(new RegExp(`\\b([\\w-]+)\\.(${FILE_TYPES})\\b`, "g"), "$1 dot $2")
    .replace(/\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g, (name) => name.split("_")
      .map((word) => /^[A-Z][A-Z0-9]+$/.test(word) && !ABBREVIATIONS.has(word) ? word.toLowerCase() : word).join(" "));
}

function spokenInline(tokens: Token[]): string {
  return tokens.map((token) => {
    switch (token.type) {
      case "text": return token.tokens ? spokenInline(token.tokens) : token.text;
      case "escape": case "image": return token.text;
      case "codespan": return speakableCode(token.text);
      case "strong": case "em": case "del": case "link": return token.tokens ? spokenInline(token.tokens) : token.text;
      case "br": return " ";
      default: return "";
    }
  }).join("");
}

function sentence(text: string) {
  return !text || /[.!?:]$/.test(text) ? text : `${text}.`;
}

function spokenBlocks(tokens: Token[]): string[] {
  const blocks: string[] = [];
  for (const token of tokens) {
    // A heading marks the appendix; the same words inside a code sample do not end speech.
    if (token.type === "heading" && /^on screen$/i.test((token.tokens ? spokenInline(token.tokens) : token.text).trim())) break;
    switch (token.type) {
      case "paragraph": case "text":
        blocks.push(token.tokens ? spokenInline(token.tokens) : token.text);
        break;
      case "heading":
        blocks.push(sentence(token.tokens ? spokenInline(token.tokens) : token.text));
        break;
      case "list":
        blocks.push(...token.items.map((item: Tokens.ListItem) => sentence(spokenBlocks(item.tokens).join(" "))));
        break;
      case "blockquote":
        blocks.push(...token.tokens ? spokenBlocks(token.tokens) : [token.text]);
        break;
    }
  }
  return blocks;
}

/** Speaks the conversational answer; code, tables and the marked appendix stay on screen. */
export function spokenSummary(text: string) {
  let spoken = speakable(spokenBlocks(lexer(text, { gfm: true })).join(" ")).replace(/\s+/g, " ").trim();
  if (!spoken) return "The result is on screen.";
  if (spoken.endsWith(":")) spoken = `${spoken.slice(0, -1)}. The details are on screen.`;
  return spoken;
}

/** Chooses what to say about a finished reply, including replies that end with a refused or failed action. */
type ReplyMessage = { error?: string; parts: { type: string; text: string; status?: string }[] };
const replyText = (message: ReplyMessage) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
const failedTools = (message: ReplyMessage) => message.parts.filter((part) => part.type === "tool" && part.status === "error");

/** True when the finished reply is a final error or a refusal with no written answer; earlier failed attempts that the reply explains do not count. */
export function replyFailed(message: ReplyMessage) {
  return !!message.error || (!replyText(message).trim() && failedTools(message).length > 0);
}

/** The first sentence of spoken text; titles such as "Mr." and "Dr." do not end it. */
export function firstSentence(text: string) {
  return text.match(/^.+?(?<!\b(?:Mr|Mrs|Ms|Dr|St|e\.g|i\.e|vs|etc))[.!?](?=\s|$)/i)?.[0] ?? text;
}

export function spokenReply(message: ReplyMessage) {
  if (message.error) return spokenSummary(message.error);
  const text = replyText(message);
  if (text.trim()) return spokenSummary(text);
  const failed = failedTools(message);
  if (failed.some((part) => /dismissed this question/i.test(part.text))) return "Question skipped. The work has stopped.";
  if (failed.some((part) => /reject|denied|declined|not allowed/i.test(part.text))) return "Request denied. The action was not carried out.";
  if (failed.length) return "Unable to complete the request. The action failed. The details are on screen.";
  return "The work finished without a written reply.";
}
import { lexer, type Token, type Tokens } from "marked";
