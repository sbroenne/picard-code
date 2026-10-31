import { access, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAzureSpeech } from "./azure-speech.js";
import { localSpeech } from "./local-speech.js";
import type { SpeechService, SpeechSelection } from "./speech-types.js";
import type { SpeechSettings } from "../shared/types.js";

/** British prebuilt MAI voice chosen by the user after listening to the comparison. */
export const DEFAULT_MAI_VOICE = "en-GB-Emily:MAI-Voice-2.1-Flash";

/** Settings that the browser may read and change. Keys and passwords are never part of these. */
export const SETTING_NAMES = ["subscription", "resourceGroup", "resourceName", "region", "deployment", "voice", "voiceStyle", "kokoroVoice"] as const;
const NAME = /^[a-zA-Z0-9_.:-]{1,150}$/;

/**
 * The launch folder's settings file is used when it exists, as before.
 * Otherwise settings live in the Picard Code folder, never in the user's project.
 */
export async function speechSettingsFile() {
  const launch = resolve(".picard-speech.json");
  try { await access(launch); return launch; }
  catch { return fileURLToPath(new URL("../../.picard-speech.json", import.meta.url)); }
}

export async function readSpeechSettings(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(".picard-speech.json must contain a settings object.");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The speech settings file is not valid. Check .picard-speech.json against the README example.");
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Shows the saved choices, filling in the same defaults that loading uses. */
export function describeSpeechSettings(record: Record<string, unknown> | undefined): SpeechSettings {
  const text = (key: string, fallback = "") => typeof record?.[key] === "string" ? record[key] as string : fallback;
  return {
    listening: record?.listening === "whisper" ? "whisper" : "mai",
    speaking: record?.speaking === "kokoro" ? "kokoro" : "mai",
    subscription: text("subscription"), resourceGroup: text("resourceGroup"), resourceName: text("resourceName"),
    region: text("region"), deployment: text("deployment"), voice: text("voice", DEFAULT_MAI_VOICE),
    voiceStyle: text("voiceStyle", "neutral"), kokoroVoice: text("kokoroVoice", "bf_emma"),
  };
}

/** Checks browser-provided settings and merges them into the saved record, keeping file paths the browser cannot see. */
export function mergeSpeechSettings(saved: Record<string, unknown> | undefined, data: Record<string, unknown>) {
  if (data.listening !== "mai" && data.listening !== "whisper") throw new Error("Choose Azure MAI or local Whisper for listening.");
  if (data.speaking !== "mai" && data.speaking !== "kokoro") throw new Error("Choose Azure MAI or local Kokoro for speaking.");
  const record: Record<string, unknown> = { ...saved, listening: data.listening, speaking: data.speaking };
  for (const key of SETTING_NAMES) {
    const value = data[key];
    if (value === undefined || value === "") { delete record[key]; continue; }
    if (typeof value !== "string" || !NAME.test(value.trim())) throw new Error(`The ${key} setting can only use letters, numbers, dots, dashes, underscores and colons.`);
    record[key] = value.trim();
  }
  return record;
}

export async function saveSpeechSettings(file: string, record: Record<string, unknown>) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

export async function loadSpeech(overrides: { listening?: string; speaking?: string } = {}, signal?: AbortSignal, file?: string): Promise<SpeechService | undefined> {
  const record = await readSpeechSettings(file ?? await speechSettingsFile());
  if (!record && !overrides.listening && !overrides.speaking) return undefined;
  return speechFromSettings(record ?? {}, overrides, signal);
}

export async function speechFromSettings(record: Record<string, unknown>, overrides: { listening?: string; speaking?: string } = {}, signal?: AbortSignal): Promise<SpeechService> {
  const listening = overrides.listening ?? record.listening ?? "mai";
  const speaking = overrides.speaking ?? record.speaking ?? "mai";
  if (listening !== "mai" && listening !== "whisper") throw new Error("Choose mai or whisper for listening. Speech services are never substituted silently.");
  if (speaking !== "mai" && speaking !== "kokoro") throw new Error("Choose mai or kokoro for speaking. Speech services are never substituted silently.");
  const selection: SpeechSelection = { listening, speaking };
  const name = (key: string, fallback?: string) => {
    const value = record[key] ?? fallback;
    if (typeof value !== "string" || !NAME.test(value)) throw new Error(`Provide a valid ${key} in the speech settings. Do not put keys there.`);
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
