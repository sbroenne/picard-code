export type VoicePhase = "off" | "listening" | "thinking" | "speaking";

export type SpeechEvent =
  | { type: "state"; phase: VoicePhase }
  | { type: "partial"; text: string }
  | { type: "transcript"; text: string }
  | { type: "audio-start"; rate: number; id: number }
  | { type: "audio-end"; id: number }
  | { type: "error"; message: string };

export class EndOfSpeech {
  private voiced = 0;
  private silence = 0;
  reset() { this.voiced = 0; this.silence = 0; }
  update(level: number, milliseconds: number) {
    if (level >= 0.012) { this.voiced += milliseconds; this.silence = 0; }
    else if (this.voiced) this.silence += milliseconds;
    if (this.voiced >= 120 && this.silence >= 900) {
      this.reset();
      return true;
    }
    return false;
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FILE_TYPES = "ts|tsx|js|jsx|mjs|cjs|json|md|py|toml|ya?ml|txt|html|css|lock|sh|ps1|cs|go|rs|java|wav|env";
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
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

function itemLabel(line: string) {
  const item = line.replace(LIST_ITEM, "").trim();
  const head = item.split(/:\s|\s[—–-]\s/)[0]!.trim();
  return (head || item).replace(/[.;,]+$/, "");
}

function joinList(items: string[]) {
  const shown = items.slice(0, 5).map(itemLabel);
  const extra = items.length - shown.length;
  if (extra > 0) shown.push(`${extra} more on screen`);
  return shown.length < 3 ? shown.join(" and ") : `${shown.slice(0, -1).join(", ")}, and ${shown.at(-1)}`;
}

/** Builds a complete short spoken answer from a written reply; detail stays on screen. */
export function spokenSummary(text: string) {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`\n]+)`/g, (_whole, code: string) => speakableCode(code))
    .replace(/`/g, "")
    .replace(/\*+/g, "")
    .replace(/(^|[^\w])__?([^_\n]+?)__?(?=[^\w]|$)/g, "$1$2")
    .replace(/^\s{0,3}(?:#{1,6}|>)\s*/gm, "")
    .trim();
  if (!prose) return "The result is on screen.";
  const blocks = prose.split(/\n\s*\n/);
  const lines = blocks[0]!.split("\n").map((line) => line.trim()).filter(Boolean);
  let items = lines.filter((line) => LIST_ITEM.test(line));
  const lead = lines.filter((line) => !LIST_ITEM.test(line)).join(" ").replace(/\s+/g, " ").trim();
  if (!items.length && lead.endsWith(":") && blocks[1]) {
    const next = blocks[1].split("\n").map((line) => line.trim()).filter(Boolean);
    if (next.length && next.every((line) => LIST_ITEM.test(line))) items = next;
  }
  let paragraph = items.length ? `${lead ? `${lead} ` : ""}${joinList(items)}.`
    : lead.endsWith(":") ? `${lead.replace(/:$/, ".")} The details are on screen.`
    : lead;
  paragraph = speakable(paragraph).replace(/\s+/g, " ").trim();
  if (paragraph.length <= 420) return paragraph;
  const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  let result = "";
  for (const sentence of sentences) {
    if ((result + sentence).length > 360) break;
    result += sentence;
  }
  return result.trim()
    ? `${result.trim()} The full result is on screen.`
    : "The reply needs a detailed explanation. Please read the result on screen.";
}

/** Chooses what to say about a finished reply, including replies that end with a refused or failed action. */
type ReplyMessage = { error?: string; parts: { type: string; text: string; status?: string }[] };
const replyText = (message: ReplyMessage) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
const failedTools = (message: ReplyMessage) => message.parts.filter((part) => part.type === "tool" && part.status === "error");

/** True when the finished reply is a final error or a refusal with no written answer; earlier failed attempts that the reply explains do not count. */
export function replyFailed(message: ReplyMessage) {
  return !!message.error || (!replyText(message).trim() && failedTools(message).length > 0);
}

export function spokenReply(message: ReplyMessage) {
  if (message.error) return spokenSummary(message.error);
  const text = replyText(message);
  if (text.trim()) return spokenSummary(text);
  const failed = failedTools(message);
  if (failed.some((part) => /reject|denied|declined|not allowed/i.test(part.text))) return "Request denied. The action was not carried out.";
  if (failed.length) return "Unable to complete the request. The action failed. The details are on screen.";
  return "The work finished without a written reply.";
}