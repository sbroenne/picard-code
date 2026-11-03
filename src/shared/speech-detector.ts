import type * as Ort from "onnxruntime-web";

/** The speech detector reads 32 ms of 16 kHz audio at a time, with the 64 samples before it. */
export const SPEECH_FRAME = 512;
const CONTEXT = 64;

/** Turns 20 ms microphone packets (16-bit, 16 kHz) into the detector's 32 ms frames. */
export class SpeechFrames {
  private samples = new Float32Array(CONTEXT + SPEECH_FRAME);
  private filled = CONTEXT;
  reset() { this.samples.fill(0); this.filled = CONTEXT; }
  push(packet: ArrayBuffer): Float32Array[] {
    const frames: Float32Array[] = [];
    const view = new DataView(packet);
    for (let index = 0; index < view.byteLength; index += 2) {
      this.samples[this.filled++] = view.getInt16(index, true) / 32768;
      if (this.filled < this.samples.length) continue;
      frames.push(this.samples.slice());
      this.samples.copyWithin(0, SPEECH_FRAME);
      this.filled = CONTEXT;
    }
    return frames;
  }
}

/** Gives each frame a chance from 0 to 1 that it holds a human voice. */
export interface SpeechDetector {
  speech(frame: Float32Array): Promise<number>;
  reset(): void;
}

/**
 * Silero VAD, an MIT-licensed voice detector, run with ONNX Runtime on this computer.
 * It remembers recent frames, so it must be reset whenever the microphone stream is interrupted.
 */
export async function sileroDetector(ort: typeof Ort, model: Uint8Array): Promise<SpeechDetector> {
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  const rate = new ort.Tensor("int64", BigInt64Array.from([16000n]));
  const empty = (): Ort.Tensor => new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  let state = empty();
  let revision = 0;
  return {
    async speech(frame) {
      const current = revision;
      const result = await session.run({ input: new ort.Tensor("float32", frame, [1, frame.length]), state, sr: rate });
      const chance = result.output?.data[0];
      if (typeof chance !== "number" || !result.stateN) throw new Error("The speech detector returned an unexpected result.");
      if (current === revision) state = result.stateN;
      return chance;
    },
    reset() { revision++; state = empty(); },
  };
}
