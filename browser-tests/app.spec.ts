import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { formatStardate } from "../src/shared/stardate";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

// The launch token is available only to the launcher, not to unauthenticated pages.
// For browser tests, capture the test launcher's printed address from its own process.
test.beforeEach(async ({ page }) => {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["dist/tests/browser-launch.js"], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/.exec(output);
      if (match) resolve(match[0]);
    });
    child.once("exit", (code) => { if (code) reject(new Error(`Browser fixture failed: ${code}`)); });
  });
  await page.goto(url);
  await expect(page.getByRole("status")).toHaveText("Standing by");
  page.on("close", () => child.kill());
});

test("empty screen fits without horizontal overflow and has no typing box", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Please specify your request." })).toBeVisible();
  await expect(page.locator("#tribute")).toBeVisible();
  await expect(page.locator("#tribute")).toHaveText("With deepest respect and gratitude: Sir Patrick Stewart 1940 – 2026");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "New log entry" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Captain’s log" })).toBeVisible();
  await expect(page.locator("#readout-stardate")).toHaveText(/^-\d{6}\.\d$/);
  // Like the ship's computer: no typing, no conversation name and no mode on the main screen.
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.locator(".crew-member")).toHaveCount(0);
  await expect(page.getByText("Type instead")).toHaveCount(0);
  await expect(page.getByText("Discuss", { exact: true })).toHaveCount(0);
  // The side panel shows live readouts, not decorative numbers.
  await expect(page.locator("#readout-provider")).toHaveText("Connected");
  await expect(page.locator("#readout-model")).not.toHaveText(/^(—|None)$/);
  await expect(page.locator("#readout-project")).not.toHaveText("—");
  await expect(page.locator("#readout-speech")).toHaveText("Not set up");
  await expect(page.locator("#readout-version")).toHaveText(version);
  await page.screenshot({ path: testInfo.outputPath("empty-screen.png"), fullPage: true });
});

