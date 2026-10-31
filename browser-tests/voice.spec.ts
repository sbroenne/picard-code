import { test, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const folder = resolve(`.picard-test-voice-audio-${process.pid}`);
const microphoneFile = join(folder, "utterance.wav");
const soundFolder = join(folder, "sounds");
// Silent stand-ins for the downloaded sounds; each has its own length so the test can tell them apart.
const SOUND_LENGTHS = { "request-accepted": 0.3, "processing": 0.5, "input-failed": 0.4, "request-failed": 0.6 };
test.use({ permissions: ["microphone"], launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
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
  const audio = Buffer.alloc(rate * 2 * 4);
  for (let index = rate / 2; index < rate * 1.5; index++) audio.writeInt16LE(Math.round(Math.sin(index / rate * 240 * 2 * Math.PI) * 6000), index * 2);
  await writeFile(microphoneFile, wave(rate, audio));
});
test.afterAll(async () => { await rm(folder, { recursive: true }); });

async function launch(page: import("@playwright/test").Page, mode?: "approval" | "question" | "unclear" | "slow") {
  // Record each computer sound that starts, and the voice status at that moment.
  await page.addInitScript((lengths) => {
    const decoded = new WeakSet<AudioBuffer>();
    const plays: string[] = [];
    Object.assign(window, { acceptedSounds: plays });
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (this: BaseAudioContext, data: ArrayBuffer) {
      const buffer = await decode.call(this, data);
      decoded.add(buffer);
      return buffer;
    } as typeof decode;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<typeof start>) {
      const buffer = this.buffer;
      if (buffer && decoded.has(buffer)) {
        const name = Object.entries(lengths).find(([, seconds]) => Math.abs(seconds - buffer.duration) < 0.02)?.[0];
        plays.push(`${name}: ${document.querySelector("#voice-status")?.textContent ?? ""}`);
      }
      return start.apply(this, args);
    };
  }, SOUND_LENGTHS);
  const child = spawn(process.execPath, ["dist/tests/browser-launch.js", "--speech", "--sounds", soundFolder, ...(mode ? [`--${mode}`] : [])], { stdio: ["ignore", "pipe", "pipe"] });
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
  await expect(page.locator("#work-status")).toHaveText("Ready");
}

function sounds(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds);
}

test("microphone starts only on activation; speech sends automatically and follow-ups keep context", async ({ page }, info) => {
  await launch(page);
  await expect(page.locator("#voice-status")).toHaveText("Microphone off");
  await expect(page.locator("#typing")).not.toHaveAttribute("open");
  await expect(page.getByRole("textbox", { name: "Your message" })).not.toBeVisible();
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await expect(page.locator("#voice-status")).toHaveText("Listening", { timeout: 15000 });
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#voice-status")).toHaveText("Computer speaking");
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await expect(page.locator("#voice-status")).toHaveText("Listening", { timeout: 15000 });
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(2, { timeout: 15000 });
  await page.getByRole("button", { name: "Microphone off", exact: true }).click();
  await expect(page.locator("#voice-status")).toHaveText("Microphone off", { timeout: 5000 });
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2);
  expect(await sounds(page)).toEqual(["request-accepted: Understanding / working", "request-accepted: Understanding / working"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("spoken-conversation.png"), fullPage: true });
});

test("spoken work asks for deliberate approval and stays paused while waiting", async ({ page }) => {
  await launch(page, "approval");
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#voice-status")).toHaveText("Waiting for your decision", { timeout: 5000 });
  await expect(page.getByRole("button", { name: "Allow once" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Microphone off", exact: true }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.locator("#work-status")).toHaveText("Ready");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  expect(await sounds(page)).toEqual(["request-accepted: Understanding / working"]);
});

test("a question is asked aloud; a negated reply is not taken as a choice; a clear spoken choice is sent", async ({ page }) => {
  const spoken: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string" && JSON.parse(payload).type === "speak") spoken.push(JSON.parse(payload).text);
  }));
  await launch(page, "question");
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await expect(page.locator(".message[data-role=assistant]")).toContainText('Your test answer was received: [["Explain first"]].', { timeout: 20000 });
  expect(spoken[0]).toBe("Which approach should I use? The options are Small change or Explain first.");
  expect(spoken[1]).toBe("Please choose Small change or Explain first.");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Additional information required." })).toHaveCount(0);
  await expect.poll(() => spoken.length, { timeout: 10000 }).toBe(3);
  expect(spoken[2]).toContain("Explain first");
  await page.getByRole("button", { name: "Microphone off", exact: true }).click();
  await expect(page.locator("#voice-status")).toHaveText(/Microphone off/, { timeout: 5000 });
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  // Spoken answers to the question do not play the request-accepted sound.
  expect(await sounds(page)).toEqual(["request-accepted: Understanding / working"]);
});

test("unclear speech plays the input-failed sound, shows the reason and listens again", async ({ page }) => {
  await launch(page, "unclear");
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await expect(page.getByText("No words were understood. Please try again.")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await page.getByRole("button", { name: "Microphone off", exact: true }).click();
  expect(await sounds(page)).toEqual(["input-failed: Understanding / working", "request-accepted: Understanding / working"]);
});

test("long work plays the processing sound once; the answer stops it and microphone off cancels it", async ({ page }) => {
  await launch(page, "slow");
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await expect.poll(() => sounds(page), { timeout: 15000 }).toEqual(["request-accepted: Understanding / working", "processing: Understanding / working"]);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#voice-status")).toHaveText("Computer speaking");
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  // The follow-up answers quickly, so no processing sound is due.
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(2, { timeout: 15000 });
  await page.getByRole("button", { name: "Microphone off", exact: true }).click();
  await page.waitForTimeout(3000);
  expect(await sounds(page)).toEqual(["request-accepted: Understanding / working", "processing: Understanding / working", "request-accepted: Understanding / working"]);
});
test("a denied action plays the failure sound once, then speaks the result", async ({ page }) => {
  const spoken: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string" && JSON.parse(payload).type === "speak") spoken.push(JSON.parse(payload).text);
  }));
  await launch(page, "approval");
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect.poll(() => spoken.at(-1), { timeout: 10000 }).toBe("Request denied. The action was not carried out.");
  await page.getByRole("button", { name: "Microphone off", exact: true }).click();
  // No processing sound while the approval waited.
  expect(await sounds(page)).toEqual(["request-accepted: Understanding / working", "request-failed: Preparing the spoken reply"]);
});