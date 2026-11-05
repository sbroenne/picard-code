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
  assert.throws(() => frameList([{ file: "a.jpg", time: 13 }], 12), /after the recording ended/);
});

test("frames the browser delivered out of order play in the order they were shown", () => {
  const list = frameList([{ file: "a.jpg", time: 10 }, { file: "c.jpg", time: 10.5 }, { file: "b.jpg", time: 10.25 }], 11);
  assert.deepEqual([...list.matchAll(/file 'frames\/(\w)\.jpg'/g)].map((match) => match[1]), ["a", "b", "c", "c"]);
  assert.doesNotMatch(list, /duration -/);
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
      { order: "computer", say: "Computer.", spoken: { start: 101, end: 102 } },
      { order: "briefing", say: "Number One, Mr Data, two sentences each: options.", spoken: { start: 105, end: 108 }, settled: 160 },
      { order: "engage", say: "Make it so.", spoken: { start: 170, end: 171 }, settled: 230 },
      { order: "report", say: "Mr Data, please run the tests and report in one sentence.", spoken: { start: 240, end: 243 }, settled: 280 },
    ],
    timeline: [
      // A briefing: every report and the computer's unspoken receipt appear together, then one long transmission.
      { time: 125, order: "briefing", message: { id: "m2", role: "assistant", speaker: "Riker", crewReport: true } },
      { time: 125, order: "briefing", message: { id: "m3", role: "assistant", speaker: "Data", crewReport: true } },
      { time: 125.2, order: "briefing", status: "Transmitting" },
      { time: 150, order: "briefing", status: "Standing by" },
      { time: 172, order: "engage", status: "Accessing" },
      { time: 200, order: "engage", status: "Transmitting" },
      { time: 206, order: "engage", status: "Accessing" },
      { time: 228, order: "engage", status: "Standing by" },
      { time: 244, order: "report", status: "Accessing" },
      { time: 262, order: "report", status: "Transmitting" },
      { time: 270, order: "report", status: "Standing by" },
    ],
  };
}

function speech({ riker = 2, data = ["The tests pass, Captain.", 2] } = {}) {
  const sentences = (...pairs) => pairs.map(([text, seconds]) => ({ text, seconds }));
  return [
    { time: 125.2, parts: speechTimes([
      { speaker: "picard-riker", sentences: sentences(["Two options, Captain.", riker], ["I recommend the single page.", 2]) },
      { speaker: "picard-data", sentences: sentences(["I concur.", 1], ["A single page is the simplest.", 2]) },
      { sentences: sentences(["Both officers have reported.", 2]) },
    ], 125.2) },
    { time: 200, parts: speechTimes([{ sentences: sentences(["The site is built.", 1.5], ["Three files were written.", 2]) }], 200) },
    { time: 262, parts: speechTimes([{ speaker: "picard-data", sentences: sentences(data) }], 262) },
  ];
}

test("the cut keeps Riker's and Data's replies whole and leaves the rest of the speech out", () => {
  const edit = draftEdit(recording(), [{ start: 29.25, end: 29.6 }], "-296154.7", speech());
  assert.deepEqual(Object.keys(edit.acts), ["briefing", "work"]);
  assert.equal(edit.narration["hook-1"], "Captain Picard never typed.");
  const said = Object.values(edit.acts).flat().flatMap((range) => range.speech).map((line) => [line.speaker, line.text]);
  assert.deepEqual(said, [
    ["Picard", "Computer."],
    ["Picard", "Number One, Mr Data, two sentences each: options."],
    ["Riker", "Two options, Captain. I recommend the single page."],
    ["Data", "I concur. A single page is the simplest."],
    ["Picard", "Make it so."],
    ["Picard", "Mr Data, please run the tests and report in one sentence."],
    ["Data", "The tests pass, Captain."],
  ]);
  const riker = edit.acts.briefing.find((range) => range.plate?.name === "Commander Riker");
  // Riker's whole reply ends in the real pause after his last sentence.
  assert.deepEqual([riker.speech[0].at, riker.speech[0].until].map((time) => Number(time.toFixed(2))), [25.2, 29.4]);
  assert.equal(edit.acts.work.filter((range) => range.plate).length, 1, "Data's report has his name plate.");
  const [first, second] = edit.acts.briefing.filter((range) => range.plate);
  assert.deepEqual([first.plate.name, second?.plate.name], ["Commander Riker", "Lieutenant Commander Data"], "back-to-back replies keep their own name plates");
  assert.ok(first.to <= second.from && first.to >= first.speech[0].until && second.from <= second.speech[0].at, "they meet between the two voices");
});