test("a new log entry shows its Stardate and keeps it stable until another entry starts", async ({ page }) => {
  const first = await page.locator("#entry-stardate").textContent();
  expect(first).toMatch(/^Stardate -?\d+\.\d$/);
  const later = new Date("2027-01-02T12:00:00Z");
  await page.clock.setFixedTime(later);
  await page.getByRole("link", { name: "Captain’s log" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#entry-stardate")).toHaveText(first!);
  await page.getByRole("button", { name: "New log entry" }).click();
  await expect(page.locator("#entry-stardate")).toBeVisible();
  await expect(page.locator("#entry-stardate")).toHaveText(`Stardate ${formatStardate(later)}`);
});

test("the main screen shows only the conversation; the side panel tiles open their own settings", async ({ page }, testInfo) => {
  // Without speech set up, the console says so and points to Settings.
  await expect(page.getByRole("status")).toHaveText("Standing by");
  await expect(page.locator("#voice-setup-hint")).toBeVisible();
  await expect(page.locator("#listen-toggle")).toBeHidden();
  for (const name of ["Project folder", "Provider sign-in"]) await expect(page.getByRole("heading", { name })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Model" })).toBeHidden();
  await expect(page.locator("#conversations")).toBeHidden();

  // There is no Settings or Options button: each side panel tile opens its own part.
  await expect(page.getByRole("link", { name: "Options" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  const conversation = page.getByRole("link", { name: "Current log entry", exact: true });
  await expect(conversation).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /^Model/ }).click();
  await expect(conversation).not.toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.getByRole("heading", { name: "Model" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Model" })).toBeVisible();
  await expect(page.getByText("OpenCode's own rules decide which actions ask first.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeHidden();
  await expect(page.getByLabel("Mode", { exact: true })).toHaveCount(0);
  // Choosing the same tile again closes it; so do the Conversation tile and a click on the conversation.
  await page.getByRole("link", { name: /^Model/ }).click();
  await expect(page.getByRole("combobox", { name: "Model" })).toBeHidden();
  await page.getByRole("link", { name: /^Model/ }).click();
  await conversation.click();
  await expect(page.getByRole("combobox", { name: "Model" })).toBeHidden();
  await expect(conversation).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /^Model/ }).click();
  await expect(page.getByRole("combobox", { name: "Model" })).toBeVisible();
  // Settings is 880 pixels wide from the left; click the conversation to its right.
  await page.mouse.click(1300, 500);
  await expect(page.getByRole("combobox", { name: "Model" })).toBeHidden();

  await page.getByRole("link", { name: /^Provider/ }).click();
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeVisible();
  await page.getByRole("link", { name: /^Project/ }).click();
  await expect(page.getByRole("heading", { name: "Project folder" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider sign-in" })).toBeHidden();
  await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await page.getByRole("link", { name: /^Listen/ }).click();
  await expect(page.getByRole("heading", { name: "Speech" })).toBeVisible();
  await expect(page.getByLabel("Listening", { exact: true })).toHaveValue("nemotron");
  // Only the fields for the chosen services show.
  await page.getByLabel("Listening", { exact: true }).selectOption("whisper");
  await page.getByLabel("Speaking", { exact: true }).selectOption("kokoro");
  await expect(page.getByLabel("Subscription ID")).toBeHidden();
  await expect(page.getByLabel("Kokoro voice")).toHaveCount(0);
  await expect(page.getByText("The computer and each bridge officer have fixed voices.", { exact: false })).toBeVisible();
  await page.getByLabel("Speaking", { exact: true }).selectOption("mai");
  await expect(page.getByLabel("Subscription ID")).toBeVisible();
  await expect(page.getByLabel("Listening deployment")).toBeHidden();
  await expect(page.getByLabel("Voice", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Voice style", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Speech" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Please specify your request." })).toBeVisible();
});

test("saved Whisper stays selected and Nemotron download details follow the chosen services", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
    await route.fulfill({ json: {
      settings: { listening: "whisper", speaking: "kokoro", subscription: "", resourceGroup: "", resourceName: "", region: "", deployment: "" },
      file: "Labeled test stand-in settings", localReady: true,
      localFiles: { whisper: true, nemotron: false, kokoro: true },
    } });
  });
  await page.getByRole("link", { name: /^Listen/ }).click();
  const listening = page.getByLabel("Listening", { exact: true });
  await expect(listening).toHaveValue("whisper");
  await expect(page.locator("#nemotron-upgrade")).toContainText("Whisper remains available");
  await expect(page.locator("#local-note")).toBeHidden();
  await listening.selectOption("nemotron");
  await expect(page.locator("#local-note")).toBeVisible();
  await expect(page.locator("#local-note")).toContainText("710 MB");
  await expect(page.locator("#local-note")).toContainText("Nothing changes until the new services work");
  await listening.selectOption("mai");
  await expect(page.locator("#local-note")).toBeHidden();
  await expect(page.getByLabel("Listening deployment")).toBeVisible();
  await listening.selectOption("whisper");
  await expect(page.locator("#local-note")).toBeHidden();
  expect(writes).toBe(0);
});

test("the only Tribute toggle is a navigation tile; About explains screen-only facts", async ({ page }, testInfo) => {
  const toggle = page.getByRole("switch", { name: "Tribute", exact: true });
  await expect(toggle).toBeChecked();
  await expect(page.locator("#sidebar").getByRole("switch")).toHaveCount(2);
  await expect(page.locator("#main").getByRole("switch")).toHaveCount(0);
  await expect(toggle).toHaveCSS("opacity", "0");
  const tile = page.locator(".tribute-switch");
  const height = (await page.locator("#new-conversation").boundingBox())!.height;
  expect((await tile.boundingBox())!.height).toBe(height);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("#tribute-toggle-state")).toHaveText("Off");
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("tribute-off.png"), fullPage: true });
  await tile.click();
  await expect(toggle).toBeChecked();
  await tile.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
  await expect(page.getByLabel("Speak automatic facts", { exact: true })).toHaveCount(0);
  await expect(page.locator("#settings-about")).toContainText("quiet tricorder sound after the answer finishes");
  await expect(page.locator("#settings-about").getByRole("switch")).toHaveCount(0);
  await toggle.check();
  await toggle.uncheck();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
  await expect(page.locator("#settings-about input")).toHaveCount(0);
  await toggle.check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the Bridge crew switch is announced and remembered", async ({ page }) => {
  const toggle = page.getByRole("switch", { name: "Bridge crew", exact: true });
  await expect(toggle).toBeChecked();
  const height = (await page.locator("#new-conversation").boundingBox())!.height;
  expect((await page.locator(".bridge-switch").boundingBox())!.height).toBe(height);
  await page.locator(".bridge-switch").click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("#bridge-toggle-state")).toHaveText("Off");
  await expect(page.locator("#bridge-status")).toHaveText("The Bridge crew is off. The computer answers every request.");
  await expect(page.getByRole("switch", { name: "Tribute", exact: true })).toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("invalid and unavailable browser storage are explained instead of claiming preferences were saved", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("picard-tribute-enabled", "not-a-boolean"));
  await page.reload();
  await expect(page.locator("#tribute-storage-error")).toContainText("invalid");
  await expect(page.getByRole("switch", { name: "Tribute", exact: true })).toBeChecked();
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage disabled", "SecurityError"); };
  });
  await page.reload();
  await page.getByRole("switch", { name: "Tribute", exact: true }).uncheck();
  await expect(page.locator("#tribute-storage-error")).toContainText("could not be saved");
  await expect(page.locator("#tribute-toggle-state")).toHaveText("Off");
});
