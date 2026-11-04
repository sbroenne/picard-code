import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveModelSettings } from "../src/server/model-settings";

const first = JSON.stringify(["github-copilot", "fixture-model"]);
const other = JSON.stringify(["other-provider", "other"]);
// Original silent stand-in, not a downloaded computer recording.
const silentSound = Buffer.alloc(44 + 4800);
silentSound.write("RIFF"); silentSound.writeUInt32LE(silentSound.length - 8, 4); silentSound.write("WAVEfmt ", 8);
silentSound.writeUInt32LE(16, 16); silentSound.writeUInt16LE(1, 20); silentSound.writeUInt16LE(1, 22);
silentSound.writeUInt32LE(24000, 24); silentSound.writeUInt32LE(48000, 28);
silentSound.writeUInt16LE(2, 32); silentSound.writeUInt16LE(16, 34); silentSound.write("data", 36); silentSound.writeUInt32LE(4800, 40);

async function launch(page: Page, args: string[] = []) {
  const child = spawn(process.execPath, ["dist/tests/browser-launch.js", "--model-setup", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/.exec(output);
      if (match) resolve(match[0]);
    });
    child.once("exit", () => reject(new Error("The model setup test server stopped.")));
  });
  page.on("close", () => child.kill());
  // The test server has no sound files; a silent stand-in keeps a missing-sound notice from replacing the error under test.
  await page.route("**/api/sounds/*", (route) => route.fulfill({ contentType: "audio/wav", body: silentSound }));
  await page.goto(url);
  if (args.includes("--provider-error")) await expect(page.getByRole("alert")).toContainText("Test provider lookup failed.");
  else await expect(page.locator("#status")).not.toHaveText("Starting up");
  return {
    url,
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const stopped = new Promise<void>((done) => child.once("exit", () => done()));
      child.kill();
      await stopped;
    },
  };
}

/** Start-up begins only when the Captain chooses it. */
async function begin(page: Page) {
  await page.getByRole("button", { name: "Begin start-up" }).click();
}

const title = (page: Page) => page.locator("#first-run-title");