test("the work is shown in short silent slices, never across speech, with a caption on the first", () => {
  const edit = draftEdit(recording(), [], "-296154.7", speech());
  const slices = edit.acts.work.filter((range) => !range.speech.length);
  assert.equal(slices.length, 4);
  for (const slice of slices) {
    assert.ok(slice.to - slice.from <= 2.01 && slice.to - slice.from >= 1, "each slice is short");
    assert.ok(slice.to <= 99.7 || slice.from >= 103.8, "no slice overlaps the computer's unspoken-for build summary");
  }
  assert.deepEqual(slices.filter((slice) => slice.caption).map((slice) => [slice.order, slice.caption]), [
    ["engage", "Writing code · waiting cut"],
    ["report", "Tests run in your project"],
  ]);
  const report = slices.filter((slice) => slice.order === "report");
  assert.ok(report.every((slice) => slice.from >= 144.4 && slice.to <= 161.7), "test slices fall between the order and Data's report");
});

test("a take where an officer is silent or talks too long is refused, never cut inside the reply", () => {
  assert.throws(() => draftEdit(recording(), [], "-296154.7", speech({ riker: 15 })), /Record again: Riker spoke for 17\.0 s/);
  const quiet = speech();
  quiet[2].parts[0].speaker = undefined;
  assert.throws(() => draftEdit(recording(), [], "-296154.7", quiet), /Record again: Data did not speak after "Mr Data, please run the tests/);
  const silent = [...speech(), { time: 230, parts: speechTimes([{ sentences: [{ text: "Hello.", seconds: 1 }] }], 230) }];
  assert.throws(() => draftEdit(recording(), [], "-296154.7", silent), /spoke at 130\.0 s, but the screen never showed Transmitting/);
  const long = speech();
  long[0].parts = speechTimes([{ speaker: "picard-riker", sentences: [{ text: "Options.", seconds: 2 }] }, { speaker: "picard-data", sentences: [{ text: "Yes.", seconds: 1 }] }, { sentences: [{ text: "Done.", seconds: 40 }] }], 125.2);
  assert.throws(() => draftEdit(recording(), [], "-296154.7", long), /runs to 68\.8 s, but the computer stopped speaking at 50\.0 s/);
});

const sounds = { "music-open.mp3": 60, "music-end.mp3": 60, "beep-plate.mp3": 3.4, "beep-caption.mp3": 3.4, "app-startup.mp3": 2, "app-request-accepted.mp3": 1 };
const spoken = { "hook-1": 2, "hook-2": 2.6, "hook-3": 1.8, "log-supplemental": 4.5 };
function edit() {
  const speech = (speaker, at, until, text) => ({ speaker, at, until, text });
  return {
    stardate: "-296154.7",
    narration: { "hook-1": "Captain Picard never typed.", "hook-2": "He spoke, and the computer answered.", "hook-3": "So we built Picard Code.", "log-supplemental": "Captain's log, supplemental." },
    acts: {
      briefing: [{ from: 0, to: 6, speech: [speech("Picard", 1, 2, "Computer.")] }, { from: 20, to: 32, speech: [speech("Riker", 21, 30, "Two options, Captain.")], plate: { name: "Commander Riker", duty: "First officer", colour: "#dd6666" } }],
      work: [{ from: 50, to: 52, speech: [], caption: "Writing code · waiting cut" }, { from: 60, to: 62, speech: [] }],
    },
    site: { from: 1, to: 7 },
  };
}

test("the episode follows the storyboard: tribute, hook, title, briefing, make it so, Captain's log, end board", () => {
  const plan = layout(edit(), spoken, sounds);
  assert.equal(plan.duration, 15 + 4 + 6 + 12 + 2 + 2 + 6 + 6 + 15);
  assert.deepEqual(plan.chapters.map((chapter) => [chapter.start, chapter.title]), [[0, "Why we built it"], [19, "The briefing"], [37, "Make it so"], [47, "Captain’s log"]]);
  assert.doesNotThrow(() => chapterList(plan.chapters, plan.duration));
  assert.doesNotThrow(() => srt(plan.captions));
  assert.equal(plan.captions[0].text, "Picard: Captain Picard never typed.");
  // The tribute comes first, on screen from the first frame; the Captain's hook follows it.
  const opening = plan.clips.find((clip) => clip.composition === "opening");
  assert.deepEqual(opening.variables.beats.dedication, [0, 4.3]);
  assert.equal(plan.captions[0].start, 4.5, "the hook starts once the dedication has faded");
  for (const name of ["hook-1", "hook-2", "hook-3"]) {
    assert.equal(plan.captions.find((cue) => cue.text.includes(edit().narration[name]))?.start, opening.variables.beats[name][0], `the ${name} words are on screen while it is said`);
  }
  assert.deepEqual(plan.captions.find((cue) => cue.text.startsWith("Riker")), { start: 26, end: 35, text: "Riker: Two options, Captain." });
  assert.deepEqual(plan.clips.filter((clip) => clip.kind === "composition" && clip.track === 0).map((clip) => [clip.composition, clip.start, clip.duration]), [["opening", 0, 15], ["title", 15, 4], ["end", 53, 15]]);
  assert.equal(plan.clips.filter((clip) => clip.src === "assets/sounds/beep-caption.mp3").length, 2, "a bridge beep on each work cut");
  assert.match(rootComposition(plan.clips), /data-composition-id="main" data-start="0" data-duration="68"/);
  assert.equal(transcript(plan.captions).split("\n")[0], "Picard: Captain Picard never typed.");
});

test("a work caption must stay short enough to clear the app's PICARD CODE title", () => {
  const long = edit();
  long.acts.work[0].caption = "Writing code in your project · Waiting cut";
  assert.throws(() => layout(long, spoken, sounds), /"Writing code in your project · Waiting cut" is too long/);
  const slices = draftEdit(recording(), [], "-296154.7", speech()).acts.work.filter((range) => range.caption);
  for (const slice of slices) assert.ok(slice.caption.length <= 30, `${slice.caption} fits beside the title`);
});

test("layout refuses a cut over 1:40, narration that overruns its beat, missing sounds and cut-off speech", () => {
  const long = edit();
  long.acts.work.push({ from: 100, to: 135, speech: [] });
  assert.throws(() => layout(long, spoken, sounds), /runs 1:4\d; the storyboard allows 1:40 at most/);
  assert.throws(() => layout(edit(), { ...spoken, "hook-1": 3.2 }, sounds), /hook-1 runs 3\.2 s but its beat is 2\.9 s/);
  assert.throws(() => layout(edit(), spoken, { ...sounds, "beep-plate.mp3": undefined }), /beep-plate\.mp3 is missing/);
  const cut = edit();
  cut.acts.briefing[1].to = 25;
  assert.throws(() => layout(cut, spoken, sounds), /cut off by its segment/);
  assert.throws(() => layout(edit(), { ...spoken, "hook-3": undefined }, sounds), /hook-3 was not spoken/);
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
