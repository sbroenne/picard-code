import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";

import type { SpeechService, SpeechInput } from "./speech-types.js";
export type { SpeechService } from "./speech-types.js";
export interface AzureSettings {
  subscription: string;
  resourceGroup: string;
  resourceName: string;
  region: string;
  deployment?: string;
  voice: string;
  /** A documented MAI speaking style such as neutral, or "none" to send no style. */
  voiceStyle?: string;
}

const run = promisify(execFile);

export async function loadAzureSpeech(settings: AzureSettings): Promise<SpeechService> {
  let key = process.env.PICARD_AZURE_SPEECH_KEY;
  if (!key) {
    const args = ["cognitiveservices", "account", "keys", "list", "--name", settings.resourceName,
      "--resource-group", settings.resourceGroup, "--subscription", settings.subscription, "-o", "json"];
    let output: string;
    try {
      // Windows Azure CLI is a .cmd file. All command arguments above are fixed
      // or restricted to safe name characters; no browser input reaches them.
      const result = process.platform === "win32"
        ? await run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `az ${args.join(" ")}`], { timeout: 30_000, windowsHide: true })
        : await run("az", args, { timeout: 30_000 });
      output = result.stdout;
    } catch {
      throw new Error("Could not read the configured Azure resource's speech key. Sign in with 'az login' in your terminal and check access to that resource, or set PICARD_AZURE_SPEECH_KEY locally. Never paste a key into chat.");
    }
    const credentials: unknown = JSON.parse(output);
    if (!credentials || typeof credentials !== "object" || !("key1" in credentials) || typeof credentials.key1 !== "string" || !credentials.key1) {
      throw new Error("Azure did not provide a speech key for the configured resource.");
    }
    key = credentials.key1;
  }
  return azureSpeech(settings, key);
}

function serviceCode(value: unknown) {
  if (value && typeof value === "object" && "code" in value && typeof value.code === "string" && /^[\w.-]{1,100}$/.test(value.code)) return ` (${value.code})`;
  return "";
}

function escapeXml(text: string) {
  return text.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

export function speakingDocument(settings: Pick<AzureSettings, "voice" | "voiceStyle">, text: string) {
  const language = /^([a-z]{2}-[A-Z]{2})-/.exec(settings.voice)?.[1] ?? "en-US";
  const style = settings.voiceStyle && settings.voiceStyle !== "none" ? settings.voiceStyle : undefined;
  const body = style ? `<mstts:express-as style="${escapeXml(style)}">${escapeXml(text)}</mstts:express-as>` : escapeXml(text);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${language}"><voice name="${escapeXml(settings.voice)}">${body}</voice></speak>`;
}

export function azureSpeech(settings: AzureSettings, key: string): SpeechService {
  return {
    listen: (callbacks, signal) => new Promise<SpeechInput>((accept, reject) => {
      signal.throwIfAborted();
      const deployment = settings.deployment;
      if (!deployment) throw new Error("Configure a MAI live listening deployment before selecting MAI listening.");
      const socket = new WebSocket(`wss://${settings.resourceName}.services.ai.azure.com/mai/v1/realtime?intent=transcription`, {
        headers: { "api-key": key }, handshakeTimeout: 15_000, maxPayload: 128_000,
      });
      let ready = false;
      let closed = false;
      let finalized = "";
      const timer = setTimeout(() => fail("Azure did not open its listening connection within 30 seconds."), 30_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        socket.terminate();
      };
      const fail = (message: string) => {
        if (closed) return;
        if (ready) callbacks.error(message);
        else reject(new Error(message));
        close();
      };
      const abort = () => {
        if (!ready) reject(new Error("Listening was stopped."));
        close();
      };
      signal.addEventListener("abort", abort, { once: true });
      socket.on("error", () => fail("Could not connect to Azure listening. Check your connection, resource access and live model deployment."));
      socket.on("unexpected-response", (_request, response) => {
        response.resume();
        fail(`Azure rejected the listening connection (HTTP ${response.statusCode}). Check access to the configured live model deployment.`);
      });
      socket.on("close", () => {
        if (!closed) fail("Azure closed its listening connection. Click the microphone button to listen again.");
      });
      socket.on("message", (raw) => {
        let event: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(raw.toString());
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid event.");
          event = parsed as Record<string, unknown>;
        }
        catch { fail("Azure sent an unreadable listening response."); return; }
        if (event.type === "session.created") {
          socket.send(JSON.stringify({
            type: "session.update",
            session: { type: "transcription", audio: { input: {
              format: { type: "audio/pcm", rate: 16000 },
              transcription: { model: deployment, language: "en" },
              turn_detection: null, noise_reduction: null,
            } } },
          }));
        } else if (event.type === "session.updated" && !ready) {
          ready = true;
          clearTimeout(timer);
          accept({
            write(audio) {
              if (closed || socket.readyState !== WebSocket.OPEN) throw new Error("Azure's listening connection is closed.");
              if (socket.bufferedAmount > 128_000) throw new Error("The listening connection fell behind. Check your connection, then click the microphone button to listen again.");
              socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.from(audio).toString("base64") }));
            },
            commit() {
              if (closed || socket.readyState !== WebSocket.OPEN) throw new Error("Azure's listening connection is closed.");
              socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            },
            close,
          });
        } else if (event.type === "conversation.item.input_audio_transcription.delta" && typeof event.delta === "string") {
          finalized += event.delta;
          if (finalized.length > 32_000) { fail("The spoken request is too long. Please use shorter turns."); return; }
          callbacks.partial(finalized);
        } else if (event.type === "conversation.item.input_audio_transcription.intermediate" && typeof event.intermediate === "string") {
          callbacks.partial((finalized + event.intermediate).slice(0, 32_000));
        } else if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
          finalized = "";
          if (event.transcript.length > 32_000) { fail("The spoken request is too long. Please use shorter turns."); return; }
          callbacks.final(event.transcript.trim());
        } else if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") {
          fail(`Azure could not understand the audio${serviceCode(event.error)}. Check the live model deployment and available service quota.`);
        }
      });
    }),
    async *speak(text, signal, voice) {
      const response = await fetch(`https://${settings.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
        headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm" },
        body: speakingDocument(voice ? { voice: voice.name, voiceStyle: voice.style } : settings, text),
      });
      if (!response.ok) {
        throw new Error(voice
          ? `Azure rejected the voice ${voice.name}${voice.style ? ` with style ${voice.style}` : ""} (HTTP ${response.status}). Check the region, resource access and quota.`
          : `Azure rejected the speaking request (HTTP ${response.status}). Check the configured voice, voice style, region, resource access and quota.`);
      }
      if (!response.body) throw new Error("Azure returned no spoken audio.");
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > 3_000_000) throw new Error("Azure returned more audio than expected. Speaking was stopped.");
        yield chunk;
      }
      if (!total) throw new Error("Azure returned an empty spoken answer.");
    },
  };
}
