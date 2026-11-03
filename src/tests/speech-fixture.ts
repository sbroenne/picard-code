import { setTimeout as wait } from "node:timers/promises";
import type { SpeechService } from "../server/speech-types.js";
import type { SpeakingVoice } from "../shared/crew-voices.js";

export function speechFixture(phrases: string | string[] = "Hello computer", seconds = 1, partials = true) {
  const queue = Array.isArray(phrases) ? [...phrases] : [phrases];
  let audioWrites = 0;
  let closes = 0;
  let spoken = "";
  const said: { text: string; voice?: SpeakingVoice; speed?: number }[] = [];
  const service: SpeechService = {
    // Labelled test stand-in: synthetic microphone phrases are complete.
    turnDetector: { async complete() { return true; }, async close() {} },
    async listen(callbacks, signal) {
      await wait(5, undefined, { signal });
      let closed = false;
      // Each completed turn hears the next phrase; the last one repeats.
      return {
        write() {
          if (closed) throw new Error("Test listening is closed.");
          ++audioWrites;
          if (partials) callbacks.partial(queue[0]!);
        },
        commit() { callbacks.final(queue.length > 1 ? queue.shift()! : queue[0]!); },
        close() { if (!closed) { closed = true; ++closes; } },
      };
    },
    officerVoice: (officer) => ({ name: `test-${officer}` }),
    async *speak(text, signal, voice, speed) {
      spoken = text;
      said.push({ text, ...voice ? { voice } : {}, ...speed === undefined ? {} : { speed } });
      const tone = Buffer.alloc(4800);
      for (let index = 0; index < tone.length / 2; index++) tone.writeInt16LE(Math.round(Math.sin(index / 24000 * 440 * 2 * Math.PI) * 3000), index * 2);
      for (let index = 0; index < seconds * 10; index++) {
        signal.throwIfAborted();
        yield tone;
        await wait(10, undefined, { signal });
      }
    },
  };
  return { service, get audioWrites() { return audioWrites; }, get closes() { return closes; }, get spoken() { return spoken; }, said };
}
