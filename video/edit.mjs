/** Pure helpers for building the intro from a recorded episode. build.mjs does the file work. */

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** Reads a stardate the way the log does: digit by digit, for example "minus two nine six point seven". */
export function spokenStardate(stardate) {
  if (!/^-?\d+\.\d$/.test(stardate)) throw new Error(`"${stardate}" is not a stardate with one decimal.`);
  const [whole, tenth] = stardate.replace("-", "").split(".");
  const words = [...whole].map((digit) => DIGITS[digit]).join(" ");
  return `${stardate.startsWith("-") ? "minus " : ""}${words} point ${DIGITS[tenth]}`;
}

/** The Captain's narration, in our own words. Spoken with a stock Kokoro voice, never an imitation. */
export function narration() {
  return {
    "hook-1": "Captain Picard never typed.",
    "hook-2": "He spoke, and the computer answered.",
    "hook-3": "So we built Picard Code.",
    "log-supplemental": "Captain's log, supplemental. The crew performed admirably.",
  };
}

/**
 * The ffmpeg concat list that plays each screencast frame for exactly as long as it was on screen.
 * The browser only sends a frame when the picture changes, so durations vary.
 */
export function frameList(frames, end) {
  if (!frames.length) throw new Error("The recording has no frames.");
  // Chrome occasionally delivers two frames out of order; their timestamps say when each was shown.
  const shown = frames.toSorted((first, second) => first.time - second.time);
  if (shown.at(-1).time > end) throw new Error(`Frame ${shown.at(-1).file} was shown after the recording ended.`);
  const lines = [];
  shown.forEach((frame, index) => {
    const next = index + 1 < shown.length ? shown[index + 1].time : end;
    lines.push(`file 'frames/${frame.file}'`, `duration ${(next - frame.time).toFixed(4)}`);
  });
  lines.push(`file 'frames/${shown.at(-1).file}'`);
  return `${lines.join("\n")}\n`;
}

const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

/** One timed element on the root timeline. */
export function clipElement(clip) {
  const attributes = { id: clip.id, class: clip.kind === "composition" ? "clip" : clip.className };
  if (clip.kind === "composition") Object.assign(attributes, { "data-composition-id": clip.composition, "data-composition-src": `compositions/${clip.composition}.html` });
  if (clip.kind !== "composition") attributes.src = clip.src;
  Object.assign(attributes, {
    "data-start": round(clip.start), "data-duration": round(clip.duration), "data-track-index": clip.track,
    "data-media-start": clip.mediaStart === undefined ? undefined : round(clip.mediaStart),
    "data-volume": clip.volume, "data-fade-in": clip.fadeIn, "data-fade-out": clip.fadeOut,
    "data-has-audio": clip.kind === "video" && clip.audio ? "true" : undefined,
    "data-variable-values": clip.variables ? JSON.stringify(clip.variables) : undefined,
  });
  const text = Object.entries(attributes).filter(([, value]) => value !== undefined).map(([name, value]) => `${name}="${escape(value)}"`).join(" ");
  if (clip.kind === "composition") return `<div ${text}></div>`;
  if (clip.kind === "video") return `<video ${text}${clip.audio ? "" : " muted"} playsinline></video>`;
  if (clip.kind === "audio") return `<audio ${text}></audio>`;
  if (clip.kind === "image") return `<img ${text} alt="">`;
  throw new Error(`Unknown clip kind "${clip.kind}".`);
}

function round(value) {
  return typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
}

