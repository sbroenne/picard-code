import type { FormField, FormRequest } from "./types.js";
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

type TextField = Extract<FormField, { type: "string" }>;

/** The next unanswered text question, with or without offered choices. */
export function spokenField(form: FormRequest, answers: Record<string, string> = {}): TextField | undefined {
  const visible = form.fields.filter((field) => !field.hidden);
  if (visible.some((field) => field.type !== "string" || field.when?.length)) return undefined;
  const field = visible.find((item) => !Object.hasOwn(answers, item.key) || !answers[item.key]!.trim());
  return field?.type === "string" ? field : undefined;
}

/** Text questions are asked one at a time; other forms stay on screen. */
export function canAskAloud(form: FormRequest) {
  return !!spokenField(form);
}

const custom = (field: TextField) => !field.options?.length || field.custom === true;

export function spokenQuestion(form: FormRequest, answers: Record<string, string> = {}) {
  const field = spokenField(form, answers);
  if (!field) return "Additional information is required. Please answer the questions on screen.";
  const question = field.description?.trim() || field.title?.trim() || form.title.trim();
  const labels = (field.options ?? []).map((option) => option.label);
  const choices = labels.length ? ` The options are ${either(labels)}.` : "";
  const other = labels.length && custom(field) ? " You may also give a different answer." : "";
  return speakable(`${question}${choices}${other}`);
}

/**
 * Turns a spoken reply into an answer OpenCode already allows. Offered choices
 * are matched conservatively; a negated or unclear reply is never turned into a
 * choice. Free wording is passed on unchanged only when the question allows it.
 */
export function matchSpokenAnswer(field: TextField, transcript: string): SpokenAnswer {
  const options = field.options ?? [];
  const labels = options.map((option) => option.label);
  const valueOf = (label: string) => options.find((option) => option.label === label)!.value;
  const said = normalize(transcript);
  const retry = labels.length ? `Please choose ${either(labels)}.` : "Please give your answer.";
  if (!said) return { retry };
  if (/^(skip|skip (the|this) question|cancel|never ?mind|stop)$/.test(said)) {
    return { retry: `The question is still open. To skip it, choose Skip question on screen. Otherwise, ${labels.length ? `say ${either(labels)}` : "give your answer"}.` };
  }
  const exact = labels.find((label) => normalize(label) === said);
  if (exact) return { answer: valueOf(exact) };
  // The Captain's order to proceed chooses the one offered answer that plainly says yes.
  if (/^(?:make it so|engage)(?: (?:number one|mr(?: \w+){1,2}|counsell?or|doctor|computer))?$/.test(said)) {
    const yes = labels.filter((label) => /^(?:yes|proceed|go ahead|continue)\b/.test(normalize(label)));
    if (yes.length === 1) return { answer: valueOf(yes[0]!) };
  }
  const ordinal = /^(?:the )?(?:option |number |choice )?(\w+)(?: one| option)?(?: please)?$/.exec(said)?.[1];
  const position = ordinal ? ORDINALS.findIndex((pattern) => pattern.test(ordinal)) : -1;
  if (position >= 0 && position < labels.length) return { answer: valueOf(labels[position]!) };
  if (!NEGATION.test(said)) {
    const mentioned = labels.filter((label) => normalize(label) && ` ${said} `.includes(` ${normalize(label)} `));
    if (mentioned.length === 1) return { answer: valueOf(mentioned[0]!) };
  }
  if (custom(field)) return { answer: transcript.trim() };
  return { retry };
}
