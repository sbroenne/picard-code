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
  expect(first).toMatch(/^Captain’s log, stardate -?\d+\.\d$/);
  const later = new Date("2027-01-02T12:00:00Z");
  await page.clock.setFixedTime(later);
  await page.getByRole("link", { name: "Captain’s log" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#entry-stardate")).toHaveText(first!);
  await page.getByRole("button", { name: "New log entry" }).click();
  await expect(page.locator("#entry-stardate")).toHaveText(`Captain’s log, stardate ${formatStardate(later)}`);
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
  // The drawer is the ship's systems, each part with its own LCARS panel code.
  await expect(page.getByRole("region", { name: "Ship’s systems Computer intelligence" })).toBeVisible();
  await expect(page.locator("#settings-code")).toHaveText("SYS 02");
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

test("MCP starts with a compact list and a live tile, not setup instructions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/api/mcp", (route) => route.fulfill({ json: { project: process.cwd(), servers: [
    { name: "Test project tools", status: "connected" },
    { name: "Test remote tools", status: "needs_auth", error: "Test sign-in required." },
  ] } }));
  await page.reload();
  const tile = page.getByRole("link", { name: /^MCP servers/ });
  await expect(tile).toContainText("Sign-in needed");
  await expect(tile).not.toContainText("Advanced setup");
  await tile.click();
  await expect(page.locator("#mcp-servers").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Sign in to Test remote tools" })).toBeVisible();
  await expect(page.locator("#mcp-auth-command")).toBeHidden();
  await expect(page.locator("#mcp-list-command")).toBeHidden();
  await expect(page.locator("#mcp-connection")).toBeHidden();
  await expect(page.locator("#settings-mcp").getByRole("textbox")).toHaveCount(0);
  const text = await page.locator("#settings-mcp").innerText();
  expect(text.trim().split(/\s+/).length).toBeLessThan(85);
  await expect(page.locator("#mcp-advanced > summary")).toBeInViewport();
  await page.locator("#mcp-advanced > summary").click();
  await expect(page.locator("#mcp-auth-command")).toBeVisible();
});

test("MCP sign-in opens the service and waits for an actual connected result", async ({ page }) => {
  let signedIn = false;
  await page.route("**/api/mcp", (route) => route.fulfill({ json: { project: process.cwd(), servers: [
    { name: "Test remote", status: signedIn ? "connected" : "needs_auth" },
  ] } }));
  let sent: unknown;
  await page.route("**/api/mcp/sign-in", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { url: "https://example.test/authorize" } });
  });
  await page.context().route("https://example.test/**", (route) => route.fulfill({ body: "Test-only sign-in service." }));
  await page.reload();
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  const opened = page.waitForEvent("popup");
  const signIn = page.getByRole("button", { name: "Sign in to Test remote" });
  await expect(signIn).toBeEnabled();
  await signIn.press("Enter");
  const popup = await opened;
  await expect(popup).toHaveURL("https://example.test/authorize");
  expect(sent).toEqual({ name: "Test remote", project: process.cwd() });
  await expect(page.locator("#mcp-action-result")).toContainText("Complete sign-in");
  await expect(page.locator("#mcp-servers")).toContainText("Sign-in needed");
  signedIn = true;
  await popup.close();
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect(page.locator("#readout-mcp")).toHaveText("1 connected");
  await expect(page.locator("#mcp-servers")).toContainText("Connected");
  await expect(page.getByRole("button", { name: "Sign in to Test remote" })).toHaveCount(0);
});

test("MCP sign-in handles blocked windows and real failures without claiming success", async ({ page }) => {
  await page.route("**/api/mcp", (route) => route.fulfill({ json: { project: process.cwd(), servers: [{ name: "Test remote", status: "needs_auth" }] } }));
  let fail = false;
  await page.route("**/api/mcp/sign-in", (route) => fail
    ? route.fulfill({ status: 409, json: { error: "Test sign-in needs Advanced setup." } })
    : route.fulfill({ json: { url: "https://example.test/authorize" } }));
  await page.reload();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Sign in to Test remote" }).click();
  const link = page.getByRole("link", { name: "Continue sign-in" });
  await expect(link).toHaveAttribute("href", "https://example.test/authorize");
  await expect(page.locator("#readout-mcp")).toHaveText("Sign-in needed");
  fail = true;
  await page.getByRole("button", { name: "Sign in to Test remote" }).click();
  await expect(page.locator("#mcp-action-result")).toHaveText("Test sign-in needs Advanced setup.");
  await expect(link).toBeHidden();
});