/** The root HyperFrames composition for the whole episode. */
export function rootComposition(clips) {
  const duration = Math.max(...clips.map((clip) => clip.start + clip.duration));
  const ids = new Set();
  for (const clip of clips) {
    if (ids.has(clip.id)) throw new Error(`Two clips share the id "${clip.id}".`);
    ids.add(clip.id);
    if (!(clip.duration > 0)) throw new Error(`Clip "${clip.id}" has no duration.`);
  }
  return `<!doctype html>
<!-- Made by video/build.mjs from a recorded episode. Do not edit by hand; edit the episode's edit.json instead. -->
<html lang="en" data-resolution="landscape">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1920, height=1080">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: #000; }
  video.app { position: absolute; inset: 0; width: 1920px; height: 1080px; object-fit: contain; }
  video.site, img.still { position: absolute; inset: 0; width: 1920px; height: 1080px; object-fit: cover; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${round(duration)}" data-width="1920" data-height="1080">
${clips.map((clip) => `  ${clipElement(clip)}`).join("\n")}
</div>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
${clips.filter((clip) => clip.kind === "image").map((clip) => `  tl.fromTo("#${clip.id}", { scale: 1 }, { scale: 1.05, duration: ${round(clip.duration)}, ease: "none" }, ${round(clip.start)});`).join("\n")}
  window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
}

/** Reads ffmpeg silencedetect output into pauses, in seconds of footage. */
export function silences(output) {
  const pauses = [];
  for (const match of output.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (match[1] === "start") pauses.push({ start: Math.max(0, Number(match[2])), end: Infinity });
    else if (pauses.length) pauses.at(-1).end = Number(match[2]);
  }
  return pauses;
}

/** The silence the speech service puts between two different speakers (HANDOVER in src/server/speech-bridge.ts). */
export const HANDOVER = 0.3;

/**
 * When each sentence of one spoken reply was heard. `parts` are the parts the app sent to be spoken, each with
 * its sentences and their measured lengths in seconds; speaking began at `start`. Different speakers are
 * separated by the speech service's handover silence.
 */
export function speechTimes(parts, start) {
  let time = start;
  return parts.map((part, index) => {
    if (index && parts[index - 1].speaker !== part.speaker) time += HANDOVER;
    return {
      speaker: part.speaker,
      sentences: part.sentences.map(({ text, seconds }) => {
        const sentence = { text, start: time, end: time + seconds };
        time += seconds;
        return sentence;
      }),
    };
  });
}

const ACTS = { computer: "briefing", briefing: "briefing", engage: "work", report: "work" };
/** Whose replies are kept, whole, after each order. Everything else spoken is left out of the cut. */
const VOICES = { briefing: ["picard-riker", "picard-data"], report: ["picard-data"] };
/** The storyboard gives each reply about ten seconds; a longer one means the take is recorded again. */
const LONGEST_REPLY = 16;
/** Short silent slices of the real screen while the crew works, with the caption on the first. */
const WORK = {
  engage: { slices: 2, caption: "Writing code · waiting cut" },
  report: { slices: 2, caption: "Tests run in your project" },
};
const SLICE = 2;
/** The longest work caption that still ends before the app's title at the top right. */
const LONGEST_CAPTION = 30;
const CREW = {
  Riker: { name: "Commander Riker", duty: "First officer", colour: "#dd6666" },
  Data: { name: "Lieutenant Commander Data", duty: "Operations · analysis", colour: "#ffaa00" },
  Geordi: { name: "Lieutenant Commander La Forge", duty: "Chief engineer", colour: "#ffaa00" },
  Worf: { name: "Lieutenant Worf", duty: "Security", colour: "#ffaa00" },
  Troi: { name: "Counselor Troi", duty: "Ship's counselor", colour: "#9999ff" },
  Crusher: { name: "Doctor Crusher", duty: "Chief medical officer", colour: "#9999ff" },
};

/** Merges keep ranges that touch or nearly touch, keeping their speech and labels. */
export function mergeRanges(ranges, gap = 0.6) {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    // A reply with a name plate always starts its own segment.
    if (last && range.from - last.to < gap && !range.plate) {
      last.to = Math.max(last.to, range.to);
      last.speech.push(...range.speech);
      for (const key of ["plate", "caption"]) if (range[key] && !last[key]) last[key] = range[key];
    } else merged.push({ ...range, speech: [...range.speech] });
  }
  return merged;
}

/** The caption name for an app speaker, such as "picard-riker"; the computer has none. */
function speakerName(id) {
  if (!id) return "Computer";
  const name = Object.keys(CREW).find((key) => id === `picard-${key.toLowerCase()}`);
  if (!name) throw new Error(`Unknown speaker "${id}".`);
  return name;
}

/**
 * `count` slices of `length` seconds spread evenly through the free time between `from` and `to`,
 * never touching the `busy` spans (where someone is speaking).
 */
function slices(from, to, busy, count, length) {
  const free = [];
  let start = from;
  for (const span of [...busy].sort((a, b) => a.from - b.from)) {
    if (span.to <= start || span.from >= to) continue;
    if (span.from - start >= 1) free.push({ from: start, to: span.from });
    start = Math.max(start, span.to);
  }
  if (to - start >= 1) free.push({ from: start, to });
  const total = free.reduce((sum, span) => sum + span.to - span.from, 0);
  const picked = [];
  for (let index = 0; index < count && total; index++) {
    let offset = ((index + 0.5) * total) / count;
    const span = free.find((item) => (offset -= item.to - item.from) < 0);
    const centre = span.to + offset;
    const slice = { from: Math.max(span.from, Math.min(centre - length / 2, span.to - length)) };
    slice.to = Math.min(span.to, slice.from + length);
    if (!picked.some((item) => item.from === slice.from)) picked.push(slice);
  }
  return picked;
}

/**
 * The cut of the recording: the Captain's orders, the named officers' replies kept whole (a reply is never
 * cut inside), and short silent slices of the crew at work. Everything else is left out.
 * `speech` lists what the app sent to be spoken, with measured sentence times (see speechTimes); times in the
 * edit are seconds from the first recorded frame.
 */
export function draftEdit(recording, pauses, stardate, speech) {
  const zero = recording.frames[0].time;
  const at = (time) => time - zero;
  const acts = { briefing: [], work: [] };
  recording.turns.forEach((turn, index) => {
    const act = ACTS[turn.order];
    if (!act) throw new Error(`No act for the order "${turn.order}".`);
    const ranges = [{ from: at(turn.spoken.start) - 0.6, to: at(turn.spoken.end) + 1, speech: [{ speaker: "Picard", at: at(turn.spoken.start), until: at(turn.spoken.end), text: turn.say }] }];
    const statuses = recording.timeline.filter((entry) => entry.order === turn.order && entry.status !== undefined);
    const near = (time) => (item) => item.time >= time - 1 && item.time <= time + 2.5;
    const next = recording.turns[index + 1]?.spoken.start ?? Infinity;
    const said = speech.filter((item) => item.time >= turn.spoken.end && item.time < next);
    const busy = [];
    const kept = [];
    for (const item of said) {
      for (const part of item.parts) {
        const name = speakerName(part.speaker);
        const length = part.sentences.at(-1).end - part.sentences[0].start;
        if (VOICES[turn.order]?.includes(part.speaker) && length > LONGEST_REPLY) {
          throw new Error(`Record again: ${name} spoke for ${length.toFixed(1)} s after "${turn.say}"; the storyboard allows about ten seconds, and a reply is never cut.`);
        }
      }
      const speaking = statuses.find((entry) => entry.status === "Transmitting" && near(item.time)(entry));
      if (!speaking) throw new Error(`The app spoke at ${at(item.time).toFixed(1)} s, but the screen never showed Transmitting.`);
      const stop = statuses.find((entry) => entry.time > speaking.time && entry.status !== "Transmitting")?.time ?? turn.settled ?? Infinity;
      const last = item.parts.at(-1).sentences.at(-1).end;
      if (last > stop + 2) {
        throw new Error(`The measured speech at ${at(item.time).toFixed(1)} s runs to ${at(last).toFixed(1)} s, but the computer stopped speaking at ${at(stop).toFixed(1)} s. Was it spoken by local Kokoro at the recorded speed?`);
      }
      busy.push({ from: at(item.parts[0].sentences[0].start) - 0.3, to: at(last) + 0.3 });
      for (const part of item.parts.filter((part) => VOICES[turn.order]?.includes(part.speaker))) {
        // End in the real pause after the last sentence, so no breath or word is clipped.
        const end = at(part.sentences.at(-1).end);
        const pause = pauses.filter((entry) => entry.start >= end - 0.5 && entry.start <= end + 0.3)
          .sort((a, b) => Math.abs(a.start - end) - Math.abs(b.start - end))[0];
        const until = pause ? pause.start + 0.15 : end;
        const name = speakerName(part.speaker);
        const start = at(part.sentences[0].start);
        kept.push({ from: start - 0.3, to: until + 0.3, speech: [{ speaker: name, at: start, until, text: part.sentences.map((sentence) => sentence.text).join(" ") }], plate: CREW[name] });
      }
    }
    for (const voice of VOICES[turn.order] ?? []) {
      if (!kept.some((range) => range.plate === CREW[speakerName(voice)])) throw new Error(`Record again: ${speakerName(voice)} did not speak after "${turn.say}".`);
    }
    const work = WORK[turn.order];
    if (work) {
      const end = kept.length ? Math.min(...kept.map((range) => range.from)) : at(turn.settled ?? turn.spoken.end);
      slices(ranges[0].to, end, busy, work.slices, SLICE).forEach((slice, number) => {
        ranges.push({ ...slice, speech: [], caption: number ? undefined : work.caption });
      });
    }
    // Back-to-back replies meet halfway between the two voices.
    kept.forEach((range, number) => {
      const before = kept[number - 1];
      if (!before || range.from >= before.to) return;
      before.to = range.from = (before.speech[0].until + range.speech[0].at) / 2;
    });
    ranges.push(...kept);
    acts[act].push(...mergeRanges(ranges, 0.05).map((range) => ({ order: turn.order, ...range })));
  });
  return {
    stardate,
    narration: narration(),
    sounds: {
      "Music-v01.mp3": "music-open.mp3",
      "Music-v22.mp3": "music-end.mp3",
      "Menusound-System_Select_C.mp3": "beep-plate.mp3",
      "Menusound-System_Confirm_Beep.mp3": "beep-caption.mp3",
    },
    acts,
    site: { from: 1, to: 7 },
  };
}

const SCENES = { opening: 15, title: 4, still: 6, end: 15 };
/**
 * The opening's beats, in seconds: the dedication to Sir Patrick and the Captain first, then each hook line
 * from when the Captain starts saying it until its words leave. The opening composition is timed from these.
 */
const BEATS = { dedication: [0, 4.3], "hook-1": [4.5, 7.4], "hook-2": [7.6, 11.4], "hook-3": [11.6, 14.6] };
const HOOK = ["hook-1", "hook-2", "hook-3"];
/** The storyboard's hard limit for the whole cut, end board included. */
export const LONGEST_CUT = 100;

/**
 * Lays the whole episode out on one timeline, as in the storyboard: the dedication and hook, the title, the
 * briefing, the crew at work, the site they built, the Captain's log and the end board.
 * `spoken` and `sounds` are lengths in seconds.
 */
export function layout(edit, spoken, sounds) {
  const clips = [];
  const speech = [];
  const chapters = [];
  let overlay = 0;
  let beep = 0;
  const add = (clip) => { clips.push({ id: `${clip.kind}-${clips.length}`, ...clip }); };
  const sound = (name, start, wanted, volume, extra = {}) => {
    const length = sounds[name];
    if (!length) throw new Error(`The sound ${name} is missing.`);
    add({ kind: "audio", src: `assets/sounds/${name}`, start, duration: Math.min(wanted, length), volume, ...extra });
  };
  const chirp = (name, start) => sound(name, start, 1.2, 0.3, { track: 20 + (beep++ % 4), fadeOut: 0.3 });
  const say = (name, start, beat) => {
    if (!spoken[name]) throw new Error(`The narration line ${name} was not spoken.`);
    if (beat && spoken[name] > beat + 0.01) throw new Error(`The narration line ${name} runs ${spoken[name].toFixed(1)} s but its beat is ${beat.toFixed(1)} s.`);
    add({ kind: "audio", src: `assets/narration/${name}.wav`, start, duration: spoken[name], volume: 1, track: 10 });
    speech.push({ speaker: "Picard", start, duration: spoken[name], text: edit.narration[name] });
  };
  const scene = (composition, start, duration, variables) => add({ kind: "composition", composition, start, duration, track: 0, variables });

  chapters.push({ start: 0, title: "Why we built it" });
  scene("opening", 0, SCENES.opening, { stardate: edit.stardate, beats: BEATS });
  // The Captain's arrival hail, as when the app opens, plays alone over the tribute.
  if (sounds["app-startup.mp3"]) sound("app-startup.mp3", 0.2, 3, 0.55, { track: 11 });
  for (const name of HOOK) say(name, BEATS[name][0], BEATS[name][1] - BEATS[name][0]);
  if (sounds["app-request-accepted.mp3"]) sound("app-request-accepted.mp3", BEATS["hook-2"][1] - 0.6, 2, 0.4, { track: 13 });
  let time = SCENES.opening;
  scene("title", time, SCENES.title);
  sound("music-open.mp3", time - 0.4, SCENES.title + 2.4, 0.32, { track: 12, fadeIn: 0.4, fadeOut: 2 });
  time += SCENES.title;

  const act = (name, title) => {
    chapters.push({ start: time, title });
    for (const range of edit.acts[name]) {
      const duration = range.to - range.from;
      if (!(duration > 0)) throw new Error(`A segment of the ${name} act ends before it starts.`);
      add({ kind: "video", className: "app", src: "assets/footage.mp4", start: time, duration, mediaStart: range.from, track: 0, audio: true, volume: 1 });
      for (const line of range.speech) {
        if (line.at < range.from - 0.01 || line.until > range.to + 0.01) throw new Error(`"${line.text.slice(0, 40)}…" is cut off by its segment; widen the segment or shorten the words.`);
        speech.push({ speaker: line.speaker, start: time + line.at - range.from, duration: line.until - line.at, text: line.text });
      }
      if (range.plate) {
        add({ kind: "composition", composition: "plate", start: time + 0.3, duration: 3, track: 1 + (overlay++ % 2), variables: range.plate });
        chirp("beep-plate.mp3", time + 0.3);
      }
      if (range.caption?.length > LONGEST_CAPTION) throw new Error(`The caption "${range.caption}" is too long; it would run under the app's PICARD CODE title. Keep it to ${LONGEST_CAPTION} characters.`);
      if (range.caption) add({ kind: "composition", composition: "caption", start: time + 0.2, duration: 4, track: 1 + (overlay++ % 2), variables: { text: range.caption } });
      // A bridge beep marks each cut through the waiting.
      if (!range.speech.length) chirp("beep-caption.mp3", time);
      time += duration;
    }
  };

  act("briefing", "The briefing");
  act("work", "Make it so");
  const site = edit.site.to - edit.site.from;
  add({ kind: "video", className: "site", src: "assets/site.mp4", start: time, duration: site, mediaStart: edit.site.from, track: 0 });
  time += site;

  chapters.push({ start: time, title: "Captain’s log" });
  add({ kind: "image", className: "still", src: "assets/captains-log.png", start: time, duration: SCENES.still, track: 0 });
  say("log-supplemental", time + 0.6, SCENES.still - 0.8);
  time += SCENES.still;

  scene("end", time, SCENES.end);
  sound("music-end.mp3", time, SCENES.end, 0.4, { track: 12, fadeIn: 0.5, fadeOut: 3 });
  time += SCENES.end;
  if (time > LONGEST_CUT + 0.01) {
    const whole = Math.round(time);
    throw new Error(`The cut runs ${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}; the storyboard allows 1:40 at most. Record shorter replies rather than cutting inside them.`);
  }
  add({ kind: "audio", src: "assets/hum.wav", start: 0, duration: time, volume: 0.12, track: 14, fadeIn: 2, fadeOut: 3 });

  speech.sort((a, b) => a.start - b.start);
  const captions = buildCaptions(speech.map((line, index) => ({
    start: line.start, duration: line.duration,
    text: index && speech[index - 1].speaker === line.speaker ? line.text : `${line.speaker}: ${line.text}`,
  })));
  return { clips, duration: time, chapters, captions };
}

