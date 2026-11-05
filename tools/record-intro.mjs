import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { installRecording } from "./record-intro-browser.mjs";
import { startEngine } from "../dist/server/process.js";
import { startApp } from "../dist/server/app.js";
import { availableModels } from "../dist/server/engine.js";
import { loadSpeech } from "../dist/server/speech.js";
import { saveModelSettings } from "../dist/server/model-settings.js";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelIndex = process.argv.indexOf("--model");
const requested = process.argv[modelIndex + 1];
assert.ok(modelIndex >= 0 && requested && !requested.startsWith("--"), "Provide --model provider/model after confirming current model availability.");
const outputRoot = resolve(root, "video/out");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, "real-intro-"));
const project = join(output, "release-board");
const settings = join(output, "settings");
const framesFolder = join(output, "frames");
await Promise.all([cp(join(root, "tools/intro-demo"), project, { recursive: true }), mkdir(settings), mkdir(framesFolder)]);
const modelFile = join(settings, "model.json");
const speechFile = join(settings, "speech.json");
const controller = new AbortController();
let speech, engine, app, browser, board;
let frameWriting = Promise.resolve();
let frameError;
const frames = [];
const events = [];
const orders = [
  "Computer Data do not change any files just explain the release board bug.",
  "Computer La Forge please repair and test this project.",
];

async function captureFrame(session, event) {
  const index = frames.length;
  const file = `${String(index).padStart(6, "0")}.jpg`;
  frames.push({ file, time: event.metadata.timestamp });
  await writeFile(join(framesFolder, file), Buffer.from(event.data, "base64"));
  await session.send("Page.screencastFrameAck", { sessionId: event.sessionId });
}

