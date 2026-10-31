import assert from "node:assert/strict";
import test from "node:test";
import { TRIBUTE_ENTRIES } from "../shared/tribute-data.js";
import { TributeCycle, checkedEntries, checkTributeRequest, declinedReply, explicitStoryRequest, explicitStorySubject, gentleWitAllowed, picardSelfQuestion, randomIndex, storyAcceptance, storyInvitation, storyOfferAllowed, tributeMode, tributeQuestion, tributeSubject } from "../shared/tribute.js";
import { computerManner } from "../server/instructions.js";
import type { ChatMessage } from "../shared/types.js";

const reply: ChatMessage = { id: "reply", role: "assistant", parts: [{ id: "text", type: "text", text: "The result is ready." }] };
const completed = (id: string) => ({ id, reply, outcome: "succeeded" as const, blocked: false, explicit: false });

test("the reviewed collection has unique sourced facts and original short stories for both subjects", () => {
  assert.equal(checkedEntries(TRIBUTE_ENTRIES), TRIBUTE_ENTRIES);
  assert.ok(TRIBUTE_ENTRIES.length >= 10);
  for (const subject of ["Picard", "Patrick Stewart"]) assert.ok(TRIBUTE_ENTRIES.filter((entry) => entry.story && entry.subject === subject).length >= 3);
  for (const entry of TRIBUTE_ENTRIES) {
    assert.ok(entry.text.length <= 240);
    if (entry.story) assert.ok(entry.story.split(/\s+/).length <= 100);
  }
  const first = TRIBUTE_ENTRIES[0]!;
  for (const entry of [
    { ...first, source: { title: "", url: first.source.url } },
    { ...first, source: { title: "Source", url: "http://example.com" } },
    { ...first, source: { title: "Source", url: "https://user:password@example.com" } },
    { ...first, text: "" }, { ...first, verified: "" }, { ...first, story: "A production account is not a fictional adventure.", provenance: "production" as const },
  ]) assert.throws(() => checkedEntries([entry]));
  assert.throws(() => checkedEntries([first, first]));
});

test("varied gaps cover two through five and allow several facts in one log", () => {
  for (const random of [0, 0.25, 0.5, 0.999]) {
    const cycle = new TributeCycle(TRIBUTE_ENTRIES, [], () => random);
    cycle.setEnabled(true);
    const gap = 2 + Math.floor(random * 4);
    const positions: number[] = [];
    for (let index = 1; index <= gap * 3; index++) {
      if (cycle.completed(completed(`one-log:${index}`))) positions.push(index);
    }
    assert.deepEqual(positions, [gap, gap * 2, gap * 3]);
  }
  assert.throws(() => randomIndex(4, () => 1));
  assert.throws(() => randomIndex(0, () => 0));
  const values = [0, 0.999, 0, 0.25, 0, 0, 0];
  const varied = new TributeCycle(TRIBUTE_ENTRIES, [], () => values.shift() ?? 0);
  varied.setEnabled(true);
  const positions: number[] = [];
  for (let index = 1; index <= 10; index++) if (varied.completed(completed(`varied:${index}`))) positions.push(index);
  assert.deepEqual(positions, [2, 7, 10]);
});

test("ineligible outcomes, duplicates and explicit tribute exchanges never advance the countdown", () => {
  const cycle = new TributeCycle(TRIBUTE_ENTRIES, [], () => 0);
  cycle.setEnabled(true);
  assert.equal(cycle.completed(completed("first")), undefined);
  for (const turn of [
    completed("first"),
    { ...completed("failed"), outcome: "failed" as const },
    { ...completed("stopped"), outcome: "interrupted" as const },
    { ...completed("pending"), blocked: true },
    { ...completed("story"), explicit: true },
    { ...completed("error"), reply: { ...reply, error: "A real error." } },
    { ...completed("empty"), reply: { ...reply, parts: [] } },
    { ...completed("refusal"), reply: { ...reply, parts: [{ id: "text", type: "text" as const, text: "I cannot carry out that request." }] } },
  ]) assert.equal(cycle.completed(turn), undefined);
  assert.ok(cycle.completed(completed("second")));
  assert.equal(cycle.completed(completed("second")), undefined);
  const recovered = { ...reply, parts: [...reply.parts, { id: "tool", type: "tool" as const, status: "error", text: "First attempt failed." }] };
  assert.equal(cycle.completed({ ...completed("third"), reply: recovered }), undefined);
  assert.ok(cycle.completed(completed("fourth")), "a recovered tool failure does not hide real success");
  assert.ok(declinedReply({ ...reply, parts: [{ id: "text", type: "text", text: "Request denied." }] }));
});

