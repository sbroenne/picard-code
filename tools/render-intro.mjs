import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { loadSpeech } from "../dist/server/speech.js";
import { speakable } from "../dist/shared/speech.js";
import { buildCaptions, captionComposition } from "../video/captions.mjs";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = resolve(process.argv[2] ?? "");
assert.ok(folder.startsWith(`${join(root, "video/out")}${sep}`), "Choose a recording folder under video/out.");
const recording = JSON.parse(await readFile(join(folder, "recording.json"), "utf8"));
const dataEndIndex = process.argv.indexOf("--data-end");
const dataEnd = dataEndIndex < 0 ? undefined : Number(process.argv[dataEndIndex + 1]);
if (dataEndIndex >= 0) assert.ok(Number.isFinite(dataEnd), "Give the measured end of Data's first paragraph, in seconds from the raw audio start.");
const offset = recording.frames[0].time - recording.audioStart;
assert.ok(Math.abs(offset) < 0.25, "Inspect the recording clocks before combining audio and pictures.");
const raw = join(folder, "app-recording.mp4");
const relative = (time) => time - recording.audioStart;
const dataTurn = recording.turns[0];
const geordiTurn = recording.turns[1];
const dataFrom = relative(dataTurn.transmitting) - 0.6;
const dataTo = dataEnd ?? relative(dataTurn.finished);
assert.ok(dataTo > dataFrom && dataTo <= relative(dataTurn.finished), "Data's excerpt must stay inside the real report.");

