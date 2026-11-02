import type { ChatMessage } from "./types.js";
import type { CrewID } from "./crew.js";
import { firstSentence, replyFailed, speakable, spokenReply } from "./speech.js";

export interface SpokenPart { text: string; speaker?: CrewID }

const written = (message: ChatMessage) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");

/** The short question that ends a report, such as "Shall I make it so?", when there is one. */
export function closingQuestion(text: string) {
  const plain = text.replace(/```[\s\S]*?(?:```|$)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*_>#]/g, "").trim();
  const last = plain.split(/\n\s*\n/).at(-1)?.replace(/\s+/g, " ").trim() ?? "";
  const question = last.match(/(?:^|[.!?]\s+)([^.!?]+\?)$/)?.[1]?.trim();
  return question && question.length <= 160 ? speakable(question) : "";
}

/**
 * What is said aloud for a finished reply. When one officer's report is the answer, it is spoken in that
 * officer's voice instead of silence or the computer's word-for-word copy. After a successful briefing, each
 * officer gives the first sentence of their own report in their own voice, Riker last with his closing
 * question. The computer's close is spoken only when it has something new: no Riker recommended a course,
 * or an officer failed.
 */
export function spokenParts(reply: ChatMessage, answer: ChatMessage, reports: ChatMessage[], officerFailed = false): SpokenPart[] {
  if (answer !== reply) return [{ text: spokenReply(answer), speaker: answer.speaker }];
  const riker = reports.filter((report) => report.speaker === "picard-riker");
  const ordered = [...reports.filter((report) => report.speaker !== "picard-riker"), ...riker];
  const findings = ordered
    .map((report) => {
      const lead = firstSentence(spokenReply(report));
      const question = report.speaker === "picard-riker" ? closingQuestion(written(report)) : "";
      return { text: question && !lead.endsWith(question) ? `${lead} ${question}` : lead, speaker: report.speaker };
    })
    .filter((part) => !/^aye,? sir[.!]?$/i.test(part.text))
    // The speech service takes at most eight parts; the computer's close is always the last.
    .slice(-7);
  const close = { text: spokenReply(reply), speaker: reply.speaker };
  if (riker.length && findings.length && !officerFailed && !replyFailed(reply)) return findings;
  return [...findings, close];
}