test("GitHub MCP shows the public code across panel changes and waits for the real connection after approval", async ({ page }) => {
  let status = "needs_auth";
  let attempt = "pending";
  await page.route("**/api/mcp", route => route.fulfill({ json: { project: process.cwd(), servers: [{ name: "Test GitHub", status }] } }));
  await page.route("**/api/mcp/sign-in**", route => route.fulfill({ json: route.request().method() === "POST"
    ? { url: "https://github.com/login/device", code: "ABCD-1234", attemptID: "test-attempt" }
    : { status: attempt } }));
  await page.reload();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Sign in to Test GitHub" }).click();
  await expect(page.locator("#mcp-sign-in-code")).toContainText("ABCD-1234");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await expect(page.locator("#mcp-sign-in-code")).toContainText("ABCD-1234");
  attempt = "complete";
  await expect(page.locator("#mcp-action-result")).toHaveText("Sign-in approved. Connecting.");
  await expect(page.locator("#mcp-sign-in-code")).toBeHidden();
  await expect(page.locator("#readout-mcp")).toHaveText("Sign-in needed");
  status = "connected";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#mcp-action-result")).toHaveText("Connected.");
});

for (const status of ["failed", "expired"]) {
  test(`GitHub MCP ${status} attempts remove stale codes and links without claiming success`, async ({ page }) => {
    let result = "pending";
    await page.route("**/api/mcp", route => route.fulfill({ json: { project: process.cwd(), servers: [{ name: "Test GitHub", status: "needs_auth" }] } }));
    await page.route("**/api/mcp/sign-in**", route => route.fulfill({ json: route.request().method() === "POST"
      ? { url: "https://github.com/login/device", code: "ABCD-1234", attemptID: "test-attempt" }
      : { status: result, ...(result === "failed" ? { error: "GitHub sign-in failed: access_denied" } : {}) } }));
    await page.reload();
    await page.evaluate(() => { window.open = () => null; });
    await page.getByRole("link", { name: /^MCP servers/ }).click();
    await page.getByRole("button", { name: "Sign in to Test GitHub" }).click();
    await expect(page.locator("#mcp-sign-in-code")).toBeVisible();
    result = status;
    await expect(page.locator("#mcp-action-result")).toHaveText(status === "failed" ? "GitHub sign-in failed: access_denied" : "GitHub sign-in expired. Choose Sign in to try again.");
    await expect(page.locator("#mcp-sign-in-code")).toBeHidden();
    await expect(page.locator("#mcp-sign-in-link")).toBeHidden();
  });
}

test("an old GitHub attempt result cannot replace a connected result", async ({ page }) => {
  let connected = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let polling = false;
  await page.route("**/api/mcp", route => route.fulfill({ json: { project: process.cwd(), servers: [{ name: "Test GitHub", status: connected ? "connected" : "needs_auth" }] } }));
  await page.route("**/api/mcp/sign-in**", async route => {
    if (route.request().method() === "POST") return route.fulfill({ json: { url: "https://github.com/login/device", code: "ABCD-1234", attemptID: "test-attempt" } });
    polling = true;
    await held;
    await route.fulfill({ json: { status: "failed", error: "An obsolete sign-in failure." } });
  });

  await page.reload();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Sign in to Test GitHub" }).click();
  await expect.poll(() => polling).toBe(true);
  connected = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#mcp-action-result")).toHaveText("Connected.");
  const oldResponse = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/mcp/sign-in");
  release();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.locator("#mcp-sign-in-code")).toBeHidden();
  await expect(page.locator("#mcp-action-result")).toHaveText("Connected.");
});

