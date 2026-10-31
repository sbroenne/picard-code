import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAzureSpeech } from "./azure-speech.js";
import { localSpeech } from "./local-speech.js";
import type { SpeechService, SpeechSelection } from "./speech-types.js";

/** British prebuilt MAI voice chosen by the user after listening to the comparison. */
export const DEFAULT_MAI_VOICE = "en-GB-Emily:MAI-Voice-2.1-Flash";

export async function loadSpeech(overrides: { listening?: string; speaking?: string } = {}, signal?: AbortSignal): Promise<SpeechService | undefined> {
  let record: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(await readFile(resolve(".picard-speech.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(".picard-speech.json must contain a settings object.");
    record = value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The speech settings file is not valid. Check .picard-speech.json against the README example.");
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    if (!overrides.listening && !overrides.speaking) return undefined;
  }
  const listening = overrides.listening ?? record.listening ?? "mai";
  const speaking = overrides.speaking ?? record.speaking ?? "mai";
  if (listening !== "mai" && listening !== "whisper") throw new Error("Choose mai or whisper for listening. Speech services are never substituted silently.");
  if (speaking !== "mai" && speaking !== "kokoro") throw new Error("Choose mai or kokoro for speaking. Speech services are never substituted silently.");
  const selection: SpeechSelection = { listening, speaking };
  const name = (key: string, fallback?: string) => {
    const value = record[key] ?? fallback;
    if (typeof value !== "string" || !/^[a-zA-Z0-9_.:-]{1,150}$/.test(value)) throw new Error(`Provide a valid ${key} in .picard-speech.json. Do not put keys in that file.`);
    return value;
  };
  const path = (key: string, fallback: string) => {
    const value = record[key] ?? fallback;
    if (typeof value !== "string" || !value.trim()) throw new Error(`Provide a valid ${key} path in .picard-speech.json.`);
    return resolve(value);
  };
  const azure = listening === "mai" || speaking === "mai" ? await loadAzureSpeech({
    subscription: name("subscription"), resourceGroup: name("resourceGroup"),
    resourceName: name("resourceName"), region: name("region"),
    deployment: listening === "mai" ? name("deployment") : undefined,
    voice: speaking === "mai" ? name("voice", DEFAULT_MAI_VOICE) : DEFAULT_MAI_VOICE,
    voiceStyle: speaking === "mai" ? name("voiceStyle", "neutral") : "neutral",
  }) : undefined;
  const local = listening === "whisper" || speaking === "kokoro" ? await localSpeech({
    python: path("localPython", resolve(".picard-voice", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")),
    whisperModel: path("whisperModel", resolve(".picard-voice", "models", "whisper-tiny.en")),
    kokoroModel: path("kokoroModel", resolve(".picard-voice", "models", "kokoro-v1.0.onnx")),
    kokoroVoices: path("kokoroVoices", resolve(".picard-voice", "models", "voices-v1.0.bin")),
    kokoroVoice: name("kokoroVoice", "bf_emma"),
  }, listening === "whisper", speaking === "kokoro", signal) : undefined;
  const listener = listening === "mai" ? azure! : local!.listener;
  const speaker = speaking === "mai" ? azure! : local!.speaker;
  return { selection, listen: listener.listen, speak: speaker.speak, close: local?.close };
}
