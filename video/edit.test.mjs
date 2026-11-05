import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptions, draftEdit, frameList, layout, mergeRanges, rootComposition, shortComposition, shortCues, silences, speechTimes, spokenStardate, transcript } from "./edit.mjs";
import { chapterList, srt } from "../tools/intro-episode.mjs";

test("stardates are read digit by digit", () => {
  assert.equal(spokenStardate("-296154.7"), "minus two nine six one five four point seven");
  assert.throws(() => spokenStardate("47634"), /not a stardate/);
});

test("each frame is held for as long as it was on screen", () => {
  const list = frameList([{ file: "a.jpg", time: 10 }, { file: "b.jpg", time: 10.5 }], 12);
  assert.match(list, /a\.jpg'\nduration 0\.5000\nfile 'frames\/b\.jpg'\nduration 1\.5000\nfile 'frames\/b\.jpg'\n$/);
  assert.throws(() => frameList([{ file: "a.jpg", time: 10 }, { file: "b.jpg", time: 9 }], 12), /out of order/);
});

test("pauses are read from ffmpeg, including one still running at the end", () => {
  const output = "[silencedetect] silence_start: -0.01\n[silencedetect] silence_end: 1.5 | silence_duration: 1.5\n[silencedetect] silence_start: 7.25\n";
  assert.deepEqual(silences(output), [{ start: 0, end: 1.5 }, { start: 7.25, end: Infinity }]);
});

test("nearby keep ranges merge with their speech", () => {
  const merged = mergeRanges([{ from: 5, to: 6, speech: [{ text: "b" }] }, { from: 0, to: 4.6, speech: [{ text: "a" }], caption: "x" }]);
  assert.deepEqual(merged, [{ from: 0, to: 6, speech: [{ text: "a" }, { text: "b" }], caption: "x" }]);
});

test("each spoken sentence is timed from its measured length, with the handover silence between speakers", () => {
  const parts = speechTimes([
    { speaker: "picard-riker", sentences: [{ text: "One.", seconds: 1 }, { text: "Two.", seconds: 2 }] },
    { speaker: "picard-riker", sentences: [{ text: "Three.", seconds: 1 }] },
    { speaker: "picard-data", sentences: [{ text: "Four.", seconds: 1 }] },
  ], 10);
  assert.deepEqual(parts.map((part) => part.sentences.map(({ start, end }) => [start, end])), [[[10, 11], [11, 13]], [[13, 14]], [[14.3, 15.3]]]);
});

function recording() {
  return {
    frames: [{ file: "0.jpg", time: 100 }],
    turns: [
      { order: "computer", say: "Computer.", spoken: { start: 101, end: 102 }, settled: 110 },
      { order: "options", say: "Number One, options.", spoken: { start: 120, end: 122 }, settled: 160 },
      { order: "engage", say: "Make it so.", spoken: { start: 200, end: 201 }, settled: 260 },
    ],
    timeline: [
      { time: 102.5, order: "computer", status: "Accessing" },
      { time: 103, order: "computer", message: { id: "m1", role: "assistant", speaker: "Computer" } },
      { time: 103.1, order: "computer", status: "Transmitting" },
      { time: 105, order: "computer", status: "Standing by" },
      // A briefing: every report and the computer's unspoken receipt appear together, then one long transmission.
      { time: 125, order: "options", message: { id: "m2", role: "assistant", speaker: "Riker", crewReport: true } },
      { time: 125, order: "options", message: { id: "m3", role: "assistant", speaker: "Geordi", crewReport: true } },
      { time: 125, order: "options", message: { id: "m4", role: "assistant", speaker: "Computer" } },
      { time: 125.2, order: "options", status: "Transmitting" },
      { time: 150, order: "options", status: "Standing by" },
      { time: 240, order: "engage", message: { id: "m5", role: "assistant", speaker: "Geordi" } },
      { time: 250, order: "engage", status: "Standing by" },
    ],
    approvals: [{ order: "engage", time: 220, request: {} }],
  };
}

function speech({ riker = 2 } = {}) {
  const sentences = (...pairs) => pairs.map(([text, seconds]) => ({ text, seconds }));
  return [
    { time: 103.1, parts: speechTimes([{ sentences: sentences(["Ready.", 0.8]) }], 103.1) },
    { time: 125.2, parts: speechTimes([
      { speaker: "picard-riker", sentences: sentences(["We have three options, Captain.", riker], ["First, a single page.", 1.5], ["Second, a timeline.", 1.5]) },
      { speaker: "picard-geordi", sentences: sentences(["Easy build, Captain.", 1.6], ["I’d use plain files.", 2], ["Nothing fancy.", 1]) },
    ], 125.2) },
  ];
}

test("the first cut keeps each officer's first whole sentences from a shared transmission, with exact words", () => {
  const edit = draftEdit(recording(), [{ start: 28.65, end: 29 }], "-296154.7", speech());
  assert.equal(edit.narration["log-open"].includes("minus two nine six"), true);
  const [first] = edit.acts.one;
  assert.equal(first.from, 0.4);
  assert.deepEqual(first.speech.map((line) => [line.speaker, line.text]), [["Picard", "Computer."], ["Computer", "Ready."]]);
  const reports = edit.acts.two.filter((range) => range.plate);
  assert.deepEqual(reports.map((range) => [range.plate.name, range.speech[0].text]), [
    ["Commander Riker", "We have three options, Captain. First, a single page."],
    ["Lieutenant Commander La Forge", "Easy build, Captain. I’d use plain files."],
  ]);
  // Riker's cut lands in the real pause after his second sentence; Geordi starts after the handover silence.
  assert.deepEqual(reports.map((range) => [range.speech[0].at, range.speech[0].until].map((time) => Number(time.toFixed(2)))), [[25.2, 28.8], [30.5, 34.1]]);
  assert.ok(edit.acts.three.some((range) => range.caption === "The Captain decides" && range.from === 117.5));
  assert.ok(edit.acts.three.some((range) => range.from === 139.7 && range.to === 141.2), "an unspoken reply still shows briefly");
});

test("a repeated announcement keeps only its first sentence", () => {
  const take = recording();
  take.approvals = [{ order: "engage", time: 210, request: {} }, { order: "engage", time: 225, request: {} }];
  take.timeline.push(
    { time: 210, order: "engage", status: "Transmitting" }, { time: 216, order: "engage", status: "Accessing" },
    { time: 225, order: "engage", status: "Transmitting" }, { time: 231, order: "engage", status: "Accessing" },
  );
  const announce = (time) => ({ time, parts: speechTimes([{ sentences: [{ text: "Captain, approval is required.", seconds: 2 }, { text: "Choose Allow once or Deny.", seconds: 3 }] }], time) });
  const edit = draftEdit(take, [], "-296154.7", [...speech(), announce(210), announce(225)]);
  const said = edit.acts.three.flatMap((range) => range.speech).filter((line) => line.speaker === "Computer").map((line) => line.text);
  assert.deepEqual(said, ["Captain, approval is required. Choose Allow once or Deny.", "Captain, approval is required."]);
});

test("the first cut refuses speech that does not match the recording rather than cutting words", () => {
  assert.throws(() => draftEdit(recording(), [], "-296154.7", speech({ riker: 40 })), /runs to 73\.1 s, but the computer stopped speaking at 50\.0 s/);
  const silent = [...speech(), { time: 230, parts: speechTimes([{ sentences: [{ text: "Hello.", seconds: 1 }] }], 230) }];
  assert.throws(() => draftEdit(recording(), [], "-296154.7", silent), /spoke at 130\.0 s, but the screen never showed Transmitting/);
});

const sounds = { "music-open.mp3": 60, "music-end.mp3": 60, "beep-plate.mp3": 3.4, "beep-line.mp3": 3.4, "beep-caption.mp3": 3.4, "app-startup.mp3": 2 };
const spoken = { "log-open": 7, "log-supplemental": 5, engage: 1 };
function edit() {
  const speech = (speaker, at, until, text) => ({ speaker, at, until, text });
  return {
    stardate: "-296154.7",
    narration: { "log-open": "Captain's log.", "log-supplemental": "Captain's log, supplemental.", engage: "Engage." },
    acts: {
      one: [{ from: 0, to: 6, speech: [speech("Picard", 1, 2, "Computer."), speech("Computer", 3, 4, "Ready.")] }],
      two: [{ from: 20, to: 32, speech: [speech("Riker", 21, 30, "Three options, Captain.")], plate: { name: "Commander Riker", duty: "First officer", colour: "#dd6666" } }],
      three: [{ from: 50, to: 62, speech: [], caption: "The Captain decides" }],
    },
    site: { from: 1, to: 8 },
  };
}

test("the episode is laid out with YouTube chapters and captions of the exact words", () => {
  const plan = layout(edit(), spoken, sounds);
  assert.equal(plan.duration, 18 + 6 + 6 + 5 + 2 + 12 + 2 + 12 + 7 + 6 + 15);
  assert.deepEqual(plan.chapters.map((chapter) => chapter.start), [0, 24, 37, 51, 63]);
  assert.doesNotThrow(() => chapterList(plan.chapters, plan.duration));
  assert.doesNotThrow(() => srt(plan.captions));
  assert.equal(plan.captions[0].text, "Picard: Captain's log.");
  assert.deepEqual(plan.captions.find((cue) => cue.text.startsWith("Riker")), { start: 38, end: 47, text: "Riker: Three options, Captain." });
  assert.equal(plan.clips.find((clip) => clip.composition === "plate").start, 37.3);
  assert.equal(plan.clips.filter((clip) => clip.src === "assets/sounds/beep-line.mp3").length, 5);
  assert.equal(plan.clips.find((clip) => clip.src === "assets/sounds/beep-plate.mp3").duration, 1.2);
  assert.match(rootComposition(plan.clips), /data-composition-id="main" data-start="0" data-duration="91"/);
  assert.equal(transcript(plan.captions).split("\n")[0], "Picard: Captain's log.");
});

test("layout refuses missing sounds and speech cut off by its segment rather than hiding them", () => {
  assert.throws(() => layout(edit(), spoken, { ...sounds, "beep-plate.mp3": undefined }), /beep-plate\.mp3 is missing/);
  const cut = edit();
  cut.acts.two[0].to = 25;
  assert.throws(() => layout(cut, spoken, sounds), /cut off by its segment/);
  assert.throws(() => layout(edit(), { ...spoken, engage: undefined }, sounds), /engage was not spoken/);
});

test("captions keep the exact words inside each speech clip", () => {
  const text = "Picard Code uses OpenCode 2. Nemotron listens and Kokoro speaks. The exact reading is 99.6%.";
  const cues = buildCaptions([{ start: 10, duration: 8, text }]);
  assert.equal(cues.map((cue) => cue.text.replaceAll("\n", " ")).join(" "), text);
  assert.equal(cues[0].start, 10);
  assert.equal(cues.at(-1).end, 18);
  for (const cue of cues) assert.ok(cue.text.split("\n").every((line) => line.length <= 42) && cue.text.split("\n").length <= 2);
  assert.throws(() => buildCaptions([{ start: 0, duration: 2, text: "a" }, { start: 1, duration: 2, text: "b" }]), /overlap/);
});

test("a Short keeps the captions of its parts, retimed, and refuses a cut through spoken words", () => {
  const captions = [
    { start: 10, end: 12, text: "Riker: Options." },
    { start: 20, end: 23, text: "Make it so." },
    { start: 30, end: 34, text: "Engage." },
  ];
  const cues = shortCues(captions, [{ from: 9, to: 13 }, { from: 29, to: 35 }]);
  assert.deepEqual(cues, [{ start: 1, end: 3, text: "Riker: Options." }, { start: 5, end: 9, text: "Engage." }]);
  assert.throws(() => shortCues(captions, [{ from: 21, to: 25 }]), /cuts through the words "Make it so\."/);
  const html = shortComposition({ title: "The briefing", ranges: [{ from: 9, to: 13 }, { from: 29, to: 35 }], cues, source: "assets/episode.mp4" });
  assert.match(html, /data-duration="10" data-width="1080" data-height="1920"/);
  assert.match(html, /<video id="part-1" class="episode" src="assets\/episode.mp4" data-start="4" data-duration="6" data-track-index="0" data-media-start="29" data-has-audio="true" playsinline>/);
  assert.match(html, /tl.set\("#cue-1", \{ opacity: 1 \}, 5\).set\("#cue-1", \{ opacity: 0 \}, 9\)/);
  const rewrapped = shortComposition({ title: "Log", ranges: [{ from: 0, to: 4 }], cues: [{ start: 0, end: 3, text: "Picard: Captain's log, stardate minus two\nnine six one." }], source: "assets/episode.mp4" });
  assert.match(rewrapped, /class="cue">Picard: Captain&#39;s log, stardate minus two nine six one\.<\/p>/, "the narrow Short rewraps the episode's caption lines");
});
