import { sileroDetector, type SpeechDetector } from "../src/shared/speech-detector";
// Shipped with the app and served locally, like the runtime file Vite copies for ONNX Runtime.
import model from "@ricky0123/vad-web/dist/silero_vad_v5.onnx?url";

let loading: Promise<SpeechDetector> | undefined;

/** Loads the voice detector shipped with Picard Code. Nothing is downloaded from the internet. */
export function loadSpeechDetector() {
  loading ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1;
    const response = await fetch(model);
    if (!response.ok) throw new Error(`The voice detector file is missing (${response.status}). Reinstall Picard Code.`);
    return sileroDetector(ort, new Uint8Array(await response.arrayBuffer()));
  })().catch((error: unknown) => {
    loading = undefined;
    throw new Error(`The voice detector could not start. ${error instanceof Error ? error.message : String(error)}`);
  });
  return loading;
}