test("facts do not repeat until exhaustion; stale IDs are discarded; switching on resets the gap", () => {
  const entries = TRIBUTE_ENTRIES.slice(0, 3);
  const cycle = new TributeCycle(entries, ["retired"], () => 0);
  assert.deepEqual(cycle.seenIDs, []);
  cycle.setEnabled(true);
  const ids: string[] = [];
  for (let index = 1; index <= 8; index++) {
    const fact = cycle.completed(completed(String(index)));
    if (fact) ids.push(fact.id);
  }
  assert.deepEqual(ids, [entries[0]!.id, entries[1]!.id, entries[2]!.id, entries[0]!.id]);
  cycle.completed(completed("before-off"));
  cycle.setEnabled(false);
  assert.equal(cycle.completed(completed("off")), undefined);
  cycle.setEnabled(true);
  assert.equal(cycle.completed(completed("reenabled-first")), undefined);
  assert.ok(cycle.completed(completed("reenabled-second")));
  const empty = new TributeCycle([], [], () => 0);
  empty.setEnabled(true);
  empty.completed(completed("a"));
  assert.throws(() => empty.completed(completed("b")), /No reviewed/);
});

test("self-questions mean Picard, not first-person project questions; humour stays bounded", () => {
  for (const text of ["Computer, tell me about myself.", "Who am I?", "Describe me", "What do you know about me?", "What are my interests?", "Where was I born?"]) {
    assert.equal(picardSelfQuestion(text), true, text);
    assert.equal(tributeQuestion(text), true, text);
  }
  for (const text of ["Tell me about my file", "Tell me about myself and my files", "What is my project history?", "Who am I signed in as in this account?", "Describe my settings", "Tell me about my last request"]) {
    assert.equal(picardSelfQuestion(text), false, text);
  }
  assert.equal(gentleWitAllowed("Tell me about myself"), true);
  for (const text of ["Tell me about myself, facts only", "Tell me about myself without jokes", "Tell me about myself, don't tease", "Tell me about myself, no humour", "Tell me about my family"]) {
    assert.equal(gentleWitAllowed(text), false);
  }
  assert.equal(gentleWitAllowed("Tell me about myself and my Borg assimilation"), false);
});

test("story acceptance is explicit, never a negation, vague reply, or unrelated request", () => {
  for (const text of ["Yes.", "Yes, please.", "yes please", "Computer, tell me", "Go ahead", "tell me the story", "tell me a short story"]) assert.equal(storyAcceptance(text), true, text);
  for (const text of ["", "no", "not now", "yes but don't", "maybe", "tell me about my project", "I don't want a story", "yes, change the file"]) assert.equal(storyAcceptance(text), false, text);
  assert.ok(explicitStoryRequest("Computer, tell me a short story about Sir Patrick Stewart."));
  assert.ok(explicitStoryRequest("Tell me another story about Patrick Stewart"));
  assert.ok(explicitStoryRequest("Tell me a Patrick Stewart story"));
  assert.equal(explicitStoryRequest("Don't tell me a story about Patrick Stewart"), false);
  assert.equal(explicitStoryRequest("Write a story file about Patrick Stewart"), false);
  for (const text of ["Tell me a short story about Picard", "Computer, tell me a story about Captain Jean-Luc Picard.", "Tell me another story about Jean Luc Picard", "Tell me a Picard story", "Tell me a story about myself"]) {
    assert.equal(explicitStorySubject(text), "Picard", text);
  }
  assert.equal(explicitStorySubject("Tell me a Patrick Stewart story"), "Patrick Stewart");
  for (const text of ["Don't tell me a story about Picard", "Tell me a story about my project", "Write a Picard story file", "Tell me a story about Picard but not now"]) assert.equal(explicitStorySubject(text), undefined, text);
});

