import { test, expect } from "@playwright/test";
import { copyFile, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { TRIBUTE_ENTRIES } from "../src/shared/tribute-data";
import { formatStardate } from "../src/shared/stardate";
import type { ChatMessage } from "../src/shared/types";

const folder = resolve(`.picard-test-voice-audio-${process.pid}`);
const microphoneFile = join(folder, "utterance.wav");
const soundFolder = join(folder, "sounds");
// Silent stand-ins for the downloaded sounds; each has its own length so the test can tell them apart.
const SOUND_LENGTHS = { startup: 0.2, "request-accepted": 0.3, "input-failed": 0.4, "request-failed": 0.6, "tribute-fact": 0.5 };
// Simulated speaker output keeps the browser's audio clock running even when this computer's real speakers are unavailable.
test.use({ permissions: ["microphone"], launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-audio-output",
  `--use-file-for-fake-audio-capture=${microphoneFile}`,
] } });
function wave(rate: number, audio: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(audio.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}
test.beforeAll(async () => {
  await mkdir(folder);
  await mkdir(soundFolder);
  for (const [name, seconds] of Object.entries(SOUND_LENGTHS)) await writeFile(join(soundFolder, `${name}.mp3`), wave(24000, Buffer.alloc(24000 * 2 * seconds)));
  const rate = 48000;
  // Leave time for the answer and optional story invitation before a follow-up without "Computer".
  const audio = Buffer.alloc(rate * 2 * 8);
  for (let index = rate / 2; index < rate * 1.5; index++) audio.writeInt16LE(Math.round(Math.sin(index / rate * 240 * 2 * Math.PI) * 6000), index * 2);
  await writeFile(microphoneFile, wave(rate, audio));
});
test.afterAll(async () => { await rm(folder, { recursive: true }); });

async function launch(page: import("@playwright/test").Page, mode?: "resume" | "approval" | "question" | "unclear" | "slow" | "long" | "choose" | "unsafe" | "fresh" | "sleep" | "separate" | "tribute" | "picard" | "picard-decline" | "stewart" | "stewart-about" | "picard-story" | "repo" | "crew" | "briefing" | "briefing-failure" | "briefing-recovered" | "briefing-repeat" | "briefing-late-failure" | "briefing-copy" | "briefing-filename" | "briefing-failure-copy" | "briefing-failure-only" | "briefing-parent-failure" | "officer" | "news" | "interrupt" | "interrupt-room" | "interrupt-approval" | "interrupt-request" | "interrupt-final" | "no-speech" | "example" | "showcase" | "broken" | "missing-outcome") {
  // Record each computer sound that starts, and the voice status at that moment.
  await page.addInitScript((lengths) => {
    const decoded = new WeakSet<AudioBuffer>();
    const plays: string[] = [];
    const timeline: { name: string; at: number; end: number; capture: boolean; visibleErrors: string[] }[] = [];
    let capture = false;
    Object.assign(window, { acceptedSounds: plays, audioTimeline: timeline });
    const node = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends node {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args);
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: unknown) => {
          if (typeof message === "boolean") capture = message;
          post(message);
        };
      }
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (this: BaseAudioContext, data: ArrayBuffer) {
      const buffer = await decode.call(this, data);
      decoded.add(buffer);
      return buffer;
    } as typeof decode;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<typeof start>) {
      const buffer = this.buffer;
      let name = "speech";
      if (buffer && decoded.has(buffer)) {
        name = Object.entries(lengths).find(([, seconds]) => Math.abs(seconds - buffer.duration) < 0.02)?.[0] ?? "unknown";
        plays.push(`${name}: ${document.querySelector("#status")?.textContent ?? ""}`);
      }
      if (buffer) timeline.push({
        name, at: this.context.currentTime, end: Math.max(args[0] ?? 0, this.context.currentTime) + buffer.duration, capture,
        visibleErrors: [...document.querySelectorAll(".message-error")].map((node) => node.textContent ?? ""),
      });
      return start.apply(this, args);
    };
  }, SOUND_LENGTHS);
  const child = spawn(process.execPath, ["dist/tests/browser-launch.js", ...(mode === "no-speech" ? [] : ["--speech"]), "--sounds", soundFolder, ...(mode ? [`--${mode}`] : [])], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/.exec(output);
      if (match) resolve(match[0]);
    });
    child.on("exit", () => reject(new Error("The speech test server stopped.")));
  });
  page.on("close", () => child.kill());
  await page.goto(url);
  // No note or agreement step: the main screen opens straight away.
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect(status(page)).not.toHaveText("Starting up", { timeout: 15000 });
}

function status(page: import("@playwright/test").Page) {
  return page.getByRole("status");
}

/** Listening starts by itself; if the browser wants a click before playing sound, one click on the visible status text gives it. */
async function startListening(page: import("@playwright/test").Page) {
  await expect.poll(async () => `${await status(page).textContent()} ${await page.locator("#status-detail").textContent()}`, { timeout: 15000 })
    .toMatch(/Standing by|Listening|Understanding|Click anywhere/);
  if ((await page.locator("#status-detail").textContent())?.includes("Click anywhere")) await page.locator("#status-detail").click();
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding/, { timeout: 15000 });
}

type Spoken = { text: string; speaker?: string }[];
/** Each spoken answer, as the parts sent for speaking; a plain answer is one part in the computer's voice. */
function spokenParts(page: import("@playwright/test").Page) {
  const spoken: Spoken[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload !== "string") return;
    const data = JSON.parse(payload);
    if (data.type === "speak") spoken.push(data.parts ?? [{ text: data.text }]);
  }));
  return spoken;
}

function spokenText(page: import("@playwright/test").Page) {
  const spoken: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload !== "string") return;
    const data = JSON.parse(payload);
    if (data.type === "speak") spoken.push(data.text ?? data.parts.map((part: { text: string }) => part.text).join(" "));
  }));
  return spoken;
}

function sounds(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds.filter((sound) => !sound.startsWith("startup:")));
}

/** Hold a speaking request before the test voice can produce any audio. */
async function holdSpeaking(page: import("@playwright/test").Page) {
  let pending: { message: string; server: import("@playwright/test").WebSocketRoute; browser: import("@playwright/test").WebSocketRoute; at: number } | undefined;
  await page.routeWebSocket("**/api/speech", (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => {
      if (typeof message === "string" && JSON.parse(message).type === "speak") {
        pending = { message, server, browser, at: Date.now() };
      } else server.send(message);
    });
  });
  return {
    pending: () => pending,
    release: () => {
      if (!pending) throw new Error("No speaking request is waiting.");
      pending.server.send(pending.message);
      pending = undefined;
    },
    fail: (message: string) => {
      if (!pending) throw new Error("No speaking request is waiting.");
      pending.browser.send(JSON.stringify({ type: "error", message }));
      pending = undefined;
    },
    staleSpeaking: () => {
      if (!pending) throw new Error("No speaking request is waiting.");
      pending.browser.send(JSON.stringify({ type: "state", phase: "speaking" }));
    },
    startWithoutAudio: () => {
      if (!pending) throw new Error("No speaking request is waiting.");
      const { id } = JSON.parse(pending.message) as { id: number };
      pending.browser.send(JSON.stringify({ type: "audio-start", rate: 24000, id }));
    },
  };
}

