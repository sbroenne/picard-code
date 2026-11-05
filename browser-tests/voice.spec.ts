import { test, expect } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { TRIBUTE_ENTRIES } from "../src/shared/tribute-data";
import { formatStardate } from "../src/shared/stardate";
import type { AppState, ChatMessage } from "../src/shared/types";
import { syntheticVoice } from "../src/tests/test-audio";

const folder = resolve(`.picard-test-voice-audio-${process.pid}`);
const soundFolder = join(folder, "sounds");
const browserDiagnostics = new WeakMap<import("@playwright/test").Page, string[]>();
const microphoneVoice = Array.from(syntheticVoice(1, 0.1));
// Silent stand-ins for the downloaded sounds; each has its own length so the test can tell them apart.
const SOUND_LENGTHS = { startup: 0.2, "request-accepted": 0.3, "input-failed": 0.4, "request-failed": 0.6 };
// Simulated speaker output keeps the browser's audio clock running even when this computer's real speakers are unavailable.
test.use({ permissions: ["microphone"], launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-audio-output",
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
});
test.afterAll(async () => { await rm(folder, { recursive: true }); });

async function launch(page: import("@playwright/test").Page, mode?: "resume" | "approval" | "question" | "unclear" | "slow" | "long" | "choose" | "unsafe" | "fresh" | "fresh-starlog" | "sleep" | "separate" | "tribute" | "picard" | "picard-decline" | "stewart" | "stewart-about" | "picard-story" | "repo" | "crew" | "briefing" | "briefing-failure" | "briefing-recovered" | "briefing-repeat" | "briefing-late-failure" | "briefing-copy" | "briefing-filename" | "briefing-failure-copy" | "briefing-failure-only" | "briefing-parent-failure" | "officer" | "news" | "interrupt" | "interrupt-room" | "faster" | "speed-follow-up" | "interrupt-approval" | "interrupt-request" | "interrupt-final" | "no-speech" | "example" | "showcase" | "broken" | "missing-outcome" | "explanation" | "smart-turn" | "smart-turn-late" | "smart-turn-error" | "refusal-idle" | "refusal-approval" | "refusal-question" | "refusal-busy", extra: string[] = []) {
  const diagnostics: string[] = [];
  browserDiagnostics.set(page, diagnostics);
  page.on("console", (message) => { if (message.type() === "error") diagnostics.push(`Browser console: ${message.text()}`); });
  page.on("pageerror", (error) => diagnostics.push(`Browser error: ${error.message}`));
  page.on("requestfailed", (request) => diagnostics.push(`Request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText})`));
  // Record each computer sound that starts, and the voice status at that moment.
  await page.addInitScript(({ lengths, microphoneVoice }) => {
    const decoded = new WeakSet<AudioBuffer>();
    const microphoneSources = new WeakSet<AudioBufferSourceNode>();
    const plays: string[] = [];
    const timeline: { name: string; at: number; end: number; capture: boolean; visibleErrors: string[] }[] = [];
    let capture = false;
    let startTestMicrophone: (() => void) | undefined;
    Object.assign(window, { acceptedSounds: plays, audioTimeline: timeline });
    const node = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends node {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args);
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: unknown) => {
          if (typeof message === "boolean") capture = message;
          post(message);
          if (message === true) startTestMicrophone?.();
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
      if (microphoneSources.has(this)) return start.apply(this, args);
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
    const createMediaStreamSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      if ((window as unknown as { useControlledMicrophoneAudio?: boolean }).useControlledMicrophoneAudio) return createMediaStreamSource.call(this, stream);
      const destination = this.createMediaStreamDestination();
      const audio = this.createBuffer(1, 16000 * 8, 16000);
      audio.getChannelData(0).set(microphoneVoice, 8000);
      const source = this.createBufferSource();
      microphoneSources.add(source);
      source.buffer = audio;
      source.loop = true;
      source.connect(destination);
      let started = false;
      // Start when the app enables capture, including after the microphone is switched back on.
      startTestMicrophone = () => {
        if (started) return;
        started = true;
        source.start();
      };
      return createMediaStreamSource.call(this, destination.stream);
    };
  }, { lengths: SOUND_LENGTHS, microphoneVoice });
  const child = spawn(process.execPath, ["dist/tests/browser-launch.js", ...(mode === "no-speech" ? [] : ["--speech"]), "--sounds", soundFolder, ...(mode ? [`--${mode}`] : []), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.stderr.on("data", (chunk) => diagnostics.push(`Test server: ${chunk.toString().trim()}`));
    child.on("exit", (code, signal) => diagnostics.push(`Test server exited with code ${code} and signal ${signal}.`));
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
  if (mode === "no-speech") await expect(page.getByRole("heading", { name: "Computer voice offline" })).toBeVisible();
  else if (extra.includes("--model-setup")) await expect(page.locator("#first-run-setup")).toBeVisible({ timeout: 15000 });
  else await expect(status(page)).not.toHaveText("Starting up", { timeout: 15000 });
}

function status(page: import("@playwright/test").Page) {
  return page.getByRole("status");
}

async function watchStatus(page: import("@playwright/test").Page, id = "status") {
  await page.addInitScript((id) => {
    const headings: string[] = [];
    Object.assign(window, { consoleHeadings: headings });
    document.addEventListener("DOMContentLoaded", () => {
      const readout = document.getElementById(id)!;
      const record = () => {
        const text = readout.textContent ?? "";
        headings.push(text);
      };
      new MutationObserver(record).observe(readout, { childList: true, subtree: true, characterData: true });
      record();
    });
  }, id);
  return () => page.evaluate(() => (window as unknown as { consoleHeadings: string[] }).consoleHeadings);
}

async function blockAudioUntilInteraction(page: import("@playwright/test").Page) {
  // Headless Chromium can allow autoplay despite policy flags and Playwright's own calls count as activation.
  await page.addInitScript(() => {
    let activated = false;
    for (const name of ["pointerdown", "keydown"]) window.addEventListener(name, (event) => {
      if (event.isTrusted) activated = true;
    }, true);
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      private suspended: Promise<void>;
      constructor(options?: AudioContextOptions) {
        super(options);
        this.suspended = this.suspend();
        Object.assign(window, { pauseTestAudio: () => this.suspend() });
      }
      override get state() {
        return activated ? super.state : "suspended";
      }
      override resume() {
        return activated ? this.suspended.then(() => super.resume()) : Promise.resolve();
      }
    };
  });
  return () => page.evaluate(() => (window as unknown as { pauseTestAudio(): Promise<void> }).pauseTestAudio());
}

/** Check the paused state before unlocking sound, so setup cannot click through contradictory instructions. */
async function startListening(page: import("@playwright/test").Page) {
  await expect(page.locator("#voice-channel")).toHaveText(/^(Listening|Paused)$/, { timeout: 15000 });
  if (await page.locator("#voice-channel").textContent() === "Paused") {
    await expect(status(page)).toHaveText("Not listening");
    await expect(page.locator("#status-detail")).toHaveText("The browser paused sound. Click the microphone, or press M.");
    await expect(page.locator("#welcome-title")).toBeHidden();
    await expect(page.locator("#listen-toggle")).toHaveAttribute("data-act", "");
    await page.locator("#listen-toggle").click();
  }
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
}

/** Drop the real event stream, then reopen it without unrelated updates masking recovery. */
async function controlLiveConnection(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends EventTarget {
      private source: EventSource;
      constructor(url: string | URL) {
        super();
        const connect = (recovery = false) => {
          const source = new NativeEventSource(url);
          source.addEventListener("message", (event) => {
            if (!recovery || JSON.parse(event.data).type === "connection") {
              this.dispatchEvent(new MessageEvent("message", { data: event.data }));
            }
          });
          source.addEventListener("error", () => this.dispatchEvent(new Event("error")));
          return source;
        };
        this.source = connect();
        Object.assign(window, {
          disconnectTestEvents: () => {
            this.source.close();
            this.dispatchEvent(new Event("error"));
          },
          reconnectTestEvents: () => { this.source = connect(true); },
        });
      }
      close() { this.source.close(); }
    } as unknown as typeof EventSource;
  });
  return {
    disconnect: () => page.evaluate(() => (window as unknown as { disconnectTestEvents(): void }).disconnectTestEvents()),
    reconnect: () => page.evaluate(() => (window as unknown as { reconnectTestEvents(): void }).reconnectTestEvents()),
  };
}