/** Plain spoken words in order, for YouTube's automatic caption timing. */
export function transcript(captions) {
  return `${captions.map((cue) => cue.text.replace(/\n/g, " ")).join("\n")}\n`;
}

/**
 * The episode's captions retimed for a Short made of `ranges` (episode seconds) played one after another.
 * A range that cuts through a caption would cut through spoken words, so it is refused.
 */
export function shortCues(captions, ranges) {
  const cues = [];
  let offset = 0;
  for (const { from, to } of ranges) {
    if (!(to > from)) throw new Error(`The Short range ${from}–${to} s has no length.`);
    for (const cue of captions) {
      const inside = Math.min(cue.end, to) - Math.max(cue.start, from);
      if (inside <= 0.05) continue;
      if (cue.start < from - 0.05 || cue.end > to + 0.05) {
        throw new Error(`The Short range ${from}–${to} s cuts through the words "${cue.text.replace(/\n/g, " ")}".`);
      }
      cues.push({ start: offset + Math.max(cue.start, from) - from, end: offset + Math.min(cue.end, to) - from, text: cue.text });
    }
    offset += to - from;
  }
  return cues;
}

/** A vertical 1080×1920 Short: parts of the rendered episode in the middle, its title above, large captions below. */
export function shortComposition({ title, ranges, cues, source }) {
  let start = 0;
  const videos = ranges.map(({ from, to }, index) => {
    const clip = { id: `part-${index}`, kind: "video", className: "episode", src: source, start, duration: to - from, mediaStart: from, track: 0, audio: true };
    start += to - from;
    return clipElement(clip);
  });
  const lines = cues.map((cue, index) => `  <p id="cue-${index}" class="cue">${escape(cue.text.replace(/\s*\n\s*/g, " "))}</p>`);
  return `<!doctype html>
<!-- Made by video/youtube.mjs from the rendered episode. Do not edit by hand. -->
<html lang="en" data-resolution="portrait">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; font-family: "Oswald", sans-serif; }
  .elbow { position: absolute; left: 40px; top: 150px; width: 1000px; height: 120px; border: solid #ff9c33; border-width: 34px 0 0 150px; border-radius: 80px 0 0 0; }
  .elbow::after { content: ""; position: absolute; right: 0; top: -34px; width: 180px; height: 34px; background: #9999ff; }
  .tribute { position: absolute; left: 230px; right: 40px; top: 200px; color: #cc99cc; font-size: 30px; letter-spacing: .14em; text-transform: uppercase; line-height: 1.3; }
  .title { position: absolute; left: 40px; right: 40px; top: 360px; color: #ff9c33; font-size: 96px; font-weight: 700; line-height: 1.05; text-transform: uppercase; }
  video.episode { position: absolute; left: 0; top: 640px; width: 1080px; height: 608px; object-fit: contain; }
  .cue { position: absolute; left: 60px; right: 60px; top: 1300px; color: #fff; font-family: Arial, sans-serif; font-size: 52px; font-weight: 700; line-height: 1.3; text-align: center; opacity: 0; }
  .footer { position: absolute; left: 40px; right: 40px; bottom: 120px; display: flex; gap: 24px; align-items: center; color: #ffcc99; font-size: 40px; letter-spacing: .1em; }
  .footer::before { content: ""; width: 120px; height: 40px; border-radius: 20px 0 0 20px; background: #cc99cc; }
</style>
</head>
<body>
<div id="root" data-composition-id="short" data-start="0" data-duration="${round(start)}" data-width="1080" data-height="1920">
  <div class="elbow"></div>
  <p class="tribute">A tribute to Sir Patrick Stewart<br>and Captain Jean-Luc Picard</p>
  <h1 class="title">${escape(title)}</h1>
${videos.map((video) => `  ${video}`).join("\n")}
${lines.join("\n")}
  <p class="footer">PICARD CODE · NPX PICARD-CODE</p>
</div>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
${cues.map((cue, index) => `  tl.set("#cue-${index}", { opacity: 1 }, ${round(cue.start)}).set("#cue-${index}", { opacity: 0 }, ${round(cue.end)});`).join("\n")}
  tl.set({}, {}, ${round(start)});
  window.__timelines["short"] = tl;
</script>
</body>
</html>
`;
}

