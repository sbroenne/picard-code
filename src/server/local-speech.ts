import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SpeechListener, SpeechSpeaker } from "./speech-types.js";

export interface LocalSettings {
  python: string;
  whisperModel: string;
  kokoroModel: string;
  kokoroVoices: string;
  kokoroVoice: string;
}
interface LocalResult {
  type: string;
  id?: number;
  text?: string;
  audio?: string;
  message?: string;
}
interface Job {
  items: LocalResult[];
  error?: Error;
  wake?: () => void;
}

class LocalWorker {
  private child: ChildProcessWithoutNullStreams;
  private jobs = new Map<number, Job>();
  private sequence = 0;
  private fatal?: Error;
  private closing?: Promise<void>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private rejectStartup?: (error: Error) => void;
  readonly ready: Promise<void>;

  constructor(settings: LocalSettings, listening: boolean, speaking: boolean) {
    const args = [fileURLToPath(new URL("../../scripts/local-speech-worker.py", import.meta.url))];
    if (listening) args.push("--whisper-model", settings.whisperModel);
    if (speaking) args.push("--kokoro-model", settings.kokoroModel, "--kokoro-voices", settings.kokoroVoices, "--kokoro-voice", settings.kokoroVoice);
    const env: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: "1", HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", OMP_NUM_THREADS: "4" };
    for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "LD_LIBRARY_PATH"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    this.child = spawn(settings.python, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let initialized = false;
    let accept!: () => void;
    let reject!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, fail) => { accept = resolve; reject = fail; });
    this.rejectStartup = reject;
    const timer = setTimeout(() => fail(new Error("Local speech did not load within 60 seconds. Check the Python environment and model files.")), 60_000);
    this.startupTimer = timer;
    const fail = (error: Error) => {
      clearTimeout(timer);
      this.fatal = error;
      if (!initialized) reject(error);
      for (const job of this.jobs.values()) { job.error = error; job.wake?.(); }
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
    };
    this.child.stderr.on("data", (bytes) => { stderr = (stderr + bytes.toString()).slice(-4000); });
    this.child.stdin.on("error", () => {
      if (!this.closing) fail(new Error("The local speech process stopped accepting requests. Check its Python setup and restart Picard Code."));
    });
    this.child.on("error", () => fail(new Error("Could not start local speech. Run the local speech setup and check the configured Python path.")));
    this.child.on("exit", (code) => {
      if (!this.closing) fail(new Error(`Local speech stopped (exit ${code}). ${stderr.trim() || "Check the model files and Python setup."}`));
    });
    this.child.stdout.on("data", (bytes) => {
      buffer += bytes.toString();
      if (buffer.length > 256_000) { fail(new Error("Local speech returned an oversized response.")); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let result: LocalResult;
        try {
          const value: unknown = JSON.parse(line);
          if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") throw new Error("Invalid response.");
          result = value as LocalResult;
        } catch { fail(new Error("Local speech sent an unreadable response. Check its Python dependencies.")); return; }
        if (result.type === "ready") { initialized = true; clearTimeout(timer); accept(); }
        else if (result.id !== undefined) {
          const job = this.jobs.get(result.id);
          if (job) { job.items.push(result); job.wake?.(); }
        } else if (result.type === "error") fail(new Error(result.message ?? "Local speech could not load."));
        else { fail(new Error("Local speech returned an unexpected response.")); return; }
      }
    });
  }

  async *request(method: string, data: object, signal: AbortSignal): AsyncIterable<LocalResult> {
    signal.throwIfAborted();
    await this.ready;
    if (this.fatal) throw this.fatal;
    signal.throwIfAborted();
    const id = ++this.sequence;
    const job: Job = { items: [] };
    this.jobs.set(id, job);
    const abort = () => { job.error = new Error("Local speech was stopped."); job.wake?.(); };
    signal.addEventListener("abort", abort, { once: true });
    let finished = false;
    try {
      this.child.stdin.write(`${JSON.stringify({ id, method, ...data })}\n`);
      while (true) {
        if (job.error) throw job.error;
        const result = job.items.shift();
        if (!result) { await new Promise<void>((resolve) => { job.wake = resolve; }); continue; }
        if (result.type === "error") throw new Error(result.message ?? "Local speech failed.");
        if (result.type === "done") finished = true;
        yield result;
        if (finished) return;
      }
    } finally {
      signal.removeEventListener("abort", abort);
      this.jobs.delete(id);
      if (!finished && !this.fatal && this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify({ id, method: "cancel" })}\n`);
    }
  }

  close() {
    if (this.closing) return this.closing;
    clearTimeout(this.startupTimer);
    this.rejectStartup?.(new Error("Local speech loading was stopped."));
    this.closing = new Promise<void>((resolve) => {
      for (const job of this.jobs.values()) { job.error = new Error("Local speech was stopped."); job.wake?.(); }
      if (this.child.exitCode !== null || this.child.signalCode !== null) { resolve(); return; }
      this.child.once("exit", () => resolve());
      this.child.kill();
    });
    return this.closing;
  }
}

export async function localSpeech(settings: LocalSettings, listening: boolean, speaking: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted();
  for (const path of [settings.python, ...(listening ? [settings.whisperModel] : []), ...(speaking ? [settings.kokoroModel, settings.kokoroVoices] : [])]) {
    try { await realpath(path); }
    catch { throw new Error("A configured local speech file is missing. Run npx picard-code setup-speech, or choose Save and apply in the Listen · Speak tile to download it."); }
  }
  // A cancelled speaking batch must not delay the next listening request.
  const listenerWorker = listening ? new LocalWorker(settings, true, false) : undefined;
  const speakerWorker = speaking ? new LocalWorker(settings, false, true) : undefined;
  const workers = [listenerWorker, speakerWorker].filter((worker): worker is LocalWorker => !!worker);
  const close = async () => { await Promise.all(workers.map((worker) => worker.close())); };
  const abort = () => { void close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try { await Promise.all(workers.map((worker) => worker.ready)); }
  catch (error) {
    signal?.removeEventListener("abort", abort);
    await close();
    signal?.throwIfAborted();
    throw error;
  }
  signal?.throwIfAborted();
  const listener: SpeechListener = {
    async listen(callbacks, signal) {
      if (!listenerWorker) throw new Error("Whisper listening is not enabled.");
      signal.throwIfAborted();
      let chunks: Uint8Array[] = [];
      let closed = false;
      const controller = new AbortController();
      const close = () => {
        closed = true;
        chunks = [];
        controller.abort();
        signal.removeEventListener("abort", close);
      };
      signal.addEventListener("abort", close, { once: true });
      return {
        write(audio) {
          if (closed) throw new Error("Local listening is closed.");
          chunks.push(Buffer.from(audio));
        },
        commit() {
          if (closed) throw new Error("Local listening is closed.");
          const audio = Buffer.concat(chunks).toString("base64");
          chunks = [];
          void (async () => {
            for await (const result of listenerWorker.request("transcribe", { audio }, controller.signal)) {
              if (closed) return;
              if (result.type === "partial" && typeof result.text === "string") callbacks.partial(result.text);
              else if (result.type === "done" && typeof result.text === "string") callbacks.final(result.text);
              else throw new Error("Whisper returned an unexpected listening result.");
            }
          })().catch((error: unknown) => {
            if (!closed) callbacks.error(error instanceof Error ? error.message : "Whisper could not understand the request.");
          });
        },
        close,
      };
    },
  };
  const speaker: SpeechSpeaker = {
    async *speak(text, signal, voice) {
      if (!speakerWorker) throw new Error("Kokoro speaking is not enabled.");
      let bytes = 0;
      const request = voice ? { text, voice: voice.name, ...voice.speed === undefined ? {} : { speed: voice.speed } } : { text };
      for await (const result of speakerWorker.request("synthesize", request, AbortSignal.any([signal, AbortSignal.timeout(60_000)]))) {
        if (result.type === "done") break;
        if (result.type !== "audio" || typeof result.audio !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.audio)) throw new Error("Kokoro returned an unexpected speaking result.");
        const chunk = Buffer.from(result.audio, "base64");
        bytes += chunk.length;
        if (!chunk.length || chunk.length % 2 || bytes > 3_000_000) throw new Error("Kokoro returned incomplete or oversized audio.");
        yield chunk;
      }
      if (!bytes) throw new Error("Kokoro returned no spoken audio.");
    },
  };
  return { listener, speaker, close: () => {
    signal?.removeEventListener("abort", abort);
    return close();
  } };
}