for (const recovery of ["approval", "question"] as const) {
  test(`live connection recovery restores saved replies and ${recovery} without reloading`, async ({ page }) => {
    const connection = await controlLiveConnection(page);
    let navigations = 0;
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
    await launch(page, "example");
    await startListening(page);
    await expect(page.locator(".message[data-role=assistant]")).toContainText("The settings test fails", { timeout: 15000 });
    await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    const entryID = await page.locator(".message[data-role=user]").getAttribute("data-session-id");
    expect(entryID).toBeTruthy();
    const origin = new URL(page.url()).origin;
    const readState = async (): Promise<AppState> => {
      const response = await page.request.get(`${origin}/api/state`);
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const readMessages = async (): Promise<ChatMessage[]> => {
      const response = await page.request.get(`${origin}/api/conversations/${entryID}/messages`);
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const initial = await readState();
    const send = async (text: string) => {
      const response = await page.request.post(`${origin}/api/conversations/${entryID}/send`, {
        headers: { "x-picard-request": "1" },
        data: { text, ...initial.selectedModel, bridge: false },
      });
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ accepted: true });
    };
    const navigationsBefore = navigations;
    await connection.disconnect();
    await expect(status(page)).toHaveText("Reconnecting");
    await expect(page.locator("#notice-text")).toContainText("The live connection stopped.");

    // The same OpenCode stand-in keeps working while this browser cannot receive events.
    await send("hello from the disconnected test page");
    await expect.poll(async () => (await readMessages()).filter((message) => message.outcome === "succeeded").length).toBe(2);
    const saved = (await readMessages()).findLast((message) => message.outcome === "succeeded")!;
    await expect(page.locator(`[data-message-id="${saved.id}"]`)).toHaveCount(0);
    await send(recovery === "approval" ? "request an approval" : "ask a question and let me choose");
    await expect.poll(async () => recovery === "approval" ? (await readState()).permissions.length : (await readState()).questions.length).toBe(1);
    await expect(page.getByRole("heading", { name: recovery === "approval" ? "Approval required." : "Additional information required." })).toHaveCount(0);
    await expect(status(page)).toHaveText("Reconnecting");
    await connection.reconnect();
    await expect(page.locator(`[data-message-id="${saved.id}"]`)).toContainText(saved.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
    await expect(page.locator("#notice-text")).toBeEmpty();
    await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
    expect(navigations).toBe(navigationsBefore);
    await expect(page.locator(".message[data-role=user]")).toHaveCount(3);
    expect(await page.locator(".message[data-role=user]").last().getAttribute("data-session-id")).toBe(entryID);
    await expect(status(page)).toHaveText(recovery === "approval" ? "Decision needed" : "Answer needed");
    await expect(page.getByRole("heading", { name: recovery === "approval" ? "Approval required." : "Additional information required." })).toBeVisible();
    if (recovery === "approval") {
      await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
    } else {
      await expect(page.getByRole("radio", { name: "Small change" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Skip question", exact: true })).toBeEnabled();
    }
  });
}

test("live connection recovery does not announce an unfinished reply as a completed answer", async ({ page }) => {
  const connection = await controlLiveConnection(page);
  const spoken = spokenText(page);
  await launch(page, "missing-outcome");
  await startListening(page);
  await expect(page.locator("#working")).toContainText("Preparing the reply.", { timeout: 15000 });
  await connection.disconnect();
  await expect(status(page)).toHaveText("Reconnecting");
  await connection.reconnect();
  await expect(page.locator("#notice-text")).toBeEmpty();
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
  await expect(page.locator("#working")).toContainText("Preparing the reply.");
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  expect(spoken).toEqual([]);
  expect(await soundNames(page)).toEqual(["request-accepted"]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(page.locator(".message[data-role=assistant]")).toContainText("without a terminal outcome");
  expect(spoken).toEqual([]);
});

for (const microphoneOff of [false, true]) {
  for (const exit of ["same tile", "Current log entry", "Escape"] as const) {
    test(`closing settings through ${exit} keeps the microphone ${microphoneOff ? "off" : "listening"}`, async ({ page }) => {
      await page.addInitScript(() => {
        let starts = 0;
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => { starts++; return getUserMedia(constraints); };
        Object.assign(window, { testMicrophoneStarts: () => starts });
      });
      const microphoneStarts = () => page.evaluate(() => (window as unknown as { testMicrophoneStarts(): number }).testMicrophoneStarts());
      await launch(page, "resume");
      await startListening(page);
      await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
      await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
      const entryID = await page.locator(".message[data-role=user]").first().getAttribute("data-session-id");
      if (microphoneOff) await page.getByRole("button", { name: "Switch microphone off" }).click();
      const startsBefore = await microphoneStarts();
      const speechTile = page.locator("a.readout[href='#settings/voice']");
      await speechTile.click();
      await expect(page.locator("#drawer-settings")).toBeVisible();
      await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
      // Moving to another settings tile must not restart listening behind the drawer.
      await page.locator("#readout-model").click();
      await expect(page.locator("#settings-model")).toBeVisible();
      expect(await microphoneStarts()).toBe(startsBefore);
      if (exit === "same tile") await page.locator("#readout-model").click();
      else if (exit === "Current log entry") await page.locator("#nav-conversation").click();
      else await page.keyboard.press("Escape");
      await expect(page.locator("#drawer-settings")).toBeHidden();
      await expect(page.locator("#voice-channel")).toHaveText(microphoneOff ? "Microphone off" : "Listening");
      if (microphoneOff) {
        expect(await microphoneStarts()).toBe(startsBefore);
        await expect(page.getByRole("button", { name: "Switch microphone on" })).toBeVisible();
        await page.getByRole("button", { name: "Switch microphone on" }).click();
      }
      await expect.poll(microphoneStarts).toBe(startsBefore + 1);
      await expect(page.locator(".message[data-role=user]")).toHaveCount(2, { timeout: 15000 });
      expect(await page.locator(".message[data-role=user]").last().getAttribute("data-session-id")).toBe(entryID);
      await page.getByRole("button", { name: "Switch microphone off" }).click();
    });
  }
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

async function captureSiteScreen(page: import("@playwright/test").Page, name: string) {
  await page.locator("#readout-project").evaluate((node) => {
    node.textContent = "Example project";
    node.removeAttribute("title");
  });
  await expect(page.locator("#readout-speech")).toHaveText("Nemotron · Kokoro");
  await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("video/assets", { recursive: true });
  await page.screenshot({ path: `site/assets/${name}.png`, animations: "disabled" });
  await copyFile(`site/assets/${name}.png`, `video/assets/${name}.png`);
}

async function soundNames(page: import("@playwright/test").Page) {
  return (await sounds(page)).map((sound) => sound.split(":")[0]);
}

/** Hold a speaking request before the test voice can produce any audio. */
async function holdSpeaking(page: import("@playwright/test").Page) {
  let pending: { message: string; server: import("@playwright/test").WebSocketRoute; browser: import("@playwright/test").WebSocketRoute; at: number } | undefined;
  const messages: string[] = [];
  let audioPackets = 0;
  let audioBytes = 0;
  await page.routeWebSocket("**/api/speech", (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => {
      if (typeof message !== "string") {
        audioPackets++;
        audioBytes += message.byteLength;
      } else {
        const data = JSON.parse(message) as { type: string; id?: number };
        messages.push(`Browser sent ${data.type}${data.id === undefined ? "" : ` (${data.id})`}`);
      }
      if (typeof message === "string" && JSON.parse(message).type === "speak") {
        pending = { message, server, browser, at: Date.now() };
      } else server.send(message);
    });
    server.onMessage((message) => {
      if (typeof message === "string") {
        const data = JSON.parse(message) as { type: string; phase?: string };
        const id = "id" in data && typeof data.id === "number" ? `, ${data.id}` : "";
        messages.push(`Voice server sent ${data.type}${data.phase ? ` (${data.phase}${id})` : id}`);
      }
      browser.send(message);
    });
  });
  return {
    pending: () => pending,
    diagnostics: () => ({ messages, audioPackets, audioBytes }),
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

/** Let the first officer's voice play, then hold the next part of the spoken reply and everything after it. */
async function holdLaterParts(page: import("@playwright/test").Page) {
  let held: (string | Buffer)[] | undefined;
  let done = false;
  let route: import("@playwright/test").WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/speech", (browser) => {
    const server = browser.connectToServer();
    route = browser;
    browser.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (!held && !done && typeof message === "string") {
        const data = JSON.parse(message) as { type: string; index?: number };
        if (data.type === "part-start" && data.index! > 0) held = [];
      }
      if (held) held.push(message);
      else browser.send(message);
    });
  });
  const stop = () => {
    if (!held) throw new Error("No part of the reply is being held.");
    const waiting = held;
    held = undefined;
    done = true;
    return waiting;
  };
  return {
    holding: () => !!held,
    release: () => { for (const message of stop()) route!.send(message); },
    /** Lets later voice messages through but never plays the held part. */
    drop: () => { stop(); },
    fail: (message: string) => { stop(); route!.send(JSON.stringify({ type: "error", message })); },
  };
}

for (const keyboard of [false, true]) {
  test(`console clarity: a browser-paused channel waits for ${keyboard ? "Space" : "a panel click"}, not microphone switching`, async ({ page }) => {
    const microphone = await controlledMicrophone(page, [0.1]);
    const pauseAudio = await blockAudioUntilInteraction(page);
    await launch(page, "example");
    await expect(page.locator("#voice-channel")).toHaveText("Paused", { timeout: 15000 });
    await expect(status(page)).toHaveText("Not listening");
    await expect(page.locator("#listen-toggle")).toHaveAttribute("data-act", "");
    await expect(page.locator("#status-detail")).toHaveText("The browser paused sound. Click the microphone, or press M.");
    await expect(page.locator("#welcome-title")).toBeHidden();
    if (keyboard) await page.keyboard.press("Space");
    else await page.locator("#status-detail").click();
    await expect(status(page)).toHaveText("Standing by");
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    await expect(page.locator("#status-detail")).toHaveText("Say “Computer”, then your request.");
    await expect(page.getByRole("heading", { name: "Please specify your request." })).toBeVisible();
    await expect(page.locator("#listen-toggle")).not.toHaveAttribute("data-act");
    await pauseAudio();
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(status(page)).toHaveText("Not listening");
    await expect(page.locator("#voice-channel")).toHaveText("Paused");
    await startListening(page);
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
    await expect(page.locator("#status-detail")).toHaveText("The microphone is off. Click the microphone, or press M.");
    await expect(page.locator("#welcome-title")).toBeHidden();
    await expect(page.locator("#listen-toggle")).toHaveAttribute("data-channel", "closed");
    await expect(page.locator("#listen-toggle")).toHaveAttribute("data-act", "");
    await page.getByRole("button", { name: "Switch microphone on" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    await expect(status(page)).not.toHaveText("Not listening");
    // Force the startup overlap on every PR, rather than only on a slower release runner.
    await page.addInitScript((startupLength) => {
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        if (this.buffer && Math.abs(this.buffer.duration - startupLength) < 0.02) {
          this.playbackRate.value = 0.1;
          this.addEventListener("ended", () => Object.assign(window, { testStartupEndedAt: performance.now() }), { once: true });
        }
        return start.apply(this, args);
      };
    }, SOUND_LENGTHS.startup);
    await page.reload();
    await expect(status(page)).toHaveText("Not listening", { timeout: 15000 });
    await startListening(page);
    // The app ignores its cue and a 200 ms echo tail; the test phrase must start after actual playback.
    await expect.poll(() => page.evaluate(() => {
      const ended = (window as unknown as { testStartupEndedAt?: number }).testStartupEndedAt;
      return ended !== undefined && performance.now() - ended >= 200;
    })).toBe(true);
    await microphone.start();
    await expect(page.locator(".message[data-role=user]")).toHaveCount(1, { timeout: 15000 });
    await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

test("console clarity: an already open channel needs no click or microphone switching", async ({ page }) => {
  const microphone = await controlledMicrophone(page, [0.1]);
  await launch(page, "example");
  await expect(page.locator("#voice-channel")).toHaveText("Listening", { timeout: 15000 });
  await expect(status(page)).toHaveText("Standing by");
  await expect(page.locator("#status-detail")).toHaveText("Say “Computer”, then your request.");
  await microphone.start();
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const action of ["click", "M", "Enter", "Space"]) {
  test(`console clarity: ${action} resumes a connected microphone without switching it off first`, async ({ page }) => {
    const labels = await watchStatus(page, "voice-channel");
    const microphone = await controlledMicrophone(page, [0.1]);
    await blockAudioUntilInteraction(page);
    await launch(page, "example");
    await expect(status(page)).toHaveText("Not listening", { timeout: 15000 });
    await expect(page.locator("#listen-toggle")).toHaveAttribute("title", "Resume listening (M)");
    await expect(page.locator("#listen-toggle")).toHaveAttribute("data-channel", "paused");
    const before = (await labels()).length;
    if (action === "click") await page.locator("#listen-toggle").click({ delay: 100 });
    else {
      if (action !== "M") await page.locator("#listen-toggle").focus();
      await page.keyboard.press(action);
    }
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    await expect(status(page)).toHaveText("Standing by");
    expect((await labels()).slice(before)).not.toContain("Microphone off");
    await microphone.start();
    await expect(page.locator(".message[data-role=user]")).toHaveCount(1, { timeout: 15000 });
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
  });
}

test("console clarity: microphone permission does not ask for an unrelated sound-unlocking click", async ({ page }) => {
  await blockAudioUntilInteraction(page);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await new Promise<void>((done) => Object.assign(window, { releaseMicrophone: done }));
      return original(constraints);
    };
  });
  await launch(page);
  await expect(status(page)).toHaveText("Not listening");
  await expect(page.locator("#voice-channel")).toHaveText("Starting");
  await expect(page.locator("#status-detail")).toHaveText("Starting the microphone. Allow access if your browser asks.");
  await expect(page.locator("#listen-toggle")).toBeDisabled();
  await expect(page.locator("#listen-toggle")).toHaveAttribute("data-channel", "opening");
  // The centre of the screen must not invite a request the computer cannot hear yet.
  await expect(page.locator("#welcome-title")).toBeHidden();
  await expect(page.locator("#listen-toggle")).not.toHaveAttribute("data-act");
  await page.evaluate(() => (window as unknown as { releaseMicrophone(): void }).releaseMicrophone());
  await expect(status(page)).toHaveText("Not listening", { timeout: 15000 });
  await expect(page.locator("#voice-channel")).toHaveText("Paused");
  await expect(page.locator("#welcome-title")).toBeHidden();
  await expect(page.locator("#listen-toggle")).toHaveAttribute("data-act", "");
  await page.getByRole("button", { name: "Resume listening", exact: true }).click();
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
  await expect(page.getByRole("heading", { name: "Please specify your request." })).toBeVisible();
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("console clarity: startup waits for permission and the open channel stays stable through speech and recognition", async ({ page }) => {
  const headings = await watchStatus(page);
  const microphone = await controlledMicrophone(page, [0.1]);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await new Promise<void>((done) => Object.assign(window, { releaseMicrophone: done }));
      return original(constraints);
    };
  });
  let transcript: (() => void) | undefined;
  await page.routeWebSocket("**/api/speech", (browser) => {
    const server = browser.connectToServer();
    server.onMessage((message) => {
      if (typeof message === "string" && JSON.parse(message).type === "transcript") {
        transcript = () => browser.send(message);
      } else browser.send(message);
    });
  });
  await launch(page, "example");
  await expect(status(page)).toHaveText("Not listening", { timeout: 3000 });
  await expect(page.locator("#voice-channel")).toHaveText("Starting");
  expect(await headings()).not.toContain("Standing by");
  await page.evaluate(() => (window as unknown as { releaseMicrophone(): void }).releaseMicrophone());
  await startListening(page);
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
  await microphone.start();
  await expect(page.locator("#voice-partial")).toContainText("Computer");
  await expect(status(page)).toHaveText("Standing by");
  await expect.poll(() => !!transcript, { timeout: 15000 }).toBe(true);
  await expect(page.locator("#status-detail")).toHaveText("Checking what you said.");
  await expect(page.locator("#status-detail")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#status-detail")).toHaveAttribute("aria-atomic", "true");
  await expect(status(page)).toHaveText("Standing by");
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
  expect(await headings()).not.toContain("Understanding");
  expect(await headings()).not.toContain("Listening");
  transcript!();
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  await expect(page.locator("#status-detail")).toContainText("The computer is speaking.");
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await expect(status(page)).toHaveText("Standing by");
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
  const sequence = await headings();
  expect(sequence.slice(sequence.indexOf("Not listening"))).toEqual([
    "Not listening", "Standing by", "Accessing", "Transmitting", "Standing by",
  ]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("console clarity: sending is not shown as accepted work and a real failure closes the channel", async ({ page }) => {
  const microphone = await controlledMicrophone(page, [0.1]);
  const speaking = await holdSpeaking(page);
  let send: import("@playwright/test").Route | undefined;
  await page.route(/\/api\/conversations\/[^/]+\/send$/, (route) => { send = route; });
  await launch(page, "example");
  await startListening(page);
  await microphone.start();
  await expect.poll(() => !!send, { timeout: 15000 }).toBe(true);
  await expect(status(page)).toHaveText("Standing by");
  await expect(page.locator("#status-detail")).toHaveText("Sending your request.");
  await send!.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test stand-in: the request was not accepted." }) });
  await expect.poll(() => !!speaking.pending()).toBe(true);
  speaking.fail("Test stand-in: the speaking connection failed.");
  await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
  await expect(status(page)).toHaveText("Not listening");
  await expect(page.locator("#notice")).toContainText("Test stand-in: the speaking connection failed.");
  expect(await soundNames(page)).not.toContain("request-accepted");
});

for (const keyboard of [false, true]) {
  test(`console clarity: ${keyboard ? "keyboard" : "button"} microphone switching does not hide work or playback`, async ({ page }, info) => {
    const headings = await watchStatus(page);
    const microphone = await controlledMicrophone(page, [0.1]);
    const speaking = await holdSpeaking(page);
    await launch(page, "slow");
    await startListening(page);
    await microphone.start();
    await expect(status(page)).toHaveText("Accessing", { timeout: 15000 });
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    if (keyboard) await page.keyboard.press("m");
    else await page.getByRole("button", { name: "Switch microphone off" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
    await expect(status(page)).toHaveText("Accessing");
    await expect.poll(() => !!speaking.pending(), { timeout: 25000 }).toBe(true);
    await expect(status(page)).toHaveText("Accessing");
    await expect(page.locator("#status-detail")).toHaveText("Preparing the spoken reply.");
    speaking.release();
    await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
    await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
    await expect(page.locator("#status-detail")).toHaveText("The computer is speaking. Choose Stop speaking to interrupt.");
    if (keyboard) await page.keyboard.press("m");
    else await page.getByRole("button", { name: "Switch microphone on" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    await expect(status(page)).toHaveText("Transmitting");
    await page.screenshot({ path: info.outputPath("console-test-stand-in.png"), fullPage: true });
    await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
    await expect(status(page)).toHaveText("Standing by");
    expect(await headings()).not.toContain("Understanding");
    expect(await headings()).not.toContain("Preparing reply");
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await expect(status(page)).toHaveText("Not listening");
  });
}

for (const mode of ["approval", "question"] as const) {
  test(`console clarity: a pending ${mode} stays prominent while its explanation is spoken`, async ({ page }) => {
    const microphone = await controlledMicrophone(page, [0.1]);
    const speaking = await holdSpeaking(page);
    await launch(page, mode);
    await startListening(page);
    await microphone.start();
    const heading = mode === "approval" ? "Decision needed" : "Answer needed";
    await expect(status(page)).toHaveText(heading, { timeout: 15000 });
    await expect.poll(() => !!speaking.pending()).toBe(true);
    if (mode === "question") await expect(page.locator("#status-detail")).toHaveText("Answer the question on screen.");
    speaking.release();
    await expect(page.getByRole("button", { name: "Stop speaking", exact: true })).toBeVisible();
    await expect(page.locator("#status-detail")).toContainText("The computer is speaking.");
    await expect(status(page)).toHaveText(heading);
    await expect(page.locator("#voice-console")).toHaveAttribute("data-activity", "attention");
    if (mode === "question") {
      await expect(page.locator("#status-detail")).toHaveText("The computer is speaking. Answer the question on screen.");
      await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
      await expect(page.locator("#status-detail")).toHaveText("Say your answer, or choose it on screen.");
    }
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
    await expect(status(page)).toHaveText(heading);
    if (mode === "approval") await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
    await expect(status(page)).toHaveText(heading);
    if (mode === "approval") await expect(page.locator("#status-detail")).toHaveText("Choose Allow once or Deny on screen.");
    else await expect(page.locator("#status-detail")).toHaveText("Answer the question on screen.");
  });
}

/** Start test speech only after the microphone and the real voice detector are ready. */
async function controlledMicrophone(page: import("@playwright/test").Page, phraseStarts = [0.5, 3.5]) {
  await page.addInitScript(({ voice, phraseStarts }) => {
    Object.assign(window, { useControlledMicrophoneAudio: true });
    const original = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function () {
      const destination = this.createMediaStreamDestination();
      const audio = this.createBuffer(1, 16000 * 20, 16000);
      for (const seconds of phraseStarts) audio.getChannelData(0).set(voice, 16000 * seconds);
      Object.assign(window, { startMicrophone: () => {
        const source = this.createBufferSource();
        source.buffer = audio;
        source.connect(destination);
        source.start();
      } });
      return original.call(this, destination.stream);
    };
  }, { voice: Array.from(syntheticVoice(1, 0.1)), phraseStarts });
  let audioBytes = 0;
  const checks: number[] = [];
  const commits: number[] = [];
  const requests: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload !== "string") audioBytes += payload.length;
    else if (JSON.parse(payload).type === "check-turn") checks.push(audioBytes);
    else if (JSON.parse(payload).type === "commit") commits.push(audioBytes);
  }));
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/conversations\/[^/]+\/send$/.test(request.url())) requests.push(request.url());
  });
  return { checks, commits, requests, bytes: () => audioBytes, start: () => page.evaluate(() => (window as unknown as { startMicrophone(): void }).startMicrophone()) };
}

/** Hold real test-service results until the test has reached the state they must arrive in. */
async function holdTurnResults(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const received: number[] = [];
    Object.assign(window, { receivedTurnResults: received });
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        this.addEventListener("message", (event: MessageEvent) => {
          if (typeof event.data !== "string") return;
          const data = JSON.parse(event.data);
          // Mark receipt after the app's synchronous message handler has run.
          if (data.type === "turn-result") setTimeout(() => received.push(data.id), 0);
        });
      }
    };
  });
  const pending: { id: number; complete: boolean; message: string; browser: import("@playwright/test").WebSocketRoute }[] = [];
  await page.routeWebSocket("**/api/speech", (browser) => {
    const server = browser.connectToServer();
    server.onMessage((message) => {
      if (typeof message === "string") {
        const data = JSON.parse(message);
        if (data.type === "turn-result") {
          pending.push({ id: data.id, complete: data.complete, message, browser });
          return;
        }
      }
      browser.send(message);
    });
  });
  return {
    pending,
    async release(index: number) {
      const result = pending[index];
      if (!result) throw new Error("No pause detection result is waiting.");
      result.browser.send(result.message);
      await expect.poll(() => page.evaluate(() => (window as unknown as { receivedTurnResults: number[] }).receivedTurnResults)).toContain(result.id);
    },
  };
}

for (const mode of ["smart-turn", "smart-turn-late"] as const) {
  test(`${mode}: a thinking pause stays in one request and resumed speech rejects stale completion`, async ({ page }) => {
    const capture = await controlledMicrophone(page);
    const results = await holdTurnResults(page);
    await launch(page, mode);
    await startListening(page);
    await capture.start();
    await expect.poll(() => results.pending.length, { timeout: 10000 }).toBe(1);
    expect(capture.checks).toHaveLength(1);
    expect(capture.commits).toEqual([]);
    expect(capture.requests).toEqual([]);
    expect(results.pending[0]!.complete).toBe(mode === "smart-turn-late");
    if (mode === "smart-turn") await results.release(0);
    await expect.poll(() => results.pending.length, { timeout: 10000 }).toBe(2);
    expect(capture.checks).toHaveLength(2);
    if (mode === "smart-turn-late") {
      await results.release(0);
      const afterStaleResult = capture.bytes();
      // Another detected packet proves queued completion work did not stop capture.
      await expect.poll(capture.bytes).toBeGreaterThan(afterStaleResult);
    }
    expect(capture.commits).toEqual([]);
    expect(capture.requests).toEqual([]);
    expect(results.pending[1]!.complete).toBe(true);
    const releasedAt = capture.bytes();
    await results.release(1);
    await expect.poll(() => capture.commits.length, { timeout: 10000 }).toBe(1);
    expect(capture.checks).toHaveLength(2);
    expect(capture.commits[0]).toBeGreaterThan(32000 * 4);
    expect(capture.commits[0]! - releasedAt).toBeLessThan(32000 * 0.5);
    await expect.poll(() => capture.requests.length).toBe(1);
    await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
    await expect(page.locator(".message[data-role=user]")).toContainText("Computer, hello there");
  });
}

test("Smart Turn stops visibly on checker failure without submitting an unfinished request", async ({ page }) => {
  const capture = await controlledMicrophone(page);
  await launch(page, "smart-turn-error");
  await startListening(page);
  await capture.start();
  await expect(page.locator("#notice")).toContainText("Test-only pause checker failure.", { timeout: 10000 });
  await expect(status(page)).toHaveText("Not listening");
  expect(capture.commits).toEqual([]);
  expect(capture.requests).toEqual([]);
});

test("microphone off during a Smart Turn check discards its late completion", async ({ page }) => {
  const capture = await controlledMicrophone(page);
  const results = await holdTurnResults(page);
  await launch(page, "smart-turn-late");
  await startListening(page);
  await capture.start();
  await expect.poll(() => results.pending.length, { timeout: 10000 }).toBe(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await results.release(0);
  expect(capture.commits).toEqual([]);
  expect(capture.requests).toEqual([]);
  await expect(status(page)).toHaveText("Not listening");
});

test("\"Computer, speak faster\" confirms at the faster speed, is not sent as a request, and later replies keep the speed", async ({ page }) => {
  const frames: { text?: string; speed?: number }[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string" && JSON.parse(payload).type === "speak") frames.push(JSON.parse(payload));
  }));
  await launch(page, "faster");
  await startListening(page);
  await expect.poll(() => frames.find((frame) => frame.text === "Speaking faster."), { timeout: 20000 }).toEqual(expect.objectContaining({ speed: 1.1 }));
  await expect.poll(() => page.evaluate(() => localStorage.getItem("picard-speaking-speed"))).toBe("1.1");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(".message[data-role=user]")).toContainText("Computer, hello there");
  const later = () => frames.slice(frames.findIndex((frame) => frame.text === "Speaking faster.") + 1);
  await expect.poll(() => later().length, { timeout: 15000 }).toBeGreaterThan(0);
  expect(later().every((frame) => frame.speed === 1.1)).toBe(true);
});

