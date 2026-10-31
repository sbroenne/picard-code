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
  await page.getByText("Type instead", { exact: true }).click();
  page.on("close", () => child.kill());
});

test("empty screen, folder controls and long content fit without horizontal overflow", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Please specify a task." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "New conversation" })).toBeVisible();
  await page.getByRole("button", { name: "Understand this project" }).click();
  await expect(page.getByRole("textbox", { name: "Your message" })).toHaveValue("Explain this project and where I should start.");
  await page.screenshot({ path: testInfo.outputPath("empty-screen.png"), fullPage: true });
});

test("the main screen shows only the conversation; setup and options stay in slide-outs", async ({ page }, testInfo) => {
  await expect(page.getByRole("button", { name: "Turn microphone on" })).toBeVisible();
  for (const name of ["Project folder", "Copilot connection"]) await expect(page.getByRole("heading", { name })).toBeHidden();
  await expect(page.getByLabel("Model")).toBeHidden();
  await expect(page.getByLabel("Mode", { exact: true })).toBeHidden();
  await expect(page.locator("#conversations")).toBeHidden();

  await page.getByRole("link", { name: "Discuss" }).click();
  await expect(page).toHaveURL(/#options$/);
  await expect(page.getByLabel("Model")).toBeVisible();
  await expect(page.getByLabel("Mode", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Model")).toBeHidden();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#settings$/);
  for (const name of ["Copilot connection", "Project folder", "Speech", "Privacy and approvals"]) await expect(page.getByRole("heading", { name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Project folder" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Please specify a task." })).toBeVisible();
});

test("send, stream, approval, stop and safe code rendering work", async ({ page }, testInfo) => {
  const prompt = page.getByRole("textbox", { name: "Your message" });
  await prompt.fill("Hello computer");
  await page.getByRole("button", { name: "Send", exact: false }).click();
  await expect(page.locator(".message[data-role=assistant]")).toContainText("A genuinely streamed reply");
  await expect(page.getByRole("status")).toHaveText("Ready");
  await prompt.fill("Request an approval");
  await page.getByRole("button", { name: "Send", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible();
  await expect(page.getByText("OpenCode wants to run a command. Review the requested action before allowing it.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("approval-screen.png"), fullPage: true });
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.getByRole("status")).toHaveText("Ready");
  await prompt.fill("Stop this reply");
  await page.getByRole("button", { name: "Send", exact: false }).click();
  await page.getByRole("button", { name: "Stop work" }).click();
  await expect(page.getByRole("status")).toHaveText("Ready");
  await prompt.fill("unsafe output");
  await page.getByRole("button", { name: "Send", exact: false }).click();
  await expect(page.locator("#messages")).toContainText("<img src=x onerror=alert('unsafe')>");
  await expect(page.locator("#messages img")).toHaveCount(0);
  await expect(page.locator("#messages pre")).toContainText("const safe = true;");
  await expect(page.getByRole("status")).toHaveText("Ready");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("questions receive real answers and conversations reopen after reload", async ({ page }, testInfo) => {
  await page.getByRole("textbox", { name: "Your message" }).fill("Ask a question");
  await page.getByRole("button", { name: "Send", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Additional information required." })).toBeVisible();
  await page.getByRole("radio", { name: "Explain first" }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.locator("#messages")).toContainText('Your test answer was received: [["Explain first"]].');
  await expect(page.getByRole("status")).toHaveText("Ready");
  await page.reload();
  await expect(page.locator("#messages")).toContainText('Your test answer was received: [["Explain first"]].');
  await expect(page.getByRole("status")).toHaveText("Ready");
  await page.screenshot({ path: testInfo.outputPath("conversation-screen.png"), fullPage: true });
});
