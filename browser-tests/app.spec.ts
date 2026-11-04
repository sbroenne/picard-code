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
  // Original silent stand-in, not a downloaded computer recording.
  const silent = Buffer.alloc(44 + 4800);
  silent.write("RIFF"); silent.writeUInt32LE(silent.length - 8, 4); silent.write("WAVEfmt ", 8);
  silent.writeUInt32LE(16, 16); silent.writeUInt16LE(1, 20); silent.writeUInt16LE(1, 22);
  silent.writeUInt32LE(24000, 24); silent.writeUInt32LE(48000, 28);
  silent.writeUInt16LE(2, 32); silent.writeUInt16LE(16, 34); silent.write("data", 36); silent.writeUInt32LE(4800, 40);
  await page.route("**/api/sounds/startup", (route) => route.fulfill({ contentType: "audio/wav", body: silent }));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Computer voice offline" })).toBeVisible();
  page.on("close", () => child.kill());
});

test("empty screen fits without horizontal overflow and has no typing box", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Computer voice offline" })).toBeVisible();
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
  await expect(page.locator("#readout-speech")).toHaveText("Offline");
  await expect(page.locator("#readout-version")).toHaveText(version);
  await expect(page.locator("#voice-console")).toBeHidden();
  await expect(page.locator("#speech-first-start").getByRole("button", { name: "Prepare the computer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Skip to speech setup" })).toHaveAttribute("href", "#speech-first-start");
  const action = await page.locator("#prepare-computer").boundingBox();
  expect(action!.y + action!.height).toBeLessThan(800);
  await page.screenshot({ path: testInfo.outputPath("empty-screen.png"), fullPage: true });
});