test.setTimeout(60000);

test("briefing reports stay in one log entry; officer approvals require a button and findings are spoken only when the briefing ends", async ({ page }) => {
  const spoken = spokenText(page);
  const parts = spokenParts(page);
  await launch(page, "crew");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Geordi needs your decision.", { exact: true })).toBeVisible();
  await expect(page.locator(".crew-report")).toContainText("Data supplied an investigation report.");
  expect(spoken.some((text) => text.includes("Data supplied"))).toBe(false);
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report)")).toContainText("Geordi's action was denied", { timeout: 15000 });
  await expect.poll(() => spoken.filter((text) => text.includes("Geordi's action was denied")).length).toBe(1);
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report) .message-header strong")).toHaveText("Computer");
  expect(parts.at(-1)).toEqual([
    { text: expect.stringContaining("Data supplied an investigation report."), speaker: "picard-data" },
    { text: expect.stringContaining("Geordi's action was denied") },
  ]);
  await expect(page.locator("#approvals")).toBeEmpty();
});

test("a request for one officer is handed to that officer, who answers in the conversation; the answer is spoken once in that officer's voice", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "officer");
  await startListening(page);
  const answer = page.locator(".message.current[data-role=assistant]");
  await expect(answer).toContainText("Test stand-in: Captain, the cache is stale.", { timeout: 20000 });
  await expect(answer).toHaveCount(1);
  await expect(answer.locator(".message-header strong")).toHaveText("Data");
  await expect.poll(() => spoken.filter((answer) => answer.some((part) => part.text.includes("the cache is stale"))).length, { timeout: 15000 }).toBe(1);
  expect(spoken.find((answer) => answer.some((part) => part.text.includes("the cache is stale")))).toEqual([expect.objectContaining({ speaker: "picard-data" })]);
  await expect(page.locator(".crew-report")).toHaveCount(0);
});

test("after a briefing, each officer's finding is spoken in their own voice, then the computer closes", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "crew");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect.poll(() => spoken.find((answer) => answer.some((part) => part.text.includes("reports are collected"))), { timeout: 15000 }).toEqual([
    { text: "Test stand-in: Data supplied an investigation report.", speaker: "picard-data" },
    { text: expect.stringContaining("the briefing reports are collected") },
  ]);
});

test("Riker has the last word in a briefing without a repeated computer close", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing");
  await startListening(page);
  await expect(page.locator(".message.current[data-role=assistant]")).toHaveCount(3, { timeout: 20000 });
  const officerNames = page.locator(".crew-report .message-header strong");
  await expect(officerNames).toHaveCount(2);
  await expect(officerNames.filter({ hasText: /^Data$/ })).toHaveCount(1);
  await expect(officerNames.filter({ hasText: /^Riker$/ })).toHaveCount(1);
  await expect(page.locator(".crew-report .message-header small")).toHaveCount(0);
  await expect(page.locator(".crew-report .copy-button")).toHaveCount(2);
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toEqual([
    { text: "Test stand-in: Data found a small repair.", speaker: "picard-data" },
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I proceed?", speaker: "picard-riker" },
  ]);
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report)")).toContainText("The recommendation is waiting for your decision.");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("Riker's spoken question keeps a filename while the screen keeps its exact spelling", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-filename");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: Data found a small repair.", speaker: "picard-data" },
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I update retry policy dot ts?", speaker: "picard-riker" },
  ]);
  const rikerReport = page.locator(".crew-report").filter({ has: page.getByText("Riker", { exact: true }) });
  await expect(rikerReport).toContainText("Shall I update retry_policy.ts?");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a briefing speaks the computer's close when an officer's action was denied after a partial report", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-failure");
  await startListening(page);
  await expect(page.locator(".message.current[data-role=assistant]")).toHaveCount(3, { timeout: 20000 });
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toEqual([
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I proceed?", speaker: "picard-riker" },
    { text: "Test stand-in: Data's action was denied. No command was run." },
  ]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a recovered officer action does not make the computer repeat a successful briefing", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-recovered");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: Data found a small repair.", speaker: "picard-data" },
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I proceed?", speaker: "picard-riker" },
  ]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a second report from the same officer does not hide a different failed assignment", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-repeat");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: Data found a small repair.", speaker: "picard-data" },
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I proceed?", speaker: "picard-riker" },
    { text: "Test stand-in: Data's action was denied. No command was run." },
  ]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("an earlier successful step does not hide the officer's final failed action", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-late-failure");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I proceed?", speaker: "picard-riker" },
    { text: "Test stand-in: Data's action was denied. No command was run." },
  ]);
  await expect(page.getByText("Test stand-in: Data completed an earlier step.", { exact: true })).toBeVisible();
  await expect(page.locator(".crew-report .message-error")).toContainText("The user declined this tool call");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a copied computer close cannot replace the officers' own spoken reports", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-copy");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: Data found a small repair.", speaker: "picard-data" },
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I proceed?", speaker: "picard-riker" },
  ]);
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report)")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a copied computer close cannot hide an officer's failed action", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-failure-copy");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: I recommend the smaller repair, Captain. Shall I proceed?", speaker: "picard-riker" },
    { text: "Data did not finish. Request denied. The action was not carried out." },
  ]);
  await expect(page.locator(".crew-report .message-error")).toContainText("The user declined this tool call");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("an interrupted officer's partial report is explained even without a computer close", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-failure-only");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Data did not finish. Request denied. The action was not carried out." },
  ]);
  await expect(page.locator(".crew-report .message-error")).toContainText("The user declined this tool call");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a copied computer reply does not hide its own failed action", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-parent-failure");
  await startListening(page);
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report) .message-error"))
    .toContainText("The user declined this tool call", { timeout: 20000 });
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toEqual([
    { text: "Request denied. The action was not carried out." },
  ]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("while work runs, the conversation says who is working and what they are doing; a step that failed on the way is folded away", async ({ page }) => {
  await launch(page, "news");
  await startListening(page);
  const working = page.locator("#working");
  await expect(working).toBeVisible({ timeout: 20000 });
  await expect(working).toContainText("Data is working on it.");
  await expect(working).toContainText("Searching the web.");
  // The working line sits right after the latest request, in the conversation, not in the console.
  const request = (await page.locator(".message.current[data-role=user]").boundingBox())!;
  const line = (await working.boundingBox())!;
  expect(line.y).toBeGreaterThan(request.y);
  await expect(page.locator(".message-error")).toHaveCount(0);
  await expect(page.locator(".step-failures summary")).toHaveText("1 step did not work");
  await expect(page.locator(".message.current[data-role=assistant]").last()).toContainText("Test stand-in: Captain, no real news was searched.", { timeout: 15000 });
  await expect(page.locator(".message.current[data-role=assistant] .message-header strong").last()).toHaveText("Data");
  await expect(working).toBeHidden();
  // The real error stays readable, word for word, when opened.
  const note = page.locator(".step-failures");
  await expect(note.locator(".step-failure")).toBeHidden();
  await note.locator("summary").click();
  await expect(note.locator(".step-failure")).toContainText("403 GET https://example.com/news");
  await expect(page.locator(".message-error")).toHaveCount(0);
});

test("with the Bridge crew off, an officer request goes to the computer", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("picard-bridge-enabled", "false"));
  await launch(page, "crew");
  await expect(page.getByRole("switch", { name: "Bridge crew", exact: true })).not.toBeChecked();
  const sent = page.waitForRequest((request) => request.url().endsWith("/send"));
  await startListening(page);
  expect((await sent).postDataJSON()).toMatchObject({ text: "Computer, have Data and Geordi look at the repair", bridge: false });
  await expect(page.locator(".message.current[data-role=assistant]").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".message.current[data-role=assistant] .message-header strong").first()).toHaveText("Computer");
  await expect(page.getByText("Geordi needs your decision.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".crew-report")).toHaveCount(0);
});

