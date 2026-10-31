import { test, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const folder = resolve(`.picard-test-voice-audio-${process.pid}`);
const microphoneFile = join(folder, "utterance.wav");
const soundFolder = join(folder, "sounds");
// Silent stand-ins for the downloaded sounds; each has its own length so the test can tell them apart.
const SOUND_LENGTHS = { "request-accepted": 0.3, "processing": 0.5, "input-failed": 0.4, "request-failed": 0.6 };
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
  // One short utterance every six seconds, leaving time for each reply before the next.
  const audio = Buffer.alloc(rate * 2 * 6);
  for (let index = rate / 2; index < rate * 1.5; index++) audio.writeInt16LE(Math.round(Math.sin(index / rate * 240 * 2 * Math.PI) * 6000), index * 2);
  await writeFile(microphoneFile, wave(rate, audio));
});
test.afterAll(async () => { await rm(folder, { recursive: true }); });

async function launch(page: import("@playwright/test").Page, mode?: "approval" | "question" | "unclear" | "slow" | "long" | "choose" | "unsafe" | "fresh" | "sleep") {
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
        plays.push(`${name}: ${document.querySelector("#status")?.textContent ?? ""}`);
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
  // No note or agreement step: the main screen opens straight away.
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect(status(page)).not.toHaveText("Starting up", { timeout: 15000 });
}

function status(page: import("@playwright/test").Page) {
  return page.getByRole("status");
}

/** Listening starts by itself; if the browser wants a click before playing sound, one click on the computer panel gives it. */
async function startListening(page: import("@playwright/test").Page) {
  await expect.poll(async () => `${await status(page).textContent()} ${await page.locator("#status-detail").textContent()}`, { timeout: 15000 })
    .toMatch(/Standing by|Listening|Understanding|Click anywhere/);
  if ((await page.locator("#status-detail").textContent())?.includes("Click anywhere")) await page.locator("#messages").click();
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding/, { timeout: 15000 });
}

function spokenText(page: import("@playwright/test").Page) {
  const spoken: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string" && JSON.parse(payload).type === "speak") spoken.push(JSON.parse(payload).text);
  }));
  return spoken;
}

function sounds(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as unknown as { acceptedSounds: string[] }).acceptedSounds);
}

test.setTimeout(60000);

test("listening stays on; “Computer” starts a task, follow-ups need no “Computer”; the app always opens listening", async ({ page }, info) => {
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
  await expect.poll(async () => `${await status(page).textContent()} ${await page.locator("#status-detail").textContent()}`, { timeout: 15000 })
    .toMatch(/Standing by|Listening|Understanding|Click anywhere/);
  if ((await page.locator("#status-detail").textContent())?.includes("Click anywhere")) await page.locator("#messages").click();
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding/, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]")).toHaveCount(2);
});

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

test("silence and speech not addressed to the computer are not sent and make no sound", async ({ page }) => {
  await launch(page, "unclear");
  await startListening(page);
  await expect(page.locator("#voice-partial")).toHaveText("Not sent: “Is it raining outside” Start with “Computer”.", { timeout: 20000 });
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(".message[data-role=user]")).toHaveText(/Computer, hello there/);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  expect(await sounds(page)).toEqual(["request-accepted: Understanding"]);
});

test("long work plays the processing sound once, and “Stop” cancels it within the task", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "slow");
  await startListening(page);
  await expect.poll(() => sounds(page), { timeout: 15000 }).toEqual(["request-accepted: Understanding", "processing: Working"]);
  await expect(page.locator("#status-detail")).toHaveText("Say “Stop” to cancel.");
  await expect.poll(() => spoken.at(-1), { timeout: 15000 }).toBe("Work stopped, Captain.");
  await expect(status(page)).toHaveText(/Speaking|Preparing reply|Standing by/);
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  // Stopping by voice is not a failure, so no failure sound plays.
  expect(await sounds(page)).toEqual(["request-accepted: Understanding", "processing: Working"]);
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
  // No processing sound while the approval waited.
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

test("the Stop work button cancels spoken work", async ({ page }) => {
  await launch(page, "long");
  await startListening(page);
  await expect(page.getByRole("button", { name: "Stop work" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Stop work" }).click();
  await expect(status(page)).toHaveText("Microphone off", { timeout: 10000 });
  await expect(page.getByRole("button", { name: "Stop work" })).toBeHidden();
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
  await expect(status(page)).toHaveText(/Standing by|Listening|Understanding|Ready/, { timeout: 15000 });
  await page.screenshot({ path: info.outputPath("conversation-screen.png"), fullPage: true });
});

test("“New log entry” clears the screen and ends the task; the earlier conversation stays in the captain’s log with its stardate and can be deleted", async ({ page }) => {
  const spoken = spokenText(page);
  await launch(page, "fresh");
  await startListening(page);
  await expect(page.locator(".message[data-role=assistant]")).toHaveCount(1, { timeout: 15000 });
  await expect(status(page)).toHaveText("Speaking");
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await expect.poll(() => spoken.at(-1), { timeout: 20000 }).toBe("Ready for a new log entry.");
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Please specify a task." })).toBeVisible();
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
  await expect(page.locator("#conversations")).toHaveText("Your conversations will appear here.");
  // The panel stays open after deleting.
  await expect(page.locator("#drawer-records")).toBeVisible();
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
  expect(heard[0]).toMatch(/^request-accepted/);
  expect(heard).toHaveLength(2);
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
