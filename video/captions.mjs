import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function wrapCaption(text) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > 42) throw new Error("A caption word is too long for the clear space above the interface.");
    if (line && `${line} ${word}`.length > 42) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line];
}

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
      if (!balanced) throw new Error("The final caption cannot be balanced inside the clear space above the interface.");
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

function timestamp(seconds, separator = ".") {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds / 60000) % 60;
  const wholeSeconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}${separator}${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function captionComposition(html, cues) {
  const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const captionElements = cues.map((cue, index) =>
    `<p id="caption-${index}" class="caption" data-start="${cue.start}" data-duration="${cue.end - cue.start}" data-track-index="${100 + index}">${escape(cue.text)}</p>`).join("\n");
  const captionTimeline = `for (const caption of document.querySelectorAll(".caption")) {
    const start = Number(caption.dataset.start);
    tl.fromTo(caption, { opacity: 0 }, { opacity: 1, duration: 0.01 }, start);
    tl.set(caption, { opacity: 0 }, start + Number(caption.dataset.duration));
  }`;
  const rootEnd = "\n</div>\n<script src=";
  const timelineEnd = "window.__timelines = { main: tl };";
  if (!html.includes(rootEnd) || !html.includes(timelineEnd)) throw new Error("The video structure changed. Update caption placement before rendering.");
  return html
    .replaceAll('src="assets/', 'src="./')
    .replace("</style>", ".caption { position: absolute; z-index: 100; top: 24px; left: 100px; width: 1720px; margin: 0; color: #fff; font: 36px/1.2 Arial, sans-serif; text-align: center; text-transform: none; white-space: pre-line; }\n</style>")
    .replace(rootEnd, `\n${captionElements}${rootEnd}`)
    .replace(timelineEnd, `${captionTimeline}\n  ${timelineEnd}`);
}

async function prepare() {
  const folder = dirname(fileURLToPath(import.meta.url));
  const html = await readFile(join(folder, "index.html"), "utf8");
  const lengths = JSON.parse(await readFile(join(folder, "assets/lengths.json"), "utf8"));
  const words = JSON.parse(await readFile(join(folder, "assets/lines.json"), "utf8"));
  const entries = [];
  for (const [, name, start, duration] of html.matchAll(/<audio id="([^"]+)"[^>]+data-start="([^"]+)" data-duration="([^"]+)"/g)) {
    if (!Number.isFinite(lengths[name]) || Math.abs(lengths[name] - Number(duration)) > 0.03 || !words[name]) {
      throw new Error(`The measured speech length or words for ${name} do not match the video. Update its timing before rendering.`);
    }
    entries.push({ start: Number(start), duration: lengths[name], text: words[name] });
  }
  if (!entries.length || entries.length !== Object.keys(words).length) throw new Error("The video and speech script do not contain the same clips.");
  const cues = buildCaptions(entries);
  const total = Number(/id="root"[^>]+data-duration="([^"]+)"/.exec(html)?.[1]);
  if (!Number.isFinite(total) || cues.at(-1).end > total) throw new Error("The video duration is missing or ends before its speech.");
  const out = join(folder, "out");
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "picard-code.srt"), cues.map((cue, index) =>
    `${index + 1}\n${timestamp(cue.start, ",")} --> ${timestamp(cue.end, ",")}\n${cue.text}\n`).join("\n"));
  await writeFile(join(out, "picard-code.vtt"), "WEBVTT\n\n" + cues.map((cue) =>
    `${timestamp(cue.start)} --> ${timestamp(cue.end)} line:0% position:50% align:center\n${cue.text}\n`).join("\n"));
  await writeFile(join(folder, "assets/captioned.html"), captionComposition(html, cues));
  console.log(`Prepared ${cues.length} caption cues. Clip lengths match the composition; within-clip timing is estimated and needs a listening review.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare();