test("signed in without a default: start-up asks for a confirmed choice, never a guessed one", async ({ page }) => {
  await launch(page, ["--no-default-model"]);
  await expect(page).not.toHaveURL(/#settings/);
  await expect(page.locator("#first-run-setup")).toBeVisible();
  await expect(page.locator("#first-run-setup")).toBeFocused();
  await expect(title(page)).toHaveText("Welcome aboard, Captain.");
  await expect(page.locator("#first-run-lead")).toHaveText("The ship is on standby. Your OpenCode sign-in is already in use. Two systems remain before the computer can take your orders.");
  await expect(page.locator("#system-core")).toHaveText("Online · your OpenCode sign-in");
  await expect(page.locator("#system-intelligence")).toHaveText("Offline");
  await expect(page.locator("#system-comms")).toHaveText("Offline");
  await expect(page.locator("#welcome-note")).toBeHidden();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect(page.locator("#voice-console")).toBeHidden();
  await expect(page.locator("#speech-first-start")).toBeHidden();
  await begin(page);
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator("#first-run-lead")).toHaveText("OpenCode has no default AI model set, so select the one that powers the computer. The most capable model gives the best answers.");
  await expect(page.locator('[data-system="intelligence"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#first-run-setup")).toBeFocused();
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Confirm this model" })).toBeDisabled();
  await expect(page.locator("#model-status")).toHaveText("Awaiting your selection");
  await expect(page.locator("#readout-model")).toHaveText("Offline");
  await expect(page.locator("#model optgroup")).toHaveCount(2);
  await page.selectOption("#model", other);
  await expect(page.locator("#model-status")).toHaveText("Awaiting confirmation");
  await expect(page.locator("#readout-model")).toHaveText("Offline");
  await page.getByRole("button", { name: "Confirm this model" }).click();
  await expect(page.locator("#readout-model")).toHaveText("Other model");
  await expect(title(page)).toHaveText("Open a channel");
  await expect(page.locator("#system-intelligence")).toHaveText("Online");
  await expect(page.locator('[data-system="comms"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await page.reload();
  await expect(page.locator("#readout-model")).toHaveText("Other model");
  await expect(title(page)).toHaveText("Open a channel");
});

test("signed in with a default: Begin start-up confirms OpenCode's default and goes straight to communications", async ({ page }) => {
  await launch(page);
  await expect(page.locator("#first-run-lead")).toHaveText("The ship is on standby. Your OpenCode sign-in and default AI model are already in use. One system remains before the computer can take your orders.");
  await expect(page.locator("#system-intelligence")).toHaveText("Online · Copilot test model, your OpenCode default");
  await expect(page.locator("#welcome-note")).toHaveText("Change the AI model at any time under Computer intelligence.");
  // Nothing is chosen for the Captain until Begin start-up is pressed.
  await expect(page.locator("#readout-model")).toHaveText("Offline");
  await begin(page);
  await expect(title(page)).toHaveText("Open a channel");
  await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
});

test("a failed default confirmation stays on the welcome screen with the real error", async ({ page }) => {
  // Speech is already set up, so no background speech updates can re-enable the button by chance.
  await launch(page, ["--speech"]);
  await page.route("**/api/model", (route) => route.fulfill({
    status: 502, contentType: "application/json", body: JSON.stringify({ error: "Could not save the model choice. Test disk is full." }),
  }));
  await begin(page);
  await expect(page.getByRole("alert")).toContainText("Could not save the model choice. Test disk is full.");
  await expect(page.locator("#first-run-setup #notice")).toBeVisible();
  await expect(title(page)).toHaveText("Welcome aboard, Captain.");
  await expect(page.locator("#readout-model")).toHaveText("Offline");
  await expect(page.getByRole("button", { name: "Begin start-up" })).toBeEnabled();
});

test("without a sign-in, the computer core step gives the order and the free models stay a clear second choice", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await expect(page.locator("#first-run-lead")).toContainText("Three systems must come online");
  await expect(page.locator("#readout-provider")).toHaveText("OpenCode models");
  await begin(page);
  await expect(title(page)).toHaveText("Computer core offline");
  await expect(page.locator('[data-system="core"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#wizard-command")).toHaveText("npx picard-code opencode auth login");
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await page.getByRole("link", { name: "Skip sign-in for now and use OpenCode's few free models" }).click();
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator("#first-run-lead")).toHaveText("Select one of OpenCode's free models to power the computer. Sign in under AI provider at any time for more capable models.");
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect(page.locator("#model")).toHaveValue("");
  await page.selectOption("#model", JSON.stringify(["opencode", "free-model"]));
  await page.getByRole("button", { name: "Confirm this model" }).click();
  await expect(title(page)).toHaveText("Open a channel");
  await expect(page.locator("#readout-model")).toHaveText("Free test model");
  await page.reload();
  await expect(title(page)).toHaveText("Open a channel");
  await expect(page.locator("#readout-model")).toHaveText("Free test model");
  // Signing in stays available later from the side panel.
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await page.getByRole("link", { name: "Connect an AI provider" }).click();
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible();
});

test("the Computer intelligence tile during start-up opens the model step, not the side panel", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await begin(page);
  await expect(title(page)).toHaveText("Computer core offline");
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator('[data-system="intelligence"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await page.getByRole("link", { name: /^AI provider/ }).click();
  await expect(title(page)).toHaveText("Computer core offline");
  await expect(page.locator("#drawer-settings")).toBeHidden();
});

test("an existing OpenCode account skips the computer core step even with only free models", async ({ page }) => {
  await launch(page, ["--free-models", "--opencode-account"]);
  await expect(page.locator("#readout-provider")).toHaveText("Connected");
  await begin(page);
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator("#model optgroup")).toHaveCount(1);
  await expect(page.locator("#model")).toHaveValue("");
});

test("voice systems start on their own, report a real failure and come online after Try again", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { microphoneRequests: 0, voiceBarTexts: [] as string[] });
    navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as { microphoneRequests: number }).microphoneRequests++;
      throw new Error("Test microphone deliberately unavailable.");
    };
    // Steps can pass quickly, so record every message the voice bar shows.
    new MutationObserver(() => {
      const texts = (window as unknown as { voiceBarTexts: string[] }).voiceBarTexts;
      const text = document.getElementById("voice-bar-text")?.textContent ?? "";
      if (text && texts.at(-1) !== text) texts.push(text);
    }).observe(document, { childList: true, characterData: true, subtree: true });
  });
  let speechWrites = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/settings")) speechWrites++; });
  await launch(page, ["--speech-setup-fails"]);
  await expect(page.locator("#voice-bar-text")).toHaveText("Voice systems offline: Test speech download failed. No files were downloaded.");
  const shown = await page.evaluate(() => (window as unknown as { voiceBarTexts: string[] }).voiceBarTexts);
  expect(shown[0]).toMatch(/^Initializing voice systems/);
  expect(shown).not.toContain("Voice systems online");
  expect(shown.at(-1)).toBe("Voice systems offline: Test speech download failed. No files were downloaded.");
  await expect(page.locator("#readout-speech")).toHaveText("Failed");
  await begin(page);
  await expect(title(page)).toHaveText("Open a channel");
  await expect(page.getByRole("button", { name: "Open a channel" })).toBeDisabled();
  await expect(page.locator("#open-channel-hint")).toHaveText("Available once voice systems are online.");
  await page.locator("#voice-bar-retry").click();
  await expect(page.locator("#voice-bar-text")).toHaveText(/^Initializing voice systems/);
  await expect(page.locator("#voice-bar-text")).toHaveText("Voice systems online");
  await expect(page.locator("#voice-bar-retry")).toBeHidden();
  await expect(page.locator("#readout-speech")).toHaveText("Nemotron · Kokoro");
  await expect(page.getByRole("button", { name: "Open a channel" })).toBeEnabled();
  expect(speechWrites).toBe(2);
  // The microphone is asked for only when the Captain opens the channel.
  expect(await page.evaluate(() => (window as unknown as { microphoneRequests: number }).microphoneRequests)).toBe(0);
  await page.getByRole("button", { name: "Open a channel" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { microphoneRequests: number }).microphoneRequests)).toBe(1);
  await expect(page.locator("#open-channel-hint")).toHaveText("To allow the microphone, use the site settings next to the address bar, then choose Open a channel again.");
  await expect(title(page)).toHaveText("Open a channel");
});