test("crew activity and decisions return after reload, and Belay that stops the related work", async ({ page }) => {
  await launch(page, "crew");
  await startListening(page);
  await expect(page.getByText("Geordi needs your decision.", { exact: true })).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(page.getByText("Geordi needs your decision.", { exact: true })).toBeVisible();
  await expect(page.locator(".crew-report")).toContainText("Data supplied an investigation report.");
  await page.getByRole("button", { name: "Switch microphone off", exact: true }).click();
  await page.getByRole("button", { name: "Belay that", exact: true }).click();
  await expect(page.locator("#approvals")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Belay that", exact: true })).toBeHidden();
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report)")).toContainText("Work stopped before it finished.");
});

test("Computer interrupts playback, then the next request keeps its exact words", async ({ page }) => {
  const commands: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string") commands.push(JSON.parse(payload).type);
  }));
  const stoppedWork: string[] = [];
  page.on("request", (request) => { if (/\/conversations\/[^/]+\/stop$/.test(request.url())) stoppedWork.push(request.url()); });
  await launch(page, "interrupt");
  await startListening(page);
  await expect(status(page)).toHaveText("Speaking", { timeout: 15000 });
  await expect.poll(() => commands.includes("stop-speaking"), { timeout: 15000 }).toBe(true);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Keep the exact name and do not change files.", { timeout: 15000 });
  expect(stoppedWork).toEqual([]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const mode of ["interrupt-request", "interrupt-final"] as const) {
test(`${mode}: a request spoken over an answer keeps Computer and the exact words`, async ({ page }) => {
  const commands: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string") commands.push(JSON.parse(payload).type);
  }));
  await launch(page, mode);
  await startListening(page);
  await expect(status(page)).toHaveText("Speaking", { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Computer, keep the exact name and do not change files.");
  expect(commands).toContain("stop-speaking");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});
}

test("room speech during playback is ignored even within a log entry", async ({ page }) => {
  const commands: string[] = [];
  const transcripts: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload === "string") commands.push(JSON.parse(payload).type);
    });
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") {
        const event = JSON.parse(payload);
        if (event.type === "transcript") transcripts.push(event.text);
      }
    });
  });
  await launch(page, "interrupt-room");
  await startListening(page);
  await expect(status(page)).toHaveText("Speaking", { timeout: 15000 });
  await expect.poll(() => transcripts.includes("Hello again"), { timeout: 15000 }).toBe(true);
  await expect(status(page)).toHaveText("Speaking");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  expect(commands).not.toContain("stop-speaking");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const muted of [false, true]) {
test(`clicking the computer panel interrupts speech with the microphone ${muted ? "off" : "on"}`, async ({ page }) => {
  await launch(page, "interrupt-room");
  await startListening(page);
  await expect(status(page)).toHaveText("Speaking", { timeout: 15000 });
  if (muted) await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.locator("#status").click();
  await expect(status(page)).toHaveText(muted ? "Microphone off" : "Standing by");
  await expect(page.getByRole("button", { name: `Switch microphone ${muted ? "on" : "off"}` })).toBeVisible();
  if (!muted) await page.getByRole("button", { name: "Switch microphone off" }).click();
});
}

