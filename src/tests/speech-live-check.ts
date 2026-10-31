import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { loadSpeech } from "../server/speech.js";

const service = await loadSpeech({ listening: "mai", speaking: "mai" });
if (!service) throw new Error("Set up .picard-speech.json before checking real Azure speech.");
const phrase = "The listening connection is ready. Please specify your request.";
const chunks: Uint8Array[] = [];
for await (const chunk of service.speak(phrase, AbortSignal.timeout(60_000))) chunks.push(chunk);
const audio = Buffer.concat(chunks);
assert.ok(audio.length > 16000, "Speaking must produce actual audio, not an empty response.");
assert.equal(audio.length % 2, 0);
const samples = Math.floor(audio.length / 2 / 1.5);
const inputAudio = Buffer.alloc(samples * 2);
for (let index = 0; index < samples; index++) {
  const position = index * 1.5;
  const first = Math.floor(position);
  const fraction = position - first;
  const a = audio.readInt16LE(first * 2);
  const b = audio.readInt16LE(Math.min(first + 1, audio.length / 2 - 1) * 2);
  inputAudio.writeInt16LE(Math.round(a + (b - a) * fraction), index * 2);
}
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 45_000);
let finish!: (text: string) => void;
let fail!: (error: Error) => void;
const transcript = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
// Attach the failure observer before audio streaming, without hiding a rejection.
void transcript.catch(() => {});
let partials = 0;
const input = await service.listen({
  partial: () => { partials++; },
  final: finish,
  error: (message) => fail(new Error(message)),
}, controller.signal);
controller.signal.addEventListener("abort", () => fail(new Error("Azure did not finish the live speech check within 45 seconds.")), { once: true });
try {
  for (let offset = 0; offset < inputAudio.length; offset += 640) {
    input.write(inputAudio.subarray(offset, offset + 640));
    await wait(20);
  }
  input.write(Buffer.alloc(2560));
  input.commit();
  const understood = await transcript;
  assert.match(understood, /listening connection is ready/i);
  assert.match(understood, /specify your request/i);
  assert.ok(partials > 0, "Listening must provide live intermediate words.");
  console.log(`Real Azure speaking and MAI live listening passed. ${partials} live word updates; the original test phrase was understood. No microphone or model was used.`);
} finally {
  clearTimeout(deadline);
  controller.abort();
  input.close();
}
