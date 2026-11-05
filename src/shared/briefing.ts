import type { ChatMessage } from "./types.js";
import { crewMember, type CrewID } from "./crew.js";
import { replyFailed, spokenReply } from "./speech.js";

/** `message` is the ID of the reply this part speaks, so it can appear on screen when its voice starts. */
export interface SpokenPart { text: string; speaker?: CrewID; message?: string }

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
 * officer gives their conversational answer in report order, without a fixed closing speaker.
 * A routine computer receipt stays on screen; new information and real failures are still spoken.
 */
export function spokenParts(reply: ChatMessage, answer: ChatMessage, reports: ChatMessage[], options: { failed?: ChatMessage[]; repeated?: boolean } = {}): SpokenPart[] {
  const failed = options.failed ?? [];
  if (answer !== reply) {
    const part = { text: spokenReply(answer), speaker: answer.speaker, message: answer.id };
    return failed.length ? [part, { text: failureNotice(failed) }] : [part];
  }
  const findings = reports
    .map((report) => {
      const lead = spokenReply(report);
      if (/^(?:aye|understood)(?:,?\s+(?:sir|captain))?[.!]?$/i.test(lead)) return undefined;
      return { text: lead, speaker: report.speaker, message: report.id };
    })
    .filter((part) => part !== undefined)
    // The speech service takes at most eight parts; the computer's close is always the last.
    .slice(-7);
  const close = failed.length && (options.repeated || reply.background)
    ? { text: failureNotice(failed) }
    : { text: reply.outcome && reply.outcome !== "succeeded" && !replyFailed(reply) ? failureReason(reply) : spokenReply(reply), speaker: reply.speaker, message: reply.id };
  const receipt = spokenReply(reply) === "The reports are on screen.";
  if (findings.length && !reply.speaker && (options.repeated || receipt) && !failed.length && !replyFailed(reply) && (!reply.outcome || reply.outcome === "succeeded")) return findings;
  return [...findings, close];
}