async function ffmpeg(args) {
  await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 8 * 1024 * 1024 });
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const captions = [];
const edits = [];
let elapsed = 0;
let browser;
let speech;
try {
  const frames = [];
  for (let index = 0; index < recording.frames.length; index++) {
    frames.push(`file 'frames/${recording.frames[index].file}'`, "option framerate 60");
    const end = recording.frames[index + 1]?.time ?? recording.frames[index].time + 1 / 24;
    frames.push(`duration ${Math.max(0.001, end - recording.frames[index].time).toFixed(6)}`);
  }
  frames.push(`file 'frames/${recording.frames.at(-1).file}'`, "option framerate 60");
  await writeFile(join(folder, "render-frames.txt"), `${frames.join("\n")}\n`);
  console.log("Combining timestamped actual browser frames with actual browser audio.");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", join(folder, "render-frames.txt"), "-i", join(folder, "audio.webm"),
    "-filter_complex", `[0:v]fps=24[v];[1:a]atrim=start=${Math.max(0, offset)},asetpts=PTS-STARTPTS[a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "19",
    "-c:a", "aac", "-b:a", "192k", "-shortest", raw]);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  async function image(name, content, imageFile) {
    const src = imageFile ? `data:image/png;base64,${(await readFile(join(folder, imageFile))).toString("base64")}` : undefined;
    await page.setContent(`<!doctype html><html><style>
      html,body {margin:0;background:#000;color:#ffcc99;font-family:Arial,sans-serif;}
      main {position:relative;width:1920px;height:1080px;overflow:hidden;}
      img {position:absolute;left:0;top:185px;width:1920px;height:895px;object-fit:cover;object-position:top;}
      .rail {position:absolute;left:80px;top:112px;width:1760px;height:20px;background:#ff9c33;border-radius:10px;}
      h1 {position:absolute;left:120px;top:230px;margin:0;font-size:142px;color:#ff9c33;letter-spacing:-.03em;}
      .lead {position:absolute;left:126px;top:436px;margin:0;font-size:70px;line-height:1.2;}
      .url {position:absolute;left:126px;top:770px;margin:0;font-size:46px;color:#cc99cc;}
      .note {position:absolute;left:126px;top:965px;margin:0;font-size:24px;color:#b3a8a0;}
      .banner {position:absolute;left:0;top:105px;width:1920px;height:80px;background:#000;text-align:center;font-weight:bold;font-size:38px;line-height:80px;color:#ffcc99;}
      </style><main>${src ? `<img src="${src}">` : ""}${content}</main></html>`);
    await page.screenshot({ path: join(folder, `${name}.png`) });
  }

  await image("opening", '<div class="banner">READY TO LAUNCH. REALLY?</div>', "before.png");
  await image("result", '<div class="banner">REAL REPAIR. THREE PASSING CHECKS.</div>', "after.png");
  await image("closing", '<div class="rail"></div><h1>PICARD CODE</h1><p class="lead">Your project.<br>Your bridge crew.<br>You have the conn.</p><p class="url">sbroenne.github.io/picard-code</p><p class="note">An unofficial tribute to Sir Patrick Stewart and Captain Jean-Luc Picard</p>');
  await image("wait", '<div style="position:absolute;left:0;top:24px;width:1920px;text-align:center;font:36px Arial;color:#ffcc99">WAIT SHORTENED</div>');
  await image("badge", '<div style="position:absolute;right:26px;top:92px;font:20px Arial;color:#b3a8a0">Prepared demo · real app</div>');
  await page.setViewportSize({ width: 1280, height: 720 });
  await image("thumbnail", `<style>
    main{width:1280px;height:720px;}img{left:530px;top:170px;width:730px;height:530px;object-fit:contain;}
    .rail{left:36px;top:36px;width:1208px;height:16px;}
    h1{left:60px;top:76px;font-size:96px;}
    .lead{left:60px;top:230px;font-size:54px;}
    .note{left:60px;top:635px;font-size:20px;}
    </style><div class="rail"></div><h1>PICARD CODE</h1>
    <p class="lead">Your bridge crew.<br>At your command.</p>
    <p style="position:absolute;left:60px;top:475px;font-size:28px;color:#cc99cc">No typing. Real repairs.</p>
    <p class="note">Actual app · prepared example</p>`, "geordi.png");

  speech = await loadSpeech({ listening: "nemotron", speaking: "kokoro" }, undefined, join(folder, "settings/speech.json"));
  assert.ok(speech, "Local speech must be prepared; saved choices will not be changed.");

  async function narrated(name, text, minimum) {
    const parts = [];
    for await (const part of speech.speak(text, AbortSignal.timeout(120000), { name: "bm_daniel" })) parts.push(part);
    const pcm = Buffer.concat(parts);
    const spokenDuration = pcm.length / 48000;
    const duration = Math.ceil(Math.max(minimum, spokenDuration + 0.5) * 24) / 24;
    await writeFile(join(folder, `${name}.wav`), wav(pcm));
    const file = `${name}.mp4`;
    await ffmpeg(["-loop", "1", "-framerate", "24", "-i", join(folder, `${name}.png`), "-i", join(folder, `${name}.wav`),
      "-t", String(duration), "-vf", "format=yuv420p", "-af", "apad", "-c:v", "libx264", "-threads", "2",
      "-preset", "fast", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1", join(folder, file)]);
    captions.push({ start: elapsed, duration: spokenDuration, text });
    edits.push({ file, duration, kind: "narrated card" });
    elapsed += duration;
  }

  async function footage(name, from, to, text, shortened = false) {
    const start = Math.max(0, from - offset);
    const duration = Math.ceil((to - from) * 24) / 24;
    assert.ok(duration > 0, "Each actual-footage cut needs a positive duration.");
    const file = `${name}.mp4`;
    const filter = "[0:v]scale=1536:960,pad=1920:1080:192:120:black[v];[1:v]format=rgba,colorkey=0x000000:0.05:0[overlay];[v][overlay]overlay=0:0,format=yuv420p[out]";
    await ffmpeg(["-ss", String(start), "-i", raw, "-loop", "1", "-framerate", "24", "-i", join(folder, `${shortened ? "wait" : "badge"}.png`),
      "-t", String(duration), "-filter_complex", filter, "-map", "[out]", "-map", "0:a",
      "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1", join(folder, file)]);
    if (text) captions.push({ start: elapsed + 0.25, duration: Math.max(0.1, duration - 0.55), text });
    edits.push({ file, duration, kind: "actual app", sourceStart: from, sourceEnd: to, shortenedWait: shortened });
    elapsed += duration;
  }

  await narrated("opening", "Ready to launch? Not with a failed checkout.", 4.5);
  await footage("captain-data", relative(dataTurn.spoken.start), relative(dataTurn.spoken.end) + 0.5, dataTurn.order);
  await footage("data-wait", relative(dataTurn.spoken.end) + 2, relative(dataTurn.spoken.end) + 4, undefined, true);
  const dataReport = dataTurn.screen.at(-1).split("Copy").slice(1).join("Copy").split("\nOn screen")[0];
  await footage("data-report", dataFrom, dataTo, speakable(dataEnd === undefined ? dataReport : dataReport.split("\n")[0]));
  await footage("captain-geordi", relative(geordiTurn.spoken.start), relative(geordiTurn.spoken.end) + 0.5, geordiTurn.order);
  await footage("geordi-wait", relative(geordiTurn.spoken.end) + 2, relative(geordiTurn.spoken.end) + 4, undefined, true);
  const geordiReport = geordiTurn.screen.at(-1).split("Copy").slice(1).join("Copy").split("\nOn screen")[0];
  await footage("geordi-report", relative(geordiTurn.transmitting) - 0.6, relative(geordiTurn.finished) + 0.5, speakable(geordiReport));
  await narrated("result", "A real repair. Three passing checks. All by voice.", 4.5);
  await narrated("closing", "Picard Code. Your project. Your bridge crew. You have the conn.", 6);

  await writeFile(join(folder, "edit.txt"), edits.map((edit) => `file '${edit.file}'`).join("\n") + "\n");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", join(folder, "edit.txt"), "-c", "copy", "-movflags", "+faststart", join(folder, "picard-code-real-intro.mp4")]);
  await ffmpeg(["-i", join(folder, "picard-code-real-intro.mp4"), "-an", "-c:v", "copy", join(folder, "intro-silent.mp4")]);
  await ffmpeg(["-i", join(folder, "picard-code-real-intro.mp4"), "-vn", "-ar", "48000", "-ac", "1", join(folder, "intro-audio.wav")]);
  const cues = buildCaptions(captions);
  const stamp = (seconds, separator) => {
    const milliseconds = Math.round(seconds * 1000);
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}${separator}${String(milliseconds % 1000).padStart(3, "0")}`;
  };
  await writeFile(join(folder, "picard-code.srt"), cues.map((cue, index) => `${index + 1}\n${stamp(cue.start, ",")} --> ${stamp(cue.end, ",")}\n${cue.text}\n`).join("\n"));
  await writeFile(join(folder, "picard-code.vtt"), "WEBVTT\n\n" + cues.map((cue) => `${stamp(cue.start, ".")} --> ${stamp(cue.end, ".")} line:0% position:50% align:center\n${cue.text}\n`).join("\n"));
  const composition = `<!doctype html><html><style>html,body{margin:0;background:black;}#root{position:relative;width:1920px;height:1080px;overflow:hidden;}video{width:1920px;height:1080px;}</style><div id="root" data-composition-id="main" data-start="0" data-duration="${elapsed}" data-width="1920" data-height="1080">
<video id="actual-app" src="intro-silent.mp4" muted data-start="0" data-duration="${elapsed}" data-track-index="0"></video>
<audio id="actual-browser-playback" src="intro-audio.wav" data-start="0" data-duration="${elapsed}" data-track-index="1"></audio>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script>const tl=gsap.timeline({paused:true});tl.to({}, {duration:${elapsed}});window.__timelines = { main: tl };</script></html>`;
  await writeFile(join(folder, "captioned.html"), captionComposition(composition, cues));
  await writeFile(join(folder, "edit.json"), JSON.stringify({ estimatedDuration: elapsed, edits, captions: cues, captionTiming: "Estimated within clips; review before upload.", dataExcerpt: dataEnd !== undefined }, null, 2));
  await writeFile(join(folder, "youtube-description.txt"), `Title: Picard Code: your project, your bridge crew\n\nYour dashboard says ready to launch. Checkout has failed. Take the conn.\n\nWatch Data find the mistake and Geordi repair the project through the actual Picard Code app. The repair passes all three original checks, and the browser now correctly blocks the launch. Checkout itself is still failing; the repair stops the board from reporting a false success.\n\nTry Picard Code: https://sbroenne.github.io/picard-code/\nSource: https://github.com/sbroenne/picard-code\n\nRecorded with real OpenCode 2 and ${recording.model}, real local Nemotron listening, Smart Turn, and Kokoro speaking. Picard Code supports multiple AI providers through OpenCode.\n\nThis is an edited prepared demo in an original example project. Requests use the stock Kokoro Daniel voice through the real browser microphone path; this is not a physical microphone recording. Data uses the app's stock Liam voice, and Geordi uses Echo. Their replies, code changes, and check results are real. Waiting is shortened and Data's report is excerpted. No actor's voice is cloned, and no television recordings or sounds are included. Caption times within clips are estimated and need a listening review before publication.\n\nPicard Code is an unofficial tribute to Sir Patrick Stewart and Captain Jean-Luc Picard. Star Trek and its characters are trademarks of their respective owners. This project is not affiliated with or endorsed by the rights holders.\n`);
  console.log(`Real-footage intro saved: ${join(folder, "picard-code-real-intro.mp4")} (${elapsed.toFixed(2)} seconds before frame rounding).`);
} finally {
  try { await speech?.close?.(); }
  finally { await browser?.close(); }
}