test("a spoken interruption cannot approve an action", async ({ page }) => {
  const decisions: string[] = [];
  const spoken = spokenText(page);
  page.on("request", (request) => { if (request.method() === "POST" && /\/permissions\//.test(request.url())) decisions.push(request.url()); });
  await launch(page, "interrupt-approval");
  await startListening(page);
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible({ timeout: 15000 });
  await expect.poll(() => spoken.includes("A decision is needed first. Choose Allow once or Deny on screen."), { timeout: 15000 }).toBe(true);
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  expect(decisions).toEqual([]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("the arrival call plays once at startup, not when switching the microphone or starting a new log entry", async ({ page }) => {
  await launch(page);
  await startListening(page);
  const arrivals = () => page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds.filter((sound) => sound.startsWith("startup:")));
  await expect.poll(arrivals).toHaveLength(1);
  expect((await arrivals())[0]).toMatch(/^startup: (Ready|Starting microphone|Standing by)$/);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Switch microphone on" }).click();
  await startListening(page);
  await page.getByRole("button", { name: "New log entry", exact: true }).click();
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding/, { timeout: 15000 });
  expect(await arrivals()).toHaveLength(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.reload();
  await startListening(page);
  await expect.poll(arrivals).toHaveLength(1);
  expect((await arrivals())[0]).toMatch(/^startup: (Ready|Starting microphone|Standing by)$/);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a missing arrival sound is reported, without preventing listening", async ({ page }) => {
  await page.route("**/api/sounds/startup", (route) => route.fulfill({ status: 404, body: "This sound is not set up." }));
  await launch(page);
  await expect(page.getByText("The startup sound could not be loaded: HTTP 404. Restart Picard Code to check and download its sounds.", { exact: true })).toBeVisible();
  await startListening(page);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("the arrival call waits for a click and works before speech is set up", async ({ playwright }) => {
  const browser = await playwright.chromium.launch({ args: [
    "--disable-audio-output", "--autoplay-policy=document-user-activation-required",
    "--disable-features=MediaEngagementBypassAutoplayPolicies,AutoplayIgnoreWebAudio",
  ] });
  try {
    const page = await browser.newPage();
    // Headless Chromium can allow autoplay despite its policy flags; hold audio until a real click.
    await page.addInitScript(() => {
      // Playwright's own page calls count as user activation, so wait for a real click instead.
      let clicked = false;
      window.addEventListener("pointerdown", (event) => { if (event.isTrusted) clicked = true; }, true);
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        private suspended: Promise<void>;
        constructor(options?: AudioContextOptions) {
          super(options);
          this.suspended = this.suspend();
        }
        // The suspend above finishes later, so report the context as suspended until a real click.
        override get state() {
          return clicked ? super.state : "suspended";
        }
        override resume() {
          return clicked ? this.suspended.then(() => super.resume()) : Promise.resolve();
        }
      };
    });
    await launch(page, "no-speech");
    const played = () => page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds);
    expect(await played()).toEqual([]);
    await page.locator("#voice-console").click();
    await expect.poll(played).toEqual(["startup: Standing by"]);
    await expect(page.locator("#voice-setup-hint")).toBeVisible();
  } finally { await browser.close(); }
});

test("a slow arrival sound never interrupts a spoken request", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((done) => { release = done; });
  await page.route("**/api/sounds/startup", async (route) => { await ready; await route.continue(); });
  await launch(page);
  await startListening(page);
  await expect(status(page)).toHaveText("Listening");
  release();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  const arrivals = await page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds.filter((sound) => sound.startsWith("startup:")));
  expect(arrivals).toEqual([]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("listening stays on; “Computer” starts a task, follow-ups need no “Computer”; the app always opens listening", async ({ page }, info) => {
  // A random tribute fact could follow the second answer and add its sound.
  await page.addInitScript(() => localStorage.setItem("picard-tribute-enabled", "false"));
  await launch(page);
  await expect(page.getByRole("button", { name: "Start listening" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(status(page)).toHaveText("Speaking");
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(2, { timeout: 15000 });
  // The original words are sent unchanged, including "Computer"; the follow-up needed no "Computer".
  await expect(page.locator(".message[data-role=user]").first()).toContainText("Computer, hello there");
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Hello again");
  await expect(page.locator("#status-detail")).toHaveText("Go ahead with the next request, or say “New log entry”.");
  await expect(page.locator(".message.current")).toHaveCount(2);
  await expect(page.locator(".message.earlier")).toHaveCount(2);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2);
  expect(await sounds(page)).toEqual(["request-accepted: Understanding", "request-accepted: Understanding"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("spoken-conversation.png"), fullPage: true });

  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(status(page)).toHaveText("Microphone off");
  await expect(page.locator("#status-detail")).toHaveText("Click the microphone button or press M to switch it on.");
  await page.getByRole("button", { name: "Switch microphone on" }).click();
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding/, { timeout: 15000 });
  // The M key switches it off and on too.
  await page.keyboard.press("m");
  await expect(status(page)).toHaveText("Microphone off");
  await page.keyboard.press("m");
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding/, { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();

  // The app always opens with the microphone on, even after it was switched off. The browser may want one click first.
  await page.reload();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await startListening(page);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2);
});

for (const prefixed of [false, true]) {
  for (const keyboard of [false, true]) {
    test(`microphone ${keyboard ? "keyboard" : "button"} switching keeps ${prefixed ? "an addressed request" : "a follow-up"} in the current log entry`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("picard-tribute-enabled", "false"));
      const entries: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/conversations\/[^/]+\/send$/.test(request.url())) entries.push(request.url());
      });
      await launch(page, prefixed ? "resume" : undefined);
      await startListening(page);
      await expect(status(page)).toHaveText("Speaking", { timeout: 15000 });
      if (keyboard) await page.keyboard.press("m");
      else await page.getByRole("button", { name: "Switch microphone off" }).click();
      await expect(status(page)).toHaveText("Microphone off");
      await expect(page.getByRole("button", { name: "Stop speaking", exact: true })).toBeHidden({ timeout: 15000 });
      if (keyboard) await page.keyboard.press("m");
      else await page.getByRole("button", { name: "Switch microphone on" }).click();
      await expect(page.locator(".message[data-role=user]")).toHaveCount(2, { timeout: 20000 });
      expect(entries).toHaveLength(2);
      expect(entries[1]).toBe(entries[0]);
      await expect(page.locator(".message[data-role=user]").last()).toContainText(prefixed ? "Computer, hello again" : "Hello again");
      await page.getByRole("button", { name: "Switch microphone off" }).click();
    });
  }
}

test("facts vary within one log, are separate from copied answers, and the navigation switch stops future facts", async ({ page }, testInfo) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  const spoken = spokenText(page);
  await launch(page, "tribute");
  await startListening(page);
  await expect(page.locator(".tribute-fact")).toHaveCount(2, { timeout: 35000 });
  await expect(page.locator("#messages > .tribute-fact")).toHaveCount(2);
  await expect(page.locator(".message .tribute-fact")).toHaveCount(0);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(4);
  const facts = await page.locator(".tribute-fact p").allTextContents();
  expect(new Set(facts).size).toBe(2);
  await expect(page.locator(".tribute-fact button, .tribute-fact input")).toHaveCount(0);
  await expect(page.locator(".tribute-fact a").first()).toHaveAttribute("href", /^https:/);
  const latestFact = page.locator(".tribute-fact").last();
  await expect(latestFact).toBeInViewport();
  await expect(latestFact.locator(".tribute-record-body")).toHaveCSS("border-left-width", "14px");
  await expect(latestFact).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(latestFact).toHaveCSS("color", "rgb(242, 230, 218)");
  await expect(latestFact.getByRole("heading", { name: "Jean-Luc Picard", exact: true })).toHaveCSS("font-size", "24px");
  await expect(latestFact.locator(".tribute-record-title small")).toHaveText("Personnel file");
  await expect(latestFact.locator(".tribute-record-bars")).toHaveAttribute("aria-hidden", "true");
  await expect(latestFact.locator(".message-header, .copy-button")).toHaveCount(0);
  await expect(latestFact).toHaveCSS("opacity", "1");
  await expect(page.locator(".tribute-fact").first()).toHaveCSS("opacity", "1");
  const date = await latestFact.locator(".tribute-stardate").textContent();
  await latestFact.locator("a").focus();
  await expect(latestFact.locator("a")).toBeFocused();
  await expect(latestFact.locator(".tribute-stardate")).toHaveText(date!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("tribute-fact.png"), fullPage: true });
  expect(spoken.some((text) => text.startsWith("Picard fact."))).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { Object.assign(window, { copiedTributeAnswer: text }); },
    } });
  });
  await page.locator(".message[data-role=assistant]").last().getByRole("button", { name: "Copy", exact: true }).click();
  const copied = await page.evaluate(() => (window as unknown as { copiedTributeAnswer: string }).copiedTributeAnswer);
  expect(copied).toBe("A genuinely streamed reply from the test fixture.");
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await expect(page.locator(".message[data-role=user]")).toHaveCount(6, { timeout: 25000 });
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await expect(page.locator(".tribute-fact")).toHaveCount(2);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Tribute", exact: true })).not.toBeChecked();
  await expect(page.locator(".tribute-fact")).toHaveCount(0);
});

