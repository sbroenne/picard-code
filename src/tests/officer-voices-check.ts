import assert from "node:assert/strict";
import { CREW_VOICES } from "../shared/crew-voices.js";
import type { SpeechService } from "../server/speech-types.js";
import { speechChunks } from "../server/speech-bridge.js";

/** Speaks an original character example in each officer's voice and checks that each is real, audible audio. */
export async function checkOfficerVoices(service: SpeechService) {
  assert.ok(service.officerVoice, "The speech service must provide officer voices.");
  const used: string[] = [];
  for (const officer of Object.keys(CREW_VOICES) as (keyof typeof CREW_VOICES)[]) {
    const voice = service.officerVoice(officer);
    const chunks: Uint8Array[] = [];
    for await (const chunk of service.speak("The local speaking check is complete. All six officers must produce audible speech.", AbortSignal.timeout(60_000), voice)) chunks.push(chunk);
    const audio = Buffer.concat(chunks);
    let energy = 0;
    for (let index = 0; index + 1 < audio.length; index += 2) energy += (audio.readInt16LE(index) / 32768) ** 2;
    assert.ok(audio.length > 16000 && Math.sqrt(energy / (audio.length / 2)) > 0.005, `${officer}'s voice ${voice.name} must produce audible speech.`);
    used.push(`${officer} ${voice.name}`);
  }
  assert.equal(new Set(used.map((entry) => entry.split(" ").at(-1))).size, Object.keys(CREW_VOICES).length, "Each officer must have a different voice.");
  return used.join(", ");
}

/** Speaks a long, number-heavy answer piece by piece at the slowest speed, as the speech bridge does. */
export async function checkLongAnswer(service: SpeechService) {
  const answer = "Jean-Luc Picard was born in 2305 in La Barre, France, and grew up on his family's vineyard. He entered Starfleet Academy in 2323 after one failed attempt, and served as captain of the Stargazer for twenty-two years. In 2364 he took command of the Enterprise-D, NCC-1701-D. Over the next seven years he faced the Borg, the Romulans and Q, and was taken by the Borg in 2366.\n\n".repeat(3);
  let longest = 0;
  for (const piece of speechChunks(answer)) {
    let bytes = 0;
    for await (const chunk of service.speak(piece, AbortSignal.timeout(60_000), undefined, 0.8)) bytes += chunk.length;
    assert.ok(bytes > 16000, "Each piece of a long answer must produce real audio.");
    longest = Math.max(longest, bytes / 48000);
  }
  return `A ${answer.length}-character answer was spoken completely at speed 0.8; the longest piece was ${longest.toFixed(1)} of 62.5 allowed seconds`;
}
