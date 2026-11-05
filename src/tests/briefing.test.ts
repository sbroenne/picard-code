import assert from "node:assert/strict";
import test from "node:test";
import { spokenParts } from "../shared/briefing.js";
import { BRIDGE_CREW } from "../shared/crew.js";
import type { ChatMessage } from "../shared/types.js";
import type { CrewID } from "../shared/crew.js";

const message = (id: string, text: string, speaker?: CrewID, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: "assistant", parts: text ? [{ id: `${id}-text`, type: "text", text }] : [], speaker, background: !!speaker, ...extra });

const data = message("data", "The parser rejects empty files. The details are below.", "picard-data");
const worf = message("worf", "No security risk was found.", "picard-worf");
const riker = message("riker", "I recommend fixing the parser first, Captain.\n\nIt is the smaller change and Worf found no risk. Shall I make it so?", "picard-riker");
const close = message("close", "The reports are on screen.");
const denied = message("denied", "I started the investigation.", "picard-data", {
  outcome: "interrupted",
  parts: [
    { id: "partial", type: "text", text: "I started the investigation." },
    { id: "action", type: "tool", text: "shell\nThe user declined this tool call", status: "error" },
  ],
});

test("briefings preserve report order without making Riker the closing speaker", () => {
  const parts = spokenParts(close, close, [riker, data, worf]);
  assert.deepEqual(parts.map((part) => part.speaker), ["picard-riker", "picard-data", "picard-worf"]);
  assert.deepEqual(parts.map((part) => part.message), ["riker", "data", "worf"], "each part names the report it speaks, so it can appear when its voice starts");
  assert.equal(parts[0]!.text, "I recommend fixing the parser first, Captain. It is the smaller change and Worf found no risk. Shall I make it so?");
  assert.ok(!parts.some((part) => part.text.includes("The reports are on screen")));
});

test("successful receipts stay on screen with or without Riker; failures are still heard", () => {
  assert.deepEqual(spokenParts(close, close, [data, worf]).map((part) => part.speaker), ["picard-data", "picard-worf"]);
  assert.equal(spokenParts(close, close, [data, riker], { failed: [denied] }).at(-1)!.speaker, undefined, "an officer failed");
  const acknowledgement = message("riker", "Aye, sir.", "picard-riker");
  assert.equal(spokenParts(close, close, [data, acknowledgement]).at(-1)!.speaker, "picard-data", "an acknowledgement does not require a computer close");
  for (const text of ["Aye, sir.\n\nShall I proceed?", "Understood, Captain.\n\nShall I proceed?"]) {
    assert.equal(spokenParts(close, close, [data, message("riker", text, "picard-riker")]).at(-1)!.text, text.replace("\n\n", " "), "a real question in a later paragraph is spoken once in place");
  }
  const failed = message("close", "", undefined, { error: "The briefing failed." });
  assert.equal(spokenParts(failed, failed, [riker]).at(-1)!.text, "The briefing failed.");
  const missing = message("missing", "Worf did not report. Only Data's findings are available.");
  assert.equal(spokenParts(missing, missing, [data]).at(-1)!.text, "Worf did not report. Only Data's findings are available.", "a missing call is not mistaken for a routine receipt");
});

test("one officer's report spoken as the answer is unchanged", () => {
  assert.deepEqual(spokenParts(close, data, []), [{ text: "The parser rejects empty files. The details are below.", speaker: "picard-data", message: "data" }]);
});

test("each officer's character wording reaches speech in direct replies and briefings", () => {
  for (const officer of BRIDGE_CREW) {
    for (const example of officer.examples) {
      const report = message(officer.id, example.reply, officer.id);
      assert.deepEqual(spokenParts(close, report, []), [{ text: example.reply, speaker: officer.id, message: officer.id }]);
      assert.deepEqual(spokenParts(close, close, [report])[0], { text: example.reply, speaker: officer.id, message: officer.id });
    }
  }
});