test("after a reload, \"Computer, speak slowest\" lets the next follow-up in the same log entry go without \"Computer\"", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("picard-tribute-enabled", "false"));
  const entries: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/conversations\/[^/]+\/send$/.test(request.url())) entries.push(request.url());
  });
  await launch(page, "speed-follow-up");
  await startListening(page);
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(page.getByRole("button", { name: "Stop speaking", exact: true })).toBeHidden({ timeout: 15000 });
  await page.reload();
  await startListening(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("picard-speaking-speed")), { timeout: 20000 }).toBe("0.8");
  await expect.poll(() => entries.length, { timeout: 20000 }).toBe(2);
  expect(entries[1]).toBe(entries[0]);
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Hello again");
});

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

test("after a successful briefing, officers speak without a routine computer close", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "crew");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect.poll(() => spoken.find((answer) => answer.some((part) => part.text.includes("Data supplied"))), { timeout: 15000 }).toEqual([
    { text: "Test stand-in: Data supplied an investigation report.", speaker: "picard-data" },
  ]);
});

test("officers keep their report order without moving Riker last", async ({ page }) => {
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
  // Each officer wears their division's colour and rank pips.
  const riker = page.locator(".crew-report").filter({ has: page.getByText("Riker", { exact: true }) });
  await expect(riker).toHaveAttribute("data-division", "command");
  await expect(riker.locator(".rank")).toHaveAttribute("title", "Commander");
  await expect(riker.locator(".rank-pips")).toHaveText("●●●");
  await expect(page.locator(".crew-report").filter({ has: page.getByText("Data", { exact: true }) })).toHaveAttribute("data-division", "operations");
  // Division colours must not be mistaken for a red alert, the computer or a yellow alert.
  const colours = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"));
    const value = (name: string) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color.match(/\d+/g)!.slice(0, 3).map(Number);
    };
    const result = { command: value("--command"), operations: value("--operations"), red: value("--red"), orange: value("--orange"), gold: value("--gold") };
    probe.remove();
    return result;
  });
  const apart = (a: number[], b: number[]) => Math.hypot(...a.map((value, i) => value - b[i]));
  expect(apart(colours.command, colours.red)).toBeGreaterThan(40);
  expect(apart(colours.operations, colours.orange)).toBeGreaterThan(40);
  expect(apart(colours.operations, colours.gold)).toBeGreaterThan(40);
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toEqual([
    { text: "Test stand-in: I recommend the smaller repair, Captain.", speaker: "picard-riker" },
    { text: "Test stand-in: Data found a small repair.", speaker: "picard-data" },
  ]);
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report)")).toContainText("The reports are on screen.");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("Riker's later conversational question is spoken once as part of his own report", async ({ page }) => {
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