test("speech that is already set up is not prepared again during start-up", async ({ page }) => {
  let speechWrites = 0;
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/(settings|speech-setup)$/.test(request.url())) speechWrites++; });
  await launch(page, ["--speech"]);
  await expect(page.locator("#voice-bar-text")).toHaveText("Voice systems online");
  await begin(page);
  await expect(page.getByRole("button", { name: "Open a channel" })).toBeEnabled();
  await expect(page.locator("#voice-console")).toBeHidden();
  expect(speechWrites).toBe(0);
});

test("a later speech change that fails stays visible after the channel is open", async ({ page }) => {
  await launch(page, ["--speech", "--speech-settings"]);
  await begin(page);
  await expect(title(page)).toHaveText("Open a channel");
  // The channel is open and the first order is awaited, without needing a microphone here.
  await page.evaluate(() => {
    localStorage.setItem("picard-first-run", "listening");
    window.dispatchEvent(new StorageEvent("storage", { key: "picard-first-run" }));
  });
  await expect(title(page)).toHaveText("All systems online");
  await expect(page.locator("#voice-bar")).toBeHidden();
  await page.getByRole("link", { name: /^Listen/ }).click();
  await page.locator("#advanced-speech > summary").click();
  await page.getByLabel("Listening", { exact: true }).selectOption("mai");
  await page.getByLabel("Subscription ID").fill("test-subscription");
  await page.getByLabel("Resource group").fill("test-group");
  await page.getByLabel("Resource name").fill("test-resource");
  await page.getByLabel("Region", { exact: true }).fill("broken");
  await page.getByLabel("Listening deployment").fill("test-listening");
  await page.locator("#save-speech").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#voice-bar-text")).toHaveText("Voice systems offline: The new speech settings did not work, so nothing was changed. Test speech service could not start.");
  await expect(page.locator("#voice-bar-retry")).toBeVisible();
  await expect(page.locator("#readout-speech")).toHaveText("Nemotron · Kokoro");
});

test("a connected provider with no usable models shows the model problem rather than the sign-in order", async ({ page }) => {
  await launch(page, ["--no-models"]);
  await begin(page);
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator("#model-problem")).toContainText("Check your models in OpenCode");
  await expect(page.locator("#model-status")).toHaveText("No models available");
  await expect(page.locator("#model")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm this model" })).toBeDisabled();
});

test("the computer core step does not offer free models when there are none", async ({ page }) => {
  await launch(page, ["--no-models", "--no-providers"]);
  await begin(page);
  await expect(title(page)).toHaveText("Computer core offline");
  await expect(page.locator("#use-free-models")).toBeHidden();
});

