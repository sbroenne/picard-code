import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import type { SpeechCallbacks, SpeechInput, SpeechListener } from "./speech-types.js";

/** The native runtime's transcription protocol, not the OpenAI Realtime API. */
export function connectNemotron(origin: string, key: string, callbacks: SpeechCallbacks, signal: AbortSignal): Promise<SpeechInput> {
  signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/v1/audio/transcriptions/realtime`, {
      headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 15_000, maxPayload: 128_000,
    });
    let ready = false;
    let configured = false;
    let closed = false;
    let committed = false;
    let text = "";
    let audioBytes = 0;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => fail("Nemotron did not open its listening connection within 15 seconds."), 15_000);
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearTimeout(finalTimer);
      signal.removeEventListener("abort", abort);
      socket.terminate();
    };
    const fail = (message: string) => {
      if (closed) return;
      close();
      if (ready) callbacks.error(message);
      else reject(new Error(message));
    };
    const abort = () => fail(signal.reason instanceof Error ? signal.reason.message : "Nemotron listening was stopped.");
    signal.addEventListener("abort", abort, { once: true });
    socket.on("error", () => fail("The local Nemotron listening connection failed. Check the speech setup."));
    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      fail(`Nemotron rejected the listening connection (HTTP ${response.statusCode}).`);
    });
    socket.on("close", () => { if (!closed) fail("Nemotron closed its listening connection before the request finished."); });
    socket.on("message", (raw, binary) => {
      if (closed) return;
      try {
        if (binary) throw new Error("Nemotron returned audio instead of a listening result.");
        const event: unknown = JSON.parse(raw.toString());
        if (!event || typeof event !== "object" || !("type" in event)) throw new Error("Nemotron sent an unreadable listening response.");
        if (event.type === "session.created" && !configured) {
          configured = true;
          socket.send(JSON.stringify({ type: "session.update", session: {
            sample_rate: 16000, language: "en", automatic_punctuation: true,
            verbatim: true, profanity_filter: false,
          } }));
        } else if (event.type === "session.updated" && configured && !ready) {
          ready = true;
          clearTimeout(timer);
          accept({
            write(audio) {
              if (closed || committed || socket.readyState !== WebSocket.OPEN) throw new Error("Nemotron's listening connection is closed.");
              if (!audio.length || audio.length % 2) throw new Error("Nemotron needs complete 16-bit audio samples.");
              audioBytes += audio.length;
              if (audioBytes > 16000 * 2 * 61) { fail("The spoken request is too long. Please use shorter turns."); return; }
              if (socket.bufferedAmount > 128_000) { fail("Nemotron listening fell behind. Try a shorter request."); return; }
              socket.send(audio);
            },
            commit() {
              if (closed || committed || !audioBytes) throw new Error("No Nemotron listening request is waiting.");
              committed = true;
              finalTimer = setTimeout(() => fail("Nemotron did not finish understanding the request within 30 seconds."), 30_000);
              socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            },
            close,
          });
        } else if (event.type === "conversation.item.input_audio_transcription.delta" && ready && "delta" in event && typeof event.delta === "string") {
          text += event.delta;
          if (text.length > 32_000) throw new Error("Nemotron returned too many words. Please use shorter turns.");
          callbacks.partial(text);
        } else if (event.type === "conversation.item.input_audio_transcription.completed" && ready && "transcript" in event && typeof event.transcript === "string") {
          if (!committed) throw new Error("Nemotron finished before the spoken request ended. Nothing was sent.");
          if (event.transcript.length > 32_000) throw new Error("Nemotron returned too many words. Please use shorter turns.");
          close();
          callbacks.final(event.transcript.trim());
        } else if (event.type === "error") {
          const error = "error" in event ? event.error : undefined;
          const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
            ? error.message.replaceAll(key, "[removed]").slice(0, 1000) : "No error details were provided.";
          throw new Error(`Nemotron could not understand the audio. ${message}`);
        } else if (event.type !== "input_audio_buffer.committed") throw new Error("Nemotron returned an unexpected listening response.");
      } catch (error) { fail(error instanceof SyntaxError ? "Nemotron sent an unreadable listening response." : error instanceof Error ? error.message : "Nemotron listening failed."); }
    });
    if (signal.aborted) abort();
  });
}

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("Could not choose a local Nemotron listening port.");
  return address.port;
}

export async function nemotronSpeech(settings: { program: string; model: string }, signal?: AbortSignal): Promise<SpeechListener & { close(): Promise<void> }> {
  signal?.throwIfAborted();
  for (const path of [settings.program, settings.model]) {
    try { await realpath(path); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new Error("A configured Nemotron speech file is missing. Choose Nemotron and Save and apply in the Listen · Speak tile to download it.");
      }
      throw error;
    }
  }
  const origin = `http://127.0.0.1:${await unusedPort()}`;
  const key = randomBytes(32).toString("hex");
  const env: NodeJS.ProcessEnv = { NEMO_SPEECH_HTTP_API_KEY: key };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TEMP", "TMP", "LANG", "LC_ALL"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const child = spawn(settings.program, ["serve", "--host", "127.0.0.1", "--port", new URL(origin).port,
    "--asr-model", settings.model, "--gpu", "-1", "--asr.backend.threads", "4",
    "--asr.endpointing.enable=false", "--asr.batching.enabled=false", "--no-ui"], {
    cwd: dirname(settings.program), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = new AbortController();
  let closing: Promise<void> | undefined;
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (bytes) => { stderr = (stderr + bytes.toString()).slice(-4000); });
  child.on("error", (error) => stopped.abort(new Error(`Could not start Nemotron. ${error.message}`)));
  child.on("exit", (code) => stopped.abort(new Error(`Nemotron stopped (exit ${code}). ${stderr.replaceAll(key, "[removed]").trim() || "Check the local speech setup."}`)));
  const close = () => {
    if (closing) return closing;
    stopped.abort(new Error("Nemotron listening was stopped."));
    closing = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) { resolve(); return; }
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
    return closing;
  };
  const abort = () => { void close(); };
  signal?.addEventListener("abort", abort, { once: true });
  const startup = AbortSignal.any([stopped.signal, AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
  try {
    while (true) {
      startup.throwIfAborted();
      let response: Response | undefined;
      try { response = await fetch(`${origin}/ready`, { signal: AbortSignal.any([startup, AbortSignal.timeout(1000)]) }); }
      catch (error) {
        startup.throwIfAborted();
        if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === "TimeoutError")) throw error;
      }
      if (response?.ok) {
        const status: unknown = await response.json();
        if (!status || typeof status !== "object" || !("ready" in status) || status.ready !== true) throw new Error("Nemotron returned an unreadable readiness result.");
        break;
      }
      await response?.body?.cancel();
      if (response && response.status !== 503) throw new Error(`Nemotron could not start listening (HTTP ${response.status}).`);
      await wait(100, undefined, { signal: startup });
    }
    startup.throwIfAborted();
    return {
      listen: (callbacks, requestSignal) => connectNemotron(origin, key, callbacks, AbortSignal.any([requestSignal, stopped.signal])),
      close: () => { signal?.removeEventListener("abort", abort); return close(); },
    };
  } catch (error) {
    const failure: unknown = startup.aborted ? startup.reason : error;
    signal?.removeEventListener("abort", abort);
    await close();
    if (failure instanceof DOMException && failure.name === "TimeoutError") throw new Error("Nemotron did not load within 60 seconds. Check the local speech setup.");
    throw failure;
  }
}