test("a new log entry keeps its Stardate stable until another entry starts", async ({ page }) => {
  const first = await page.locator("#entry-stardate").textContent();
  expect(first).toMatch(/^Stardate -?\d+\.\d$/);
  const later = new Date("2027-01-02T12:00:00Z");
  await page.clock.setFixedTime(later);
  await page.getByRole("link", { name: "Captain’s log" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#entry-stardate")).toHaveText(first!);
  await page.getByRole("button", { name: "New log entry" }).click();
  await expect(page.locator("#entry-stardate")).toHaveText(`Stardate ${formatStardate(later)}`);
});

test("the main screen shows only the conversation; the side panel tiles open their own settings", async ({ page }, testInfo) => {
  // Preparation owns the main screen until speech can actually be used.
  await expect(page.locator("#voice-console")).toBeHidden();
  await expect(page.locator("#speech-first-start")).toBeVisible();
  await expect(page.locator("#listen-toggle")).toBeHidden();
  for (const name of ["Project folder", "Connect your AI provider"]) await expect(page.getByRole("heading", { name })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "AI model" })).toBeHidden();
  await expect(page.locator("#conversations")).toBeHidden();

  // There is no Settings or Options button: each side panel tile opens its own part.
  await expect(page.getByRole("link", { name: "Options" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  const conversation = page.getByRole("link", { name: "Current log entry", exact: true });
  await expect(conversation).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await expect(conversation).not.toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.getByRole("heading", { name: "Computer intelligence" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "AI model" })).toBeVisible();
  await expect(page.getByText("OpenCode's own rules decide which actions ask first.", { exact: false })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeHidden();
  await expect(page.getByLabel("Mode", { exact: true })).toHaveCount(0);
  // Choosing the same tile again closes it; so do the Conversation tile and a click on the conversation.
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await expect(page.getByRole("combobox", { name: "AI model" })).toBeHidden();
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await conversation.click();
  await expect(page.getByRole("combobox", { name: "AI model" })).toBeHidden();
  await expect(conversation).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await expect(page.getByRole("combobox", { name: "AI model" })).toBeVisible();
  // Settings is 880 pixels wide from the left; click the conversation to its right.
  await page.mouse.click(1300, 500);
  await expect(page.getByRole("combobox", { name: "AI model" })).toBeHidden();

  await page.getByRole("link", { name: /^AI provider/ }).click();
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible();
  await expect(page.getByText("OpenCode's own rules decide which actions ask first.", { exact: false })).toBeHidden();
  await page.getByText("About the connection", { exact: true }).click();
  await expect(page.getByText("OpenCode's own rules decide which actions ask first.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: /^Project/ }).click();
  await expect(page.getByRole("heading", { name: "Project folder" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeHidden();
  await page.getByRole("link", { name: /Sir Patrick Stewart/ }).click();
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await page.getByRole("link", { name: /^Listen/ }).click();
  await expect(page.getByRole("heading", { name: "Speech" })).toBeVisible();
  await expect(page.locator("#prepare-local-speech")).toHaveText("Prepare the computer");
  await expect(page.getByLabel("Listening", { exact: true })).toBeHidden();
  await page.locator("#advanced-speech > summary").click();
  await expect(page.getByLabel("Listening", { exact: true })).toHaveValue("nemotron");
  // Only the fields for the chosen services show.
  await expect(page.getByLabel("Listening", { exact: true }).locator("option")).toHaveCount(2);
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
  await expect(page.getByRole("heading", { name: "Computer voice offline" })).toBeVisible();
});

test("Nemotron download details follow the chosen services without writing settings", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
    await route.fulfill({ json: {
      settings: { listening: "nemotron", speaking: "kokoro", subscription: "", resourceGroup: "", resourceName: "", region: "", deployment: "" },
      file: "Labeled test stand-in settings", localReady: false,
      localFiles: { nemotron: false, kokoro: true },
    } });
  });
  await page.getByRole("link", { name: /^Listen/ }).click();
  await page.locator("#advanced-speech > summary").click();
  const listening = page.getByLabel("Listening", { exact: true });
  await expect(listening).toHaveValue("nemotron");
  await expect(page.locator("#local-note")).toBeVisible();
  await expect(page.locator("#local-note")).toContainText("710 MB");
  await expect(page.locator("#local-note")).toContainText("Nothing changes until the new services work");
  await listening.selectOption("mai");
  await expect(page.locator("#local-note")).toBeHidden();
  await expect(page.getByLabel("Listening deployment")).toBeVisible();
  await listening.selectOption("nemotron");
  await expect(page.locator("#local-note")).toContainText("710 MB");
  expect(writes).toBe(0);
});

test("local speech preparation shows real steps, reports failure and retries without false readiness", async ({ page }, testInfo) => {
  const settings = { listening: "nemotron", speaking: "kokoro", subscription: "", resourceGroup: "", resourceName: "", region: "", deployment: "" };
  const saved = { settings, file: "Labeled test stand-in settings", localReady: true, localFiles: { nemotron: true, kokoro: true }, speech: { configured: true, listening: "nemotron", speaking: "kokoro" } };
  let phase = "running";
  let writes = 0;
  const step = "Downloading Nemotron — labeled test download";
  const error = "The Nemotron download could not be verified. Labeled test stand-in; no files were downloaded.";
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      phase = "running";
      expect(route.request().postDataJSON()).toMatchObject({ listening: "nemotron", speaking: "kokoro" });
      await route.fulfill({ status: 202, json: { state: "running", step } });
    } else await route.fulfill({ json: { ...saved, localReady: false, speech: { configured: false }, localFiles: { nemotron: false, kokoro: false } } });
  });
  await page.route("**/api/speech-setup", (route) => route.fulfill({ json: phase === "done"
    ? { state: "done", step: "Starting the selected speech services", result: saved }
    : { state: phase, step, ...(phase === "failed" ? { error } : {}) } }));
  await page.screenshot({ path: process.env.PICARD_SPEECH_CAPTURE ? ".picard-voice/samples/speech-first-start.png" : testInfo.outputPath("speech-first-start.png"), fullPage: true });
  await page.locator("#prepare-computer").click();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Preparing the computer" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", step);
  expect(await page.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  await expect(page.locator("#voice-console")).toBeHidden();
  await expect(page.locator("#speech-first-start")).toBeHidden();
  await expect(page.getByRole("link", { name: "Skip to speech setup" })).toHaveAttribute("href", "#speech-preparation");
  await expect(page.locator("#listen-toggle")).toBeHidden();
  await page.screenshot({ path: process.env.PICARD_SPEECH_CAPTURE ? ".picard-voice/samples/speech-preparation.png" : testInfo.outputPath("speech-preparation.png"), fullPage: true });
  phase = "failed";
  await expect(page.getByRole("heading", { name: "Speech preparation stopped" })).toBeVisible();
  await expect(page.locator("#speech-preparation-error")).toHaveText(error);
  await expect(page.locator("#voice-console")).toBeHidden();
  await expect(page.getByRole("progressbar")).toBeHidden();
  await expect(page.locator("#listen-toggle")).toBeHidden();
  await page.screenshot({ path: process.env.PICARD_SPEECH_CAPTURE ? ".picard-voice/samples/speech-preparation-failed.png" : testInfo.outputPath("speech-preparation-failed.png"), fullPage: true });
  await page.locator("#retry-speech-setup").click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect(writes).toBe(2);
  phase = "done";
  await expect(page.locator("#speech-preparation")).toBeHidden();
  await expect(page.locator("#readout-speech")).toHaveText("Nemotron · Kokoro");
  await expect(page.locator("#voice-console")).toBeVisible();
});

test("speech setup retry rejoins a running download after a connection failure", async ({ page }) => {
  let writes = 0;
  let disconnected = true;
  let done = false;
  const step = "Downloading Nemotron — labeled test download";
  const settings = { listening: "nemotron", speaking: "kokoro" };
  await page.route("**/api/settings", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    return route.fulfill({ status: 202, json: { state: "running", step } });
  });
  await page.route("**/api/speech-setup", (route) => {
    if (disconnected) return route.abort("connectionfailed");
    return route.fulfill({ json: done
      ? { state: "done", step, result: { settings, file: "Labeled test settings", localFiles: { nemotron: true, kokoro: true },
        speech: { configured: true, ...settings } } }
      : { state: "running", step } });
  });
  await page.locator("#prepare-computer").click();
  await expect(page.locator("#retry-speech-setup")).toBeVisible();
  await expect(page.locator("#speech-preparation-error")).not.toBeEmpty();
  disconnected = false;
  await page.locator("#retry-speech-setup").click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect(writes).toBe(1);
  done = true;
  await expect(page.locator("#speech-preparation")).toBeHidden();
  await expect(page.locator("#voice-console")).toBeVisible();
});

test("reopening during automatic speech setup follows the same job without starting another", async ({ page }) => {
  let writes = 0;
  const setup = { state: "running", step: "Installing local speech — labeled test download" };
  const state = await (await page.request.get(new URL("/api/state", page.url()).href)).json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/state", (route) => route.fulfill({ json: { ...state, speech: { configured: setup.state === "running", setup } } }));
  await page.route("**/api/speech-setup", (route) => route.fulfill({ json: setup }));
  await page.route("**/api/settings", (route) => { if (route.request().method() === "POST") writes++; return route.continue(); });
  await page.reload();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", setup.step);
  await expect(page.locator("#voice-console")).toBeHidden();
  await expect(page.locator("#notice")).toBeHidden();
  await expect(page.locator(".preparation-progress i").first()).toHaveCSS("animation-name", "none");
  await expect(page.getByRole("heading", { name: "Computer voice offline" })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", setup.step);
  setup.state = "failed";
  await page.reload();
  await expect(page.getByRole("heading", { name: "Speech preparation stopped" })).toBeVisible();
  await expect(page.locator("#retry-speech-setup")).toBeVisible();
  expect(writes).toBe(0);
});

test("reloaded speech retry asks the server to repeat the failed choice, not saved settings", async ({ page }) => {
  const state = await (await page.request.get(new URL("/api/state", page.url()).href)).json();
  const setup = { state: "failed", step: "Downloading Nemotron", error: "Generated download failure" };
  let retries = 0;
  let settingWrites = 0;
  await page.route("**/api/state", (route) => route.fulfill({ json: { ...state, speech: {
    configured: true, listening: "mai", speaking: "mai", setup,
  } } }));
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "POST") settingWrites++;
    return route.fulfill({ json: { settings: { listening: "mai", speaking: "mai" }, localFiles: { nemotron: false, kokoro: false } } });
  });
  await page.route("**/api/speech-setup", (route) => {
    if (route.request().method() === "POST") {
      retries++;
      expect(route.request().postDataJSON()).toEqual({});
      return route.fulfill({ status: 202, json: { state: "done", step: "Starting speech", result: {
        settings: { listening: "nemotron", speaking: "mai" }, file: "Labeled test settings",
        localFiles: { nemotron: true, kokoro: false }, speech: { configured: true, listening: "nemotron", speaking: "mai" },
      } } });
    }
    return route.fulfill({ json: setup });
  });
  await page.reload();
  await expect(page.locator("#retry-speech-setup")).toBeVisible();
  await page.locator("#retry-speech-setup").click();
  await expect(page.locator("#speech-preparation")).toBeHidden();
  await expect(page.locator("#readout-speech")).toHaveText("Nemotron · Azure MAI");
  expect(retries).toBe(1);
  expect(settingWrites).toBe(0);
});

