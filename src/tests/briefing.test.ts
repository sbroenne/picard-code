import assert from "node:assert/strict";
import test from "node:test";
import { closingQuestion, spokenParts } from "../shared/briefing.js";
import type { ChatMessage } from "../shared/types.js";
import type { CrewID } from "../shared/crew.js";

const message = (id: string, text: string, speaker?: CrewID, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: "assistant", parts: text ? [{ id: `${id}-text`, type: "text", text }] : [], speaker, background: !!speaker, ...extra });

const data = message("data", "The parser rejects empty files. The details are below.", "picard-data");
const worf = message("worf", "No security risk was found.", "picard-worf");
const riker = message("riker", "I recommend fixing the parser first, Captain.\n\nIt is the smaller change and Worf found no risk. Shall I make it so?", "picard-riker");
const close = message("close", "Both reports are in. A fix for empty files is waiting for your decision.");

test("Riker has the last word in a briefing and the computer's close stays on screen", () => {
  const parts = spokenParts(close, close, [riker, data, worf]);
  assert.deepEqual(parts.map((part) => part.speaker), ["picard-data", "picard-worf", "picard-riker"]);
  assert.equal(parts.at(-1)!.text, "I recommend fixing the parser first, Captain. Shall I make it so?");
  assert.ok(!parts.some((part) => part.text.includes("Both reports are in")));
});

test("the computer's close is heard when it has something new", () => {
  assert.equal(spokenParts(close, close, [data, worf]).at(-1)!.text, "Both reports are in. A fix for empty files is waiting for your decision.", "no Riker recommended a course");
  assert.equal(spokenParts(close, close, [data, riker], true).at(-1)!.speaker, undefined, "an officer failed");
  const failed = message("close", "", undefined, { error: "The briefing failed." });
  assert.equal(spokenParts(failed, failed, [riker]).at(-1)!.text, "The briefing failed.");
});

test("one officer's report spoken as the answer is unchanged", () => {
  assert.deepEqual(spokenParts(close, data, []), [{ text: "The parser rejects empty files. The details are below.", speaker: "picard-data" }]);
});

test("a closing question is found only at the end of a report", () => {
  assert.equal(closingQuestion("I recommend the smaller change. Shall I make it so?"), "Shall I make it so?");
  assert.equal(closingQuestion("Shall we? I recommend the smaller change."), "");
  assert.equal(closingQuestion("**Recommendation:** patch it.\n\nShall I proceed?"), "Shall I proceed?");
  assert.equal(closingQuestion(""), "");
  const repeated = message("riker", "Shall I make it so?", "picard-riker");
  assert.equal(spokenParts(close, close, [repeated]).at(-1)!.text, "Shall I make it so?", "the question is not said twice");
});