test("story offers and reference subjects follow the question without mixing the Captain and actor", () => {
  for (const [text, subject] of [["Tell me about myself", "Picard"], ["Tell me about Picard", "Picard"], ["Tell me about Patrick Stewart", "Patrick Stewart"]] as const) {
    assert.equal(tributeSubject(text), subject);
    assert.equal(storyOfferAllowed(text), true);
    assert.match(storyInvitation(subject), subject === "Picard" ? /Captain Jean-Luc Picard/ : /Sir Patrick Stewart/);
  }
  for (const text of ["Explain my code", "Tell me about Picard, facts only", "Tell me about Patrick Stewart, no stories", "Tell me about Patrick Stewart's family", "Tell me about myself and my Borg assimilation"]) {
    assert.equal(storyOfferAllowed(text), false, text);
  }
});

test("repository questions stay grounded in the selected project, even when it is named Picard", () => {
  for (const text of [
    "Tell me about our Picard repo",
    "Tell me about Picard's repository",
    "Explain the Picard repositories",
    "Tell me about myself and our repo",
    "Who am I signed in as on GitHub?",
    "Tell me about the Picard dependencies",
    "What does the Picard README say?",
    "Tell me about Patrick Stewart in our files",
  ]) {
    assert.equal(picardSelfQuestion(text), false, text);
    assert.equal(tributeQuestion(text), false, text);
    assert.equal(tributeSubject(text), undefined, text);
    assert.equal(storyOfferAllowed(text), false, text);
    assert.equal(gentleWitAllowed(text), false, text);
    const manner = computerManner(text, { mode: "screen" });
    assert.doesNotMatch(manner, /Reviewed reference material follows/);
    assert.match(manner, /selected Project folder supplied by OpenCode/);
    assert.match(manner, /Read its actual files/);
    assert.match(manner, /file paths and line numbers/);
    assert.match(manner, /not permission to edit files/);
    assert.match(manner, /including read-only commands/);
  }
});

test("request options are allowlisted and instructions preserve identity in every mode", () => {
  assert.equal(tributeMode(true, false), "screen");
  assert.equal(tributeMode(true, true), "spoken");
  assert.equal(tributeMode(false, true), "off");
  const story = TRIBUTE_ENTRIES.find((entry) => entry.story)!;
  assert.deepEqual(checkTributeRequest({ mode: "off", storyID: story.id }), { mode: "off", storyID: story.id });
  for (const value of [null, [], "on", {}, { mode: "on" }, { mode: "screen", story: "invented" }, { mode: "screen", storyID: "unknown" }, { mode: "screen", storyID: TRIBUTE_ENTRIES[0]!.id }]) {
    assert.throws(() => checkTributeRequest(value));
  }
  for (const mode of ["off", "screen", "spoken"] as const) {
    const manner = computerManner("Tell me about myself", { mode });
    assert.match(manner, /fictional life, not Patrick Stewart/);
    assert.match(manner, /"My file", "my project"/);
    assert.match(manner, /Never invent completion/);
    assert.match(manner, /not permission to change OpenCode/);
    assert.equal(manner.includes("one short,\naffectionate"), mode !== "off");
  }
  assert.doesNotMatch(computerManner("Explain my code", { mode: "spoken" }), /you may add one/);
  assert.doesNotMatch(computerManner("Tell me about myself, facts only", { mode: "screen" }), /you may add one/);
  const manner = computerManner("Yes", { mode: "off", storyID: story.id });
  assert.match(manner, /explicitly requested/);
  assert.ok(manner.includes(story.source.url));
  assert.ok(manner.includes(story.story!));
  assert.match(computerManner("Tell me about Patrick Stewart", { mode: "off" }), /simonandschuster\.com/);
  assert.match(computerManner("Tell me about Picard", { mode: "off" }), /startrek\.com/);
  for (const subject of ["Picard", "Patrick Stewart"] as const) {
    const entry = TRIBUTE_ENTRIES.find((entry) => entry.story && entry.subject === subject)!;
    const instructions = computerManner("Yes, please.", { mode: "off", storyID: entry.id });
    assert.ok(instructions.includes(`explicitly requested the following ${subject} story`));
    assert.ok(instructions.includes(entry.story!));
    assert.ok(instructions.includes(entry.source.url));
    assert.match(instructions, subject === "Picard" ? /fictional adventures, not Patrick Stewart/ : /Patrick Stewart is the actor/);
  }
});