test("GitHub MCP explains a connection failure after successful sign-in", async ({ page }) => {
  let status = "needs_auth";
  await page.route("**/api/mcp", route => route.fulfill({ json: { project: process.cwd(), servers: [
    { name: "Test GitHub", status, ...(status === "failed" ? { error: "Test GitHub refused the MCP connection." } : {}) },
  ] } }));
  await page.route("**/api/mcp/sign-in**", route => route.fulfill({ json: route.request().method() === "POST"
    ? { url: "https://github.com/login/device", code: "ABCD-1234", attemptID: "test-attempt" } : { status: "complete" } }));
  await page.reload();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Sign in to Test GitHub" }).click();
  await expect(page.locator("#mcp-action-result")).toHaveText("Sign-in approved. Connecting.");
  status = "failed";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#mcp-action-result")).toHaveText("Test GitHub refused the MCP connection.");
  await expect(page.locator("#mcp-sign-in-code")).toBeHidden();
});

test("MCP retry waits for the server state and the tile follows updates while the panel is closed", async ({ page }) => {
  let status = "failed";
  await page.route("**/api/mcp", (route) => route.fulfill({ json: { project: process.cwd(), servers: [
    { name: "Test failed", status, ...(status === "failed" ? { error: "Test connection refused." } : {}) },
  ] } }));
  await page.route("**/api/mcp/connect", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ name: "Test failed", project: process.cwd() });
    status = "pending";
    await route.fulfill({ json: { requested: true } });
  });
  await page.reload();
  await expect(page.locator("#readout-mcp")).toHaveText("Needs attention");
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Retry Test failed" }).click();
  await expect(page.locator("#mcp-servers")).toContainText("Connecting");
  await expect(page.locator("#readout-mcp")).toHaveText("Connecting");
  await page.keyboard.press("Escape");
  status = "connected";
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect(page.locator("#readout-mcp")).toHaveText("1 connected");
  status = "disabled";
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect(page.locator("#readout-mcp")).toHaveText("Disabled");
});

test("a previous MCP sign-in cannot overwrite a later action failure", async ({ page }) => {
  let firstConnected = false;
  await page.route("**/api/mcp", (route) => route.fulfill({ json: { project: process.cwd(), servers: [
    { name: "Test first", status: firstConnected ? "connected" : "needs_auth" },
    { name: "Test second", status: "needs_auth" },
  ] } }));
  await page.route("**/api/mcp/sign-in", (route) => route.request().postDataJSON().name === "Test first"
    ? route.fulfill({ json: { url: "https://example.test/authorize" } })
    : route.fulfill({ status: 409, json: { error: "Test second sign-in failed." } }));
  await page.reload();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Sign in to Test first" }).click();
  await expect(page.locator("#mcp-sign-in-link")).toBeVisible();
  await page.getByRole("button", { name: "Sign in to Test second" }).click();
  await expect(page.locator("#mcp-action-result")).toHaveText("Test second sign-in failed.");
  firstConnected = true;
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect(page.locator("#mcp-servers").getByRole("listitem").filter({ hasText: "Test first" })).toContainText("Connected");
  await expect(page.locator("#mcp-action-result")).toHaveText("Test second sign-in failed.");
});

test("an unrelated MCP update preserves keyboard focus on Sign in", async ({ page }) => {
  let otherStatus = "pending";
  await page.route("**/api/mcp", (route) => route.fulfill({ json: { project: process.cwd(), servers: [
    { name: "Test remote", status: "needs_auth" },
    { name: "Test other", status: otherStatus },
  ] } }));
  await page.reload();
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  const signIn = page.getByRole("button", { name: "Sign in to Test remote" });
  await expect(signIn).toBeEnabled();
  await signIn.focus();
  await expect(signIn).toBeFocused();
  otherStatus = "connected";
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect(page.locator("#mcp-servers").getByRole("listitem").filter({ hasText: "Test other" })).toContainText("Connected");
  await expect(signIn).toBeFocused();
});