test("a long explanation speaks through its final paragraph while the technical appendix stays on screen", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "explanation");
  await startListening(page);
  await expect(page.locator("#messages pre")).toContainText("const value = 42;", { timeout: 45000 });
  await expect(page.locator("#messages")).toContainText("APPENDIX_SENTINEL");
  await expect.poll(() => spoken.find((text) => text.includes("The final point is to hear the complete explanation.")), { timeout: 15000 }).toBeTruthy();
  const answer = spoken.find((text) => text.includes("Here is the full explanation."))!;
  expect(answer.length).toBeGreaterThan(1000);
  expect(answer).not.toMatch(/APPENDIX|const value|On screen/);
  await expect(page.getByRole("button", { name: "Stop speaking", exact: true })).toBeHidden({ timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a briefing speaks the computer's close when an officer's action was denied after a partial report", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-failure");
  await startListening(page);
  await expect(page.locator(".message.current[data-role=assistant]")).toHaveCount(3, { timeout: 20000 });
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toEqual([
    { text: "Test stand-in: I recommend the smaller repair, Captain.", speaker: "picard-riker" },
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
    { text: "Test stand-in: I recommend the smaller repair, Captain.", speaker: "picard-riker" },
  ]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a second report from the same officer does not hide a different failed assignment", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-repeat");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: Data found a small repair.", speaker: "picard-data" },
    { text: "Test stand-in: I recommend the smaller repair, Captain.", speaker: "picard-riker" },
    { text: "Test stand-in: Data's action was denied. No command was run." },
  ]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("an earlier successful step does not hide the officer's final failed action", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-late-failure");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: I recommend the smaller repair, Captain.", speaker: "picard-riker" },
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
    { text: "Test stand-in: I recommend the smaller repair, Captain.", speaker: "picard-riker" },
  ]);
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report)")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("a copied computer close cannot hide an officer's failed action", async ({ page }) => {
  const spoken = spokenParts(page);
  await launch(page, "briefing-failure-copy");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toEqual([
    { text: "Test stand-in: I recommend the smaller repair, Captain.", speaker: "picard-riker" },
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
  // A real failure gets a red alert frame; the exact error stays readable and the label is decoration.
  const failed = page.locator(".message.current[data-role=assistant]:not(.crew-report)");
  await expect(failed).toHaveAttribute("data-alert", "red");
  await expect(failed.locator(".alert-label")).toHaveText("Red alert");
  await expect(failed.locator(".alert-label")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".scan-bar")).toBeHidden();
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
  // The LCARS scanning bar moves beside the written progress while the work runs.
  await expect(working.locator(".scan-bar")).toBeVisible();
  await expect(status(page)).toHaveText("Accessing");
  // The working line sits right after the latest request, in the conversation, not in the console.
  const request = (await page.locator(".message.current[data-role=user]").boundingBox())!;
  const line = (await working.boundingBox())!;
  expect(line.y).toBeGreaterThan(request.y);
  await expect(page.locator(".message-error")).toHaveCount(0);
  await expect(page.locator(".message.current[data-role=assistant]").last()).toContainText("Test stand-in: Captain, no real news was searched.", { timeout: 15000 });
  await expect(page.locator(".step-failures summary")).toHaveText("1 step did not work");
  await expect(page.locator(".message.current[data-role=assistant] .message-header strong").last()).toHaveText("Data");
  await expect(working).toBeHidden();
  await expect(page.locator(".scan-bar")).toBeHidden();
  // Data wears operations gold and a lieutenant commander's pips; a folded step is not a red alert.
  const report = page.locator(".message.current[data-role=assistant]").last();
  await expect(report).toHaveAttribute("data-division", "operations");
  await expect(report.locator(".rank")).toHaveAttribute("title", "Lieutenant Commander");
  await expect(report.locator(".rank-pips")).toHaveText("●●○");
  await expect(report).not.toHaveAttribute("data-alert");
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
  await expect(page.locator(".approval")).toHaveAttribute("data-alert", "yellow");
  await expect(page.locator("#entry-stardate")).toHaveText(/^Captain’s log, stardate -?\d+\.\d$/);
  await expect(page.locator(".crew-report")).toContainText("Data supplied an investigation report.");
  await page.getByRole("button", { name: "Switch microphone off", exact: true }).click();
  await page.getByRole("button", { name: "Belay that", exact: true }).click();
  await expect(page.locator("#approvals")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Belay that", exact: true })).toBeHidden();
  await expect(page.locator(".message.current[data-role=assistant]:not(.crew-report)")).toContainText("Work stopped before it finished.");
  // Work the Captain stopped is not a failure, so it gets no red alert.
  await expect(page.locator(".message[data-alert]")).toHaveCount(0);
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
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
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
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Computer, keep the exact name and do not change files.");
  expect(commands).toContain("stop-speaking");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});
}

