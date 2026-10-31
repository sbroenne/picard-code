import { test, expect } from "@playwright/test";

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
  await expect(page.getByRole("status")).toHaveText("Ready");
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
  await expect(page.getByText("Type instead")).toHaveCount(0);
  await expect(page.getByText("Discuss", { exact: true })).toHaveCount(0);
  // The side panel shows live readouts, not decorative numbers.
  await expect(page.locator("#readout-provider")).toHaveText("Connected");
  await expect(page.locator("#readout-model")).not.toHaveText(/^(—|None)$/);
  await expect(page.locator("#readout-project")).not.toHaveText("—");
  await expect(page.locator("#readout-speech")).toHaveText("Not set up");
  await page.screenshot({ path: testInfo.outputPath("empty-screen.png"), fullPage: true });
});

test("the main screen shows only the conversation; the side panel tiles open their own settings", async ({ page }, testInfo) => {
  // Without speech set up, the console says so and points to Settings.
  await expect(page.getByRole("status")).toHaveText("Ready");
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
  await page.mouse.click(700, 500);
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
  // Only the fields for the chosen services show.
  await page.getByLabel("Listening", { exact: true }).selectOption("whisper");
  await page.getByLabel("Speaking", { exact: true }).selectOption("kokoro");
  await expect(page.getByLabel("Subscription ID")).toBeHidden();
  await expect(page.getByLabel("Kokoro voice")).toBeVisible();
  await page.getByLabel("Speaking", { exact: true }).selectOption("mai");
  await expect(page.getByLabel("Subscription ID")).toBeVisible();
  await expect(page.getByLabel("Listening deployment")).toBeHidden();
  await expect(page.getByLabel("Voice", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Speech" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Please specify your request." })).toBeVisible();
});

test("the only Tribute toggle is in navigation; About retains the secondary speech preference", async ({ page }) => {
  const toggle = page.getByRole("switch", { name: "Tribute", exact: true });
  await expect(toggle).toBeChecked();
  await expect(page.locator("#sidebar").getByRole("switch")).toHaveCount(1);
  await expect(page.locator("#main").getByRole("switch")).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("#tribute-toggle-state")).toHaveText("Off");
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
  const spoken = page.getByLabel("Speak automatic facts", { exact: true });
  await expect(spoken).toBeDisabled();
  await expect(page.locator("#settings-about").getByRole("switch")).toHaveCount(0);
  await toggle.check();
  await spoken.check();
  await toggle.uncheck();
  await expect(spoken).toBeChecked();
  await expect(spoken).toBeDisabled();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
  await expect(spoken).toBeChecked();
  await expect(spoken).toBeDisabled();
  await toggle.check();
  await expect(spoken).toBeEnabled();
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