test("MCP guidance opens from Ship's systems and a direct link without adding a typing flow", async ({ page }) => {
  const tile = page.getByRole("link", { name: /^MCP servers/ });
  await tile.click();
  await expect(page.getByRole("region", { name: "Ship’s systems MCP servers" })).toBeVisible();
  await expect(tile).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#mcp-project")).toHaveText(process.cwd());
  await expect(page.locator("#mcp-list-command")).toHaveText("npx picard-code opencode mcp list");
  await expect(page.locator("#mcp-auth-command")).toHaveText("npx picard-code opencode mcp auth");
  await expect(page.locator("#settings-mcp").getByRole("textbox")).toHaveCount(0);
  await expect(page.locator("#mcp-connection")).toBeHidden();
  await page.locator("#mcp-advanced > summary").click();
  await expect(page.locator("#mcp-connection")).toContainText("your installed OpenCode");
  await expect(page.locator("#mcp-server-guidance")).toHaveCount(0);
  await expect(page.locator("#settings-mcp")).not.toContainText("--connect");
  await expect(page.locator("#settings-mcp")).toContainText("--global");
  await expect(page.getByRole("link", { name: "OpenCode MCP setup guide" })).toHaveAttribute("href", "https://opencode.ai/v2/docs/mcp-servers/");
  await tile.click();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await page.evaluate(() => { location.hash = "settings/mcp"; });
  await expect(page.getByRole("heading", { name: "MCP servers", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await tile.click();
  await page.getByRole("link", { name: "Current log entry", exact: true }).click();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const source of ["installed", "bundled", "custom"] as const) {
  test(`MCP instructions describe only the ${source} OpenCode used by this launch`, async ({ page }) => {
    let openCodeVersion = "";
    await page.route("**/api/state", async (route) => {
      const state = await (await route.fetch()).json();
      openCodeVersion = state.version;
      state.openCode = { source, customSettings: false };
      await route.fulfill({ json: state });
    });
    await page.reload();
    await page.getByRole("link", { name: /^MCP servers/ }).click();
    await page.locator("#mcp-advanced > summary").click();
    const description = page.locator("#mcp-connection");
    const panel = page.locator("#settings-mcp");
    if (source === "installed") await expect(description).toContainText("your installed OpenCode");
    if (source === "bundled") await expect(description).toContainText("Picard Code's bundled OpenCode");
    if (source === "custom") await expect(description).toContainText("selected with PICARD_OPENCODE_PATH");
    await expect(page.locator("#mcp-server-guidance")).toHaveCount(0);
    await expect(panel).not.toContainText("--connect");
    await expect(panel).not.toContainText("OPENCODE_SERVER_PASSWORD");
    await expect(description).toContainText(`OpenCode ${openCodeVersion}`);
    await expect(panel).not.toContainText("if none is installed");
    await expect(page.locator("#mcp-custom-settings")).toBeHidden();
    for (const action of ["list", "auth"]) {
      const command = `npx picard-code opencode mcp ${action}`;
      await expect(page.locator(`#mcp-${action}-command`)).toHaveText(command);
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          writeText: async (text: string) => { sessionStorage.setItem("testCopiedCommand", text); },
        } });
      });
      await page.locator(`#copy-mcp-${action}`).click();
      expect(await page.evaluate(() => sessionStorage.getItem("testCopiedCommand"))).toBe(command);
    }
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: /^MCP servers/ }).click();
    await expect(description).toBeVisible();
    await page.unrouteAll({ behavior: "wait" });
  });
}

test("MCP custom-settings advice appears only when this launch uses custom settings", async ({ page }) => {
  let customSettings = true;
  await page.route("**/api/state", async (route) => {
    const state = await (await route.fetch()).json();
    state.openCode = { source: "installed", customSettings };
    await route.fulfill({ json: state });
  });
  await page.reload();
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.locator("#mcp-advanced > summary").click();
  await expect(page.locator("#mcp-custom-settings")).toBeVisible();
  await expect(page.locator("#mcp-custom-settings")).toContainText("This launch uses custom OpenCode settings.");
  customSettings = false;
  await page.reload();
  await expect(page.locator("#mcp-custom-settings")).toBeHidden();
  await page.unrouteAll({ behavior: "wait" });
});

