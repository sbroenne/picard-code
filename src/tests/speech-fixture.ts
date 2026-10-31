import { setTimeout as wait } from "node:timers/promises";
import type { SpeechService } from "../server/speech-types.js";

export function speechFixture(phrase = "Hello computer") {
  let audioWrites = 0;
  let closes = 0;
  let spoken = "";
  const service: SpeechService = {
    async listen(callbacks, signal) {
      await wait(5, undefined, { signal });
      let closed = false;
      return {
        write() {
          if (closed) throw new Error("Test listening is closed.");
          ++audioWrites;
          callbacks.partial(phrase);
        },
        commit() { callbacks.final(phrase); },
        close() { if (!closed) { closed = true; ++closes; } },
      };
    },
    async *speak(text, signal) {
      spoken = text;
      const tone = Buffer.alloc(4800);
      for (let index = 0; index < tone.length / 2; index++) tone.writeInt16LE(Math.round(Math.sin(index / 24000 * 440 * 2 * Math.PI) * 3000), index * 2);
      for (let index = 0; index < 10; index++) {
        signal.throwIfAborted();
        yield tone;
        await wait(10, undefined, { signal });
      }
    },
  };
  return { service, get audioWrites() { return audioWrites; }, get closes() { return closes; }, get spoken() { return spoken; } };
}
