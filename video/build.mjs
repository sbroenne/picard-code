import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { draftEdit, frameList, layout, rootComposition, silences, speechTimes, transcript } from "./edit.mjs";
import { chapterList, srt } from "../tools/intro-episode.mjs";
import { formatStardate } from "../dist/shared/stardate.js";
import { COMPUTER_VOICES, CREW_VOICES } from "../dist/shared/crew-voices.js";
import { speechChunks } from "../dist/server/speech-bridge.js";

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "assets");
const argument = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const episode = resolve(process.argv[2] ?? "");
assert.ok(episode.startsWith(`${join(here, "out")}${sep}`) && existsSync(join(episode, "recording.json")),
  "Choose a finished recording under video/out, for example: node video/build.mjs video/out/episode-ABC123 --sounds ~/Downloads/sttng_geraeusche");
const collection = argument("--sounds");
assert.ok(collection && existsSync(collection), "Give the folder with the owner's sound collection: --sounds FOLDER. Its files are copied into the ignored video/assets folder only.");
const appSounds = join(homedir(), ".picard-code", "sounds");
assert.ok(existsSync(join(appSounds, "request-accepted.mp3")), "Start Picard Code once (or run npm run setup:sounds) so its computer sounds are downloaded.");

const recording = JSON.parse(await readFile(join(episode, "recording.json"), "utf8"));
const start = recording.frames[0].time;
const end = Math.max(recording.frames.at(-1).time, ...recording.turns.map((turn) => turn.settled ?? turn.spoken.end)) + 2;
await rm(assets, { recursive: true, force: true });
await mkdir(join(assets, "sounds"), { recursive: true });

console.log("Making the app footage from the recorded frames and sound.");
await writeFile(join(episode, "frames.txt"), frameList(recording.frames, end));
const audioOffset = start - recording.audioStart;
await execute("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(episode, "frames.txt"),
  ...(audioOffset >= 0 ? ["-ss", audioOffset.toFixed(3)] : ["-itsoffset", (-audioOffset).toFixed(3)]), "-i", join(episode, "audio.webm"),
  "-map", "0:v", "-map", "1:a", "-vf", "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
  "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", join(assets, "footage.mp4")], { maxBuffer: 1 << 26 });
await execute("ffmpeg", ["-y", "-loglevel", "error", "-i", join(episode, "site.webm"), "-an", "-vf", "fps=30,format=yuv420p",
  "-c:v", "libx264", "-crf", "16", join(assets, "site.mp4")]);
await copyFile(join(episode, "captains-log.png"), join(assets, "captains-log.png"));
assert.ok(existsSync(join(episode, "tribute.png")), "Record again: this take has no screen of the tribute record after Data's report.");
await copyFile(join(episode, "tribute.png"), join(assets, "tribute.png"));

const pauses = silences((await execute("ffmpeg", ["-hide_banner", "-nostats", "-i", join(assets, "footage.mp4"), "-af", "silencedetect=noise=-38dB:d=0.28", "-f", "null", "-"], { maxBuffer: 1 << 26 })).stderr);
const python = join(homedir(), ".picard-code", "voice", "bin", "python3");
const editFile = join(episode, "edit.json");
if (!existsSync(editFile)) {
  // What the app asked to be spoken, said again with the same local Kokoro voices to time every sentence.
  const said = recording.events.filter((event) => event.type === "speak");
  assert.ok(said.length, "This recording does not list what the app spoke. Record it again with tools/record-intro.mjs.");
  const pieces = said.flatMap((event, index) => event.parts.flatMap((part, at) => speechChunks(part.text).map((text) => ({
    event: index, part: at, text, speed: event.speed, voice: part.speaker ? CREW_VOICES[part.speaker].kokoro : COMPUTER_VOICES.kokoro,
  }))));
  await writeFile(join(episode, "pieces.json"), JSON.stringify(pieces));
  console.log(`Timing ${pieces.length} spoken pieces with local Kokoro.`);
  const measured = JSON.parse((await execute(python, [join(here, "measure.py"), join(episode, "pieces.json")], { maxBuffer: 1 << 26 })).stdout);
  const speech = said.map((event, index) => {
    const begun = recording.events.find((item) => item.type === "state" && item.phase === "speaking" && item.time >= event.time);
    assert.ok(begun, `The app was asked to speak at ${(event.time - start).toFixed(1)} s, but never started speaking.`);
    const parts = event.parts.map((part, at) => ({
      speaker: part.speaker,
      sentences: pieces.flatMap((piece, number) => piece.event === index && piece.part === at ? measured[number] : []),
    }));
    return { time: begun.time, parts: speechTimes(parts, begun.time) };
  });
  await writeFile(editFile, `${JSON.stringify(draftEdit(recording, pauses, formatStardate(new Date(start * 1000)), speech), null, 2)}\n`);
  console.log(`Wrote a first cut to ${editFile}. Review it against the frames; every segment is real footage, only waiting is left out.`);
}
const edit = JSON.parse(await readFile(editFile, "utf8"));

console.log("Speaking the Captain's log with the stock Kokoro Daniel voice.");
await mkdir(join(assets, "narration"));
const lines = Object.fromEntries(Object.entries(edit.narration).map(([name, text]) => [name, { voice: "bm_daniel", speed: 0.9, text }]));
await writeFile(join(episode, "narration.json"), JSON.stringify(lines, null, 2));
const spoken = JSON.parse((await execute(python, [join(here, "speak.py"), join(episode, "narration.json"), join(assets, "narration")])).stdout);

console.log("Copying sounds into the ignored video/assets folder.");
for (const name of ["request-accepted", "input-failed", "request-failed", "startup", "tribute-fact"]) {
  if (existsSync(join(appSounds, `${name}.mp3`))) await copyFile(join(appSounds, `${name}.mp3`), join(assets, "sounds", `app-${name}.mp3`));
}
const available = new Set(await readdir(collection));
for (const [from, to] of Object.entries(edit.sounds)) {
  assert.ok(available.has(from), `The sound collection has no ${from}.`);
  await copyFile(join(collection, from), join(assets, "sounds", to));
}

const lengths = {};
for (const name of await readdir(join(assets, "sounds"))) {
  const { stdout } = await execute("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(assets, "sounds", name)]);
  lengths[name] = Number(stdout.trim());
}
const plan = layout(edit, spoken, lengths);
await execute("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.6:seed=1701:duration=${plan.duration.toFixed(2)}`,
  "-f", "lavfi", "-i", `sine=frequency=55:duration=${plan.duration.toFixed(2)}`,
  "-filter_complex", "[0]lowpass=f=160,highpass=f=30[n];[1]volume=0.25[s];[n][s]amix=inputs=2:normalize=0,volume=0.5",
  "-ar", "48000", join(assets, "hum.wav")]);
await writeFile(join(here, "index.html"), rootComposition(plan.clips));

const out = join(episode, "youtube");
await mkdir(out, { recursive: true });
await writeFile(join(out, "chapters.txt"), `${chapterList(plan.chapters, plan.duration)}\n`);
await writeFile(join(out, "captions.srt"), srt(plan.captions));
await writeFile(join(out, "transcript.txt"), transcript(plan.captions));
console.log(`Built video/index.html (${plan.duration.toFixed(1)} s). Check it with: cd video && npm run check`);
