import { TRIBUTE_ENTRIES, type TributeEntry } from "./tribute-data.js";
import type { ChatMessage } from "./types.js";
import { replyFailed } from "./speech.js";

export type TributeMode = "off" | "screen" | "spoken";
export interface TributeRequest { mode: TributeMode; storyID?: string }
export type ExecutionOutcome = "succeeded" | "failed" | "interrupted";
export function storyInvitation(subject: TributeEntry["subject"]) {
  return `I can tell you a short story about ${subject === "Picard" ? "Captain Jean-Luc Picard" : "Sir Patrick Stewart"}.`;
}

export function tributeMode(enabled: boolean, spoken: boolean): TributeMode {
  return !enabled ? "off" : spoken ? "spoken" : "screen";
}

function words(text: string) {
  return text.toLowerCase().trim().replace(/^computer[\s,:.!]+/, "").replace(/[.!?,]+$/g, "").replace(/[,;:]/g, " ").replace(/\s+/g, " ");
}

function projectReference(text: string) {
  return /\b(files?|folders?|projects?|repos?|repositor(?:y|ies)|code|settings|accounts?|requests?|tests?|passwords?|keys?|git|github|branches|branch|commits?|dependencies|readme|package\.json)\b/.test(words(text));
}

export function picardSelfQuestion(text: string) {
  const request = words(text).replace(/^please /, "");
  if (projectReference(text)) return false;
  return /^(?:(?:tell|remind) me about (?:myself|my (?:life|history|interests|reputation))|(?:who|what) am i(?: known for)?|what (?:are my interests|do you know about me)|describe me|what is my (?:history|reputation|background)|how old am i|where (?:was i born|am i from))(?:\b|$)/.test(request);
}

export function gentleWitAllowed(text: string) {
  return picardSelfQuestion(text) && storyOfferAllowed(text);
}