test("returning from the terminal after signing in moves on to the model choice without a button", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await begin(page);
  await expect(title(page)).toHaveText("Computer core offline");
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), hasConnectedProvider: true } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.locator("#readout-model")).toHaveText("Offline");
  await expect(page.getByRole("button", { name: "Confirm this model" })).toBeDisabled();
  await page.unrouteAll({ behavior: "wait" });
});

test("signing in after opening the AI provider tile during start-up moves on to the model choice", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await begin(page);
  await page.getByRole("link", { name: /^AI provider/ }).click();
  await expect(page).toHaveURL(/#settings\/provider$/);
  await expect(title(page)).toHaveText("Computer core offline");
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), hasConnectedProvider: true } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator("#system-core")).toHaveText("Online");
  await page.unrouteAll({ behavior: "wait" });
});

test("a failed sign-in check runs once at a time and shows the real error", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await begin(page);
  await expect(title(page)).toHaveText("Computer core offline");
  let refreshes = 0;
  let finish!: () => void;
  const waiting = new Promise<void>((done) => { finish = done; });
  await page.route("**/api/refresh", async (route) => {
    refreshes++;
    await waiting;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Test provider connection failed." }) });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => refreshes).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  finish();
  await expect(page.getByRole("alert")).toContainText("Test provider connection failed.");
  await expect(page.locator("#first-run-setup #notice")).toBeVisible();
  expect(refreshes).toBe(1);
  await expect(title(page)).toHaveText("Computer core offline");
  await page.unrouteAll({ behavior: "wait" });
});

test("copying the sign-in order reports only actual clipboard results", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await begin(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { sessionStorage.setItem("testCopiedCommand", text); } } });
  });
  const copy = page.getByRole("button", { name: "Copy order" });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#wizard-copy-result")).toHaveText("Order copied");
  expect(await page.evaluate(() => sessionStorage.getItem("testCopiedCommand"))).toBe("npx picard-code opencode auth login");
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Test clipboard access refused."); }; });
  await copy.click();
  await expect(page.getByRole("alert")).toContainText("Test clipboard access refused.");
  await expect(page.locator("#wizard-copy-result")).toBeEmpty();
  await expect(copy).toBeEnabled();
});

test("a failed provider lookup does not claim that start-up is needed", async ({ page }) => {
  await launch(page, ["--provider-error"]);
  await expect(page.locator("#first-run-setup")).toBeHidden();
  await expect(page.locator("#settings-provider")).toBeHidden();
  await expect(page.locator("#readout-provider")).toHaveText("Checking");
  await expect(page).not.toHaveURL(/#settings\/provider$/);
});

test("missing saved models are named without selecting a replacement", async ({ page }) => {
  // This flag deliberately seeds an unavailable choice instead of the usual ready fixture.
  await launch(page, ["--model-unavailable"]);
  await expect(page.locator("#first-run-setup")).toBeHidden();
  await expect(page.locator("#drawer-settings")).toBeVisible();
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.locator("#model-status")).toHaveText("Model unavailable");
  await expect(page.locator("#model-guidance")).toHaveText("Your saved choice is kept until you confirm a replacement.");
  await expect(page.locator("#model-problem")).toContainText("missing-model");
  await expect(page.locator("#readout-model")).toHaveText("Unavailable");
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#model")).toHaveValue("");
  await page.selectOption("#model", first);
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
});

test("losing every provider keeps a saved choice in model recovery, not first-run onboarding", async ({ page }) => {
  await launch(page, ["--model-unavailable", "--no-models", "--no-providers"]);
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#model-problem")).toContainText("missing-model");
  await expect(page.locator("#model-status")).toHaveText("Model unavailable");
  await expect(page.locator("#first-run-setup")).toBeHidden();
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page.getByRole("button", { name: "Refresh connection" })).toBeEnabled();
  await expect(page).toHaveURL(/#settings\/model$/);
  await page.getByRole("link", { name: "Connect an AI provider" }).click();
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible();
  await expect(page.locator("#first-run-setup")).toBeHidden();
});

