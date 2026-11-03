import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const first = JSON.stringify(["github-copilot", "fixture-model"]);
const other = JSON.stringify(["other-provider", "other"]);

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
  await page.goto(url);
  if (args.includes("--provider-error")) await expect(page.getByRole("alert")).toContainText("Test provider lookup failed.");
  else await expect(page.getByRole("status")).not.toHaveText("Starting up");
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

test("first use requires a confirmed choice, not OpenCode's default or a dropdown change", async ({ page }) => {
  await launch(page);
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#setup-progress")).toBeVisible();
  await expect(page.locator('[data-setup-step="model"]')).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Use this model" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Computer intelligence" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "AI model" })).toBeVisible();
  await expect(page.locator("#model-guidance")).toHaveText("Choose the most capable AI model available for the best answers. It may cost more or take longer.");
  await expect(page.locator("#model-status")).toHaveText("Awaiting your selection");
  await expect(page.locator(".model-details")).not.toHaveAttribute("open", "");
  await expect(page.getByText("Models are grouped by AI provider", { exact: false })).toBeHidden();
  await page.getByText("About this choice", { exact: true }).click();
  await expect(page.getByText("Models are grouped by AI provider", { exact: false })).toBeVisible();
  await page.getByText("About this choice", { exact: true }).click();
  await expect(page.locator("#model optgroup")).toHaveCount(2);
  await page.selectOption("#model", other);
  await expect(page.locator("#model-status")).toHaveText("Awaiting confirmation");
  await expect(page.locator("#readout-model")).toHaveText("Not selected");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page.locator("#readout-model")).toHaveText("Other model");
  await expect(page).toHaveURL(/#settings\/voice$/);
  await expect(page.locator('[data-setup-step="voice"]')).toHaveAttribute("aria-current", "step");
  await page.reload();
  await expect(page.locator("#readout-model")).toHaveText("Other model");
  await expect(page.getByRole("status")).toHaveText("Standing by");
});

test("only default models open connection onboarding with an explicit optional model choice", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await expect(page).toHaveURL(/#settings\/provider$/);
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible();
  await expect(page.locator('[data-setup-step="provider"]')).toHaveText("01 Connect AI provider");
  await expect(page.getByRole("link", { name: /^AI provider/ })).toBeVisible();
  await expect(page.locator("#provider-welcome")).toHaveText("Welcome aboard, Captain.");
  await expect(page.locator("#provider-welcome")).toBeVisible();
  await expect(page.locator("#provider-guidance")).toContainText("Connect your preferred AI provider in OpenCode");
  await expect(page.locator("#provider-guidance")).not.toContainText("Captain");
  await expect(page.locator("#provider-status")).toHaveText("No connected AI providers found. 1 model available.");
  await expect(page.locator('[data-setup-step="provider"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#readout-provider")).toHaveText("OpenCode models");
  await expect(page.locator("#workspace-caption")).toBeHidden();
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page.getByRole("button", { name: "Refresh connection" })).toBeEnabled();
  await expect(page).toHaveURL(/#settings\/provider$/);
  await expect(page.locator("#provider-status")).toHaveText("No connected AI providers found. 1 model available.");
  const continueWithoutConnecting = page.getByRole("link", { name: "Continue without connecting" });
  await expect(continueWithoutConnecting).toHaveClass("pill outline");
  await expect(continueWithoutConnecting).toHaveAccessibleDescription("Choose from OpenCode's default models. For the best experience, connect your own AI provider.");
  await continueWithoutConnecting.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await page.selectOption("#model", JSON.stringify(["opencode", "free-model"]));
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page).toHaveURL(/#settings\/voice$/);
  await expect(page.getByRole("heading", { name: "Speech" })).toBeVisible();
  await expect(page.locator("#readout-model")).toHaveText("Free test model");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect(page.locator("#setup-progress")).toBeHidden();
  await expect(page.locator("#readout-model")).toHaveText("Free test model");
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await page.getByRole("link", { name: "Connect an AI provider" }).click();
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible();
  await expect(page.locator("#provider-welcome")).toBeHidden();
  await expect(page.locator("#setup-progress")).toBeHidden();
});

test("an existing OpenCode account skips connection onboarding even with only default models", async ({ page }) => {
  await launch(page, ["--free-models", "--opencode-account"]);
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#readout-provider")).toHaveText("Connected");
  await expect(page.locator("#use-opencode-models")).toBeHidden();
  await expect(page.locator("#model optgroup")).toHaveCount(1);
  await expect(page.locator("#model")).toHaveValue("");
});

test("a connected provider with no usable models opens model recovery rather than sign-in onboarding", async ({ page }) => {
  await launch(page, ["--no-models"]);
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#model-problem")).toContainText("Check your models in OpenCode");
  await expect(page.locator("#model-status")).toHaveText("No models available");
  await expect(page.locator("#model-guidance")).toHaveText("Check model availability in OpenCode before choosing an AI model.");
  await expect(page.locator("#model")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Use this model" })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page.getByRole("button", { name: "Refresh connection" })).toBeEnabled();
  await expect(page).toHaveURL(/#settings\/model$/);
});

test("connection onboarding does not offer a dead continuation when no models are available", async ({ page }) => {
  await launch(page, ["--no-models", "--no-providers"]);
  await expect(page).toHaveURL(/#settings\/provider$/);
  await expect(page.locator("#use-opencode-models")).toBeHidden();
  await expect(page.locator("#default-model-guidance")).toBeHidden();
  await expect(page.locator("#provider-status")).toHaveText("No connected AI providers found. 0 models available.");
});

test("refreshing after connecting a provider advances to explicit model selection", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), hasConnectedProvider: true } });
  });
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.locator("#readout-model")).toHaveText("Not selected");
  await expect(page.getByRole("button", { name: "Use this model" })).toBeDisabled();
  await page.unrouteAll({ behavior: "wait" });
});