for (const subject of ["picard", "stewart"] as const) {
test(`${subject} facts have LCARS headings and a real, stable Stardate`, async ({ page }, testInfo) => {
  const shownAt = new Date("2026-11-01T06:00:00Z");
  await page.clock.setFixedTime(shownAt);
  await page.addInitScript((seen) => {
    Math.random = () => 0;
    localStorage.setItem("picard-tribute-seen", JSON.stringify(seen));
  }, subject === "stewart" ? TRIBUTE_ENTRIES.filter((entry) => entry.subject === "Picard").map((entry) => entry.id) : []);
  await launch(page, "tribute");
  await startListening(page);
  const fact = page.locator(`.tribute-fact[data-subject="${subject}"]`);
  await expect(fact).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(`#messages > .message[data-role="assistant"] + .tribute-fact[data-subject="${subject}"]`)).toHaveCount(1);
  await expect(page.locator(".message .tribute-fact")).toHaveCount(0);
  await expect(fact.locator(".message-header, .copy-button")).toHaveCount(0);
  const reply = page.locator(".message[data-role=assistant]").last();
  const replyBounds = await reply.boundingBox();
  const factBounds = await fact.boundingBox();
  expect(factBounds!.y).toBeGreaterThanOrEqual(replyBounds!.y + replyBounds!.height + 24);
  expect(factBounds!.x).toBe(replyBounds!.x);
  await expect(fact.getByRole("heading")).toHaveText(subject === "picard" ? "Jean-Luc Picard" : "Sir Patrick Stewart");
  await expect(fact.locator(".tribute-record-title small")).toHaveText(subject === "picard" ? "Personnel file" : "All the world’s a stage");
  await expect(fact.locator(".tribute-record-body")).toHaveCSS("border-left-color", subject === "picard" ? "rgb(204, 153, 204)" : "rgb(255, 204, 153)");
  const date = `Stardate ${formatStardate(shownAt)}`;
  await expect(fact.locator(".tribute-stardate")).toHaveText(date);
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await page.clock.setFixedTime(new Date("2026-11-02T06:00:00Z"));
  await page.getByRole("switch", { name: "Tribute", exact: true }).check();
  await expect(fact.locator(".tribute-stardate")).toHaveText(date);
  await fact.locator("a").focus();
  await expect(fact.locator("a")).toBeFocused();
  await expect(fact.locator("a")).toHaveAttribute("href", /^https:/);
  await page.screenshot({ path: testInfo.outputPath(`${subject}-record.png`), fullPage: true });
  if (process.env.PICARD_SITE_CAPTURE === "1" && subject === "stewart") await fact.screenshot({ path: "video/assets/stewart.png" });
  await page.setViewportSize({ width: 1000, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await fact.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1000);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.reload();
  await expect(page.locator(".tribute-fact")).toHaveCount(0);
  expect((await sounds(page)).some((sound) => sound.startsWith("tribute-fact:"))).toBe(false);
});
}

test("a standalone fact stays visible when an officer report replaces the computer's repeated answer", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route("**/api/conversations/*/messages", async (route) => {
    const response = await route.fetch();
    const messages: ChatMessage[] = await response.json();
    const withReports = messages.flatMap((message) => message.role === "assistant" && message.outcome === "succeeded"
      ? [{ ...message, id: `report-${message.id}`, background: true, speaker: "picard-data" as const }, message]
      : [message]);
    await route.fulfill({ response, json: withReports });
  });
  const spoken = spokenText(page);
  await launch(page, "tribute");
  await startListening(page);
  await expect(page.locator("#messages > .crew-report + .tribute-fact")).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(".tribute-fact")).toHaveCount(1);
  await expect(page.locator(".message .tribute-fact")).toHaveCount(0);
  await expect(page.locator(".crew-report").last().locator(".message-header strong")).toHaveText("Data");
  await expect.poll(async () => (await sounds(page)).some((sound) => sound.startsWith("tribute-fact:")), { timeout: 5000 }).toBe(true);
  expect(spoken).toHaveLength(2);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a fact cue follows actual playback once, without listening or speaking the fact, even with the old preference", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem("picard-tribute-spoken", "true");
  });
  const sent: { text: string; at: number }[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string") {
      const data = JSON.parse(payload);
      if (data.type === "speak") sent.push({ text: data.text ?? data.parts.map((part: { text: string }) => part.text).join(" "), at: Date.now() });
    }
  }));
  await launch(page, "tribute");
  await startListening(page);
  await expect.poll(async () => (await sounds(page)).filter((sound) => sound.startsWith("tribute-fact:")).length, { timeout: 20000 }).toBe(1);
  await expect(page.locator(".tribute-fact")).toHaveCount(1);
  expect(sent).toHaveLength(2);
  expect(sent.some((item) => /^(Picard|Patrick Stewart) fact\./.test(item.text))).toBe(false);
  const timeline = await page.evaluate(() => (window as unknown as {
    audioTimeline: { name: string; at: number; end: number; capture: boolean }[];
  }).audioTimeline);
  const cueIndex = timeline.findIndex((item) => item.name === "tribute-fact");
  const cue = timeline[cueIndex]!;
  expect(cue.at).toBeGreaterThanOrEqual(Math.max(...timeline.slice(0, cueIndex).filter((item) => item.name === "speech").map((item) => item.end)));
  expect(cue.capture).toBe(false);
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await page.getByRole("switch", { name: "Tribute", exact: true }).check();
  expect((await sounds(page)).filter((sound) => sound.startsWith("tribute-fact:"))).toHaveLength(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("turning Tribute off during its cue stops that cue and returns to listening", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await launch(page, "tribute");
  await startListening(page);
  await expect.poll(async () => (await sounds(page)).some((sound) => sound.startsWith("tribute-fact:")), { timeout: 20000 }).toBe(true);
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a missing tribute sound is reported and never replaced by automatic fact speech", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem("picard-tribute-spoken", "true");
  });
  await page.route("**/api/sounds/tribute-fact", (route) => route.fulfill({ status: 404, body: "This sound is not set up." }));
  const spoken = spokenText(page);
  await launch(page, "tribute");
  await expect(page.getByText("The tribute-fact sound could not be loaded: HTTP 404. Restart Picard Code to check and download its sounds.", { exact: true })).toBeVisible();
  await startListening(page);
  await expect(page.locator(".tribute-fact")).toHaveCount(1, { timeout: 20000 });
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  expect((await sounds(page)).some((sound) => sound.startsWith("tribute-fact:"))).toBe(false);
  expect(spoken.some((text) => /^(Picard|Patrick Stewart) fact\./.test(text))).toBe(false);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("Tribute off discards a cue whose sound is still loading", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/sounds/tribute-fact", async (route) => {
    await ready;
    await route.continue();
  });
  await launch(page, "tribute");
  await startListening(page);
  await expect(page.locator(".tribute-fact")).toHaveCount(1, { timeout: 20000 });
  // All buffered answer audio has ended, but the cue is still waiting for its file.
  await expect(page.locator("#status-detail")).toHaveText("A new tribute fact is on screen.", { timeout: 5000 });
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  const loaded = page.waitForResponse("**/api/sounds/tribute-fact");
  release();
  await loaded;
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  expect((await sounds(page)).some((sound) => sound.startsWith("tribute-fact:"))).toBe(false);
});

test("turning Tribute off cancels the pending cue without cutting off the answer", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem("picard-tribute-spoken", "true");
  });
  const spoken = spokenText(page);
  await launch(page, "tribute");
  await startListening(page);
  await expect(page.locator(".tribute-fact")).toHaveCount(1, { timeout: 20000 });
  await expect(status(page)).toHaveText("Speaking");
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Stop speaking", exact: true })).toBeVisible();
  await expect(status(page)).toHaveText("Standing by", { timeout: 10000 });
  expect(spoken.some((text) => text.startsWith("Picard fact."))).toBe(false);
  expect((await sounds(page)).some((sound) => sound.startsWith("tribute-fact:"))).toBe(false);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const subject of ["Picard", "Patrick Stewart"] as const) {
test(`a ${subject} answer offers a matching story aloud; acceptance keeps the words and source`, async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  const spoken = spokenText(page);
  await launch(page, subject === "Picard" ? "picard" : "stewart-about");
  await startListening(page);
  const name = subject === "Picard" ? "Captain Jean-Luc Picard" : "Sir Patrick Stewart";
  await expect.poll(() => spoken.includes(`I can tell you a short story about ${name}.`), { timeout: 20000 }).toBe(true);
  await expect(page.locator(".tribute-invitation")).toContainText(name);
  await expect(page.locator(".wikipedia-source a")).toHaveAttribute("href", subject === "Picard" ? /Jean-Luc_Picard$/ : /Patrick_Stewart$/);
  await expect(page.getByRole("button", { name: /story/i })).toHaveCount(0);
  await expect(page.locator(".tribute-source a")).toHaveAttribute("href", subject === "Picard" ? /startrek/ : /londontheatre/, { timeout: 25000 });
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Yes, please.");
  await expect(page.locator(".tribute-fact")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});
}

