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
const denied = message("denied", "I started the investigation.", "picard-data", {
  outcome: "interrupted",
  parts: [
    { id: "partial", type: "text", text: "I started the investigation." },
    { id: "action", type: "tool", text: "shell\nThe user declined this tool call", status: "error" },
  ],
});

test("Riker has the last word in a briefing and the computer's close stays on screen", () => {
  const parts = spokenParts(close, close, [riker, data, worf]);
  assert.deepEqual(parts.map((part) => part.speaker), ["picard-data", "picard-worf", "picard-riker"]);
  assert.equal(parts.at(-1)!.text, "I recommend fixing the parser first, Captain. Shall I make it so?");
  assert.ok(!parts.some((part) => part.text.includes("Both reports are in")));
});

test("the computer's close is heard when it has something new", () => {
  assert.equal(spokenParts(close, close, [data, worf]).at(-1)!.text, "Both reports are in. A fix for empty files is waiting for your decision.", "no Riker recommended a course");
  assert.equal(spokenParts(close, close, [data, riker], { failed: [denied] }).at(-1)!.speaker, undefined, "an officer failed");
  const acknowledgement = message("riker", "Aye, sir.", "picard-riker");
  assert.equal(spokenParts(close, close, [data, acknowledgement]).at(-1)!.speaker, undefined, "Riker did not give a recommendation");
  for (const text of ["Aye, sir.\n\nShall I proceed?", "Understood, Captain.\n\nShall I proceed?"]) {
    assert.equal(spokenParts(close, close, [data, message("riker", text, "picard-riker")]).at(-1)!.speaker, undefined, "a question is not a recommendation");
  }
  const failed = message("close", "", undefined, { error: "The briefing failed." });
  assert.equal(spokenParts(failed, failed, [riker]).at(-1)!.text, "The briefing failed.");
});

test("one officer's report spoken as the answer is unchanged", () => {
  assert.deepEqual(spokenParts(close, data, []), [{ text: "The parser rejects empty files. The details are below.", speaker: "picard-data" }]);
});

test("a copied close does not replace reports or hide a failed action", () => {
  const copied = message("copy", "I recommend fixing the parser first, Captain.");
  assert.deepEqual(spokenParts(copied, copied, [data, riker], { repeated: true }).map((part) => part.speaker), ["picard-data", "picard-riker"]);
  assert.deepEqual(spokenParts(copied, riker, [riker], { failed: [denied], repeated: true }), [
    { text: "I recommend fixing the parser first, Captain. Shall I make it so?", speaker: "picard-riker" },
    { text: "Data did not finish. Request denied. The action was not carried out." },
  ]);
  assert.deepEqual(spokenParts(denied, denied, [], { failed: [denied] }), [
    { text: "Data did not finish. Request denied. The action was not carried out." },
  ]);
  const interrupted = { ...denied, background: false, speaker: undefined };
  assert.deepEqual(spokenParts(interrupted, interrupted, []), [
    { text: "Request denied. The action was not carried out.", speaker: undefined },
  ]);
  const worfFailed = message("worf-failed", "", "picard-worf", { error: "The model could not be reached." });
  assert.equal(spokenParts(copied, copied, [riker], { failed: [denied, worfFailed], repeated: true }).at(-1)!.text,
    "Data and Worf did not finish. The details are on screen.");
  assert.deepEqual(spokenParts(copied, copied, [data, worf], { repeated: true }).map((part) => part.speaker), ["picard-data", "picard-worf"]);
});

test("a closing question is found only at the end of a report", () => {
  assert.equal(closingQuestion("I recommend the smaller change. Shall I make it so?"), "Shall I make it so?");
  assert.equal(closingQuestion("Shall we? I recommend the smaller change."), "");
  assert.equal(closingQuestion("**Recommendation:** patch it.\n\nShall I proceed?"), "Shall I proceed?");
  assert.equal(closingQuestion(""), "");
  const repeated = message("riker", "Shall I make it so?", "picard-riker");
  assert.equal(spokenParts(close, close, [repeated]).at(-1)!.text, "Shall I make it so?", "the question is not said twice");
});
