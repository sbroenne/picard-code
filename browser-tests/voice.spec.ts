import { test, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const folder = resolve(`.picard-test-voice-audio-${process.pid}`);
const microphoneFile = join(folder, "utterance.wav");
test.use({ permissions: ["microphone"], launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  `--use-file-for-fake-audio-capture=${microphoneFile}`,
] } });
test.beforeAll(async () => {
  await mkdir(folder);
  const rate = 48000;
  const audio = Buffer.alloc(rate * 2 * 4);
  for (let index = rate / 2; index < rate * 1.5; index++) audio.writeInt16LE(Math.round(Math.sin(index / rate * 240 * 2 * Math.PI) * 6000), index * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(audio.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(audio.length, 40);
  await writeFile(microphoneFile, Buffer.concat([header, audio]));
});
test.afterAll(async () => { await rm(folder, { recursive: true }); });

async function launch(page: import("@playwright/test").Page, approval = false) {
  const child = spawn(process.execPath, ["dist/tests/browser-launch.js", "--speech", ...(approval ? ["--approval"] : [])], { stdio: ["ignore", "pipe", "pipe"] });
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("spoken-conversation.png"), fullPage: true });
});

test("spoken work asks for deliberate approval and stays paused while waiting", async ({ page }) => {
  await launch(page, true);
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#voice-status")).toHaveText("Waiting for your decision", { timeout: 5000 });
  await expect(page.getByRole("button", { name: "Allow once" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Microphone off", exact: true }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.locator("#work-status")).toHaveText("Ready");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
});