test("copying the sign-in command reports only actual clipboard results", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { sessionStorage.setItem("testCopiedCommand", text); } } });
  });
  const copy = page.getByRole("button", { name: "Copy command" });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#provider-copy-result")).toHaveText("Command copied");
  expect(await page.evaluate(() => sessionStorage.getItem("testCopiedCommand"))).toBe("npx picard-code opencode auth login");
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Test clipboard access refused."); }; });
  await copy.click();
  await expect(page.getByRole("alert")).toContainText("Test clipboard access refused.");
  await expect(page.locator("#provider-copy-result")).toBeEmpty();
  await expect(copy).toBeEnabled();
});

test("a failed provider lookup does not claim that connection onboarding is needed", async ({ page }) => {
  await launch(page, ["--provider-error"]);
  await expect(page.locator("#settings-provider")).toBeHidden();
  await expect(page.locator("#setup-progress")).toBeHidden();
  await expect(page.locator("#readout-provider")).toHaveText("Checking");
  await expect(page).not.toHaveURL(/#settings\/provider$/);
});

test("connection refresh stays single and shows real progress and failures", async ({ page }) => {
  await launch(page, ["--free-models"]);
  let refreshes = 0;
  let finish!: () => void;
  const waiting = new Promise<void>((done) => { finish = done; });
  await page.route("**/api/refresh", async (route) => {
    refreshes++;
    await waiting;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Test provider connection failed." }) });
  });
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page.locator("#provider-status")).toHaveText("Refreshing connection");
  await expect(page.getByRole("button", { name: "Refreshing connection" })).toBeDisabled();
  await page.locator("#refresh-provider").dispatchEvent("click");
  finish();
  await expect(page.getByRole("alert")).toContainText("Test provider connection failed.");
  await expect(page.getByRole("button", { name: "Refresh connection" })).toBeEnabled();
  expect(refreshes).toBe(1);
  await expect(page.locator("#provider-status")).toHaveText("No connected AI providers found. 1 model available.");
});

test("missing saved models are named without selecting a replacement", async ({ page }) => {
  // This flag deliberately seeds an unavailable choice instead of the usual ready fixture.
  await launch(page, ["--model-unavailable"]);
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
  await expect(page.locator("#setup-progress")).toBeHidden();
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page.getByRole("button", { name: "Refresh connection" })).toBeEnabled();
  await expect(page).toHaveURL(/#settings\/model$/);
  await page.getByRole("link", { name: "Connect an AI provider" }).click();
  await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible();
  await expect(page.locator("#provider-welcome")).toBeHidden();
});

test("the saved LCARS readout is clear and only a changed choice can be confirmed", async ({ page }) => {
  const app = await launch(page);
  await page.selectOption("#model", first);
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page.locator("#settings-voice")).toBeVisible();
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

test("closing setup and pressing M cannot start the microphone before confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { microphoneRequests: 0 });
    navigator.mediaDevices.getUserMedia = async () => {
      const tracker = window as unknown as { microphoneRequests: number };
      tracker.microphoneRequests++;
      throw new Error("Test microphone deliberately unavailable.");
    };
  });
  let sends = 0;
  page.on("request", (request) => { if (request.url().endsWith("/send")) sends++; });
  await launch(page, ["--speech"]);
  await page.selectOption("#model", first);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Switch microphone on" })).toBeDisabled();
  await page.keyboard.press("m");
  expect(await page.evaluate(() => (window as unknown as { microphoneRequests: number }).microphoneRequests)).toBe(0);
  expect(sends).toBe(0);
  await page.getByRole("link", { name: /^Computer intelligence/ }).click();
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { microphoneRequests: number }).microphoneRequests)).toBe(1);
});

test("confirmation updates other open pages and an unconfirmed change stays only a draft", async ({ page, context }) => {
  const app = await launch(page);
  const second = await context.newPage();
  await second.goto(app.url);
  await expect(second.locator("#model")).toHaveValue("");
  await page.selectOption("#model", other);
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await expect(second.locator("#model")).toHaveValue(other);
  await second.selectOption("#model", first);
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await second.reload();
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await second.getByRole("link", { name: /^Computer intelligence/ }).click();
  await expect(second.locator("#model")).toHaveValue(other);
});

test("confirmation failures remain visible and do not activate the selected model", async ({ page }) => {
  await launch(page);
  await page.route("**/api/model", (route) => route.fulfill({
    status: 502, contentType: "application/json", body: JSON.stringify({ error: "Could not save the model choice. Test disk is full." }),
  }));
  await page.selectOption("#model", first);
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save the model choice. Test disk is full.");
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await expect(page.locator("#readout-model")).toHaveText("Not selected");
  await expect(page.getByRole("button", { name: "Use this model" })).toBeEnabled();
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
  await page.selectOption("#model", first);
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page.getByRole("status")).toHaveText("Starting microphone");
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
  const firstApp = await launch(page, args);
  let secondApp: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await page.selectOption("#model", other);
    await page.getByRole("button", { name: "Use this model" }).click();
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await firstApp.close();
    secondApp = await launch(page, args);
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(page.locator("#drawer-settings")).toBeHidden();
    await page.getByRole("link", { name: /^Computer intelligence/ }).click();
    await expect(page.locator("#model")).toHaveValue(other);
  } finally {
    await firstApp.close();
    await secondApp?.close();
    await rm(settings, { recursive: true });
  }
});