test("a copied close does not replace reports or hide a failed action", () => {
  const copied = message("copy", "I recommend fixing the parser first, Captain.");
  assert.deepEqual(spokenParts(copied, copied, [data, riker], { repeated: true }).map((part) => part.speaker), ["picard-data", "picard-riker"]);
  assert.deepEqual(spokenParts(copied, riker, [riker], { failed: [denied], repeated: true }), [
    { text: "I recommend fixing the parser first, Captain. It is the smaller change and Worf found no risk. Shall I make it so?", speaker: "picard-riker", message: "riker" },
    { text: "Data did not finish. Request denied. The action was not carried out." },
  ]);
  assert.deepEqual(spokenParts(denied, denied, [], { failed: [denied] }), [
    { text: "Data did not finish. Request denied. The action was not carried out." },
  ]);
  const interrupted = { ...denied, background: false, speaker: undefined };
  assert.deepEqual(spokenParts(interrupted, interrupted, []), [
    { text: "Request denied. The action was not carried out.", speaker: undefined, message: "denied" },
  ]);
  const worfFailed = message("worf-failed", "", "picard-worf", { error: "The model could not be reached." });
  assert.equal(spokenParts(copied, copied, [riker], { failed: [denied, worfFailed], repeated: true }).at(-1)!.text,
    "Data and Worf did not finish. The details are on screen.");
  assert.deepEqual(spokenParts(copied, copied, [data, worf], { repeated: true }).map((part) => part.speaker), ["picard-data", "picard-worf"]);
});

test("questions in an officer's spoken opening keep filenames, versions and titles intact", () => {
  for (const [question, spoken] of [
    ["Shall I update example.ts?", "Shall I update example dot ts?"],
    ["Shall I update retry_policy.ts?", "Shall I update retry policy dot ts?"],
    ["Shall I update _example.ts_?", "Shall I update example dot ts?"],
    ["Shall I use version 2.1?", "Shall I use version 2.1?"],
    ["Shall I contact Dr. Crusher?", "Shall I contact Dr. Crusher?"],
    ["Dr. Crusher agrees. Shall I update `example.ts`?", "Dr. Crusher agrees. Shall I update example dot ts?"],
  ] as const) {
    for (const officer of ["picard-data", "picard-riker"] as const) {
      const report = message("question", question, officer);
      assert.deepEqual(spokenParts(close, close, [report]), [{ text: spoken, speaker: officer, message: "question" }]);
      assert.deepEqual(spokenParts(close, report, [report], { repeated: true }), [{ text: spoken, speaker: officer, message: "question" }]);
    }
  }
});

test("Riker can give a requested coordination result after the officers he called", () => {
  const coordinated = message("coordinated", "Data found the cause; I recommend the smaller repair, Captain.", "picard-riker", { background: false });
  assert.deepEqual(spokenParts(coordinated, coordinated, [data, worf]).map((part) => part.speaker), ["picard-data", "picard-worf", "picard-riker"]);
  assert.equal(spokenParts(coordinated, coordinated, [data, worf]).at(-1)!.text, "Data found the cause; I recommend the smaller repair, Captain.");
});

test("officers give complete conversational reports but leave technical appendices on screen", () => {
  const report = message("data", "Captain, I found the cause.\n\nThe second finding changes my recommendation.\n\n### On screen\n\nThe exact file references.", "picard-data");
  assert.deepEqual(spokenParts(close, close, [report]), [{
    text: "Captain, I found the cause. The second finding changes my recommendation.", speaker: "picard-data", message: "data",
  }]);
  assert.deepEqual(spokenParts(close, report, [report]), spokenParts(close, close, [report]));
});

test("a long briefing keeps the latest seven reports so the computer's close always fits in eight spoken parts", () => {
  const reports = Array.from({ length: 9 }, (_, index) => message(`report-${index}`, `Finding number ${index + 1}.`, "picard-data"));
  const failed = message("close", "", undefined, { error: "The briefing failed." });
  const parts = spokenParts(failed, failed, reports);
  assert.equal(parts.length, 8);
  assert.deepEqual(parts.slice(0, 7).map((part) => part.text), Array.from({ length: 7 }, (_, index) => `Finding number ${index + 3}.`));
  assert.equal(parts.at(-1)!.text, "The briefing failed.");
});