test("while Azure is in use, the local speech choice reads as a switch, not as the current setup", async ({ page }) => {
  const state = await (await page.request.get(new URL("/api/state", page.url()).href)).json();
  await page.route("**/api/state", (route) => route.fulfill({ json: { ...state, speech: { configured: true, listening: "mai", speaking: "mai" } } }));
  await page.reload();
  await page.getByRole("link", { name: /^Listen/ }).click();
  await expect(page.locator("#speech-current")).toHaveText("In use: Azure listens, Azure speaks");
  await expect(page.locator("#local-speech-offer")).toHaveText("Switch to this computer: Nemotron listens and Kokoro speaks, with no Azure account needed.");
  await expect(page.locator("#prepare-local-speech")).toHaveText("Use this computer instead");
});

test("a long saved log cannot scroll preparation out of view, and Belay that still stops work", async ({ page }) => {
  const state = await (await page.request.get(new URL("/api/state", page.url()).href)).json();
  const entry = { id: "saved-setup-entry", title: "Generated saved log", created: 1, updated: 1 };
  const setup = { state: "running", step: "Downloading Nemotron" };
  let done = false;
  let stopped = 0;
  await page.route("**/api/state", (route) => route.fulfill({ json: { ...state, conversations: [entry],
    statuses: stopped ? {} : { [entry.id]: { type: "busy" } }, speech: { configured: false, setup } } }));
  await page.route(`**/api/conversations/${entry.id}/messages`, (route) => route.fulfill({ json: [{
    id: "long-saved-message", role: "user", parts: [{ id: "long-text", type: "text", text: "Original generated long log.\n".repeat(300) }],
  }] }));
  await page.route(`**/api/conversations/${entry.id}/stop`, (route) => {
    stopped++;
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/speech-setup", (route) => {
    if (route.request().method() === "POST") setup.state = "running";
    return route.fulfill({ json: done ? { state: "done", step: "Starting speech", result: {
      settings: { listening: "nemotron", speaking: "kokoro" }, file: "Labeled test settings",
      localFiles: { nemotron: true, kokoro: true }, speech: { configured: true, listening: "nemotron", speaking: "kokoro" },
    } } : setup });
  });
  await page.reload();
  await expect(page.locator("#messages")).toContainText("Original generated long log");
  await expect(page.locator("#voice-console")).toBeHidden();
  await expect(page.locator("#speech-preparation")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Belay that", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Belay that", exact: true }).click();
  await expect(page.locator("#stop")).toBeHidden();
  expect(stopped).toBe(1);
  setup.state = "failed";
  await expect(page.locator("#retry-speech-setup")).toBeVisible();
  await expect(page.locator("#speech-preparation")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#messages")).toContainText("Original generated long log");
  await page.locator("#retry-speech-setup").click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  done = true;
  await expect(page.locator("#speech-preparation")).toBeHidden();
  await expect(page.locator("#messages")).toBeVisible();
  await expect(page.locator("#messages")).toContainText("Original generated long log");
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
  await expect(page.locator("#settings-about")).toContainText("Automatic facts appear silently on screen.");
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
