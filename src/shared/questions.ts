import type { QuestionInfo } from "@opencode-ai/sdk/v2";
import { speakable } from "./speech.js";

export type SpokenAnswer = { answer: string } | { retry: string };

const NEGATION = /\b(no|not|don't|dont|do not|never|neither|nor|without|except|instead|rather than|avoid)\b/;
const ORDINALS = [/^(first|one|1)$/, /^(second|two|2)$/, /^(third|three|3)$/, /^(fourth|four|4)$/, /^(fifth|five|5)$/];

function normalize(text: string) {
  return text.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
}

function either(words: string[]) {
  return words.length < 3 ? words.join(" or ") : `${words.slice(0, -1).join(", ")}, or ${words.at(-1)}`;
}

/** Only single-answer questions are asked aloud; anything else stays on screen. */
export function canAskAloud(questions: QuestionInfo[]) {
  return questions.length === 1 && !questions[0]!.multiple && (questions[0]!.options.length > 0 || questions[0]!.custom !== false);
}

export function spokenQuestion(question: QuestionInfo) {
  const labels = question.options.map((option) => option.label);
  const choices = labels.length ? ` The options are ${either(labels)}.` : "";
  const other = labels.length && question.custom !== false ? " You may also give a different answer." : "";
  return speakable(`${question.question.trim()}${choices}${other}`);
}

/**
 * Turns a spoken reply into an answer OpenCode already allows. Offered choices
 * are matched conservatively; a negated or unclear reply is never turned into a
 * choice. Free wording is passed on unchanged only when the question allows it.
 */
export function matchSpokenAnswer(question: QuestionInfo, transcript: string): SpokenAnswer {
  const labels = question.options.map((option) => option.label);
  const custom = question.custom !== false;
  const said = normalize(transcript);
  const retry = labels.length ? `Please choose ${either(labels)}.` : "Please give your answer.";
  if (!said) return { retry };
  if (/^(skip|skip (the|this) question|cancel|never ?mind|stop)$/.test(said)) {
    return { retry: `The question is still open. To skip it, choose Skip question on screen. Otherwise, ${labels.length ? `say ${either(labels)}` : "give your answer"}.` };
  }
  const exact = labels.find((label) => normalize(label) === said);
  if (exact) return { answer: exact };
  const ordinal = /^(?:the )?(?:option |number |choice )?(\w+)(?: one| option)?(?: please)?$/.exec(said)?.[1];
  const position = ordinal ? ORDINALS.findIndex((pattern) => pattern.test(ordinal)) : -1;
  if (position >= 0 && position < labels.length) return { answer: labels[position]! };
  if (!NEGATION.test(said)) {
    const mentioned = labels.filter((label) => normalize(label) && ` ${said} `.includes(` ${normalize(label)} `));
    if (mentioned.length === 1) return { answer: mentioned[0]! };
  }
  if (custom) return { answer: transcript.trim() };
  return { retry };
}
