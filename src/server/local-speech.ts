import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SpeechSpeaker } from "./speech-types.js";

export interface LocalSettings {
  python: string;
  kokoroModel: string;
  kokoroVoices: string;
  kokoroVoice: string;
}
interface LocalResult {
  type: string;
  id?: number;
  audio?: string;
  message?: string;
  probability?: number;
}
interface Job {
  items: LocalResult[];
  error?: Error;
  wake?: () => void;
}

export class LocalWorker {
  private child: ChildProcessWithoutNullStreams;
  private jobs = new Map<number, Job>();
  private sequence = 0;
  private fatal?: Error;
  private closing?: Promise<void>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private rejectStartup?: (error: Error) => void;
  readonly ready: Promise<void>;

  constructor(python: string, args: string[]) {
    const env: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: "1", HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", OMP_NUM_THREADS: "4" };
    for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "LD_LIBRARY_PATH"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    this.child = spawn(python, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
      if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) { resolve(); return; }
      const force = setTimeout(() => { this.child.kill("SIGKILL"); }, 2000);
      force.unref();
      this.child.once("close", () => { clearTimeout(force); resolve(); });
      this.child.kill();
    });
    return this.closing;
  }
}

export async function localSpeech(settings: LocalSettings, signal?: AbortSignal) {
  signal?.throwIfAborted();
  for (const path of [settings.python, settings.kokoroModel, settings.kokoroVoices]) {
    try { await realpath(path); }
    catch { throw new Error("A configured local speech file is missing. Run npx picard-code setup-speech --listening mai --speaking kokoro, or choose Kokoro and Save and apply in the Listen · Speak tile to download it."); }
  }
  const speakerWorker = new LocalWorker(settings.python, [
    fileURLToPath(new URL("../../scripts/local-speech-worker.py", import.meta.url)),
    "--kokoro-model", settings.kokoroModel, "--kokoro-voices", settings.kokoroVoices, "--kokoro-voice", settings.kokoroVoice,
  ]);
  const close = () => speakerWorker.close();
  const abort = () => { void close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try { await speakerWorker.ready; }
  catch (error) {
    signal?.removeEventListener("abort", abort);
    await close();
    signal?.throwIfAborted();
    throw error;
  }
  signal?.throwIfAborted();
  const speaker: SpeechSpeaker = {
    async *speak(text, signal, voice, speed) {
      let bytes = 0;
      const request = { text, ...voice ? { voice: voice.name } : {}, ...speed === undefined ? {} : { speed } };
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
  return { speaker, close: () => {
    signal?.removeEventListener("abort", abort);
    return close();
  } };
}