function wrapCaption(text) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > 42) throw new Error("A caption word is longer than one caption line.");
    if (line && `${line} ${word}`.length > 42) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line];
}

/** Splits exact spoken words into caption cues of at most two 42-character lines, timed by word count. */
export function buildCaptions(entries) {
  const cues = [];
  let previousEnd = 0;
  for (const { start, duration, text } of entries) {
    if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0 || !text?.trim()) {
      throw new Error("Each speech clip needs a start, a positive duration and its exact words.");
    }
    if (start < previousEnd) throw new Error("Speech clips overlap.");
    previousEnd = start + duration;
    const lines = wrapCaption(text);
    const groups = [];
    for (let index = 0; index < lines.length; index += 2) groups.push(lines.slice(index, index + 2).join("\n"));
    if (groups.length > 1 && groups.at(-1).split(/\s+/).length < 4) {
      const words = groups.slice(-2).join(" ").split(/\s+/);
      let balanced;
      let difference = Infinity;
      for (let split = 1; split < words.length; split++) {
        const parts = [wrapCaption(words.slice(0, split).join(" ")), wrapCaption(words.slice(split).join(" "))];
        const gap = Math.abs(split - (words.length - split));
        if (parts.every((part) => part.length <= 2) && gap < difference) {
          balanced = parts.map((part) => part.join("\n"));
          difference = gap;
        }
      }
      if (!balanced) throw new Error("The final caption cannot be balanced into two lines.");
      groups.splice(-2, 2, ...balanced);
    }
    const totalWords = text.split(/\s+/).length;
    let usedWords = 0;
    for (const caption of groups) {
      const from = start + duration * usedWords / totalWords;
      usedWords += caption.split(/\s+/).length;
      cues.push({ start: from, end: start + duration * usedWords / totalWords, text: caption });
    }
  }
  return cues;
}
