import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { resolve, join, dirname, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { installRecording } from "./record-intro-browser.mjs";
import { ORDERS, allowWaitingCommand, demoPermissions, sentEvent } from "./intro-episode.mjs";
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
const output = await mkdtemp(join(outputRoot, "episode-"));
const project = join(output, "tribute-site");
const settings = join(output, "settings");
const framesFolder = join(output, "frames");
await Promise.all([mkdir(project), mkdir(settings), mkdir(framesFolder)]);
await writeFile(join(project, "opencode.json"), `${JSON.stringify(demoPermissions(), null, 2)}\n`);
const modelFile = join(settings, "model.json");
const speechFile = join(settings, "speech.json");
const controller = new AbortController();
let speech, engine, app, browser, site;
let frameWriting = Promise.resolve();
let frameError;
const frames = [];
const events = [];
const timeline = [];
const approvals = [];
const now = () => Date.now() / 1000;

async function captureFrame(session, event) {
  const file = `${String(frames.length).padStart(6, "0")}.jpg`;
  frames.push({ file, time: event.metadata.timestamp });
  await writeFile(join(framesFolder, file), Buffer.from(event.data, "base64"));
  await session.send("Page.screencastFrameAck", { sessionId: event.sessionId });
}

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

try {
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
  for (const order of ORDERS) {
    const chunks = [];
    for await (const chunk of speech.speak(order.say, AbortSignal.timeout(120000), { name: "bm_daniel" })) chunks.push(chunk);
    captainAudio.push(Buffer.concat(chunks).toString("base64"));
  }
  app = await startApp({ client: engine.client, project, speech, modelFile, speechFile, webRoot: join(root, "web-dist"), prepareCrew: engine.prepareCrew });
  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  await page.addInitScript(installRecording);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const event = JSON.parse(payload);
      if (["state", "error", "transcript"].includes(event.type)) events.push({ time: now(), ...event });
    });
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const event = sentEvent(payload, now());
      if (event) events.push(event);
    });
  });
  await page.goto(app.url);
  await expect(page.locator("#status")).not.toHaveText("Starting up", { timeout: 60000 });
  await page.locator("#voice-console").click();
  await expect.poll(() => page.evaluate(() => typeof window.demoSpeak), { timeout: 60000 }).toBe("function");
  await expect(page.locator("#voice-channel")).toHaveText("Listening", { timeout: 30000 });
  const recordingStart = await page.evaluate(() => window.startDemoRecording());
  const session = await context.newCDPSession(page);
  session.on("Page.screencastFrame", (event) => {
    frameWriting = frameWriting.then(() => captureFrame(session, event)).catch((error) => { frameError = error; });
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

  const seen = new Set();
  let last = "";
  async function observe(order) {
    const snapshot = await page.evaluate(() => ({
      status: document.querySelector("#status")?.textContent ?? "",
      detail: document.querySelector("#status-detail")?.textContent ?? "",
      messages: [...document.querySelectorAll(".message")].map((item) => ({
        id: item.dataset.messageId, role: item.dataset.role,
        speaker: item.querySelector(".message-header strong")?.textContent ?? "",
        crewReport: item.classList.contains("crew-report"),
      })),
    }));
    const time = now();
    const state = `${snapshot.status}|${snapshot.detail}`;
    if (state !== last) { timeline.push({ time, order, status: snapshot.status, detail: snapshot.detail }); last = state; }
    for (const message of snapshot.messages) {
      if (!message.id || seen.has(message.id)) continue;
      seen.add(message.id);
      timeline.push({ time, order, message });
    }
    return snapshot;
  }

  /** Waits until the crew has finished and the console stays Standing by, answering command approvals with the real button. */
  async function settle(order) {
    const started = Date.now();
    let quietSince;
    for (;;) {
      assert.ok(Date.now() - started < 25 * 60000, `The work for "${order.say}" did not finish within 25 minutes.`);
      const failure = events.find((event) => event.type === "error");
      assert.equal(failure, undefined, `Red alert during "${order.say}": ${failure?.message}`);
      const approval = await allowWaitingCommand(page, { now });
      if (approval) {
        approvals.push({ order: order.id, ...approval });
        console.log(`Allow once: ${approval.command}`);
        quietSince = undefined;
        continue;
      }
      const snapshot = await observe(order.id);
      assert.notEqual(snapshot.status, "Answer needed", `OpenCode asked a question that needs a real answer: ${snapshot.detail}`);
      if (snapshot.status === "Standing by" && snapshot.detail !== "Sending your request.") {
        quietSince ??= Date.now();
        if (Date.now() - quietSince > 6000) return now();
      } else quietSince = undefined;
      await page.waitForTimeout(250);
    }
  }

  const turns = [];
  for (let index = 0; index < ORDERS.length; index++) {
    const order = ORDERS[index];
    await expect(page.locator("#voice-channel")).toHaveText("Listening", { timeout: 60000 });
    console.log(`Captain: ${order.say}`);
    const before = await page.locator(".message[data-role=user]").count();
    const spoken = await page.evaluate((audio) => window.demoSpeak(audio), captainAudio[index]);
    if (!order.heard) {
      await expect(page.locator("#status-detail")).toHaveText("Go ahead.", { timeout: 15000 });
      await observe(order.id);
      turns.push({ order: order.id, say: order.say, spoken });
      continue;
    }
    await expect(page.locator(".message[data-role=user]")).toHaveCount(before + 1, { timeout: 60000 });
    const heard = await page.locator(".message[data-role=user]").last().innerText();
    assert.match(heard, order.heard, `Nemotron heard "${heard}" for "${order.say}".`);
    const settled = await settle(order);
    await page.screenshot({ path: join(output, `${order.id}.png`) });
    turns.push({ order: order.id, say: order.say, heard, spoken, settled });
  }
  await page.waitForTimeout(1500);
  const audio = await page.evaluate(() => window.finishDemoRecording());
  await session.send("Page.stopScreencast");
  await frameWriting;
  if (frameError) throw frameError;
  await writeFile(join(output, "audio.webm"), Buffer.from(audio.audio, "base64"));

  await page.locator("#history-tile").click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(output, "captains-log.png") });

  const files = (await readdir(project, { recursive: true })).filter((file) => !file.startsWith("node_modules") && !file.startsWith(".")).sort();
  assert.ok(files.includes("index.html"), `The crew did not build index.html in the demo project. Files: ${files.join(", ")}`);
  const result = { files, tests: undefined };
  const manifest = files.includes("package.json") ? JSON.parse(await readFile(join(project, "package.json"), "utf8")) : {};
  const testCommand = manifest.scripts?.test ? ["npm", ["test"]]
    : files.some((file) => /\.test\.m?js$/.test(file)) ? [process.execPath, ["--test", "--test-reporter=tap"]] : undefined;
  if (testCommand) {
    try {
      const run = await execute(testCommand[0], testCommand[1], { cwd: project, timeout: 120000 });
      result.tests = { command: [testCommand[0] === process.execPath ? "node" : testCommand[0], ...testCommand[1]].join(" "), passed: true, output: run.stdout };
    } catch (error) {
      result.tests = { command: testCommand[1].join(" "), passed: false, output: `${error.stdout ?? ""}${error.stderr ?? error.message}` };
    }
  }

  site = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname)).replace(/^[/\\]+/, "") || "index.html";
    const file = join(project, path);
    if (!file.startsWith(`${project}${sep}`)) { response.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) throw new Error("Folder");
      response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((done, fail) => { site.once("error", fail); site.listen(0, "127.0.0.1", done); });
  const siteContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: output, size: { width: 1920, height: 1080 } } });
  const preview = await siteContext.newPage();
  const siteErrors = [];
  preview.on("pageerror", (error) => siteErrors.push(error.message));
  await preview.goto(`http://127.0.0.1:${site.address().port}/`);
  await preview.waitForTimeout(9000);
  await preview.screenshot({ path: join(output, "site.png") });
  const siteVideo = await preview.video().path();
  await siteContext.close();
  await rename(siteVideo, join(output, "site.webm"));
  result.siteErrors = siteErrors;

  const conversations = await engine.client.sessions(project);
  const transcript = [];
  for (const entry of conversations) {
    // The app's own message list, crew reports included, so captions use the exact words that were spoken.
    const shown = await page.evaluate(async (id) => {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages`);
      if (!response.ok) throw new Error(`Picard Code could not list log entry ${id}: ${response.status} ${await response.text()}`);
      return response.json();
    }, entry.id);
    transcript.push({ id: entry.id, messages: await engine.client.messages(entry.id, project), shown });
  }
  assert.ok(events.some((event) => event.type === "check-turn"), "Actual Smart Turn must be used.");
  assert.equal(events.filter((event) => event.type === "error").length, 0, "Real speech failures must not be presented as a successful demo.");
  assert.deepEqual(pageErrors, [], "Browser errors must not be hidden.");
  assert.ok(frames.length > 20, "The actual app transitions must be recorded.");
  await writeFile(join(output, "recording.json"), JSON.stringify({
    model: requested, listening: "nemotron", speaking: "kokoro",
    preparedDemo: true, generatedCaptainVoice: "bm_daniel", actorImitation: false,
    demoPermissions: demoPermissions(), audioStart: recordingStart,
    frames, events, timeline, approvals, turns, result, transcript,
  }, null, 2));
  console.log(`Recorded. Approvals: ${approvals.length}. Tests: ${result.tests ? `${result.tests.command} ${result.tests.passed ? "passed" : "FAILED"}` : "none found"}.`);
  console.log(`Saved to ${output}.`);
} finally {
  controller.abort();
  try { await frameWriting; }
  finally {
    try { await browser?.close(); }
    finally {
      try { if (site) await new Promise((done) => site.close(() => done())); }
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
