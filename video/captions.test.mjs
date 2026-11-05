import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptions, captionComposition } from "./captions.mjs";

test("captions preserve exact words and stay inside each measured speech clip", () => {
  const text = "Picard Code uses OpenCode 2. Nemotron listens and Kokoro speaks. The exact reading is 99.6%.";
  const cues = buildCaptions([{ start: 10, duration: 8, text }]);
  assert.equal(cues.map((cue) => cue.text.replaceAll("\n", " ")).join(" "), text);
  assert.equal(cues[0].start, 10);
  assert.equal(cues.at(-1).end, 18);
  for (const [index, cue] of cues.entries()) {
    assert.ok(cue.end > cue.start);
    assert.ok(cue.text.split("\n").every((line) => line.length <= 42));
    assert.ok(cue.text.split("\n").length <= 2);
    if (index) assert.equal(cues[index - 1].end, cue.start);
  }
});

test("captioned composition escapes words and reserves space above the original interface", () => {
  const html = '<style></style><div id="root"><img src="assets/answer.png">\n</div>\n<script src="gsap.js">window.__timelines = { main: tl };</script>';
  const captioned = captionComposition(html, [{ start: 1, end: 3, text: '<script> & "Captain"\nSecond line' }]);
  assert.ok(captioned.includes('&lt;script&gt; &amp; &quot;Captain&quot;'));
  assert.ok(captioned.includes('src="./answer.png"'));
  assert.ok(captioned.includes("top: 24px"));
  assert.ok(captioned.includes('data-start="1" data-duration="2"'));
  assert.ok(captioned.includes('tl.set(caption, { opacity: 0 }'));
  assert.throws(() => captionComposition("<p>Not a composition</p>", []), /structure changed/);
});

test("caption preparation rejects overlapping or invalid speech rather than hiding it", () => {
  assert.throws(() => buildCaptions([{ start: 0, duration: 2, text: "First" }, { start: 1, duration: 2, text: "Second" }]), /overlap/);
  for (const entry of [
    { start: -1, duration: 2, text: "Hello" },
    { start: 0, duration: 0, text: "Hello" },
    { start: 0, duration: NaN, text: "Hello" },
    { start: 0, duration: 2, text: "" },
    { start: 0, duration: 2, text: "x".repeat(43) },
  ]) assert.throws(() => buildCaptions([entry]));
});

test("a short final fragment is balanced with the preceding caption rather than flashed", () => {
  const text = "Nemotron listens and Kokoro speaks on your computer. OpenCode two connects the AI provider you choose. Online providers receive your requests and relevant project content.";
  const cues = buildCaptions([{ start: 0, duration: 11.74, text }]);
  assert.equal(cues.map((cue) => cue.text.replaceAll("\n", " ")).join(" "), text);
  assert.ok(cues.every((cue) => cue.end - cue.start >= 1));
  assert.ok(cues.every((cue) => cue.text.split("\n").length <= 2));
});
