import type { ChatMessage } from "./types.js";
import { crewMember, type CrewID } from "./crew.js";
import { firstSentence, replyFailed, speakable, spokenReply, stripUnderscoreEmphasis } from "./speech.js";

export interface SpokenPart { text: string; speaker?: CrewID }

const written = (message: ChatMessage) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");

/** The short question that ends a report, such as "Shall I make it so?", when there is one. */
export function closingQuestion(text: string) {
  const plain = stripUnderscoreEmphasis(text.replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*>#]/g, "")).trim();
  const last = plain.split(/\n\s*\n/).at(-1)?.replace(/\s+/g, " ").trim() ?? "";
  let remaining = last;
  let question = "";
  while (remaining) {
    question = firstSentence(remaining);
    remaining = remaining.slice(question.length).trimStart();
  }
  return question.endsWith("?") && question.length <= 160 ? speakable(question) : "";
}

function failureReason(message: ChatMessage) {
  const parts = message.parts.filter((part) => part.type === "tool" && part.status === "error");
  if (message.error || parts.length) return spokenReply({ error: message.error, parts });
  return "The details are on screen.";
}

function failureNotice(reports: ChatMessage[]) {
  const names = [...new Set(reports.map((report) => crewMember(report.speaker)?.name ?? "An officer"))];
  const subject = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
  return `${subject} did not finish. ${reports.length === 1 ? failureReason(reports[0]!) : "The details are on screen."}`;
}

/**
 * What is said aloud for a finished reply. When one officer's report is the answer, it is spoken in that
 * officer's voice instead of silence or the computer's word-for-word copy. After a successful briefing, each
 * officer gives the first sentence of their own report in their own voice, Riker last with his closing
 * question. The computer's close is spoken only when it has something new: no Riker recommended a course,
 * or an officer failed.
 */
export function spokenParts(reply: ChatMessage, answer: ChatMessage, reports: ChatMessage[], options: { failed?: ChatMessage[]; repeated?: boolean } = {}): SpokenPart[] {
  const failed = options.failed ?? [];
  if (answer !== reply) {
    const text = spokenReply(answer);
    const question = answer.speaker === "picard-riker" && reports.length ? closingQuestion(written(answer)) : "";
    const part = { text: question && !text.endsWith(question) ? `${text} ${question}` : text, speaker: answer.speaker };
    return failed.length ? [part, { text: failureNotice(failed) }] : [part];
  }
  const riker = reports.filter((report) => report.speaker === "picard-riker");
  const ordered = [...reports.filter((report) => report.speaker !== "picard-riker"), ...riker];
  const findings = ordered
    .map((report) => {
      const lead = firstSentence(spokenReply(report));
      if (/^(?:aye|understood)(?:,?\s+(?:sir|captain))?[.!]?$/i.test(lead)) return undefined;
      const question = report.speaker === "picard-riker" ? closingQuestion(written(report)) : "";
      return { text: question && !lead.endsWith(question) ? `${lead} ${question}` : lead, speaker: report.speaker };
    })
    .filter((part) => part !== undefined)
    // The speech service takes at most eight parts; the computer's close is always the last.
    .slice(-7);
  const close = failed.length && (options.repeated || reply.background)
    ? { text: failureNotice(failed) }
    : { text: reply.outcome && reply.outcome !== "succeeded" && !replyFailed(reply) ? failureReason(reply) : spokenReply(reply), speaker: reply.speaker };
  if (findings.length && (options.repeated || findings.some((part) => part.speaker === "picard-riker")) && !failed.length && !replyFailed(reply)) return findings;
  return [...findings, close];
}
