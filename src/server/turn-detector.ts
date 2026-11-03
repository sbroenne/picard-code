import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LocalWorker } from "./local-speech.js";
import { PICARD_HOME } from "./speech.js";
import { setupTurn } from "../../scripts/setup-turn.mjs";

export interface TurnDetector {
  complete(audio: Uint8Array, signal: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}

/** Reuses the local speech protocol, without starting or changing a listening or speaking service. */
export async function connectTurnDetector(program: string, args: string[], signal?: AbortSignal): Promise<TurnDetector> {
  signal?.throwIfAborted();
  let worker: LocalWorker | undefined;
  let loading: Promise<LocalWorker> | undefined;
  const workers = new Set<LocalWorker>();
  let closed = false;
  const retire = async (previous: LocalWorker) => {
    if (worker === previous) { worker = undefined; loading = undefined; }
    await previous.close();
    workers.delete(previous);
  };
  const close = async () => {
    closed = true;
    signal?.removeEventListener("abort", abort);
    await Promise.all([...workers].map(retire));
  };
  const abort = () => { void close(); };
  signal?.addEventListener("abort", abort, { once: true });
  const open = (stopped?: AbortSignal) => {
    if (closed) throw new Error("Pause detection was stopped.");
    loading ??= (async () => {
      const next = new LocalWorker(program, args);
      worker = next;
      workers.add(next);
      const stop = () => { void next.close(); };
      stopped?.addEventListener("abort", stop, { once: true });
      try {
        stopped?.throwIfAborted();
        await next.ready;
        if (closed) throw new Error("Pause detection was stopped.");
        stopped?.throwIfAborted();
        return next;
      } catch (error) { await retire(next); throw error; }
      finally { stopped?.removeEventListener("abort", stop); }
    })();
    return loading;
  };
  let pending = 0;
  try {
    await open(signal);
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
      let active: LocalWorker | undefined;
      const timeout = AbortSignal.timeout(5000);
      const stopped = AbortSignal.any([requestSignal, timeout, ...(signal ? [signal] : [])]);
      try {
        let probability: number | undefined;
        active = await open(stopped);
        for await (const result of active.request("check-turn", { audio: Buffer.from(audio).toString("base64") }, stopped)) {
          if (result.type === "done") break;
          if (result.type !== "turn" || probability !== undefined || typeof result.probability !== "number" || !Number.isFinite(result.probability) || result.probability < 0 || result.probability > 1) {
            throw new Error("Pause detection returned an invalid completion score.");
          }
          probability = result.probability;
        }
        if (probability === undefined) throw new Error("Pause detection returned no completion score.");
        return probability > 0.5;
      } catch (error) {
        // Never retry or submit the failed request. A later microphone attempt starts a fresh worker.
        if (active && !requestSignal.aborted && !signal?.aborted) await retire(active);
        if (timeout.aborted && !requestSignal.aborted && !signal?.aborted) {
          throw new Error("Pause detection did not finish within five seconds. The spoken request was not sent. Switch the microphone on to try again.");
        }
        throw error;
      } finally { pending--; }
    },
    close,
  };
}

export async function loadTurnDetector(python: string, signal?: AbortSignal): Promise<TurnDetector> {
  if (typeof python !== "string" || !python.trim()) throw new Error("The local Python path is not valid.");
  try { await access(python); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("The local pause detector is not prepared. Prepare speech in the Listen · Speak tile, or run npx picard-code setup-speech with your listening and speaking choices. Saved choices have not changed.");
    }
    throw error;
  }
  const model = await setupTurn(PICARD_HOME, signal);
  return connectTurnDetector(python, [fileURLToPath(new URL("../../scripts/turn-detector-worker.py", import.meta.url)), "--model", model], signal);
}