try {
  console.log("Preparing the isolated original release-board project.");
  let originalFailed = false;
  try { await execute(process.execPath, ["--test", "--test-reporter=tap", "checks.mjs"], { cwd: project }); }
  catch (error) {
    if (!error.stdout?.includes("not ok 1")) throw error;
    originalFailed = true;
    await writeFile(join(output, "before-tests.txt"), error.stdout);
  }
  assert.ok(originalFailed, "The original example must fail its mixed-result check.");
  const originalEntries = (await readdir(project, { recursive: true })).sort();
  const originalFiles = new Map();
  for (const file of ["index.html", "status.mjs", "checks.mjs"]) originalFiles.set(file, await readFile(join(project, file), "utf8"));
  engine = await startEngine(project);
  assert.equal(engine.crewProblem, undefined, engine.crewProblem);
  const available = await availableModels(engine.client, project);
  const model = available.models.find((item) => `${item.providerID}/${item.modelID}` === requested);
  assert.ok(model, "That model is not available in the signed-in OpenCode connection.");
  await saveModelSettings(modelFile, model);
  console.log(`Starting real Nemotron, Smart Turn and Kokoro; real OpenCode model: ${requested}.`);
  speech = await loadSpeech({ listening: "nemotron", speaking: "kokoro" }, controller.signal, speechFile);
  assert.ok(speech, "Prepare the local speech models before recording; no speech service will be substituted.");
  const captainAudio = [];
  for (const order of orders) {
    const chunks = [];
    for await (const chunk of speech.speak(order, AbortSignal.timeout(120000), { name: "bm_daniel" })) chunks.push(chunk);
    captainAudio.push(Buffer.concat(chunks).toString("base64"));
  }
  app = await startApp({ client: engine.client, project, speech, modelFile, speechFile, webRoot: join(root, "web-dist"), prepareCrew: engine.prepareCrew });
  board = createServer(async (request, response) => {
    const file = request.url === "/" ? "index.html" : request.url === "/status.mjs" ? "status.mjs" : undefined;
    if (!file) { response.writeHead(404).end("Not found"); return; }
    try {
      const content = await readFile(join(project, file));
      response.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : "text/javascript");
      response.setHeader("Cache-Control", "no-store");
      response.end(content);
    } catch (error) { response.writeHead(500).end(error.message); }
  });
  await new Promise((done, fail) => { board.once("error", fail); board.listen(0, "127.0.0.1", done); });
  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1600, height: 1000 } });
  const preview = await context.newPage();
  await preview.goto(`http://127.0.0.1:${board.address().port}`);
  await expect(preview.locator("#verdict")).toHaveText("READY TO LAUNCH");
  await expect(preview.locator("article").last()).toContainText("Failed");
  await preview.screenshot({ path: join(output, "before.png") });
  const page = await context.newPage();
  await page.addInitScript(installRecording);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const event = JSON.parse(payload);
      if (["state", "error", "transcript"].includes(event.type)) events.push({ time: Date.now() / 1000, ...event });
    });
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const event = JSON.parse(payload);
      if (event.type === "check-turn") events.push({ time: Date.now() / 1000, type: "check-turn" });
    });
  });
  await page.goto(app.url);
  await expect(page.locator("#status")).not.toHaveText("Starting up", { timeout: 60000 });
  await page.locator("#voice-console").click();
  await expect.poll(() => page.evaluate(() => typeof window.demoSpeak), { timeout: 60000 }).toBe("function");
  await expect(page.locator("#voice-channel")).toHaveText("Listening", { timeout: 30000 });
  await page.screenshot({ path: join(output, "standing-by.png") });
  const recordingStart = await page.evaluate(() => window.startDemoRecording());
  const session = await context.newCDPSession(page);
  session.on("Page.screencastFrame", (event) => {
    frameWriting = frameWriting.then(() => captureFrame(session, event)).catch((error) => { frameError = error; });
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 });
  const turns = [];
  for (let index = 0; index < orders.length; index++) {
    await expect(page.locator("#voice-channel")).toHaveText("Listening", { timeout: 60000 });
    console.log(`Recording the real spoken ${index ? "Geordi repair" : "Data investigation"}.`);
    const spoken = await page.evaluate((audio) => window.demoSpeak(audio), captainAudio[index]);
    await expect(page.locator(".message[data-role=user]")).toHaveCount(index + 1, { timeout: 60000 });
    await expect(page.locator(".message[data-role=user]").last()).toContainText(index ? /La\s*Forge.*repair and test this project/i : /Data/i);
    if (!index) await expect(page.locator(".message[data-role=user]").last()).toContainText(/do not change any files/i);
    await expect(page.locator("#status")).toHaveText("Transmitting", { timeout: 180000 });
    const transmitting = Date.now() / 1000;
    await expect(page.locator("#status")).not.toHaveText("Transmitting", { timeout: 180000 });
    const finished = Date.now() / 1000;
    const screen = await page.locator(".message").allTextContents();
    turns.push({ order: orders[index], spoken, transmitting, finished, screen });
    await page.screenshot({ path: join(output, index ? "geordi.png" : "data.png") });
    if (!index) {
      assert.deepEqual((await readdir(project, { recursive: true })).sort(), originalEntries, "Data must not add or remove project files.");
      for (const [file, original] of originalFiles) assert.equal(await readFile(join(project, file), "utf8"), original, `Data must not edit ${file}.`);
    }
    const state = await page.evaluate(async () => {
      const response = await fetch("/api/state");
      if (!response.ok) throw new Error(`Could not inspect the real app state: ${response.status}`);
      return response.json();
    });
    assert.equal(state.permissions.length, 0, "The recording cannot answer a permission request for the owner.");
    assert.equal(state.questions.length, 0, "A question needs the owner's actual answer.");
  }
  await page.waitForTimeout(1500);
  const audio = await page.evaluate(() => window.finishDemoRecording());
  await session.send("Page.stopScreencast");
  await frameWriting;
  if (frameError) throw frameError;
  await writeFile(join(output, "audio.webm"), Buffer.from(audio.audio, "base64"));
  assert.equal(await readFile(join(project, "checks.mjs"), "utf8"), originalFiles.get("checks.mjs"), "The original checks must not be rewritten to manufacture a pass.");
  const afterTests = await execute(process.execPath, ["--test", "--test-reporter=tap", "checks.mjs"], { cwd: project });
  await writeFile(join(output, "after-tests.txt"), afterTests.stdout);
  await preview.reload();
  await expect(preview.locator("#verdict")).toHaveText("LAUNCH BLOCKED");
  await expect(preview.locator("article").last()).toContainText("Failed");
  await preview.screenshot({ path: join(output, "after.png") });
  const conversations = await engine.client.sessions(project);
  const transcript = [];
  for (const entry of conversations) transcript.push({ id: entry.id, messages: await engine.client.messages(entry.id, project) });
  assert.ok(events.some((event) => event.type === "check-turn"), "Actual Smart Turn must be used.");
  assert.equal(events.filter((event) => event.type === "error").length, 0, "Real speech failures must not be presented as a successful demo.");
  assert.deepEqual(pageErrors, [], "Browser errors must not be hidden.");
  assert.ok(frames.length > 20, "The actual app transitions must be recorded.");
  await writeFile(join(output, "recording.json"), JSON.stringify({
    model: requested, listening: "nemotron", speaking: "kokoro",
    preparedDemo: true, generatedCaptainVoice: "bm_daniel", actorImitation: false,
    audioStart: recordingStart, frames, events, turns, transcript,
  }, null, 2));
  const lines = [];
  for (let index = 0; index < frames.length; index++) {
    lines.push(`file 'frames/${frames[index].file}'`);
    const end = index + 1 < frames.length ? frames[index + 1].time : Date.now() / 1000;
    lines.push(`duration ${Math.max(0.001, end - frames[index].time).toFixed(6)}`);
  }
  lines.push(`file 'frames/${frames.at(-1).file}'`);
  await writeFile(join(output, "frames.txt"), `${lines.join("\n")}\n`);
  console.log(`Actual app footage, browser playback, before/after and real check results saved to ${output}.`);
} finally {
  controller.abort();
  try { await frameWriting; }
  finally {
    try { await browser?.close(); }
    finally {
      try { if (board) await new Promise((done, fail) => board.close((error) => error ? fail(error) : done())); }
      finally {
        try { await app?.close(); }
        finally {
          try { await speech?.close?.(); }
          finally { await engine?.close(); }
        }
      }
    }
  }
}
