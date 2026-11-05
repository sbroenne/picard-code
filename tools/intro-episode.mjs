/** The Captain's prepared lines for the recorded episode, in order. */
export const ORDERS = [
  { id: "computer", say: "Computer.", heard: undefined },
  { id: "picard", say: "Briefly, tell me about Captain Jean-Luc Picard.", heard: /Picard/i },
  { id: "stewart", say: "In brief, who was Sir Patrick Stewart before Star Trek?", heard: /St(e|u)w?art/i },
  { id: "options", say: "Number One, Geordi, Data and Doctor Crusher, options for a tribute site to Sir Patrick, with a stardate clock.", heard: /tribute site/i },
  { id: "organise", say: "Number One, how would you organise the crew to build it?", heard: /Number One|organi[sz]e/i },
  { id: "engage", say: "Make it so.", heard: /make it so/i },
];

/**
 * OpenCode settings for the demo project only. Commands ask first, so the
 * Captain makes a real Allow once decision on screen; nothing else changes.
 */
export function demoPermissions() {
  return {
    $schema: "https://opencode.ai/config.json",
    permissions: [{ action: "shell", resource: "*", effect: "ask" }],
  };
}

/**
 * Answers one waiting command approval with the real Allow once button, after
 * leaving it on screen long enough to read. An answered approval stays on
 * screen with its buttons disabled until the app refreshes, so only boxes with
 * a working button count, and the click waits until the app removes that box.
 * Returns undefined when nothing is waiting or OpenCode withdrew the request.
 */
export async function allowWaitingCommand(page, { pause = 2500, timeout = 30000, now = () => Date.now() } = {}) {
  const waiting = page.locator(".approval").filter({ has: page.locator("button:enabled", { hasText: "Allow once" }) });
  if (!(await waiting.first().isVisible())) return undefined;
  const command = (await waiting.first().locator("pre").innerText()).trim();
  const request = await waiting.first().innerText();
  await page.waitForTimeout(pause);
  const same = waiting.filter({ has: page.locator("pre", { hasText: command }) });
  if (!(await same.count())) return undefined;
  const before = await page.locator(".approval").filter({ has: page.locator("pre", { hasText: command }) }).count();
  const time = now();
  await same.first().getByRole("button", { name: "Allow once" }).click({ timeout });
  await page.waitForFunction(([text, count]) => [...document.querySelectorAll(".approval pre")]
    .filter((node) => node.textContent.includes(text)).length < count, [command, before], { timeout });
  return { time, request, command };
}

/**
 * A recording event for a message the page sent over the speech connection: what it asked to be spoken, as
 * parts with their speakers, or a turn check. Other messages give undefined.
 */
export function sentEvent(payload, time) {
  const sent = JSON.parse(payload);
  if (sent.type === "check-turn") return { time, type: "check-turn" };
  if (sent.type !== "speak") return undefined;
  return { time, type: "speak", parts: sent.parts ?? [{ text: sent.text }], speed: sent.speed ?? 1 };
}

/** Formats seconds as YouTube's m:ss chapter time. */
export function chapterTime(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Builds the YouTube chapter list. YouTube only shows chapters when the first
 * starts at 0:00, there are at least three, and each lasts ten seconds or more.
 */
export function chapterList(chapters, total) {
  if (chapters.length < 3) throw new Error("YouTube needs at least three chapters.");
  if (chapters[0].start !== 0) throw new Error("The first chapter must start at 0:00.");
  return chapters.map((chapter, index) => {
    const end = chapters[index + 1]?.start ?? total;
    if (end - chapter.start < 10) throw new Error(`Chapter "${chapter.title}" is shorter than ten seconds.`);
    return `${chapterTime(chapter.start)} ${chapter.title}`;
  }).join("\n");
}

/** Formats seconds as an SRT time stamp. */
export function srtTime(seconds) {
  const total = Math.round(seconds * 1000);
  const part = (value, size = 2) => String(value).padStart(size, "0");
  return `${part(Math.floor(total / 3600000))}:${part(Math.floor(total / 60000) % 60)}:${part(Math.floor(total / 1000) % 60)},${part(total % 1000, 3)}`;
}

/** Writes caption cues as SRT, rejecting overlapping or empty cues. */
export function srt(cues) {
  return cues.map((cue, index) => {
    if (!(cue.end > cue.start)) throw new Error(`Caption ${index + 1} has no duration.`);
    if (index && cue.start < cues[index - 1].end) throw new Error(`Caption ${index + 1} overlaps the one before.`);
    return `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`;
  }).join("\n");
}

/** Reads SRT written by srt() back into cues, in seconds. */
export function readSrt(text) {
  const seconds = (stamp) => {
    const [, h, m, s, ms] = stamp.match(/^(\d+):(\d\d):(\d\d),(\d{3})$/) ?? [];
    if (h === undefined) throw new Error(`"${stamp}" is not an SRT time stamp.`);
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  return text.trim().split(/\n\n+/).map((block) => {
    const [, times, ...lines] = block.split("\n");
    const [start, end] = times.split(" --> ");
    return { start: seconds(start), end: seconds(end), text: lines.join("\n") };
  });
}
