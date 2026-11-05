/** The Captain's prepared lines for the recorded episode, in order. */
export const ORDERS = [
  { id: "computer", say: "Computer.", heard: undefined },
  { id: "briefing", say: "Number One and Mr Data, give me one short sentence each on your options for building a tribute site to Sir Patrick with a stardate clock.", heard: /one short sentence\W+each.*building at?\s?tribute site.*clock/i },
  { id: "engage", say: "Make it so, Number One.", heard: /make it so.*number one/i },
  { id: "report", say: "Mr Data, please run the tests and report in one sentence.", heard: /Data\W+please run the tests and report in one sentence/i },
];

/** The text Kokoro speaks for the Captain: no commas, because Smart Turn may end the turn at any pause. */
export function captainVoice(order) {
  return order.say.replace(/[,:;]/g, "");
}

/**
 * Shortens quiet gaps inside the Captain's generated voice (16-bit mono) to 120 ms.
 * The app checks whether a turn has ended after 200 ms of quiet, and Kokoro's
 * pauses between phrases are often longer, which ended orders halfway.
 */
export function tightenPauses(audio, rate, longest = 0.12) {
  const frame = Math.round(rate / 100) * 2;
  const frames = [];
  for (let start = 0; start < audio.length; start += frame) frames.push(audio.subarray(start, start + frame));
  const loud = frames.map((part) => {
    let sum = 0;
    for (let index = 0; index + 1 < part.length; index += 2) sum += part.readInt16LE(index) ** 2;
    return Math.sqrt(sum / (part.length / 2)) > 200;
  });
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (first < 0) return audio;
  const keep = Math.round(longest * 100);
  const kept = [];
  let quiet = 0;
  frames.forEach((part, index) => {
    quiet = loud[index] ? 0 : quiet + 1;
    if (index > first && index < last && quiet > keep) return;
    kept.push(part);
  });
  return Buffer.concat(kept);
}

/**
 * OpenCode settings for the demo project only. Command runs are granted
 * before the take, so no approval interrupts the episode; nothing else changes.
 */
export function demoPermissions() {
  return {
    $schema: "https://opencode.ai/config.json",
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
  };
}

/**
 * The text of the first approval, alert or warning visible on screen, or
 * undefined. The episode shows none, so the recorder stops and the take is
 * recorded again rather than cut around.
 */
export async function screenAlert(page) {
  const shown = page.locator(".approval, [data-alert], [role=alert]").filter({ visible: true });
  if (!(await shown.count())) return undefined;
  return (await shown.first().innerText()).trim() || "An empty alert";
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

/** The side-panel link and drawer for the Captain's log, as the app's own browser checks use them. */
export const CAPTAINS_LOG = { link: 'a[data-drawer-link="records"]', panel: "#drawer-records", entries: "#conversations > *" };
