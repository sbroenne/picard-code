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
  await expect(page.getByRole("status")).not.toHaveText("Starting up");
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
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Confirm model" })).toBeDisabled();
  await expect(page.getByText("For the best experience", { exact: false })).toBeVisible();
  await expect(page.locator("#model optgroup")).toHaveCount(2);
  await page.selectOption("#model", other);
  await expect(page.locator("#readout-model")).toHaveText("Choose a model");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await page.getByRole("link", { name: /^Model/ }).click();
  await page.getByRole("button", { name: "Confirm model" }).click();
  await expect(page.locator("#readout-model")).toHaveText("Other model");
  await expect(page).toHaveURL(/#settings\/voice$/);
  await page.reload();
  await expect(page.locator("#readout-model")).toHaveText("Other model");
  await expect(page.getByRole("status")).toHaveText("Standing by");
});

test("free models still require explicit confirmation", async ({ page }) => {
  await launch(page, ["--free-models"]);
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#readout-provider")).toHaveText("Connected");
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await page.selectOption("#model", JSON.stringify(["opencode", "free-model"]));
  await page.getByRole("button", { name: "Confirm model" }).click();
  await expect(page.locator("#readout-model")).toHaveText("Free test model");
});

test("missing saved models are named without selecting a replacement", async ({ page }) => {
  // This flag deliberately seeds an unavailable choice instead of the usual ready fixture.
  await launch(page, ["--model-unavailable"]);
  await expect(page.locator("#model")).toHaveValue("");
  await expect(page.locator("#model-status")).toContainText("missing-model");
  await expect(page.locator("#readout-model")).toHaveText("Unavailable");
  await page.getByRole("link", { name: /^Provider/ }).click();
  await page.getByRole("button", { name: "Refresh connection" }).click();
  await expect(page).toHaveURL(/#settings\/model$/);
  await expect(page.locator("#model")).toHaveValue("");
  await page.selectOption("#model", first);
  await page.getByRole("button", { name: "Confirm model" }).click();
  await expect(page.locator("#readout-model")).toHaveText("Copilot test model");
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
  await page.getByRole("link", { name: /^Model/ }).click();
  await page.getByRole("button", { name: "Confirm model" }).click();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { microphoneRequests: number }).microphoneRequests)).toBe(1);
});

test("confirmation updates other open pages and an unconfirmed change stays only a draft", async ({ page, context }) => {
  const app = await launch(page);
  const second = await context.newPage();
  await second.goto(app.url);
  await expect(second.locator("#model")).toHaveValue("");
  await page.selectOption("#model", other);
  await page.getByRole("button", { name: "Confirm model" }).click();
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await expect(second.locator("#model")).toHaveValue(other);
  await second.selectOption("#model", first);
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await second.reload();
  await expect(second.locator("#readout-model")).toHaveText("Other model");
  await second.getByRole("link", { name: /^Model/ }).click();
  await expect(second.locator("#model")).toHaveValue(other);
});

test("confirmation failures remain visible and do not activate the selected model", async ({ page }) => {
  await launch(page);
  await page.route("**/api/model", (route) => route.fulfill({
    status: 502, contentType: "application/json", body: JSON.stringify({ error: "Could not save the model choice. Test disk is full." }),
  }));
  await page.selectOption("#model", first);
  await page.getByRole("button", { name: "Confirm model" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save the model choice. Test disk is full.");
  await expect(page.getByRole("status")).toHaveText("Setup needed");
  await expect(page.locator("#readout-model")).toHaveText("Choose a model");
  await expect(page.getByRole("button", { name: "Confirm model" })).toBeEnabled();
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
  await page.getByRole("button", { name: "Confirm model" }).click();
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
    await page.getByRole("button", { name: "Confirm model" }).click();
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await firstApp.close();
    secondApp = await launch(page, args);
    await expect(page.locator("#readout-model")).toHaveText("Other model");
    await expect(page.locator("#drawer-settings")).toBeHidden();
    await page.getByRole("link", { name: /^Model/ }).click();
    await expect(page.locator("#model")).toHaveValue(other);
  } finally {
    await firstApp.close();
    await secondApp?.close();
    await rm(settings, { recursive: true });
  }
});