test("MCP commands report real clipboard success and failure", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { sessionStorage.setItem("testCopiedCommand", text); },
    } });
  });
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.locator("#mcp-advanced > summary").click();
  for (const action of ["list", "auth"]) {
    const copy = page.locator(`#copy-mcp-${action}`);
    await expect(copy).toBeVisible();
    await expect(copy).toBeEnabled();
    await copy.press("Enter");
    await expect(page.locator(`#mcp-${action}-copy-result`)).toHaveText("Command copied");
    expect(await page.evaluate(() => sessionStorage.getItem("testCopiedCommand"))).toBe(`npx picard-code opencode mcp ${action}`);
  }
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Test MCP clipboard access refused."); }; });
  await page.locator("#copy-mcp-auth").click();
  await expect(page.locator("#mcp-auth-copy-result")).toHaveText("Test MCP clipboard access refused.");
  await expect(page.locator("#copy-mcp-auth")).toBeEnabled();
});

test("MCP connections show live states and exact errors, including through a direct link", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/mcp", (route) => {
    requests++;
    return route.fulfill({ json: { project: process.cwd(), servers: [
      { name: "Test connected service", status: "connected" },
      { name: "Test sign-in service", status: "needs_auth", error: "Test sign-in expired." },
      { name: "Test disabled service", status: "disabled" },
      { name: "Test failed service", status: "failed", error: "Test connection refused." },
      { name: "Test pending service", status: "pending" },
      { name: "<script>Test unknown service</script>", status: "future_state", error: "<b>Test exact error</b>" },
    ] } });
  });
  await page.evaluate(() => { location.hash = "settings/mcp"; });
  const list = page.getByRole("list", { name: "MCP server connections" });
  await expect(list.getByRole("listitem")).toHaveCount(6);
  for (const [name, status] of [
    ["Test connected service", "Connected"], ["Test sign-in service", "Sign-in needed"],
    ["Test disabled service", "Disabled"], ["Test failed service", "Connection failed"],
    ["Test pending service", "Connecting"], ["Test unknown service", "Unknown state: future_state"],
  ]) await expect(list.getByRole("listitem").filter({ hasText: name })).toContainText(status);
  await expect(list).toContainText("Test sign-in expired.");
  await expect(list).toContainText("Test connection refused.");
  await expect(list).toContainText("<b>Test exact error</b>");
  await expect(list.locator("script, b")).toHaveCount(0);
  await expect(page.locator("#mcp-status")).toContainText("6");
  await page.keyboard.press("Escape");
  const before = requests;
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await expect(list.getByRole("listitem")).toHaveCount(6);
  expect(requests).toBeGreaterThan(before);
});

test("MCP connection lookup failures clear old results, keep work usable and recover on reopening", async ({ page }) => {
  let fail = false;
  let empty = false;
  await page.route("**/api/mcp", (route) => fail
    ? route.fulfill({ status: 502, json: { error: "Test MCP lookup unavailable." } })
    : route.fulfill({ json: { project: process.cwd(), servers: empty ? [] : [{ name: "Test old service", status: "connected" }] } }));
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await expect(page.locator("#mcp-servers")).toContainText("Test old service");
  fail = true;
  await page.getByRole("button", { name: "Refresh connections", exact: true }).click();
  await expect(page.locator("#mcp-status")).toHaveText("Could not check MCP servers. Test MCP lookup unavailable.");
  await expect(page.locator("#mcp-servers").getByRole("listitem")).toHaveCount(0);
  await expect(page.locator("#mcp-status")).not.toContainText("No MCP servers");
  await expect(page.getByRole("link", { name: /^Computer intelligence/ })).toBeVisible();
  await page.keyboard.press("Escape");
  fail = false;
  empty = true;
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await expect(page.locator("#mcp-status")).toHaveText("No MCP servers are configured for this Project.");
});

