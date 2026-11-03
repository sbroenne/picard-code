import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as wait } from "node:timers/promises";
import { loadSpeech } from "../server/speech.js";
import { checkOfficerVoices } from "./officer-voices-check.js";

const loaded = Date.now();
const { values } = parseArgs({ options: { listening: { type: "string", default: "nemotron" } } });
if (values.listening !== "nemotron") throw new Error("Choose nemotron for this local listening check.");
const listeningService = values.listening;
const speech = await loadSpeech({ listening: listeningService, speaking: "kokoro" });
assert.ok(speech);
const startup = Date.now() - loaded;
try {
  const started = Date.now();
  const chunks: Uint8Array[] = [];
  for await (const chunk of speech.speak("The local listening connection is ready. Please specify your request.", AbortSignal.timeout(30_000))) chunks.push(chunk);
  const speaking = Date.now() - started;
  console.log(`Kokoro produced real audio in ${speaking} ms. Checking ${listeningService}.`);
  const audio = Buffer.concat(chunks);
  assert.ok(audio.length > 16000);
  assert.equal(audio.length % 2, 0);
  let energy = 0;
  for (let index = 0; index < audio.length; index += 2) energy += (audio.readInt16LE(index) / 32768) ** 2;
  assert.ok(Math.sqrt(energy / (audio.length / 2)) > 0.005, "Kokoro must produce audible speech, not silence.");
  const samples = Math.floor(audio.length / 3);
  const inputAudio = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    const position = index * 1.5;
    const first = Math.floor(position);
    const a = audio.readInt16LE(first * 2);
    const b = audio.readInt16LE(Math.min(first + 1, audio.length / 2 - 1) * 2);
    inputAudio.writeInt16LE(Math.round(a + (b - a) * (position - first)), index * 2);
  }
  const measurements: { firstPartialMs: number | undefined; finalDelayMs: number }[] = [];
  const recognize = async (pcm = inputAudio) => {
    const controller = new AbortController();
    const started = Date.now();
    let firstPartialMs: number | undefined;
    let committedAt: number | undefined;
    let finish!: (value: { text: string } | { error: Error }) => void;
    let failure: Error | undefined;
    const result = new Promise<{ text: string } | { error: Error }>((resolve) => { finish = resolve; });
    const fail = (error: Error) => { failure = error; finish({ error }); };
    const deadline = setTimeout(() => { controller.abort(); fail(new Error(`${listeningService} did not finish within 30 seconds.`)); }, 30_000);
    let input: Awaited<ReturnType<typeof speech.listen>> | undefined;
    try {
      input = await speech.listen({
        partial: () => { if (firstPartialMs === undefined && committedAt === undefined) firstPartialMs = Date.now() - started; },
        final: (text) => finish({ text }), error: (message) => fail(new Error(message)),
      }, controller.signal);
      for (let offset = 0; offset < pcm.length; offset += 3200) {
        if (failure) throw failure;
        input.write(pcm.subarray(offset, offset + 3200));
        await wait(100);
      }
      if (failure) throw failure;
      committedAt = Date.now();
      input.commit();
      const transcript = await result;
      if ("error" in transcript) throw transcript.error;
      measurements.push({ firstPartialMs, finalDelayMs: Date.now() - committedAt });
      assert.notEqual(firstPartialMs, undefined, "Nemotron must produce live words before commit.");
      return transcript.text;
    } finally {
      clearTimeout(deadline);
      controller.abort();
      input?.close();
    }
  };
  const listeningStarted = Date.now();
  const transcript = await recognize();
  const listening = Date.now() - listeningStarted;
  console.log(`${listeningService} understood the original phrase in ${listening} ms including microphone-paced audio. Checking negations and names.`);
  const request: Uint8Array[] = [];
  for await (const chunk of speech.speak("Computer, Data, do not change any files. Explain the project first.", AbortSignal.timeout(30_000))) request.push(chunk);
  const requestAudio = Buffer.concat(request);
  const requestPCM = Buffer.alloc(Math.floor(requestAudio.length / 3) * 2);
  for (let index = 0; index < requestPCM.length / 2; index++) requestPCM.writeInt16LE(requestAudio.readInt16LE(Math.floor(index * 1.5) * 2), index * 2);
  const exact = await recognize(requestPCM);
  assert.match(exact, /computer/i);
  assert.match(exact, /data/i);
  assert.match(exact, /do not change any files/i);
  assert.match(exact, /explain the project first/i);
  console.log("The original command preserved Computer, Data, and do not change any files. Checking listening cancellation.");
  let lateResults = 0;
  const cancelled = new AbortController();
  const abandoned = await speech.listen({ partial: () => { lateResults++; }, final: () => { lateResults++; }, error: () => {} }, cancelled.signal);
  abandoned.write(inputAudio.subarray(0, 640));
  cancelled.abort();
  abandoned.close();
  await wait(100);
  assert.equal(lateResults, 0, "Cancelled listening must not publish late results.");
  assert.match(transcript, /local listening connection is ready/i);
  assert.match(transcript, /specify your request/i);
  const controller = new AbortController();
  console.log("Checking speaking cancellation.");
  const interrupted = speech.speak("This is an original cancellation check. ".repeat(12), controller.signal)[Symbol.asyncIterator]();
  const waiting = interrupted.next();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, /stopped/);
  assert.match(await recognize(), /local listening connection is ready/i, "A cancelled speaking request must not corrupt later listening.");
  console.log(`Officer voices spoke real audio: ${await checkOfficerVoices(speech)}.`);
  const directory = resolve(".picard-voice", "samples");
  await mkdir(directory, { recursive: true });
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(audio.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(audio.length, 40);
  await writeFile(resolve(directory, "kokoro-sample.wav"), Buffer.concat([header, audio]));
  console.log(`Real local CPU speech passed (${listeningService}): startup ${startup} ms, speaking ${speaking} ms for ${(audio.length / 48000).toFixed(1)} seconds of audio. Microphone-paced recognition: ${JSON.stringify(measurements)}. Listening and speaking cancellation and subsequent listening passed. Synthetic speech only, not a physical microphone accuracy check. Sample: .picard-voice\\samples\\kokoro-sample.wav`);
} finally { await speech.close?.(); }