export function storyOfferAllowed(text: string) {
  return !!tributeSubject(text) && !/\b(serious|strictly|factual|facts only|(?:no|without) (?:jokes?|humou?r|teasing|stories|offers)|(?:don't|do not) (?:joke|tease|offer)|death|loss|trauma|borg|assimilat\w*|torture|health|illness|family)\b/i.test(text.replace(/\u2019/g, "'"));
}

export function storyAcceptance(text: string) {
  return /^(?:yes(?: please)?|please do|go ahead|tell me|tell (?:me )?(?:a |the )?(?:short )?story|tell me more|i'd like that|i would like that)$/.test(words(text));
}

export function explicitStorySubject(text: string): TributeEntry["subject"] | undefined {
  const request = words(text);
  const match = /^(?:please )?(?:tell|give|read)(?: me)? (?:(?:a |another |the |a short |a little )?(?:story|anecdote) (?:about|of) ((?:sir )?patrick stewart|(?:captain )?(?:jean[- ]luc )?picard|myself)|(?:a |another |the |a short )?((?:sir )?patrick stewart|(?:captain )?(?:jean[- ]luc )?picard) (?:story|anecdote))$/.exec(request);
  const subject = match?.[1] ?? match?.[2];
  return subject ? subject.includes("patrick stewart") ? "Patrick Stewart" : "Picard" : undefined;
}

export function explicitStoryRequest(text: string) {
  return explicitStorySubject(text) !== undefined;
}

export function tributeQuestion(text: string) {
  return picardSelfQuestion(text) || explicitStoryRequest(text)
    || /^(?:please )?(?:tell|give|explain|describe|what|who|how|why)\b.*\b(?:picard|patrick stewart)\b/.test(words(text))
      && !projectReference(text) && !/\b(rename|edit|implement)\b/.test(words(text));
}

export function tributeSubject(text: string): TributeEntry["subject"] | undefined {
  if (picardSelfQuestion(text)) return "Picard";
  const story = explicitStorySubject(text);
  if (story) return story;
  if (!tributeQuestion(text)) return undefined;
  return /\bpatrick stewart\b/i.test(text) ? "Patrick Stewart" : /\bpicard\b/i.test(text) ? "Picard" : undefined;
}

export function declinedReply(reply: ChatMessage) {
  const text = reply.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
  return /^(?:(?:i|we) (?:cannot|can't|will not|won't)|(?:i am|i'm) (?:sorry|unable)|request (?:denied|refused)|(?:that|this) (?:action|request) (?:is|was) (?:not allowed|denied|refused))/i.test(text);
}

export function checkTributeRequest(value: unknown): TributeRequest {
  if (value === undefined) return { mode: "off" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide valid tribute options.");
  const data = value as Record<string, unknown>;
  if (data.mode !== "off" && data.mode !== "screen" && data.mode !== "spoken") throw new Error("Choose valid tribute options.");
  if (Object.keys(data).some((key) => key !== "mode" && key !== "storyID")) throw new Error("Provide only the supported tribute options.");
  if (data.storyID !== undefined && (typeof data.storyID !== "string" || !TRIBUTE_ENTRIES.some((entry) => entry.id === data.storyID && entry.story))) {
    throw new Error("That tribute story is not available.");
  }
  return { mode: data.mode, ...(typeof data.storyID === "string" ? { storyID: data.storyID } : {}) };
}

export function checkedEntries(entries: readonly TributeEntry[]) {
  const ids = new Set<string>();
  for (const entry of entries) {
    const url = new URL(entry.source.url);
    if (!entry.id || ids.has(entry.id) || !entry.text.trim() || !entry.source.title.trim()
      || url.protocol !== "https:" || url.username || url.password || !/^\d{4}-\d{2}-\d{2}$/.test(entry.verified)
      || !["Picard", "Patrick Stewart"].includes(entry.subject) || !["screen", "career", "production"].includes(entry.provenance)
      || entry.story !== undefined && (!entry.story.trim() || entry.subject === "Picard" && entry.provenance !== "screen"
        || entry.subject === "Patrick Stewart" && entry.provenance !== "career")) {
      throw new Error("A tribute fact has missing or invalid source details.");
    }
    ids.add(entry.id);
  }
  return entries;
}

export function randomIndex(length: number, random: () => number) {
  const value = random();
  if (!Number.isInteger(length) || length < 1 || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("A tribute fact could not be selected.");
  }
  return Math.floor(value * length);
}

export class TributeCycle {
  private remaining = 0;
  private counted = new Set<string>();
  private seen: Set<string>;
  private enabled = false;
  constructor(private entries = TRIBUTE_ENTRIES, seen: string[] = [], private random = Math.random) {
    checkedEntries(entries);
    this.seen = new Set(seen.filter((id) => entries.some((entry) => entry.id === id)));
  }
  get seenIDs() { return [...this.seen]; }
  setEnabled(enabled: boolean) {
    if (enabled !== this.enabled) this.remaining = enabled ? 2 + randomIndex(4, this.random) : 0;
    this.enabled = enabled;
  }
  completed(turn: { id: string; outcome: ExecutionOutcome; reply: ChatMessage; blocked: boolean; explicit: boolean }) {
    if (this.counted.has(turn.id)) return undefined;
    this.counted.add(turn.id);
    if (!this.enabled || turn.outcome !== "succeeded" || turn.blocked || turn.explicit || replyFailed(turn.reply) || declinedReply(turn.reply)
      || !turn.reply.parts.some((part) => part.type === "text" && part.text.trim())) return undefined;
    if (--this.remaining > 0) return undefined;
    this.remaining = 2 + randomIndex(4, this.random);
    return this.select();
  }
  private select() {
    if (!this.entries.length) throw new Error("No reviewed tribute facts are available.");
    let available = this.entries.filter((entry) => !this.seen.has(entry.id));
    if (!available.length) { this.seen.clear(); available = [...this.entries]; }
    const entry = available[randomIndex(available.length, this.random)]!;
    this.seen.add(entry.id);
    return entry;
  }
}