test("the saved LCARS readout is clear and only a changed choice can be confirmed", async ({ page }) => {
  const app = await launch(page);
  await begin(page);
  await expect(title(page)).toHaveText("Open a channel");
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  const confirm = page.getByRole("button", { name: "Use this model" });
  await expect(page.locator("#model-status")).toHaveText("Model saved · GitHub Copilot");
  await expect(page.locator("#model-guidance")).toHaveText("This AI model is used for your requests and bridge crew reports.");
  await expect(page.locator("#model-status")).toHaveAttribute("data-state", "saved");
  await expect(page.locator("#model-status")).toHaveAttribute("aria-live", "polite");
  await expect(confirm).toBeDisabled();
  await expect(page.locator("#refresh-model")).toBeHidden();
  let saves = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url() === new URL("/api/model", app.url).href) saves++; });
  await page.locator("#model-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator("#model-status")).toHaveText("Model saved · GitHub Copilot");
  expect(saves).toBe(0);
  await page.selectOption("#model", other);
  await expect(confirm).toBeEnabled();
  await expect(page.locator("#model-status")).toHaveText("New choice not saved. Copilot test model is still in use.");
  await expect(page.locator("#model-guidance")).toHaveText("Use this model to save your new choice. Your saved model stays in use until then.");
  await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
  await page.selectOption("#model", first);
  await expect(confirm).toBeDisabled();
  await expect(page.locator("#model-status")).toHaveText("Model saved · GitHub Copilot");
  await expect(page.locator("#model-guidance")).toHaveText("This AI model is used for your requests and bridge crew reports.");
});

test("a failed refresh from Computer intelligence preserves the saved choice and offers a retry", async ({ page }) => {
  await launch(page, ["--model-unavailable"]);
  await page.route("**/api/refresh", (route) => route.fulfill({
    status: 502, contentType: "application/json", body: JSON.stringify({ error: "Test provider connection failed." }),
  }));
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page.getByRole("alert")).toContainText("Test provider connection failed.");
  await expect(page.getByRole("button", { name: "Refresh connection" })).toBeEnabled();
  await expect(page.locator("#model-status")).toHaveText("Model unavailable");
  await expect(page.locator("#model-problem")).toContainText("missing-model");
  await expect(page.locator("#model")).toHaveValue("");
});

