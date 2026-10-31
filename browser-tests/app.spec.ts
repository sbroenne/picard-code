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
  await expect(page.getByRole("heading", { name: "Please specify a task." })).toBeVisible();
  await expect(page.locator("#tribute")).toBeVisible();
  await expect(page.locator("#tribute")).toHaveText("With deepest respect and gratitude: Patrick Stewart 1940 – 2026");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Logs" })).toBeVisible();
  // Like the ship's computer: no typing, no conversation name and no mode on the main screen.
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("Type instead")).toHaveCount(0);
  await expect(page.getByText("Discuss", { exact: true })).toHaveCount(0);
  // The side panel shows live readouts, not decorative numbers.
  await expect(page.locator("#readout-copilot")).toHaveText("Connected");
  await expect(page.locator("#readout-model")).not.toHaveText(/^(—|None)$/);
  await expect(page.locator("#readout-project")).not.toHaveText("—");
  await expect(page.locator("#readout-speech")).toHaveText("Not set up");
  await page.screenshot({ path: testInfo.outputPath("empty-screen.png"), fullPage: true });
});

test("the main screen shows only the conversation; setup stays in one tabbed Settings page", async ({ page }, testInfo) => {
  // Without speech set up, the console says so and points to Settings.
  await expect(page.getByRole("status")).toHaveText("Ready");
  await expect(page.locator("#voice-setup-hint")).toBeVisible();
  await expect(page.locator("#listen-toggle")).toBeHidden();
  for (const name of ["Project folder", "Copilot connection"]) await expect(page.getByRole("heading", { name })).toBeHidden();
  await expect(page.getByLabel("Model")).toBeHidden();
  await expect(page.locator("#conversations")).toBeHidden();

  // There is one Settings page; the side panel tiles open the matching tab.
  await expect(page.getByRole("link", { name: "Options" })).toHaveCount(0);
  await page.getByRole("link", { name: /^Model/ }).click();
  await expect(page).toHaveURL(/#settings\/copilot$/);
  await expect(page.getByRole("tab", { name: "Copilot" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Model")).toBeVisible();
  await expect(page.getByText("OpenCode's own rules decide which actions ask first.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Mode", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Model")).toBeHidden();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByRole("tab")).toHaveText(["Copilot", "Project", "Voice", "About"]);
  // Settings reopens on the tab used last.
  await expect(page.getByRole("heading", { name: "Copilot connection" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Speech" })).toBeHidden();
  await page.getByRole("tab", { name: "Project" }).click();
  await expect(page.getByRole("heading", { name: "Project folder" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Speech" })).toBeHidden();
  await page.getByRole("tab", { name: "Voice" }).click();
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
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Project folder" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Please specify a task." })).toBeVisible();
});
