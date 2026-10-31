import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startEngine, projectDirectory } from "../server/process.js";
import { startApp } from "../server/app.js";
import { availableModels } from "../server/engine.js";
import { loadSpeech } from "../server/speech.js";
import type { SpeechService } from "../server/speech-types.js";

const local = process.argv.includes("--local");
const name = local ? "whisper-kokoro" : "mai";
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
  speech = await loadSpeech(local ? { listening: "whisper", speaking: "kokoro" } : { listening: "mai", speaking: "mai" });
  assert.ok(speech);
  const chunks: Uint8Array[] = [];
  for await (const chunk of speech.speak("Computer, please reply with just the words, the connection is ready.", AbortSignal.timeout(60_000))) chunks.push(chunk);
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
  const choice = models.models.find((model) => model.modelID === "gpt-4.1")
    ?? models.models.find((model) => model.modelID === "gpt-5-mini")
    ?? models.defaultModel;
  assert.ok(choice, "Sign in to a model provider in OpenCode before this real conversation check.");
  const events = engine.client.events(controller.signal);
  observation = (async () => {
    for await (const event of events) {
      if (event.type === "session.text.delta" && typeof event.data.sessionID === "string") {
        const id = event.data.sessionID;
        deltas.set(id, (deltas.get(id) ?? 0) + 1);
      }
    }
  })().catch((error: unknown) => { if (!controller.signal.aborted) observationError = error; });
  app = await startApp({ client: engine.client, project, speech, webRoot: resolve("web-dist") });
  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--mute-audio", `--use-file-for-fake-audio-capture=${recording}`] });
  const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1360, height: 980 } });
  const page = await context.newPage();
  let receivedAudio = 0;
  let sentAudio = 0;
  let speaking = false;
  let audioWhileSpeaking = 0;
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") receivedAudio += payload.length;
      else {
        const event = JSON.parse(payload);
        if (event.type === "state") speaking = event.phase === "speaking";
      }
    });
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") { sentAudio += payload.length; if (speaking) audioWhileSpeaking++; }
    });
  });
  // Stay not listening until the model is chosen, so the first request uses it.
  await page.addInitScript(() => { if (!sessionStorage.getItem("picard-check")) { sessionStorage.setItem("picard-check", "1"); localStorage.setItem("picard-muted", "yes"); } });
  await page.goto(app.url);
  await expect(page.getByRole("status")).toHaveText("Microphone off", { timeout: 30_000 });
  // Settings pauses listening, so choose the model there first; closing it starts listening.
  await page.goto(`${new URL(app.url).origin}/#settings/model`);
  await page.selectOption("#model", JSON.stringify([choice.providerID, choice.modelID]));
  await page.keyboard.press("Escape");
  await page.locator("#voice-console").click();
  await expect(page.locator(".message[data-role=user]")).toContainText(/connection is ready/i, { timeout: 60_000 });
  await expect(page.locator(".message[data-role=assistant]")).toContainText(/connection is ready/i, { timeout: 90_000 });
  await expect(page.getByRole("status")).toHaveText("Speaking", { timeout: 30_000 });
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await expect(page.getByRole("status")).toHaveText("Microphone off", { timeout: 30_000 });
  assert.ok(sentAudio > 16000, "Actual browser microphone audio must reach the chosen listener.");
  assert.ok(receivedAudio > 16000, "Actual chosen speaking service must return audible-length audio.");
  assert.equal(audioWhileSpeaking, 0, "Playback must not be transcribed as another user request.");
  await expect(page.locator(".message[data-role=user]")).toHaveCount(1);
  sessionID = (await engine.client.sessions(project))[0]?.id;
  assert.ok(sessionID);
  const saved = await engine.client.messages(sessionID, project);
  assert.ok(saved.some((message) => message.type === "assistant" && "content" in message && message.content.some((item) => item.type === "text" && /connection is ready/i.test(item.text))));
  if (observationError) throw observationError;
  assert.ok((deltas.get(sessionID) ?? 0) > 0, "The real model answer must produce live text updates, not only a saved final reply.");
  await page.screenshot({ path: resolve(directory, `${name}-conversation.png`), fullPage: true });
  console.log(`Real ${name} browser conversation passed: synthesized test microphone, automatic turn submission, OpenCode + ${choice.provider} ${choice.modelID}, ${deltas.get(sessionID)} live text updates, saved reply, real spoken playback, mute and no self-listening. Screenshot: .picard-voice\\samples\\${name}-conversation.png`);
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
