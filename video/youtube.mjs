// Makes the YouTube pack from a rendered episode: three thumbnails, and the description, titles,
// translations and upload settings.
// Usage: node video/youtube.mjs video/out/episode-XXXX
// Needs <episode>/picard-code-episode.mp4 (the render) and <episode>/youtube/picks.json, which names the
// episode second each thumbnail is drawn over, for example:
// { "thumbnails": { "never-type": 35, "make-it-so": 52, "tribute": 88 } }
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const episode = resolve(process.argv[2] ?? "");
const out = join(episode, "youtube");
const render = join(episode, "picard-code-episode.mp4");
assert.ok(existsSync(render), `Render the episode first: cd video && npx --yes hyperframes@0.9.15 render -o ${render}`);
assert.ok(existsSync(join(out, "picks.json")), `Write ${join(out, "picks.json")} first; see the top of video/youtube.mjs.`);
const picks = JSON.parse(await readFile(join(out, "picks.json"), "utf8"));
const pack = JSON.parse(await readFile(join(here, "youtube.json"), "utf8"));
const chapters = (await readFile(join(out, "chapters.txt"), "utf8")).trim().split("\n").map((line) => {
  const [, time, title] = line.match(/^(\d+:\d\d) (.+)$/);
  return { time, title };
});

// YouTube turns loud videos down to about -14 LUFS but never turns quiet ones up, so bring the sound to that
// level here, measuring first so the second pass is linear. The picture is copied unchanged.
console.log("Bringing the sound to YouTube's loudness.");
const upload = join(out, "picard-code-episode.mp4");
const target = "I=-14:TP=-1:LRA=11";
const { stderr } = await execute("ffmpeg", ["-hide_banner", "-nostats", "-i", render, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { maxBuffer: 1 << 26 });
const block = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
assert.ok(block, `ffmpeg did not report the loudness:\n${stderr.slice(-2000)}`);
const measured = JSON.parse(block[0]);
await execute("ffmpeg", ["-y", "-loglevel", "error", "-i", render, "-map", "0", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart",
  "-af", `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`, upload]);
console.log(`  ${measured.input_i} LUFS before; upload ${upload}`);

console.log("Writing the description, titles, translations and upload settings.");
const list = (titles) => titles.map((title, index) => `${chapters[index].time} ${title}`).join("\n");
const describe = (lines, titles) => `${lines.join("\n").replace("{chapters}", list(titles))}\n`;
await writeFile(join(out, "description.txt"), describe(pack.description, chapters.map((chapter) => chapter.title)));
for (const [language, text] of Object.entries(pack.translations)) {
  assert.equal(text.chapters.length, chapters.length, `The ${language} translation needs ${chapters.length} chapter titles.`);
  await writeFile(join(out, `description-${language}.txt`), describe(text.description, text.chapters));
}
await writeFile(join(out, "upload.txt"), [
  "Titles for Test & Compare:", ...pack.titles.map((title) => `- ${title}`), "",
  "Translated titles:", ...Object.entries(pack.translations).map(([language, text]) => `- ${language}: ${text.title}`), "",
  `Tags: ${pack.tags.join(", ")}`, "",
  ...pack.settings, "",
  `Pinned comment: ${pack.pinned}`, "",
].join("\n"));

console.log("Drawing the thumbnails.");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  for (const thumbnail of pack.thumbnails) {
    const at = picks.thumbnails?.[thumbnail.id];
    assert.ok(Number.isFinite(at), `picks.json names no episode second for the ${thumbnail.id} thumbnail.`);
    const frame = join(out, `frame-${thumbnail.id}.png`);
    await execute("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(at), "-i", upload, "-frames:v", "1", "-vf", "scale=1280:720", frame]);
    const image = `data:image/png;base64,${(await readFile(frame)).toString("base64")}`;
    await page.setContent(thumbnailPage({ ...thumbnail, image }), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `thumbnail-${thumbnail.id}.jpg`), type: "jpeg", quality: 90 });
  }
} finally {
  await browser.close();
}

console.log(`The YouTube pack is in ${out}.`);

function thumbnailPage({ headline, kicker, image }) {
  const html = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\S+-\S+/g, (word) => `<span class="whole">${word}</span>`);
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; height: 720px; overflow: hidden; background: #000 url(${image}) center / cover; font-family: Oswald, sans-serif; text-transform: uppercase; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0,0,0,.94) 0%, rgba(0,0,0,.9) 62%, rgba(0,0,0,.45) 100%); }
  .whole { white-space: nowrap; }
  .elbow { position: absolute; left: 40px; top: 40px; width: 1200px; height: 640px; border: solid #ff9c33; border-width: 30px 0 0 110px; border-radius: 70px 0 0 0; }
  .elbow::after { content: ""; position: absolute; left: -110px; bottom: 0; width: 110px; height: 150px; background: #cc99cc; border-radius: 0 0 0 40px; }
  .cap { position: absolute; right: 40px; top: 40px; width: 220px; height: 30px; background: #9999ff; border-radius: 0 15px 15px 0; }
  h1 { position: absolute; left: 190px; right: 60px; top: 170px; color: #ff9c33; font-size: 124px; font-weight: 700; line-height: 1; text-shadow: 0 4px 18px #000; }
  p { position: absolute; left: 194px; right: 120px; top: 470px; color: #ffcc99; font-size: 40px; font-weight: 500; line-height: 1.2; letter-spacing: .04em; text-shadow: 0 2px 10px #000; }
  .name { position: absolute; left: 194px; bottom: 60px; color: #cc99cc; font-size: 34px; letter-spacing: .14em; }
</style></head><body><div class="shade"></div><div class="elbow"></div><div class="cap"></div>
<h1>${html(headline)}</h1><p>${html(kicker)}</p><div class="name">Picard Code · Built on OpenCode 2</div></body></html>`;
}
