import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSpeech } from "../server/speech.js";

const loaded = Date.now();
const speech = await loadSpeech({ listening: "whisper", speaking: "kokoro" });
assert.ok(speech);
const startup = Date.now() - loaded;
try {
  const started = Date.now();
  const chunks: Uint8Array[] = [];
  for await (const chunk of speech.speak("The local listening connection is ready. Please specify your request.", AbortSignal.timeout(30_000))) chunks.push(chunk);
  const speaking = Date.now() - started;
  console.log(`Kokoro produced real audio in ${speaking} ms. Checking Whisper.`);
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
  const recognize = async () => {
    const controller = new AbortController();
    let finish!: (text: string) => void;
    let fail!: (error: Error) => void;
    const result = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
    const deadline = setTimeout(() => { controller.abort(); fail(new Error("Whisper did not finish within 30 seconds.")); }, 30_000);
    const input = await speech.listen({ partial: () => {}, final: finish, error: (message) => fail(new Error(message)) }, controller.signal);
    try {
      input.write(inputAudio);
      input.commit();
      return await result;
    } finally {
      clearTimeout(deadline);
      controller.abort();
      input.close();
    }
  };
  const listeningStarted = Date.now();
  const transcript = await recognize();
  const listening = Date.now() - listeningStarted;
  console.log(`Whisper understood the original phrase in ${listening} ms. Checking cancellation.`);
  assert.match(transcript, /local listening connection is ready/i);
  assert.match(transcript, /specify a task/i);
  const controller = new AbortController();
  const interrupted = speech.speak("This is an original cancellation check. ".repeat(12), controller.signal)[Symbol.asyncIterator]();
  const waiting = interrupted.next();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, /stopped/);
  assert.match(await recognize(), /local listening connection is ready/i, "A cancelled speaking request must not corrupt later listening.");
  const directory = resolve(".picard-voice", "samples");
  await mkdir(directory, { recursive: true });
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(audio.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(audio.length, 40);
  await writeFile(resolve(directory, "kokoro-sample.wav"), Buffer.concat([header, audio]));
  console.log(`Real local CPU speech passed: startup ${startup} ms, speaking ${speaking} ms for ${(audio.length / 48000).toFixed(1)} seconds of audio, listening ${listening} ms. Cancellation and subsequent listening passed. Sample: .picard-voice\\samples\\kokoro-sample.wav`);
} finally { await speech.close?.(); }