test("saved setup opens directly and later provider, model and speech settings remain available", async ({ page }, testInfo) => {
  const folder = await mkdtemp(join(tmpdir(), "picard-later-settings-"));
  const file = join(folder, "model.json");
  await saveModelSettings(file, { providerID: "github-copilot", modelID: "fixture-model" });
  const app = await launch(page, ["--speech", "--speech-settings", "--model-file", file]);
  try {
    await expect(page.locator("#first-run-setup")).toBeHidden();
    await expect(page.locator("#speech-first-start")).toBeHidden();
    await expect(page.locator("#voice-bar")).toBeHidden();
    await expect(page.locator("#voice-console")).toBeVisible();
    await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
    await page.evaluate(async () => {
      const response = await fetch("/api/conversations", { method: "POST",
        headers: { "Content-Type": "application/json", "X-Picard-Request": "1" },
        body: JSON.stringify({ title: "Keep this log entry" }) });
      if (!response.ok) throw new Error("The test log entry could not be created.");
    });
    await page.reload();
    const currentEntry = page.locator('.conversation-button[aria-current="page"]');
    await expect(currentEntry).toContainText("Keep this log entry");
    await page.getByRole("link", { name: /^AI provider/ }).click();
    await page.getByRole("button", { name: "Refresh connection" }).click();
    await expect(page.getByRole("button", { name: "Refresh connection" })).toBeEnabled();
    await expect(page.locator("#drawer-settings")).toBeVisible();
    await expect(page.locator("#first-run-setup")).toBeHidden();
    await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
    await page.getByRole("link", { name: /^Computer intelligence/ }).click();
    await expect(page.getByRole("heading", { name: "Computer intelligence" })).toBeVisible();
    await expect(page.locator("#model-status")).toHaveText("Model saved · GitHub Copilot");
    await page.screenshot({ path: testInfo.outputPath("later-model-settings.png"), animations: "disabled" });
    await page.selectOption("#model", other);
    await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
    await page.getByRole("button", { name: "Use this model" }).click();
    await expect(page.locator("#drawer-settings")).toBeHidden();
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(currentEntry).toContainText("Keep this log entry");
    await page.reload();
    await expect(page.locator("#first-run-setup")).toBeHidden();
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(currentEntry).toContainText("Keep this log entry");
    await page.getByRole("link", { name: /^Listen/ }).click();
    await expect(page.locator("#drawer-settings")).toBeVisible();
    await page.locator("#advanced-speech > summary").click();
    await expect(page.getByLabel("Listening", { exact: true })).toHaveValue("nemotron");
    await expect(page.getByLabel("Speaking", { exact: true })).toHaveValue("kokoro");
    await page.getByLabel("Listening", { exact: true }).selectOption("mai");
    await expect(page.getByLabel("Speaking", { exact: true })).toHaveValue("kokoro");
    await expect(page.getByLabel("Subscription ID")).toBeVisible();
    await page.getByLabel("Listening", { exact: true }).selectOption("nemotron");
    await page.getByLabel("Speaking", { exact: true }).selectOption("mai");
    await expect(page.getByLabel("Listening", { exact: true })).toHaveValue("nemotron");
    await expect(page.getByLabel("Listening deployment")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(currentEntry).toContainText("Keep this log entry");
    await page.getByRole("link", { name: /^Listen/ }).click();
    await expect(page.getByLabel("Speaking", { exact: true })).toHaveValue("mai");
    await page.reload();
    await expect(page.getByLabel("Speaking", { exact: true })).toHaveValue("kokoro");
    await page.locator("#advanced-speech > summary").click();
    await page.getByLabel("Listening", { exact: true }).selectOption("mai");
    await page.getByLabel("Subscription ID").fill("test-subscription");
    await page.getByLabel("Resource group").fill("test-group");
    await page.getByLabel("Resource name").fill("test-resource");
    await page.getByLabel("Region", { exact: true }).fill("testregion");
    await page.getByLabel("Listening deployment").fill("test-listening");
    await page.locator("#save-speech").click();
    await expect(page.locator("#readout-speech")).toHaveText("Azure MAI · Kokoro");
    await page.reload();
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(currentEntry).toContainText("Keep this log entry");
    await page.getByRole("link", { name: /^Listen/ }).click();
    await expect(page.getByRole("heading", { name: "Speech", exact: true })).toBeVisible();
    await expect(page.getByLabel("Listening", { exact: true })).toHaveValue("mai");
    await expect(page.getByLabel("Speaking", { exact: true })).toHaveValue("kokoro");
    await expect(page.locator("#readout-provider")).toHaveText("Connected");
    await page.screenshot({ path: testInfo.outputPath("later-speech-settings.png"), animations: "disabled" });
    await page.getByLabel("Region", { exact: true }).fill("broken");
    await page.locator("#save-speech").click();
    await expect(page.locator("#speech-preparation-error")).toContainText("Test speech service could not start.");
    await expect(page.locator("#readout-speech")).toHaveText("Azure MAI · Kokoro");
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(currentEntry).toContainText("Keep this log entry");
    await page.reload();
    await page.getByRole("link", { name: /^Listen/ }).click();
    await expect(page.getByLabel("Region", { exact: true })).toHaveValue("testregion");
    await expect(page.getByLabel("Speaking", { exact: true })).toHaveValue("kokoro");
  } finally {
    await app.close();
    await rm(folder, { recursive: true });
  }
});

test("confirmation updates other open pages and an unconfirmed change stays only a draft", async ({ page, context }) => {
  const app = await launch(page, ["--no-default-model"]);
  const second = await context.newPage();
  await second.goto(app.url);
  await expect(title(second)).toHaveText("Welcome aboard, Captain.");
  await begin(page);
  // The other page follows start-up rather than waiting at the welcome screen.
  await expect(title(second)).toHaveText("Computer intelligence");
  await expect(second.locator("#model")).toHaveValue("");
  await page.selectOption("#model", other);
  await page.getByRole("button", { name: "Confirm this model" }).click();
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await expect(title(second)).toHaveText("Open a channel");
  await expect(second.locator("#model")).toHaveValue(other);
  await second.getByRole("link", { name: /^Computer intelligence/ }).click();
  await second.selectOption("#model", first);
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await second.reload();
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await second.getByRole("link", { name: /^Computer intelligence/ }).click();
  await expect(second.locator("#model")).toHaveValue(other);
});

for (const failed of [false, true]) {
  test(`voice systems prepared in one page come online in another${failed ? " after a displayed failure" : ""}`, async ({ page, context }) => {
    const app = await launch(page, failed ? ["--speech-setup-fails"] : []);
    await expect(page.locator("#voice-bar-text")).toHaveText(/^Initializing voice systems/);
    const second = await context.newPage();
    try {
      await second.goto(app.url);
      if (failed) {
        await expect(second.locator("#voice-bar-text")).toHaveText("Voice systems offline: Test speech download failed. No files were downloaded.");
        await second.locator("#voice-bar-retry").click();
      } else await expect(second.locator("#voice-bar-text")).toHaveText(/^Initializing voice systems/);
      for (const open of [page, second]) {
        await expect(open.locator("#voice-bar-text")).toHaveText("Voice systems online");
        await expect(open.locator("#readout-speech")).toHaveText("Nemotron · Kokoro");
        await expect(open.locator("#speech-first-start")).toBeHidden();
        await expect(open.locator("#speech-preparation")).toBeHidden();
        await expect(title(open)).toHaveText("Welcome aboard, Captain.");
      }
    } finally {
      await second.close();
      await app.close();
    }
  });
}

test("confirmation failures remain visible and do not activate the selected model", async ({ page }) => {
  await launch(page, ["--no-default-model"]);
  await begin(page);
  await page.route("**/api/model", (route) => route.fulfill({
    status: 502, contentType: "application/json", body: JSON.stringify({ error: "Could not save the model choice. Test disk is full." }),
  }));
  await page.selectOption("#model", first);
  await page.getByRole("button", { name: "Confirm this model" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save the model choice. Test disk is full.");
  await expect(page.locator("#first-run-setup #notice")).toBeVisible();
  await expect(title(page)).toHaveText("Computer intelligence");
  await expect(page.locator("#readout-model")).toHaveText("Offline");
  await expect(page.getByRole("button", { name: "Confirm this model" })).toBeEnabled();
});

test("losing the model cancels a microphone that is still opening", async ({ page }) => {
  await page.addInitScript(() => {
    let release!: () => void;
    const ready = new Promise<void>((done) => { release = done; });
    const stream = document.createElement("canvas").captureStream();
    Object.assign(window, { releaseTestMicrophone: release, testMicrophoneTrack: stream.getTracks()[0] });
    navigator.mediaDevices.getUserMedia = async () => { await ready; return stream; };
  });
  let worklets = 0;
  page.on("request", (request) => { if (request.url().endsWith("/microphone-worklet.js")) worklets++; });
  await launch(page, ["--speech"]);
  await begin(page);
  await page.getByRole("button", { name: "Open a channel" }).click();
  await expect(page.locator("#open-channel-hint")).toHaveText("Opening the channel");
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ json: { ...state, selectedModel: undefined, models: state.models.filter((model: { modelID: string }) => model.modelID !== "fixture-model") } });
  });
  // A real server notification makes this page check availability again.
  await page.evaluate(async () => {
    await fetch("/api/model", { method: "POST", headers: { "Content-Type": "application/json", "X-Picard-Request": "1" },
      body: JSON.stringify({ providerID: "github-copilot", modelID: "fixture-model" }) });
  });
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await page.evaluate(() => (window as unknown as { releaseTestMicrophone: () => void }).releaseTestMicrophone());
  await expect.poll(() => page.evaluate(() => (window as unknown as { testMicrophoneTrack: MediaStreamTrack }).testMicrophoneTrack.readyState)).toBe("ended");
  expect(worklets).toBe(0);
});

test("the confirmed choice survives a full app restart", async ({ page }) => {
  const settings = await mkdtemp(join(tmpdir(), "picard-model-restart-"));
  const args = ["--model-file", join(settings, "model.json")];
  const firstApp = await launch(page, [...args, "--no-default-model"]);
  let secondApp: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await begin(page);
    await page.selectOption("#model", other);
    await page.getByRole("button", { name: "Confirm this model" }).click();
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await firstApp.close();
    secondApp = await launch(page, args);
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(page.locator("#drawer-settings")).toBeHidden();
    // A saved model means the ship is already online: no start-up after a restart.
    await expect(page.locator("#first-run-setup")).toBeHidden();
    await page.getByRole("link", { name: /^Computer intelligence/ }).click();
    await expect(page.locator("#model")).toHaveValue(other);
  } finally {
    await firstApp.close();
    await secondApp?.close();
    await rm(settings, { recursive: true });
  }
});
