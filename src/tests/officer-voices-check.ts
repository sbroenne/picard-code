import assert from "node:assert/strict";
import { CREW_VOICES } from "../shared/crew-voices.js";
import type { SpeechService } from "../server/speech-types.js";

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
