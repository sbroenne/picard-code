import { access, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalWorker } from "./local-speech.js";
import { PICARD_HOME, readSpeechSettings, speechSettingsFile } from "./speech.js";
import { downloadVerified } from "../../scripts/setup-nemotron.mjs";

export const TURN_MODEL = "smart-turn-v3.2-cpu.onnx";
export const TURN_MODEL_SHA256 = "2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f";

export interface TurnDetector {
  complete(audio: Uint8Array, signal: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}

/** Reuses the local speech protocol, without starting or changing a listening or speaking service. */
export async function connectTurnDetector(program: string, args: string[], signal?: AbortSignal): Promise<TurnDetector> {
  signal?.throwIfAborted();
  const worker = new LocalWorker(program, args);
  const abort = () => { void worker.close(); };
  signal?.addEventListener("abort", abort, { once: true });
  let pending = 0;
  const close = async () => {
    signal?.removeEventListener("abort", abort);
    await worker.close();
  };
  try {
    await worker.ready;
    signal?.throwIfAborted();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    async complete(audio, requestSignal) {
      if (!audio.length || audio.length % 2 || audio.length > 256000) throw new Error("Pause detection needs up to eight seconds of complete audio samples.");
      if (pending >= 2) throw new Error("Pause detection is still finishing an earlier check. Please try again.");
      pending++;
      try {
        let probability: number | undefined;
        const stopped = AbortSignal.any([requestSignal, AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
        for await (const result of worker.request("check-turn", { audio: Buffer.from(audio).toString("base64") }, stopped)) {
          if (result.type === "done") break;
          if (result.type !== "turn" || probability !== undefined || typeof result.probability !== "number" || !Number.isFinite(result.probability) || result.probability < 0 || result.probability > 1) {
            throw new Error("Pause detection returned an invalid completion score.");
          }
          probability = result.probability;
        }
        if (probability === undefined) throw new Error("Pause detection returned no completion score.");
        return probability > 0.5;
      } finally { pending--; }
    },
    close,
  };
}

export async function loadTurnDetector(signal?: AbortSignal): Promise<TurnDetector> {
  const settings = await readSpeechSettings(await speechSettingsFile());
  const python = settings?.localPython ?? join(PICARD_HOME, "voice", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (typeof python !== "string" || !python.trim()) throw new Error("The local Python path is not valid.");
  try { await access(python); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("The Smart Turn trial needs the local speech Python environment. Run npx picard-code setup-speech --listening mai --speaking kokoro first. This does not change saved speech choices.");
    }
    throw error;
  }
  const folder = join(PICARD_HOME, "voice", "models");
  await mkdir(folder, { recursive: true });
  const model = join(folder, TURN_MODEL);
  console.log("Checking the local Smart Turn trial model (about 9 MB on first use)...");
  await downloadVerified(`https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/${TURN_MODEL}`, model, TURN_MODEL_SHA256, signal);
  signal?.throwIfAborted();
  await copyFile(fileURLToPath(new URL("../../scripts/smart-turn-LICENSE.txt", import.meta.url)), join(folder, "smart-turn-LICENSE.txt"));
  return connectTurnDetector(python, [fileURLToPath(new URL("../../scripts/turn-detector-worker.py", import.meta.url)), "--model", model], signal);
}