test("MCP live updates reject old results after a newer check or Project change", async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        document.addEventListener("test-mcp-event", (event) => {
          if (event instanceof CustomEvent) this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event.detail) }));
        });
      }
    };
  });
  let project = process.cwd();
  await page.route("**/api/state", async (route) => {
    const state = await (await route.fetch()).json();
    state.project = project;
    await route.fulfill({ json: state });
  });
  await page.reload();
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await expect(page.locator("#refresh-mcp")).toBeEnabled();
  let releaseOld = () => {};
  let old = Promise.resolve();
  let holdNext = false;
  let held = false;
  await page.route("**/api/mcp", async (route) => {
    const requestedProject = project;
    if (holdNext) {
      holdNext = false;
      held = true;
      await old;
      await route.fulfill({ json: { project: requestedProject, servers: [{ name: "Test stale service", status: "connected" }] } });
    } else await route.fulfill({ json: { project, servers: [{ name: `Test current service in ${project}`, status: "needs_auth", error: "Test sign-in needed." }] } });
  });
  const notify = (type: "mcp" | "connection") => page.evaluate((type) => {
    document.dispatchEvent(new CustomEvent("test-mcp-event", { detail: { type, connected: true } }));
  }, type);
  try {
    for (const changeProject of [false, true]) {
      old = new Promise<void>((resolve) => { releaseOld = resolve; });
      holdNext = true;
      held = false;
      await notify("mcp");
      await expect.poll(() => held).toBe(true);
      if (changeProject) project = `${process.cwd()}/test-other-project`;
      await notify(changeProject ? "connection" : "mcp");
      await expect(page.locator("#mcp-project")).toHaveText(project);
      await expect(page.locator("#mcp-servers")).toContainText(`Test current service in ${project}`);
      const staleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/mcp");
      releaseOld();
      await (await staleResponse).finished();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      await expect(page.locator("#mcp-servers")).not.toContainText("Test stale service");
      await expect(page.locator("#mcp-servers")).toContainText("Sign-in needed");
    }
  } finally { releaseOld(); await page.unrouteAll({ behavior: "wait" }); }
});

test("MCP refresh keeps the current log entry and distinguishes reloads from sign-in", async ({ page }) => {
  await page.evaluate(async () => {
    await fetch("/api/conversations", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Picard-Request": "1" },
      body: JSON.stringify({ title: "Keep this MCP log entry" }),
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "Captain’s log" }).click();
  const entry = page.getByRole("button", { name: /^Keep this MCP log entry,/ });
  await entry.click();
  const stardate = await page.locator("#entry-stardate").textContent();
  const otherPage = await page.context().newPage();
  await otherPage.goto(new URL("#settings/mcp", page.url()).href);
  await expect(otherPage.locator("#refresh-mcp")).toBeEnabled();
  const reconnected = otherPage.waitForEvent("request", { predicate: (request) => new URL(request.url()).pathname === "/api/events" });
  const refreshRequests: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/refresh")) refreshRequests.push(request.method()); });
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Refresh connections", exact: true }).click();
  await expect(page.locator("#mcp-refresh-result")).toHaveText("OpenCode settings reloaded.");
  await expect(page.locator("#mcp-status")).toHaveText("No MCP servers are configured for this Project.");
  await reconnected;
  await expect(otherPage.locator("#refresh-mcp")).toBeEnabled();
  await expect(otherPage).toHaveURL(/#settings\/mcp$/);
  await otherPage.close();
  expect(refreshRequests).toEqual(["POST"]);
  await expect(page).toHaveURL(/#settings\/mcp$/);
  await expect(page.locator("#entry-stardate")).toHaveText(stardate!);
  await page.getByRole("link", { name: "Captain’s log" }).click();
  await expect(entry).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await page.route("**/api/refresh", (route) => route.fulfill({ status: 502, json: { error: "Test MCP reload failed." } }));
  await page.getByRole("button", { name: "Refresh connections", exact: true }).click();
  await expect(page.locator("#mcp-refresh-result")).toHaveText("Test MCP reload failed.");
  await expect(page.getByRole("button", { name: "Refresh connections", exact: true })).toBeEnabled();
  await page.unroute("**/api/refresh");
  await page.getByRole("button", { name: "Refresh connections", exact: true }).click();
  await expect(page.locator("#mcp-refresh-result")).toContainText("OpenCode settings reloaded.");
});

test("MCP refresh stays unavailable while background work runs", async ({ page }) => {
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    state.statuses = { "test-background-entry": { type: "busy" } };
    await route.fulfill({ json: state });
  });
  await page.reload();
  await page.getByRole("link", { name: /^MCP servers/ }).click();
  await expect(page.getByRole("button", { name: "Refresh connections", exact: true })).toBeDisabled();
  await expect(page.locator("#mcp-status")).toHaveText("No MCP servers are configured for this Project.");
  await expect(page.locator("#settings-mcp")).toContainText("Stop running work before refreshing");
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
