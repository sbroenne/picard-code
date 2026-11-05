import assert from "node:assert/strict";
import test from "node:test";
import { LOG_TITLE_LENGTH, logEntryTitle } from "../shared/log-title.js";

const briefing = "Number One and Mister Data give me one short sentence each on your options for building a tribute site to Sir Patrick with a stardate clock";

test("a long request is shortened at the end of a whole word and marked with an ellipsis", () => {
  const title = logEntryTitle(`Computer, ${briefing}`);
  assert.equal(title, "Number One and Mister Data give me one short sentence each…");
  assert.ok([...title].length <= LOG_TITLE_LENGTH);
  assert.ok(briefing.startsWith(title.slice(0, -1)), "the Captain's words are kept unchanged");
});

test("a short request keeps every word, without an ellipsis", () => {
  assert.equal(logEntryTitle("Computer, hello there"), "hello there");
  assert.equal(logEntryTitle("hello there"), "hello there");
  const exact = "a".repeat(LOG_TITLE_LENGTH - 5) + " done";
  assert.equal(logEntryTitle(exact), exact);
});

test("the cut never leaves a dangling comma, and a word ending exactly at the limit is kept", () => {
  assert.equal(logEntryTitle(`${"word ".repeat(10)}twelve, ${"more ".repeat(10)}`), "word word word word word word word word word word twelve…");
  const fits = `${"a".repeat(LOG_TITLE_LENGTH - 1)} next`;
  assert.equal(logEntryTitle(fits), `${"a".repeat(LOG_TITLE_LENGTH - 1)}…`);
});

test("one word longer than the title is cut where it must be", () => {
  const title = logEntryTitle("x".repeat(100));
  assert.equal(title, `${"x".repeat(LOG_TITLE_LENGTH - 1)}…`);
});

test("letters outside plain English are counted whole and never split", () => {
  const title = logEntryTitle(`${"🖖 ".repeat(40)}`);
  assert.ok([...title].length <= LOG_TITLE_LENGTH);
  assert.ok(!title.includes("\uFFFD"));
  assert.match(title, /^(🖖 )*🖖…$/u);
});