test("quiet microphone speech interrupts an answer and preserves the full request", async ({ page }) => {
  const capture = await controlledMicrophone(page, [0.5]);
  await page.addInitScript(() => {
    const node = AudioWorkletNode;
    window.AudioWorkletNode = class extends node {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args);
        this.port.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
          if (document.querySelector("#status")?.textContent !== "Transmitting") return;
          const samples = new Int16Array(event.data);
          for (let index = 0; index < samples.length; index++) samples[index]! /= 32;
        });
        this.port.start();
      }
    };
  });
  const commands: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string") commands.push(JSON.parse(payload).type);
  }));
  await launch(page, "interrupt-request");
  await startListening(page);
  await capture.start();
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  await capture.start();
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Computer, keep the exact name and do not change files.");
  expect(commands).toContain("stop-speaking");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

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
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  await expect.poll(() => transcripts.includes("Hello again"), { timeout: 15000 }).toBe(true);
  await expect(status(page)).toHaveText("Transmitting");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  expect(commands).not.toContain("stop-speaking");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const muted of [false, true]) {
test(`clicking the computer panel interrupts speech with the microphone ${muted ? "off" : "on"}`, async ({ page }) => {
  await launch(page, "interrupt-room");
  await startListening(page);
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  if (muted) await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.locator("#status").click();
  await expect(status(page)).toHaveText(muted ? "Not listening" : "Standing by");
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
  expect((await arrivals())[0]).toMatch(/^startup: (Not listening|Standing by)$/);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Switch microphone on" }).click();
  await startListening(page);
  await page.getByRole("button", { name: "New log entry", exact: true }).click();
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  expect(await arrivals()).toHaveLength(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.reload();
  await startListening(page);
  await expect.poll(arrivals).toHaveLength(1);
  expect((await arrivals())[0]).toMatch(/^startup: (Not listening|Standing by)$/);
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
    await blockAudioUntilInteraction(page);
    await launch(page, "no-speech");
    const played = () => page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds);
    expect(await played()).toEqual([]);
    await page.locator("#speech-first-start-title").click();
    await expect.poll(played).toEqual(["startup: Computer voice offline"]);
    await expect(page.locator("#voice-console")).toBeHidden();
    await expect(page.locator("#prepare-computer")).toBeVisible();
  } finally { await browser.close(); }
});

test("a slow arrival sound never interrupts a spoken request", async ({ page }) => {
  const capture = await controlledMicrophone(page, [0.5]);
  let release!: () => void;
  const ready = new Promise<void>((done) => { release = done; });
  await page.route("**/api/sounds/startup", async (route) => { await ready; await route.continue(); });
  await launch(page);
  await startListening(page);
  await capture.start();
  await expect(status(page)).toHaveText("Standing by");
  await expect(page.locator("#voice-channel")).toHaveText("Listening");
  await expect.poll(capture.bytes).toBeGreaterThan(0);
  const loaded = page.waitForResponse("**/api/sounds/startup");
  release();
  await (await loaded).finished();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]")).toContainText("Computer, hello there");
  expect(capture.requests).toHaveLength(1);
  const arrivals = await page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds.filter((sound) => sound.startsWith("startup:")));
  expect(arrivals).toEqual([]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("start-up: the first answer brings the senior officers to report, and Dismissed returns the bridge", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "example", ["--model-setup"]);
  await expect(page.locator("#first-run-title")).toHaveText("Welcome aboard, Captain.");
  await page.getByRole("button", { name: "Begin start-up" }).click();
  await expect(page.locator("#first-run-title")).toHaveText("Open a channel");
  await expect(page.locator("#voice-bar-text")).toHaveText("Voice systems online");
  await page.getByRole("button", { name: "Open a channel" }).click();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#first-run-title")).toHaveText("Senior officers reporting");
  await expect(page.locator("#system-comms")).toHaveText("Online");
  await expect(page.locator("#crew-roster li")).toHaveCount(6);
  await expect(page.locator("#crew-roster")).toContainText("Number One, what are our options?");
  await expect.poll(() => spoken.join(" | ")).toContain("Your senior officers are standing by.");
  expect(spoken[0]).toBe("All systems online. Say “Computer”, then give your order.");
  // Reloading during the officers' report keeps it until the Captain dismisses it.
  await page.reload();
  await expect(page.locator("#first-run-title")).toHaveText("Senior officers reporting");
  await expect(page.locator("#crew-roster li")).toHaveCount(6);
  await page.getByRole("button", { name: "Dismissed" }).click();
  await expect(page.locator("#first-run-setup")).toBeHidden();
  await expect(page.locator("#voice-console")).toBeFocused();
  await page.reload();
  await expect(page.locator("#first-run-setup")).toBeHidden();
});

test("start-up: the first answer waits while its voice is preparing, then appears when it starts", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example", ["--model-setup"]);
  await page.getByRole("button", { name: "Begin start-up" }).click();
  await page.getByRole("button", { name: "Open a channel" }).click();
  // The first held line is the welcome; let it through, then hold the answer's voice.
  await expect.poll(() => voice.pending()?.message ?? "", { timeout: 15000 }).toContain("All systems online");
  voice.release();
  await expect.poll(() => voice.pending()?.message ?? "", { timeout: 15000 }).toMatch(/"speak"/);
  await expect(status(page)).toHaveText("Accessing");
  await expect(page.locator("#status-detail")).toHaveText("Preparing the spoken reply.");
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.release();
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1);
});

test("start-up: a failed first order keeps start-up waiting for an answer and does not call the officers", async ({ page }) => {
  await launch(page, "broken", ["--model-setup"]);
  await page.getByRole("button", { name: "Begin start-up" }).click();
  await page.getByRole("button", { name: "Open a channel" }).click();
  await expect(page.locator(".message-error")).toContainText("The test model cannot be reached.", { timeout: 15000 });
  await expect(page.locator("#first-run-title")).toHaveText("All systems online");
  await expect(page.locator("#crew-roster")).toBeHidden();
  await page.reload();
  await expect(page.locator("#first-run-title")).toHaveText("All systems online");
});

test("start-up: the next order ends the officers' report", async ({ page }) => {
  await launch(page, undefined, ["--model-setup"]);
  await page.getByRole("button", { name: "Begin start-up" }).click();
  await page.getByRole("button", { name: "Open a channel" }).click();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]").last()).toContainText("Hello again", { timeout: 15000 });
  await expect(page.locator("#first-run-setup")).toBeHidden();
});

test("start-up: with the Bridge crew off, the first answer completes start-up without the officers' report", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "example", ["--model-setup"]);
  await page.getByRole("switch", { name: "Bridge crew", exact: true }).uncheck();
  await page.getByRole("button", { name: "Begin start-up" }).click();
  await page.getByRole("button", { name: "Open a channel" }).click();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#first-run-setup")).toBeHidden();
  await expect(page.locator("#crew-roster")).toBeHidden();
  expect(spoken.join(" | ")).not.toContain("senior officers");
});

