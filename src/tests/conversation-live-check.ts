import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startEngine, projectDirectory } from "../server/process.js";
import { startApp } from "../server/app.js";
import { availableModels } from "../server/engine.js";
import { loadSpeech } from "../server/speech.js";
import type { SpeechService } from "../server/speech-types.js";

declare global {
  interface Window {
    interruptTestSpeech: (audio: string, quiet: boolean) => void;
    interruptedPlayback: boolean;
  }
}

const local = process.argv.includes("--local");
const modelArgument = process.argv.indexOf("--model");
const requestedModel = modelArgument < 0 ? undefined : process.argv[modelArgument + 1];
if (modelArgument >= 0 && (!requestedModel || requestedModel.startsWith("--"))) throw new Error("Provide --model as provider/model.");
const quiet = process.argv.includes("--quiet-interrupt");
const interrupt = quiet || process.argv.includes("--interrupt");
if (process.argv.includes("--whisper")) throw new Error("Whisper is no longer available. Use --local for Nemotron and Kokoro.");
const localListener = "nemotron";
const name = local ? `${localListener}-kokoro` : "mai";
const directory = resolve(".picard-voice", "samples");
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(resolve(".picard-live-check-"));
const project = await projectDirectory(temporary);
let speech: SpeechService | undefined;
let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let app: Awaited<ReturnType<typeof startApp>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let sessionID: string | undefined;
const controller = new AbortController();
const deltas = new Map<string, number>();
let observation: Promise<void> | undefined;
let observationError: unknown;
try {
  speech = await loadSpeech(local ? { listening: localListener, speaking: "kokoro" } : { listening: "mai", speaking: "mai" });
  assert.ok(speech);
  const chunks: Uint8Array[] = [];
  const request = interrupt
    ? "Computer, please start your reply with the connection is ready. Then add ten short sentences about careful listening in the same paragraph. Do not use tools or change files."
    : "Computer, please reply with just the words, the connection is ready.";
  for await (const chunk of speech.speak(request, AbortSignal.timeout(60_000))) chunks.push(chunk);
  const interruption: Uint8Array[] = [];
  if (interrupt) {
    for await (const chunk of speech.speak("Computer, keep the exact name Delta Seven and do not change any files.", AbortSignal.timeout(60_000), speech.officerVoice?.("picard-data"))) interruption.push(chunk);
  }
  // Long silence afterwards, so the looping test microphone does not repeat the request during the check.
  const audio = Buffer.concat([Buffer.alloc(24000), ...chunks, Buffer.alloc(48000 * 180)]);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(audio.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(audio.length, 40);
  const recording = resolve(directory, `${name}-test-request.wav`);
  await writeFile(recording, Buffer.concat([header, audio]));
  engine = await startEngine(project);
  const models = await availableModels(engine.client, project);
  const choice = requestedModel ? models.models.find((model) => `${model.providerID}/${model.modelID}` === requestedModel)
    : models.models.find((model) => model.modelID === "gpt-4.1")
    ?? models.models.find((model) => model.modelID === "gpt-5-mini")
    ?? models.models.find((model) => model.providerID === "github-copilot" && model.modelID === "gpt-6.1-terra")
    ?? models.defaultModel;
  assert.ok(choice, requestedModel ? `The requested test model ${requestedModel} is not available.` : "Sign in to a model provider in OpenCode before this real conversation check.");
  const events = engine.client.events(controller.signal);
  observation = (async () => {
    for await (const event of events) {
      if (event.type === "session.text.delta" && typeof event.data.sessionID === "string") {
        const id = event.data.sessionID;
        deltas.set(id, (deltas.get(id) ?? 0) + 1);
      }
    }
  })().catch((error: unknown) => { if (!controller.signal.aborted) observationError = error; });
  app = await startApp({ client: engine.client, project, speech, modelFile: resolve(temporary, "model.json"), speechFile: resolve(temporary, "speech.json"), webRoot: resolve("web-dist") });
  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--mute-audio", `--use-file-for-fake-audio-capture=${recording}`] });
  const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1360, height: 980 } });
  const page = await context.newPage();
  let receivedAudio = 0;
  let sentAudio = 0;
  let speaking = false;
  let audioWhileSpeaking = 0;
  let interrupting = false;
  let interruptionAudio = 0;
  const commands: string[] = [];
  const stoppedWork: string[] = [];
  page.on("request", (request) => { if (/\/conversations\/[^/]+\/stop$/.test(request.url())) stoppedWork.push(request.url()); });
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") receivedAudio += payload.length;
      else {
        const event = JSON.parse(payload);
        if (event.type === "state") speaking = event.phase === "speaking";
      }
    });
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") {
        sentAudio += payload.length;
        if (speaking) audioWhileSpeaking++;
        if (interrupting && !commands.includes("stop-speaking")) interruptionAudio += payload.length;
      } else commands.push(JSON.parse(payload).type);
    });
  });
  if (interrupt) await page.addInitScript(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && JSON.parse(data).type === "stop-speaking"
        && document.querySelector("#status")?.textContent === "Speaking") window.interruptedPlayback = true;
      send.call(this, data);
    };
    const original = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      const destination = this.createMediaStreamDestination();
      original.call(this, stream).connect(destination);
      window.interruptTestSpeech = (audio, quiet) => {
        const bytes = Uint8Array.from(atob(audio), (character) => character.charCodeAt(0));
        const view = new DataView(bytes.buffer);
        const buffer = this.createBuffer(1, bytes.length / 2, 24000);
        const samples = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 32768;
        if (quiet) {
          // Even overlapping 20 ms frames stay below the old 0.012 volume cutoff.
          let peak = 0;
          for (let start = 0; start < samples.length; start += 480) {
            let energy = 0;
            const end = Math.min(start + 480, samples.length);
            for (let index = start; index < end; index++) energy += samples[index]! ** 2;
            peak = Math.max(peak, Math.sqrt(energy / (end - start)));
          }
          if (!peak) throw new Error("The generated interruption contains no sound.");
          for (let index = 0; index < samples.length; index++) samples[index]! *= 0.006 / peak;
        }
        const source = this.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        source.onended = () => source.disconnect();
        source.start();
      };
      return original.call(this, destination.stream);
    };
  });
  // The app opens with the microphone on. Hold this test browser's microphone back until the model is chosen,
  // so the first request uses it.
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    let release!: () => void;
    const ready = new Promise<void>((done) => { release = done; });
    (window as unknown as { startTestMicrophone: () => void }).startTestMicrophone = release;
    devices.getUserMedia = async (constraints) => { await ready; return original(constraints); };
  });
  await page.goto(app.url);
  await expect(page.locator("#status")).not.toHaveText("Starting up", { timeout: 30_000 });
  await page.evaluate(() => { location.hash = "settings/model"; });
  await page.selectOption("#model", JSON.stringify([choice.providerID, choice.modelID]));
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(page.locator("#drawer-settings")).toBeHidden();
  await page.evaluate(() => (window as unknown as { startTestMicrophone: () => void }).startTestMicrophone());
  await expect.poll(async () => `${await page.getByRole("status").textContent()} ${await page.locator("#status-detail").textContent()}`, { timeout: 30_000 })
    .toMatch(/Standing by|Listening|Understanding|Click anywhere/);
  if ((await page.locator("#status-detail").textContent())?.includes("Click anywhere")) await page.locator("#messages").click();
  await expect(page.locator(".message[data-role=user]")).toContainText(/connection is ready/i, { timeout: 60_000 });
  await expect(page.locator(".message[data-role=assistant]")).toContainText(/connection is ready/i, { timeout: 90_000 });
  await expect(page.getByRole("status")).toHaveText("Speaking", { timeout: 30_000 });
  if (interrupt) {
    interrupting = true;
    await page.evaluate(({ audio, quiet }) => window.interruptTestSpeech(audio, quiet), { audio: Buffer.concat(interruption).toString("base64"), quiet });
    await expect.poll(() => commands.includes("stop-speaking"), { timeout: 5000 }).toBe(true);
    assert.equal(await page.evaluate(() => window.interruptedPlayback), true, "The answer must still be playing when the interruption stops it.");
    assert.ok(interruptionAudio >= 640, "Real microphone audio must reach the listener before playback stops.");
    await expect(page.locator(".message[data-role=user]")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator(".message[data-role=user]").last()).toContainText(/Computer.*Delta (?:Seven|7).*do not change any files/i);
    assert.deepEqual(stoppedWork, [], "Interrupting spoken playback must not stop work.");
    await expect(page.getByRole("status")).toHaveText("Speaking", { timeout: 90_000 });
  }
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(page.getByRole("status")).toHaveText("Microphone off", { timeout: 30_000 });
  assert.ok(sentAudio > 16000, "Actual browser microphone audio must reach the chosen listener.");
  assert.ok(receivedAudio > 16000, "Actual chosen speaking service must return audible-length audio.");
  if (!interrupt) assert.equal(audioWhileSpeaking, 0, "Playback must not be transcribed as another user request.");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(interrupt ? 2 : 1);
  sessionID = (await engine.client.sessions(project))[0]?.id;
  assert.ok(sessionID);
  const saved = await engine.client.messages(sessionID, project);
  assert.ok(saved.some((message) => message.type === "assistant" && "content" in message && message.content.some((item) => item.type === "text" && /connection is ready/i.test(item.text))));
  if (observationError) throw observationError;
  assert.ok((deltas.get(sessionID) ?? 0) > 0, "The real model answer must produce live text updates, not only a saved final reply.");
  await page.screenshot({ path: resolve(directory, `${name}-conversation.png`), fullPage: true });
  console.log(`Real ${name} browser conversation passed: synthesized test microphone, automatic turn submission, OpenCode + ${choice.provider} ${choice.modelID}, ${deltas.get(sessionID)} live text updates, saved reply, real spoken playback, ${interrupt ? `${quiet ? "a quiet" : "a"} spoken interruption with the exact request preserved, ` : ""}mute and no self-listening. Screenshot: .picard-voice\\samples\\${name}-conversation.png`);
} finally {
  controller.abort();
  await observation;
  await browser?.close();
  try {
    if (engine) {
      for (const conversation of await engine.client.sessions(project)) await engine.client.deleteSession(conversation.id, project);
    }
  } finally {
    try { await app?.close(); }
    finally {
      try { await speech?.close?.(); }
      finally {
        try { await engine?.close(); }
        finally { await rm(temporary, { recursive: true }); }
      }
    }
  }
}
