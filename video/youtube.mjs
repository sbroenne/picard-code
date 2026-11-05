// Makes the YouTube pack from a rendered episode: the thumbnail, and the description, titles,
// translations and upload settings.
// Usage: node video/youtube.mjs video/out/episode-XXXX
// Needs <episode>/picard-code-episode.mp4 (the render) and the app screenshot the thumbnail is drawn over.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { UPLOAD, checkSize, mediaSize } from "./quality.mjs";

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const episode = resolve(process.argv[2] ?? "");
const out = join(episode, "youtube");
const render = join(episode, "picard-code-episode.mp4");
assert.ok(existsSync(render), `Render the episode first: cd video && npm run render -- -o ${render}`);
checkSize("The render", await mediaSize(render), UPLOAD);
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

console.log("Drawing the thumbnail.");
const screen = join(episode, pack.thumbnail.over);
assert.ok(existsSync(screen), `${screen} is missing; the recorder saves it with each take.`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const image = `data:image/png;base64,${(await readFile(screen)).toString("base64")}`;
  await page.setContent(thumbnailPage({ ...pack.thumbnail, image }), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, "thumbnail.jpg"), type: "jpeg", quality: 92 });
  await page.screenshot({ path: join(out, "thumbnail.png") });
} finally {
  await browser.close();
}

console.log(`The YouTube pack is in ${out}.`);

// The real console stays bright as the frame. The tribute takes the conversation area; what the app does
// takes the status area beside the real microphone. Both still read at phone size.
function thumbnailPage({ kicker, headline, status, line, image }) {
  const html = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { position: relative; width: 1280px; height: 720px; overflow: hidden; background: #000 url(${image}) 0 0 / 1280px 720px; font-family: Oswald, sans-serif; text-transform: uppercase; }
  .clear { position: absolute; background: #000; }
  .kicker { position: absolute; left: 292px; top: 212px; color: #cc99cc; font-size: 38px; font-weight: 500; letter-spacing: .14em; }
  h1 { position: absolute; left: 286px; top: 262px; color: #cc99cc; font-size: 146px; font-weight: 700; line-height: .95; }
  .status { position: absolute; left: 560px; top: 594px; color: #ff9c33; font-size: 70px; font-weight: 700; letter-spacing: .06em; line-height: 1; }
  .line { position: absolute; left: 562px; top: 668px; color: #ffcc99; font-size: 28px; font-weight: 500; text-transform: none; }
</style></head><body>
<div class="clear" style="left:250px;top:200px;right:0;bottom:150px"></div><div class="clear" style="left:540px;top:585px;right:0;bottom:0"></div>
<div class="kicker">${html(kicker)}</div><h1>${headline.map(html).join("<br>")}</h1>
<div class="status">${html(status)}</div><div class="line">${html(line)}</div></body></html>`;
}