test("a negated story response is not an acceptance", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await launch(page, "picard-decline");
  await startListening(page);
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Not now", { timeout: 25000 });
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await expect(page.locator(".tribute-source")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const action of ["Stop speaking", "New log entry", "Settings", "Microphone off"] as const) {
  test(`${action} cancels pending tribute audio`, async ({ page }) => {
    await page.addInitScript(() => {
      Math.random = () => 0;
      localStorage.setItem("picard-tribute-spoken", "true");
    });
    const spoken = spokenText(page);
    await launch(page, "tribute");
    await startListening(page);
    await expect(page.locator(".tribute-fact")).toHaveCount(1, { timeout: 20000 });
    await expect(status(page)).toHaveText("Speaking");
    if (action === "Settings") await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
    else if (action === "Microphone off") await page.getByRole("button", { name: "Switch microphone off" }).click();
    else await page.getByRole("button", { name: action, exact: true }).click();
    if (action === "Settings") await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
    if (action === "Microphone off") await expect(status(page)).toHaveText("Microphone off", { timeout: 10000 });
    if (action === "New log entry") await expect(page.locator(".message")).toHaveCount(0);
    // The fake speaking service emits ten buffers, totalling one second of playback.
    await page.waitForTimeout(1600);
    expect(spoken.some((text) => text.startsWith("Picard fact."))).toBe(false);
    expect((await sounds(page)).some((sound) => sound.startsWith("tribute-fact:"))).toBe(false);
    if (action !== "Microphone off" && action !== "Settings") await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

test("Tribute off keeps Picard identity without offers", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("picard-tribute-enabled", "false");
    Math.random = () => 0;
  });
  const spoken = spokenText(page);
  await launch(page, "picard");
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]").first()).toContainText("Jean-Luc Picard", { timeout: 15000 });
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await expect(page.locator(".tribute-invitation")).toHaveCount(0);
  await expect(page.locator(".wikipedia-source a")).toHaveAttribute("href", /Jean-Luc_Picard$/);
  expect(spoken.some((text) => text.includes("I can tell you"))).toBe(false);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a spoken repository question keeps its real meaning with Tribute on", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "repo");
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]").last()).toContainText("src/retry.ts", { timeout: 15000 });
  await expect.poll(() => spoken.some((text) => text.includes("retry helper")), { timeout: 10000 }).toBe(true);
  await expect(status(page)).toHaveText("Standing by", { timeout: 10000 });
  await expect(page.locator(".tribute-source, .tribute-invitation, .wikipedia-source")).toHaveCount(0);
  expect(spoken.some((text) => text.includes("I can tell you"))).toBe(false);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const subject of ["Picard", "Patrick Stewart"] as const) {
test(`an explicitly requested ${subject} story is sourced and spoken with Tribute off`, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("picard-tribute-enabled", "false");
    Math.random = () => 0;
  });
  const spoken = spokenText(page);
  await launch(page, subject === "Picard" ? "picard-story" : "stewart");
  await startListening(page);
  await expect(page.locator(".tribute-source a")).toHaveAttribute("href", subject === "Picard" ? /startrek/ : /londontheatre/, { timeout: 15000 });
  await expect.poll(() => spoken.some((text) => text.includes(subject === "Picard" ? "Phoenix" : "A Christmas Carol")), { timeout: 10000 }).toBe(true);
  await expect(page.locator(".tribute-fact, .tribute-invitation")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});
}

test("spoken work asks for deliberate approval; voice cannot approve", async ({ page }) => {
  await launch(page, "approval");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 15000 });
  await expect(status(page)).toHaveText("Decision needed", { timeout: 5000 });
  await expect(page.getByRole("button", { name: "Allow once" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(status(page)).toHaveText("Microphone off");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  expect(await sounds(page)).toEqual(["request-accepted: Understanding"]);
});

test("a question is asked aloud; a negated reply is not taken as a choice; a clear spoken choice is sent", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "question");
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]").last()).toContainText('Your test answer was received: [["Explain first"]].', { timeout: 25000 });
  expect(spoken[0]).toBe("Which approach should I use? The options are Small change or Explain first.");
  expect(spoken[1]).toBe("Please choose Small change or Explain first.");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Additional information required." })).toHaveCount(0);
  await expect.poll(() => spoken.length, { timeout: 10000 }).toBe(3);
  expect(spoken[2]).toContain("Explain first");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(status(page)).toHaveText("Microphone off");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  // Spoken answers to the question do not play the request-accepted sound.
  expect(await sounds(page)).toEqual(["request-accepted: Understanding"]);
});

test("silence makes no sound; speech not addressed to the computer is not sent and plays the input-failed sound", async ({ page }) => {
  await launch(page, "unclear");
  await startListening(page);
  await expect(page.locator("#voice-partial")).toHaveText("Not sent: “Is it raining outside” Start with “Computer”.", { timeout: 20000 });
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]")).toHaveText(/Computer, hello there/);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  expect((await sounds(page)).map((sound) => sound.split(":")[0])).toEqual(["input-failed", "request-accepted"]);
});

test("long work plays only the accepted sound, and “Stop” cancels it within the task", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "slow");
  await startListening(page);
  await expect(page.locator("#status-detail")).toHaveText("Say “Belay that” to cancel.", { timeout: 15000 });
  // No sound plays while the work continues.
  await page.waitForTimeout(3000);
  expect(await sounds(page)).toEqual(["request-accepted: Understanding"]);
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toBe("Work stopped, Captain.");
  await expect(status(page)).toHaveText(/Speaking|Preparing reply|Standing by/);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  // Stopping by voice is not a failure, so no failure sound plays.
  expect(await sounds(page)).toEqual(["request-accepted: Understanding"]);
});

test("a denied action plays the failure sound once, then speaks the result", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "approval");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect.poll(() => spoken.at(-1), { timeout: 10000 }).toBe("Request denied. The action was not carried out.");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  expect(await sounds(page)).toEqual(["request-accepted: Understanding", "request-failed: Preparing reply"]);
});