test("listening stays on; “Computer” starts a task, follow-ups need no “Computer”; the app always opens listening", async ({ page }, info) => {
  await launch(page);
  await expect(page.getByRole("button", { name: "Start listening" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(status(page)).toHaveText("Transmitting");
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
  expect(await soundNames(page)).toEqual(["request-accepted", "request-accepted"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("spoken-conversation.png"), fullPage: true });

  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(status(page)).toHaveText("Not listening");
  await expect(page.locator("#status-detail")).toHaveText("The microphone is off. Click the microphone, or press M.");
  await page.getByRole("button", { name: "Switch microphone on" }).click();
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  // The M key switches it off and on too.
  await page.keyboard.press("m");
  await expect(status(page)).toHaveText("Not listening");
  await page.keyboard.press("m");
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
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
      await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
      if (keyboard) await page.keyboard.press("m");
      else await page.getByRole("button", { name: "Switch microphone off" }).click();
      await expect(status(page)).toHaveText("Not listening");
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

for (const action of ["reload", "reopen", "new entry tile"] as const) {
  test(`${action} ${action === "new entry tile" ? "starts a new" : "keeps the current"} log entry for the next addressed request`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("picard-tribute-enabled", "false"));
    const entries: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/conversations\/[^/]+\/send$/.test(request.url())) entries.push(request.url());
    });
    await launch(page, "resume");
    await startListening(page);
    await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await expect(page.getByRole("button", { name: "Stop speaking", exact: true })).toBeHidden({ timeout: 15000 });
    if (action === "new entry tile") {
      await page.getByRole("button", { name: "New log entry", exact: true }).click();
      await page.getByRole("button", { name: "Switch microphone on" }).click();
    } else {
      await page.reload();
      await startListening(page);
      if (action === "reopen") {
        await page.getByRole("link", { name: "Captain’s log" }).click();
        await page.locator("#conversations .conversation-button", { hasText: "hello there" }).click();
      }
    }
    await startListening(page);
    await expect.poll(() => entries.length, { timeout: 20000 }).toBe(2);
    if (action === "new entry tile") expect(entries[1]).not.toBe(entries[0]);
    else expect(entries[1]).toBe(entries[0]);
    await expect(page.locator(".message[data-role=user]")).toHaveCount(action === "new entry tile" ? 1 : 2);
    await expect(page.locator(".message[data-role=user]").last()).toContainText("Computer, hello again");
    await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
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
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  expect((await sounds(page)).some((sound) => sound.startsWith("tribute-fact:"))).toBe(false);
  expect(spoken).toHaveLength(2);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("facts stay silent and listening resumes after the answer, even with the old preference", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem("picard-tribute-spoken", "true");
  });
  const spoken = spokenText(page);
  const requestedSounds: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/sounds/")) requestedSounds.push(new URL(request.url()).pathname);
  });
  await launch(page, "tribute");
  await startListening(page);
  await expect(page.locator(".tribute-fact")).toHaveCount(1, { timeout: 20000 });
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  expect(spoken).toHaveLength(2);
  expect(spoken.some((text) => /^(Picard|Patrick Stewart) fact\./.test(text))).toBe(false);
  expect(requestedSounds.sort()).toEqual(Object.keys(SOUND_LENGTHS).map((name) => `/api/sounds/${name}`).sort());
  const timeline = await page.evaluate(() => (window as unknown as {
    audioTimeline: { name: string; at: number; end: number; capture: boolean }[];
  }).audioTimeline);
  expect(timeline.at(-1)?.name).toBe("speech");
  expect((await sounds(page)).every((sound) => sound.startsWith("request-accepted:"))).toBe(true);
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await page.getByRole("switch", { name: "Tribute", exact: true }).check();
  await expect(page.locator(".tribute-fact")).toHaveCount(1);
  expect((await sounds(page)).some((sound) => sound.startsWith("tribute-fact:"))).toBe(false);
  expect(requestedSounds.some((path) => path.endsWith("/tribute-fact"))).toBe(false);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("turning Tribute off leaves the spoken answer uninterrupted and facts silent", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem("picard-tribute-spoken", "true");
  });
  const spoken = spokenText(page);
  await launch(page, "tribute");
  await startListening(page);
  await expect(page.locator(".tribute-fact")).toHaveCount(1, { timeout: 20000 });
  await expect(status(page)).toHaveText("Transmitting");
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