test("Allow once lets the requested action go ahead", async ({ page }, info) => {
  await launch(page, "approval");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("OpenCode wants to run a command. Review the requested action before allowing it.")).toBeVisible();
  await page.screenshot({ path: info.outputPath("approval-screen.png"), fullPage: true });
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.locator(".message[data-role=assistant]").last()).toContainText("The test approval was answered.", { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("the Belay that button cancels spoken work", async ({ page }) => {
  await launch(page, "long");
  await startListening(page);
  await expect(page.getByRole("button", { name: "Belay that" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Belay that" }).click();
  await expect(status(page)).toHaveText("Microphone off", { timeout: 10000 });
  await expect(page.getByRole("button", { name: "Belay that" })).toBeHidden();
});

test("a question can also be answered by choosing on screen", async ({ page }) => {
  await launch(page, "choose");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Additional information required." })).toBeVisible({ timeout: 15000 });
  await page.getByRole("radio", { name: "Explain first" }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.locator("#messages")).toContainText('Your test answer was received: [["Explain first"]].', { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("skipping a question stops the work and says so", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "choose");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Additional information required." })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Skip question" }).click();
  await expect.poll(() => spoken.at(-1), { timeout: 10000 }).toBe("Question skipped. The work has stopped.");
  await expect(page.getByRole("heading", { name: "Additional information required." })).toBeHidden();
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("replies show code safely, and the conversation reopens after reload", async ({ page }, info) => {
  await launch(page, "unsafe");
  await startListening(page);
  await expect(page.locator("#messages pre")).toContainText("const safe = true;", { timeout: 15000 });
  await expect(page.locator("#messages")).toContainText("<img src=x onerror=alert('unsafe')>");
  await expect(page.locator("#messages img")).toHaveCount(0);
  // OpenCode's Markdown is shown as formatting, not as symbols.
  const reply = page.locator(".message[data-role=assistant] .markdown").last();
  await expect(reply.locator("strong")).toHaveText("bold");
  await expect(reply.locator("em")).toHaveText("emphasis");
  await expect(reply.locator("h2")).toHaveText("Result");
  await expect(reply.locator("li")).toHaveText(["first", "second"]);
  await expect(reply.locator("td")).toHaveText(["a", "1"]);
  await expect(reply).not.toContainText("**");
  await expect(reply.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://example.com");
  await expect(reply.getByRole("link", { name: "Docs" })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(reply.locator("a", { hasText: "Bad" })).not.toHaveAttribute("href", /.+/);
  await expect(reply.getByRole("link", { name: "Picture" })).toHaveAttribute("href", "https://example.com/p.png");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator("#messages pre")).toContainText("const safe = true;");
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding/, { timeout: 15000 });
  await page.screenshot({ path: info.outputPath("conversation-screen.png"), fullPage: true });
});

test("“New log entry” clears the screen and ends the task; the earlier conversation stays in the captain’s log with its stardate and can be deleted", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "fresh");
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(status(page)).toHaveText("Speaking");
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toBe("Standing by for a new log entry.");
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Please specify your request." })).toBeVisible();
  await expect(page.locator("#entry-stardate")).toBeVisible();
  await expect(page.locator("#entry-stardate")).toHaveText(/^Stardate -?\d+\.\d$/);
  expect(spoken.some((text) => /stardate/i.test(text))).toBe(false);
  // After the task ends, speech needs "Computer" again.
  await expect(page.locator("#voice-partial")).toHaveText("Not sent: “Is anyone there” Start with “Computer”.", { timeout: 20000 });
  await expect(page.locator(".message")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("link", { name: "Captain’s log" }).click();
  await expect(page.locator("#conversations")).toContainText("hello there");
  await expect(page.locator("#conversations .log-stardate")).toHaveText(/^Stardate -?\d+\.\d$/);
  // Deleting asks first; "Keep" leaves the entry alone.
  await page.getByRole("button", { name: /^Delete .*hello there/ }).click();
  await expect(page.locator("#conversations")).toContainText("permanently? This cannot be undone.");
  await page.getByRole("button", { name: "Keep" }).click();
  await expect(page.locator("#conversations .conversation-button")).toHaveCount(1);
  await page.getByRole("button", { name: /^Delete .*hello there/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("#conversations")).toHaveText("Your log entries will appear here.");
  // The panel stays open after deleting.
  await expect(page.locator("#drawer-records")).toBeVisible();
});

test("after a task ends, the next “Computer” request starts its own log entry", async ({ page }) => {
  await launch(page, "separate");
  await startListening(page);
  await expect(page.locator(".message[data-role=user]")).toContainText(["Computer, show unsafe output"], { timeout: 40000 });
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("link", { name: "Captain’s log" }).click();
  await expect(page.locator("#conversations .log-title")).toHaveCount(2);
  await page.locator("#conversations .conversation-button", { hasText: "hello there" }).click();
  await expect(page.locator(".message[data-role=user]")).toContainText(["Computer, hello there"]);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
});

test("“Stop listening”, even without “Computer”, is acknowledged and returns to standing by; only the microphone button switches the microphone", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "sleep");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toBe("Standing by.");
  await expect(status(page)).toHaveText(/Speaking|Standing by/);
  await expect(status(page)).toHaveText("Standing by", { timeout: 10000 });
  await expect(page.locator("#status-detail")).toHaveText("Say “Computer”, then your request.");
  // No task is under way, so speech without "Computer" is not sent.
  await expect(page.locator("#voice-partial")).toHaveText("Not sent: “Hello again” Start with “Computer”.", { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(".message[data-role=user]")).toContainText("Computer, hello there");
  const heard = await sounds(page);
  expect(heard.map((sound) => sound.split(":")[0])).toEqual(["request-accepted", "input-failed", "request-accepted"]);
  // Clicking the console does not switch the microphone off; the microphone button does.
  await page.locator("#status").click();
  await expect(status(page)).not.toHaveText("Microphone off");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(status(page)).toHaveText("Microphone off");
  // Only the button switches it on again; a stray click on the console does not.
  await page.locator("#status").click();
  await expect(status(page)).toHaveText("Microphone off");
  await page.getByRole("button", { name: "Switch microphone on" }).click();
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding|Speaking/, { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("the voice leads: a spoken reply appears on screen when the voice starts saying it", async ({ page }) => {
  // Note the console status at the moment the computer's reply first appears.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { replyShownDuring: seen });
    new MutationObserver(() => {
      if (!seen.length && document.querySelector(".message[data-role=assistant]")) seen.push(document.querySelector("#status")?.textContent ?? "");
    }).observe(document, { childList: true, subtree: true });
  });
  await launch(page, "example");
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  expect(await page.evaluate(() => (window as unknown as { replyShownDuring: string[] }).replyShownDuring)).toEqual(["Speaking"]);
  await expect(page.locator("#working")).toBeHidden();
});

test("the reply waits while the voice is preparing, then appears when it starts", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  await expect(status(page)).toHaveText("Preparing reply");
  await expect(page.locator("#working")).toContainText("Preparing the reply.");
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.release();
  await expect(status(page)).toHaveText("Speaking", { timeout: 15000 });
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const scenario of [
  { label: "a Wikipedia source", mode: "picard", tribute: false, selector: ".wikipedia-source a", source: /Jean-Luc_Picard$/ },
  { label: "a source and story invitation", mode: "stewart-about", tribute: true, selector: ".wikipedia-source a", source: /Patrick_Stewart$/ },
  { label: "a reviewed story", mode: "picard-story", tribute: false, selector: ".tribute-source a", source: /startrek/ },
] as const) {
  test(`a reply with ${scenario.label} waits for its voice`, async ({ page }) => {
    await page.addInitScript((enabled) => {
      localStorage.setItem("picard-tribute-enabled", String(enabled));
      Math.random = () => 0;
    }, scenario.tribute);
    const voice = await holdSpeaking(page);
    await launch(page, scenario.mode);
    await startListening(page);
    await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
    await expect(status(page)).toHaveText("Preparing reply");
    await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
    await expect(page.locator(scenario.selector)).toHaveCount(0);
    await expect(page.locator(".tribute-invitation")).toHaveCount(0);
    voice.release();
    await expect(status(page)).toHaveText("Speaking", { timeout: 15000 });
    await expect(page.locator(scenario.selector)).toHaveAttribute("href", scenario.source);
    await expect(page.locator(".tribute-invitation")).toHaveCount(scenario.mode === "stewart-about" ? 1 : 0);
    await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

test("a reply with a reviewed story appears if speaking fails", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  const voice = await holdSpeaking(page);
  await launch(page, "picard-story");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.fail("Test stand-in: the voice could not start.");
  await expect(page.locator(".tribute-source a")).toHaveAttribute("href", /startrek/);
  await expect(page.getByText("Test stand-in: the voice could not start.", { exact: true })).toBeVisible();
});

test("an automatic fact and its reply wait for the voice", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  const voice = await holdSpeaking(page);
  await launch(page, "tribute");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.release();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator(".tribute-fact")).toHaveCount(0);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2, { timeout: 25000 });
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  await expect(status(page)).toHaveText("Preparing reply");
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(2);
  await expect(page.locator(".tribute-fact")).toHaveCount(0);
  voice.release();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(3, { timeout: 15000 });
  await expect(page.locator(".tribute-fact")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("an old speaking state cannot reveal a reply before its audio starts", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  voice.staleSpeaking();
  await page.waitForTimeout(200);
  await expect(status(page)).toHaveText("Preparing reply");
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.release();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("the reply stays hidden until the first audio is ready to play", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  voice.startWithoutAudio();
  await page.waitForTimeout(200);
  await expect(status(page)).toHaveText("Preparing reply");
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.release();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const action of ["Stop speaking", "Switch microphone off"] as const) {
  test(`${action} shows a reply that is waiting for the voice`, async ({ page }) => {
    const voice = await holdSpeaking(page);
    await launch(page, "example");
    await startListening(page);
    await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
    await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.locator(".message[data-role=assistant]")).toContainText("The settings test fails", { timeout: 3000 });
    if (action === "Stop speaking") await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

test("switching the microphone off during work shows the reply as it is written", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example");
  await startListening(page);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#working")).toBeVisible();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(page.locator(".message[data-role=assistant]")).toContainText("The settings test fails", { timeout: 5000 });
  expect(voice.pending()).toBeUndefined();
});

test("a speaking failure shows the reply and the real error", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.fail("Test stand-in: the voice could not start.");
  await expect(page.locator(".message[data-role=assistant]")).toContainText("The settings test fails", { timeout: 3000 });
  await expect(page.getByText("Test stand-in: the voice could not start.", { exact: true })).toBeVisible();
});

test("a reply is shown after 20 seconds if the voice never starts", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  const started = voice.pending()!.at;
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  await expect(page.locator(".message[data-role=assistant]")).toContainText("The settings test fails", { timeout: 24000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(19_000);
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a saved reply is shown after 20 seconds even if no terminal outcome arrives", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "missing-outcome");
  await startListening(page);
  await expect(page.locator("#working")).toContainText("Preparing the reply.", { timeout: 15000 });
  const started = Date.now();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  await expect(page.locator(".message[data-role=assistant]")).toContainText("a saved reply without a terminal outcome", { timeout: 24000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(18_000);
  expect(spoken).toHaveLength(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a failed request is visible before its failure sound", async ({ page }) => {
  await launch(page, "broken");
  await startListening(page);
  await expect.poll(async () => (await sounds(page)).some((sound) => sound.startsWith("request-failed:")), { timeout: 15000 }).toBe(true);
  const timeline = await page.evaluate(() => (window as unknown as {
    audioTimeline: { name: string; visibleErrors: string[] }[];
  }).audioTimeline);
  expect(timeline.find((item) => item.name === "request-failed")?.visibleErrors).toContain("The test model cannot be reached.");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("an everyday answer is spoken briefly while the exact code stays on screen", async ({ page }, info) => {
  const spoken = spokenText(page);
  await launch(page, "example");
  await startListening(page);
  const answer = page.locator(".message[data-role=assistant]");
  await expect(answer).toHaveCount(1, { timeout: 15000 });
  await expect(answer.locator("pre code")).toHaveText("const settings = { ...defaults, ...saved };");
  await expect.poll(() => spoken[0], { timeout: 15000 })
    .toBe("The settings test fails because the default voice replaces the saved choice when the app starts.");
  await expect(status(page)).not.toHaveText("Speaking", { timeout: 15000 });
  await expect(status(page)).toHaveText(/Standing by|Listening/, { timeout: 15000 });
  await page.screenshot({ path: info.outputPath("example-answer.png"), fullPage: true });
});

test("the website example: Data and Riker answer, then a Picard personnel file appears", async ({ page }, info) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  const spoken = spokenText(page);
  const capture = process.env.PICARD_SITE_CAPTURE === "1";
  // The website video uses the real interface; the local project name is removed.
  const hideProject = () => page.locator("#readout-project").evaluate((node) => {
    node.textContent = "Example project";
    node.removeAttribute("title");
  });
  await launch(page, "showcase");
  await startListening(page);
  const speakers = page.locator(".message[data-role=assistant] .message-header strong");
  await expect(speakers).toHaveText(["Data"], { timeout: 30000 });
  await expect(page.locator(".message[data-role=assistant]").first()).toContainText("I have not changed any files.", { timeout: 15000 });
  if (capture) { await hideProject(); await page.screenshot({ path: "video/assets/data.png" }); }
  await expect(speakers).toHaveText(["Data", "Riker"], { timeout: 30000 });
  const fact = page.locator("#messages > .tribute-fact[data-subject=picard]");
  await expect(fact).toHaveCount(1, { timeout: 15000 });
  await expect(fact.locator(".tribute-record-title small")).toHaveText("Personnel file");
  await expect(status(page)).toHaveText(/Standing by|Listening/, { timeout: 15000 });
  await page.screenshot({ path: info.outputPath("site-example.png"), fullPage: true });
  expect(spoken).toHaveLength(2);
  if (capture) {
    await hideProject();
    await page.screenshot({ path: "site/assets/console.png", fullPage: true });
    await copyFile("site/assets/console.png", "video/assets/console.png");
    await writeFile("video/assets/spoken.json", `${JSON.stringify(spoken, null, 2)}\n`);
  }
});

test("the side panel keeps every tile readable on a short laptop screen", async ({ page }) => {
  await launch(page);
  for (const height of [590, 657]) {
    await page.setViewportSize({ width: 1280, height });
    const tiles = await page.locator("#sidebar .rail-button, #sidebar .readout").evaluateAll((nodes) => nodes.map((node) => {
      const tile = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      return { text: node.textContent, clipped: text.top < tile.top - 1 || text.bottom > tile.bottom + 1, bottom: tile.bottom };
    }));
    expect(tiles.filter((tile) => tile.clipped)).toEqual([]);
    expect(Math.max(...tiles.map((tile) => tile.bottom))).toBeLessThanOrEqual(height);
  }
});