test("Tribute off cancels a pending story invitation without cutting off the answer", async ({ page }) => {
  const held = await holdSpeaking(page);
  const spoken = spokenText(page);
  await launch(page, "picard");
  await startListening(page);
  await expect.poll(() => !!held.pending(), { timeout: 15000 }).toBe(true);
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  held.release();
  await expect(page.locator(".message[data-role=assistant]")).toContainText("Jean-Luc Picard", { timeout: 15000 });
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  expect(spoken).toHaveLength(1);
  expect(spoken.some((text) => text.includes("I can tell you"))).toBe(false);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

test("Tribute off stops a story invitation already being spoken", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "picard");
  await startListening(page);
  await expect.poll(() => spoken.some((text) => text.includes("I can tell you")), { timeout: 15000 }).toBe(true);
  await expect(status(page)).toHaveText("Transmitting");
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await expect(status(page)).toHaveText("Standing by", { timeout: 5000 });
  await expect(page.getByRole("button", { name: "Stop speaking", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const action of ["Stop speaking", "New log entry", "Settings", "Microphone off"] as const) {
  test(`${action} leaves automatic facts silent`, async ({ page }) => {
    await page.addInitScript(() => {
      Math.random = () => 0;
      localStorage.setItem("picard-tribute-spoken", "true");
    });
    const spoken = spokenText(page);
    await launch(page, "tribute");
    await startListening(page);
    await expect(page.locator(".tribute-fact")).toHaveCount(1, { timeout: 20000 });
    await expect(status(page)).toHaveText("Transmitting");
    if (action === "Settings") await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
    else if (action === "Microphone off") await page.getByRole("button", { name: "Switch microphone off" }).click();
    else await page.getByRole("button", { name: action, exact: true }).click();
    if (action === "Settings") await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
    if (action === "Microphone off") await expect(status(page)).toHaveText("Not listening", { timeout: 10000 });
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
  // A decision waiting for the Captain gets a yellow alert frame without changing its heading.
  await expect(page.locator(".approval")).toHaveAttribute("data-alert", "yellow");
  await expect(page.locator(".approval .alert-label")).toHaveText("Yellow alert");
  await expect(page.getByRole("button", { name: "Allow once" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(status(page)).toHaveText("Not listening");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  expect(await soundNames(page)).toEqual(["request-accepted"]);
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
  await expect(status(page)).toHaveText("Not listening");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  // Spoken answers to the question do not play the request-accepted sound.
  expect(await soundNames(page)).toEqual(["request-accepted"]);
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
  expect(await soundNames(page)).toEqual(["request-accepted"]);
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toBe("Work stopped, Captain.");
  await expect(status(page)).toHaveText(/Transmitting|Accessing|Standing by/);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  // Stopping by voice is not a failure, so no failure sound plays.
  expect(await soundNames(page)).toEqual(["request-accepted"]);
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
  expect(await soundNames(page)).toEqual(["request-accepted", "request-failed"]);
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

test("the Project folder form refuses a missing folder, clears the screen for a new one, and reopens the earlier entry on return", async ({ page }) => {
  const empty = await realpath(await mkdtemp(join(tmpdir(), "picard-project-")));
  test.info().attachments.push({ name: "empty project", contentType: "text/plain", body: Buffer.from(empty) });
  try {
    await launch(page, "example");
    await startListening(page);
    const reply = page.locator(".message[data-role=assistant]");
    await expect(reply).toHaveCount(1, { timeout: 15000 });
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    const original = await page.locator("#project-path").inputValue();
    const folderField = page.getByLabel("Full folder path");
    await page.locator("#readout-project").click();
    await folderField.fill(join(empty, "missing"));
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.locator("#notice-text")).toContainText("Could not open that folder.");
    await expect(page.locator("#readout-project")).toHaveText(basename(original));
    await expect(reply).toHaveCount(1);

    await folderField.fill(empty);
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.locator("#readout-project")).toHaveText(basename(empty));
    await expect(page.locator("#drawer-settings")).toBeHidden();
    await expect(page.locator(".message")).toHaveCount(0);
    await expect(page.locator("#workspace-caption")).toContainText(empty);

    await page.locator("#readout-project").click();
    await folderField.fill(original);
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.locator("#readout-project")).toHaveText(basename(original));
    await expect(reply).toHaveCount(1, { timeout: 15000 });
    await expect(reply).toContainText(/settings test/i);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("with finished work, “Belay that” says no work is running, and speed changes stop at the fastest", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "refusal-idle");
  await startListening(page);
  const expected = ["No work is running.", "Speaking at the fastest speed.", "This is already the fastest speaking speed."];
  await expect.poll(() => spoken.filter((text) => expected.includes(text)), { timeout: 40000 }).toEqual(expected);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  expect(await page.evaluate(() => localStorage.getItem("picard-speaking-speed"))).toBe("1.2");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
});

for (const [mode, refusal, waiting] of [
  ["refusal-approval", "A decision is needed first. Choose Allow once or Deny on screen.", "Approval required."],
  ["refusal-question", "Please answer the question on screen first.", "Additional information required."],
  ["refusal-busy", "Work is in progress. Say “Belay that” to cancel it first.", undefined],
] as const) {
  test(`${mode}: “New log entry” is refused while the current entry needs attention, and the entry stays open`, async ({ page }) => {
    const spoken = spokenText(page);
    await launch(page, mode);
    await startListening(page);
    if (waiting) await expect(page.getByRole("heading", { name: waiting })).toBeVisible({ timeout: 15000 });
    else await expect(page.getByRole("button", { name: "Belay that", exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => spoken, { timeout: 20000 }).toContain(refusal);
    expect(spoken).not.toContain("Standing by for a new log entry.");
    await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
    if (waiting) await expect(page.getByRole("heading", { name: waiting })).toBeVisible();
    await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

test("the Belay that button cancels spoken work", async ({ page }) => {
  await launch(page, "long");
  await startListening(page);
  await expect(page.getByRole("button", { name: "Belay that" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Belay that" }).click();
  await expect(status(page)).toHaveText("Not listening", { timeout: 10000 });
  await expect(page.getByRole("button", { name: "Belay that" })).toBeHidden();
});

test("a question can also be answered by choosing on screen", async ({ page }) => {
  await launch(page, "choose");
  await startListening(page);
  await expect(page.getByRole("heading", { name: "Additional information required." })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".approval")).toHaveAttribute("data-alert", "yellow");
  await expect(page.locator(".approval .alert-label")).toHaveText("Yellow alert");
  await page.getByRole("radio", { name: "Explain first" }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.locator("#messages")).toContainText('Your test answer was received: [["Explain first"]].', { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

for (const answer of ["screen", "voice", "another page", "retry"] as const) {
  test(`an answered question is not replayed while work resumes after a pause (${answer})`, async ({ page }) => {
    const spoken = spokenText(page);
    await launch(page, answer === "voice" ? "question" : "choose", ["--paused-question"]);
    await startListening(page);
    await expect.poll(() => spoken[0], { timeout: 15000 }).toBe("Which approach should I use? The options are Small change or Explain first.");
    if (answer !== "voice") {
      await expect(page.locator(".message[data-role=assistant]")).toContainText("Which approach should I use?");
      const answeringPage = answer === "another page" ? await page.context().newPage() : page;
      if (answeringPage !== page) {
        await answeringPage.goto(page.url());
        await expect(answeringPage.getByRole("heading", { name: "Additional information required." })).toBeVisible();
      }
      await answeringPage.getByRole("radio", { name: "Explain first" }).check();
      if (answer === "retry") {
        await page.route("**/api/questions/*", (route) => route.fulfill({
          status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test stand-in: the answer could not be sent." }),
        }), { times: 1 });
        await page.getByRole("button", { name: "Send answer" }).click();
        await expect(page.locator("#notice-text")).toContainText("the answer could not be sent");
        await expect(page.getByRole("heading", { name: "Additional information required." })).toBeVisible();
      }
      await answeringPage.getByRole("button", { name: "Send answer" }).click();
      if (answeringPage !== page) {
        await expect(answeringPage.getByRole("heading", { name: "Additional information required." })).toHaveCount(0);
        await answeringPage.close();
      }
    }
    await expect(page.getByRole("heading", { name: "Additional information required." })).toHaveCount(0, { timeout: 25000 });
    await expect.poll(() => spoken, { timeout: 15000 }).toEqual([
      "Which approach should I use? The options are Small change or Explain first.",
      'Your test answer was received: [["Explain first"]].',
    ]);
    await expect(page.locator(".message[data-role=assistant]").last()).toContainText("Your test answer was received");
    await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

for (const finish of ["voice", "screen", "retry"] as const) {
  test(`several questions accept spoken answers in order (${finish})`, async ({ page }) => {
    test.setTimeout(65000);
    const spoken = spokenText(page);
    await launch(page, "question", ["--multiple-questions",
      ...(finish === "screen" ? ["--finish-on-screen"] : []),
      ...(finish === "retry" ? ["--retry-answer"] : []),
    ]);
    if (finish === "retry") {
      await page.route("**/api/questions/*", (route) => route.fulfill({
        status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test stand-in: the answer could not be sent." }),
      }), { times: 1 });
    }
    await startListening(page);
    await expect.poll(() => spoken[1], { timeout: 25000 }).toBe("Which topic should I cover?");
    await expect(page.getByRole("radio", { name: "Explain first" })).toBeChecked();
    await expect(page.getByRole("heading", { name: "Additional information required." })).toBeVisible();
    if (finish === "screen") {
      await page.getByRole("textbox", { name: "Your answer" }).fill("Do not include sport");
      await page.getByRole("button", { name: "Send answer" }).click();
    }
    if (finish === "retry") {
      await expect(page.locator("#notice-text")).toContainText("the answer could not be sent", { timeout: 20000 });
      await expect(page.getByRole("radio", { name: "Explain first" })).toBeChecked();
    }
    const received = 'Your test answers were received: {"q0":"Explain first","topic":"Do not include sport"}.';
    await expect.poll(() => spoken.at(-1), { timeout: 30000 }).toBe(received);
    expect(spoken.filter((text) => text.startsWith("Which"))).toEqual([
      "Which approach should I use? The options are Small change or Explain first.",
      "Which topic should I cover?",
    ]);
    await expect(page.getByRole("heading", { name: "Additional information required." })).toHaveCount(0);
    await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

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
  await page.route("https://example.com/p.png", (route) => route.abort());
  await launch(page, "unsafe");
  await startListening(page);
  await expect(page.locator("#messages pre")).toContainText("const safe = true;", { timeout: 15000 });
  await expect(page.locator("#messages")).toContainText("<img src=x onerror=alert('unsafe')>");
  await expect(page.locator("#messages img")).toHaveCount(1);
  await expect(page.locator("#messages img[onerror]")).toHaveCount(0);
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
  await expect(reply.getByRole("link", { name: "Open source" })).toHaveAttribute("href", "https://example.com/p.png");
  await expect(reply).toContainText("This image could not be loaded.");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator("#messages pre")).toContainText("const safe = true;");
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await page.screenshot({ path: info.outputPath("conversation-screen.png"), fullPage: true });
});

for (const mode of ["fresh", "fresh-starlog"] as const) {
  test(`“${mode === "fresh" ? "New log entry" : "New starlog entry"}” clears the screen and ends the task; the earlier conversation stays in the captain’s log with its stardate and can be deleted`, async ({ page }) => {
    const spoken = spokenText(page);
    await launch(page, mode);
    await startListening(page);
    await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
    await expect(status(page)).toHaveText("Transmitting");
    await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
    await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toBe("Standing by for a new log entry.");
    await expect(page.locator(".message")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Please specify your request." })).toBeVisible();
    await expect(page.locator("#entry-stardate")).toBeVisible();
    await expect(page.locator("#entry-stardate")).toHaveText(/^Captain’s log, stardate -?\d+\.\d$/);
    expect(spoken.some((text) => /stardate/i.test(text))).toBe(false);
    // After the task ends, speech needs "Computer" again.
    await expect(page.locator("#voice-partial")).toHaveText("Not sent: “Is anyone there” Start with “Computer”.", { timeout: 20000 });
    await expect(page.locator(".message")).toHaveCount(0);
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await page.getByRole("link", { name: "Captain’s log" }).click();
    await expect(page.locator("#conversations")).toContainText("hello there");
    await expect(page.locator("#conversations .log-stardate")).toHaveText(/^Stardate -?\d+\.\d$/);
    // The Captain's log is grouped under the entry's whole stardate.
    const entryStardate = (await page.locator("#conversations .log-stardate").textContent())!.split(".")[0];
    await expect(page.getByRole("heading", { level: 3, name: entryStardate, exact: true })).toBeVisible();
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
}

test("after “Stop listening”, the next “Computer” request continues the current log entry", async ({ page }) => {
  const entries: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/conversations\/[^/]+\/send$/.test(request.url())) entries.push(request.url());
  });
  await launch(page, "separate");
  await startListening(page);
  await expect(page.locator(".message[data-role=user]")).toContainText(["Computer, hello there", "Computer, show unsafe output"], { timeout: 40000 });
  expect(entries).toHaveLength(2);
  expect(entries[1]).toBe(entries[0]);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("link", { name: "Captain’s log" }).click();
  await expect(page.locator("#conversations .log-title")).toHaveCount(1);
  await page.locator("#conversations .conversation-button", { hasText: "hello there" }).click();
  await expect(page.locator(".message[data-role=user]")).toContainText(["Computer, hello there", "Computer, show unsafe output"]);
});

test("“Stop listening”, even without “Computer”, is acknowledged and returns to standing by; only the microphone button switches the microphone", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "sleep");
  await startListening(page);
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toBe("Standing by.");
  await expect(status(page)).toHaveText(/Transmitting|Standing by/);
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
  await expect(status(page)).not.toHaveText("Not listening");
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(status(page)).toHaveText("Not listening");
  // Only the button switches it on again; a stray click on the console does not.
  await page.locator("#status").click();
  await expect(status(page)).toHaveText("Not listening");
  await page.getByRole("button", { name: "Switch microphone on" }).click();
  await expect(status(page)).toHaveText(/Standing by|Transmitting/, { timeout: 15000 });
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
  expect(await page.evaluate(() => (window as unknown as { replyShownDuring: string[] }).replyShownDuring)).toEqual(["Transmitting"]);
  await expect(page.locator("#working")).toBeHidden();
});

test("the reply waits while the voice is preparing, then appears when it starts", async ({ page }) => {
  const voice = await holdSpeaking(page);
  await launch(page, "example");
  await startListening(page);
  await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  await expect(status(page)).toHaveText("Accessing");
  await expect(page.locator("#status-detail")).toHaveText("Preparing the spoken reply.");
  await expect(page.locator("#working")).toContainText("Preparing the reply.");
  // OpenCode has finished, so the scanning bar no longer shows; the written line stays.
  await expect(page.locator("#working .scan-bar")).toBeHidden();
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
  voice.release();
  await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
});

function briefingReplies(page: import("@playwright/test").Page) {
  return {
    riker: page.locator(".crew-report", { hasText: "Test stand-in: I recommend the smaller repair, Captain." }),
    data: page.locator(".crew-report", { hasText: "Test stand-in: Data found a small repair." }),
    close: page.locator(".message[data-role=assistant]:not(.crew-report)", { hasText: "The reports are on screen." }),
  };
}

test("in a briefing, each officer's reply appears when that officer's voice starts, and the log entry title ends at a whole word", async ({ page }) => {
  const voice = await holdLaterParts(page);
  await launch(page, "briefing");
  await startListening(page);
  const replies = briefingReplies(page);
  await expect.poll(() => voice.holding(), { timeout: 20000 }).toBe(true);
  // Riker is speaking; Data has not started, so Data's reply and the computer's receipt wait.
  await expect(replies.riker).toBeVisible();
  await expect(status(page)).toHaveText("Transmitting");
  await expect(page.locator("#working")).toBeHidden();
  await expect(replies.data).toHaveCount(0);
  await expect(replies.close).toHaveCount(0);
  voice.release();
  await expect(replies.data).toBeVisible({ timeout: 15000 });
  await expect(replies.close).toBeVisible();
  await expect(replies.riker).toBeVisible();
  await expect(status(page)).not.toHaveText("Transmitting", { timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("link", { name: "Captain’s log" }).click();
  const title = "have Data and Riker brief me on the next step for a tribute…";
  await expect(page.locator("#conversations .log-title")).toHaveText(title);
  await page.locator("#conversations .conversation-button", { hasText: title }).click();
  await expect(page.locator(".message[data-role=user]")).toContainText("Computer, have Data and Riker brief me on the next step for a tribute site to Sir Patrick with a stardate clock, Riker first");
  for (const reply of Object.values(replies)) await expect(reply).toBeVisible();
});

for (const route of ["Stop speaking", "Switch microphone off", "a speaking failure", "New log entry, then reopening it from the Captain’s log"] as const) {
  test(`in a briefing, ${route} shows every officer's reply`, async ({ page }) => {
    const voice = await holdLaterParts(page);
    await launch(page, "briefing");
    await startListening(page);
    const replies = briefingReplies(page);
    await expect.poll(() => voice.holding(), { timeout: 20000 }).toBe(true);
    await expect(replies.riker).toBeVisible();
    await expect(replies.data).toHaveCount(0);
    if (route === "a speaking failure") {
      voice.fail("Test stand-in: the voice stopped.");
      await expect(page.locator("#notice")).toContainText("Test stand-in: the voice stopped.");
      await expect(page.locator("#voice-channel")).toHaveText("Microphone off");
    } else {
      voice.drop();
      await page.waitForTimeout(300);
      await expect(replies.data).toHaveCount(0);
      if (route.startsWith("New log entry")) {
        await page.getByRole("button", { name: "New log entry", exact: true }).click();
        await expect(page.locator(".message")).toHaveCount(0);
        await page.getByRole("link", { name: "Captain’s log" }).click();
        await page.locator("#conversations .conversation-button", { hasText: "have Data and Riker" }).click();
      } else await page.getByRole("button", { name: route, exact: true }).click();
    }
    for (const reply of Object.values(replies)) await expect(reply).toBeVisible({ timeout: 5000 });
    if (route === "Stop speaking" || route.startsWith("New log entry")) await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

test("in a briefing, a reply already queued to play waits while the browser has paused sound, and appears when sound resumes", async ({ page }) => {
  // Pause sound as soon as Data's first audio reaches the browser, while Riker is still speaking.
  let paused: Promise<void> | undefined;
  let later = false;
  await page.routeWebSocket("**/api/speech", (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      browser.send(message);
      if (typeof message === "string") {
        const data = JSON.parse(message) as { type: string; index?: number };
        if (data.type === "part-start" && data.index! > 0) later = true;
      } else if (later && !paused) paused = pauseAudio();
    });
  });
  const pauseAudio = await blockAudioUntilInteraction(page);
  await launch(page, "briefing");
  await startListening(page);
  const replies = briefingReplies(page);
  await expect.poll(() => !!paused, { timeout: 20000 }).toBe(true);
  await paused;
  await expect(status(page)).toHaveText("Transmitting");
  await expect(page.locator("#status-detail")).toHaveText("The browser paused sound. Click the microphone, or press M, to hear the rest.");
  // Riker's audio and Data's start (about 1.3 seconds) would long be over on a running clock.
  await page.waitForTimeout(3000);
  await expect(replies.data).toHaveCount(0);
  await expect(replies.close).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop speaking" })).toBeVisible();
  await page.getByRole("button", { name: "Resume listening" }).click();
  await expect(replies.data).toBeVisible({ timeout: 15000 });
  await expect(replies.riker).toBeVisible();
  await expect(replies.close).toBeVisible();
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
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
    await expect(status(page)).toHaveText("Accessing");
    await expect(page.locator("#status-detail")).toHaveText("Preparing the spoken reply.");
    await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
    await expect(page.locator(scenario.selector)).toHaveCount(0);
    await expect(page.locator(".tribute-invitation")).toHaveCount(0);
    voice.release();
    await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
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
  await expect(status(page)).toHaveText("Accessing");
  await expect(page.locator("#status-detail")).toHaveText("Preparing the spoken reply.");
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
  await expect(status(page)).toHaveText("Accessing");
  await expect(page.locator("#status-detail")).toHaveText("Preparing the spoken reply.");
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
  await expect(status(page)).toHaveText("Accessing");
  await expect(page.locator("#status-detail")).toHaveText("Preparing the spoken reply.");
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
  try {
    await expect.poll(() => !!voice.pending(), { timeout: 15000 }).toBe(true);
  } catch (error) {
    const state = await page.evaluate(() => ({
      status: document.querySelector("#status")?.textContent,
      detail: document.querySelector("#status-detail")?.textContent,
      partial: document.querySelector("#voice-partial")?.textContent,
      userMessages: [...document.querySelectorAll(".message[data-role=user]")].map((node) => node.textContent),
      assistantMessages: [...document.querySelectorAll(".message[data-role=assistant]")].map((node) => node.textContent),
    }));
    console.error("Speaking failure diagnostics", JSON.stringify({
      state,
      browser: browserDiagnostics.get(page),
      voice: voice.diagnostics(),
    }, null, 2));
    throw error;
  }
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

for (const path of ["**/api/conversations", "**/api/conversations/*/send"]) {
  test(`a spoken request rejected by ${path} speaks the real error without claiming acceptance`, async ({ page }) => {
    const message = path.endsWith("/send")
      ? "Could not decide which officer should handle this request. This model is not available in your country. The request was not sent."
      : "The new log entry could not be opened. The model service cannot be reached.";
    await page.route(path, async (route) => {
      if (route.request().method() === "POST") await route.fulfill({ status: 502, json: { error: message } });
      else await route.continue();
    });
    const spoken = spokenText(page);
    await launch(page);
    await startListening(page);
    await expect(page.locator("#notice-text")).toHaveText(message, { timeout: 15000 });
    // The real error sits inside a red alert frame, and the alert announces exactly that error.
    await expect(page.locator("#notice")).toHaveAttribute("data-alert", "red");
    await expect(page.locator("#notice .alert-label")).toHaveText("Red alert");
    await expect(page.locator("#notice .alert-label")).toHaveAttribute("aria-hidden", "true");
    expect(await page.locator("#notice").ariaSnapshot()).toContain(message);
    expect(await page.locator("#notice").ariaSnapshot()).not.toContain("Red alert");
    await expect.poll(() => spoken.includes(message), { timeout: 15000 }).toBe(true);
    await expect(status(page)).toHaveText("Transmitting", { timeout: 15000 });
    const timeline = await page.evaluate(() => (window as unknown as {
      audioTimeline: { name: string; at: number; end: number; capture: boolean }[];
    }).audioTimeline);
    const cue = timeline.find((item) => item.name === "input-failed")!;
    const speech = timeline.find((item) => item.name === "speech")!;
    expect(speech.at).toBeGreaterThanOrEqual(cue.end - 0.01);
    expect(cue.capture).toBe(false);
    await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
    await expect(page.locator("#notice-text")).toHaveText(message);
    expect(spoken).toEqual([message]);
    expect((await sounds(page)).map((sound) => sound.split(":")[0])).toEqual(["input-failed"]);
    await expect(page.locator(".message[data-role=user]")).toHaveCount(0);
    await expect(page.locator(".message[data-role=assistant]")).toHaveCount(0);
    await page.getByRole("button", { name: "Switch microphone off" }).click();
  });
}

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

test("an everyday answer and its question are spoken while the exact code stays on screen", async ({ page }, info) => {
  const spoken = spokenText(page);
  await launch(page, "example");
  await startListening(page);
  const answer = page.locator(".message[data-role=assistant]");
  await expect(answer).toHaveCount(1, { timeout: 15000 });
  await expect(answer.locator("pre code")).toHaveText("const settings = { ...defaults, ...saved };");
  await expect.poll(() => spoken[0], { timeout: 15000 })
    .toBe("The settings test fails because the default voice replaces the saved choice when the app starts. Shall I make that change and run the test again?");
  await expect(status(page)).not.toHaveText("Transmitting", { timeout: 15000 });
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await page.screenshot({ path: info.outputPath("example-answer.png"), fullPage: true });
  if (process.env.PICARD_SITE_CAPTURE === "1") {
    await captureSiteScreen(page, "answer");
    await writeFile("video/assets/answer-spoken.json", `${JSON.stringify(spoken, null, 2)}\n`);
  }
});

test("the website example: Data and Riker answer, then a Picard personnel file appears", async ({ page }, info) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  const spoken = spokenText(page);
  const capture = process.env.PICARD_SITE_CAPTURE === "1";
  await launch(page, "showcase");
  await startListening(page);
  const speakers = page.locator(".message[data-role=assistant] .message-header strong");
  await expect(speakers).toHaveText(["Data"], { timeout: 30000 });
  await expect(page.locator(".message[data-role=assistant]").first()).toContainText("I have not changed any files.", { timeout: 15000 });
  if (capture) {
    await mkdir("video/assets", { recursive: true });
    await page.locator("#readout-project").evaluate((node) => { node.textContent = "Example project"; node.removeAttribute("title"); });
    await page.screenshot({ path: "video/assets/data.png", animations: "disabled" });
  }
  await expect(speakers).toHaveText(["Data", "Riker"], { timeout: 30000 });
  const fact = page.locator("#messages > .tribute-fact[data-subject=picard]");
  await expect(fact).toHaveCount(1, { timeout: 15000 });
  await expect(fact.locator(".tribute-record-title small")).toHaveText("Personnel file");
  await expect(status(page)).toHaveText("Standing by", { timeout: 15000 });
  await page.screenshot({ path: info.outputPath("site-example.png"), fullPage: true });
  expect(spoken).toHaveLength(2);
  if (capture) {
    await captureSiteScreen(page, "console");
    await writeFile("video/assets/spoken.json", `${JSON.stringify(spoken, null, 2)}\n`);
    await page.getByRole("link", { name: "Captain’s log", exact: true }).click();
    await expect(page.locator("#drawer-records")).toBeVisible();
    await expect(page.locator("#conversations button").first()).toBeVisible();
    await captureSiteScreen(page, "captains-log");
  }
});

test("the side panel keeps every tile readable on a short laptop screen", async ({ page }) => {
  await launch(page);
  for (const font of ["", "Arial, sans-serif"]) {
    await page.evaluate((font) => document.documentElement.style.setProperty("--lcars", font), font);
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
  }
});
