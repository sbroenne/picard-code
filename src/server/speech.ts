import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAzureSpeech } from "./azure-speech.js";
import { localSpeech } from "./local-speech.js";
import type { SpeechService, SpeechSelection } from "./speech-types.js";
import type { SpeechSettings } from "../shared/types.js";
import { crewVoice } from "../shared/crew-voices.js";

/** British prebuilt MAI voice chosen by the user after listening to the comparison. */
export const DEFAULT_MAI_VOICE = "en-GB-Emily:MAI-Voice-2.1-Flash";

/** Settings that the browser may read and change. Keys and passwords are never part of these. */
export const SETTING_NAMES = ["subscription", "resourceGroup", "resourceName", "region", "deployment", "voice", "voiceStyle", "kokoroVoice"] as const;
const NAME = /^[a-zA-Z0-9_.:-]{1,150}$/;
const PICARD_FOLDER = fileURLToPath(new URL("../../", import.meta.url));
/**
 * Settings and downloads live in .picard-code in the user's home folder, never in their project,
 * and not beside the app, which npx keeps in a cache that each update replaces.
 */
export const PICARD_HOME = join(homedir(), ".picard-code");
const VOICE_FOLDER = join(PICARD_HOME, "voice");
const LOCAL_PATHS = {
  localPython: resolve(VOICE_FOLDER, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python"),
  whisperModel: resolve(VOICE_FOLDER, "models", "whisper-tiny.en"),
  kokoroModel: resolve(VOICE_FOLDER, "models", "kokoro-v1.0.onnx"),
  kokoroVoices: resolve(VOICE_FOLDER, "models", "voices-v1.0.bin"),
} as const;

function localPath(record: Record<string, unknown> | undefined, key: keyof typeof LOCAL_PATHS) {
  const value = record?.[key] ?? LOCAL_PATHS[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Provide a valid ${key} path in the speech settings file.`);
  return resolve(value);
}

/** Whether the local Whisper and Kokoro files that a choice needs are all present. */
export async function localSpeechReady(record: Record<string, unknown> | undefined, listening = true, speaking = true) {
  const keys: (keyof typeof LOCAL_PATHS)[] = ["localPython", ...(listening ? ["whisperModel" as const] : []), ...(speaking ? ["kokoroModel" as const, "kokoroVoices" as const] : [])];
  try { await Promise.all(keys.map((key) => access(localPath(record, key)))); return true; }
  catch { return false; }
}

/** Only the standard location is set up automatically; custom paths are the owner's to fill. */
export function canSetUpLocalSpeech(record: Record<string, unknown> | undefined) {
  return (Object.keys(LOCAL_PATHS) as (keyof typeof LOCAL_PATHS)[]).every((key) => localPath(record, key) === LOCAL_PATHS[key]);
}

/** Runs the same steps as npx picard-code setup-speech, reporting each step as it starts. Stopping the signal ends the download and everything it started. */
export function setUpLocalSpeech(onStep: (step: string) => void, signal?: AbortSignal) {
  return new Promise<void>((done, fail) => {
    if (signal?.aborted) { fail(new Error("The local speech setup was stopped because Picard Code is closing.")); return; }
    const child = spawn(process.execPath, [resolve(PICARD_FOLDER, "scripts", "setup-speech.mjs")], { cwd: PICARD_FOLDER, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let last = "";
    const read = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/[\r\n]+/)) {
        const text = line.trim();
        if (!text) continue;
        last = text;
        if (/^(Creating|Installing|Downloading|That step failed)/.test(text)) onStep(text.replace(/\.+$/, ""));
      }
    };
    // The setup starts its own programs (uv, pip), so stop the whole group, not just the script.
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", (error) => { signal?.removeEventListener("abort", stop); fail(new Error(`Could not start the local speech setup. ${error.message}`)); });
    child.on("exit", (code) => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) fail(new Error("The local speech setup was stopped because Picard Code is closing."));
      else if (code === 0) done();
      else fail(new Error(`The local speech setup stopped. ${last}`));
    });
  });
}

/**
 * Speech settings belong to the user, in .picard-code/speech.json in their home folder
 * (for example C:\Users\name on Windows), never in the Picard Code or project folder.
 * Settings that earlier versions kept in .picard-speech.json in the Picard Code folder are copied over once;
 * the old file is left alone. A copy in the folder Picard Code was started from is never read: that folder may
 * be an untrusted project, and the settings can name a program to run.
 */
export const EARLIER_SPEECH_SETTINGS = [fileURLToPath(new URL("../../.picard-speech.json", import.meta.url))];

export async function speechSettingsFile(home = homedir(), earlier = EARLIER_SPEECH_SETTINGS) {
  const file = join(home, ".picard-code", "speech.json");
  try { await access(file); return file; }
  catch { /* not there yet */ }
  for (const old of earlier) {
    let text: string;
    try { text = await readFile(old, "utf8"); }
    catch { continue; }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, { encoding: "utf8", mode: 0o600 });
    console.log(`Speech settings now live in ${file} (copied from ${old}).`);
    break;
  }
  return file;
}

export async function readSpeechSettings(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The speech settings file must contain a settings object.");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The speech settings file is not valid. Check it against the README example.");
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Shows the saved choices, filling in the same defaults that loading uses. */
export function describeSpeechSettings(record: Record<string, unknown> | undefined): SpeechSettings {
  const text = (key: string, fallback = "") => typeof record?.[key] === "string" ? record[key] as string : fallback;
  return {
    listening: record?.listening === "mai" ? "mai" : "whisper",
    speaking: record?.speaking === "mai" ? "mai" : "kokoro",
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
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

export async function loadSpeech(overrides: { listening?: string; speaking?: string } = {}, signal?: AbortSignal, file?: string): Promise<SpeechService | undefined> {
  const record = await readSpeechSettings(file ?? await speechSettingsFile());
  // With nothing chosen, speech on this computer starts only once its download is already there.
  if (!record && !overrides.listening && !overrides.speaking && !await localSpeechReady(undefined)) return undefined;
  return speechFromSettings(record ?? {}, overrides, signal);
}

export async function speechFromSettings(record: Record<string, unknown>, overrides: { listening?: string; speaking?: string } = {}, signal?: AbortSignal): Promise<SpeechService> {
  const listening = overrides.listening ?? record.listening ?? "whisper";
  const speaking = overrides.speaking ?? record.speaking ?? "kokoro";
  if (listening !== "mai" && listening !== "whisper") throw new Error("Choose mai or whisper for listening. Speech services are never substituted silently.");
  if (speaking !== "mai" && speaking !== "kokoro") throw new Error("Choose mai or kokoro for speaking. Speech services are never substituted silently.");
  const selection: SpeechSelection = { listening, speaking };
  const name = (key: string, fallback?: string) => {
    const value = record[key] ?? fallback;
    if (typeof value !== "string" || !NAME.test(value)) throw new Error(`Provide a valid ${key} in the speech settings. Do not put keys there.`);
    return value;
  };
  const azure = listening === "mai" || speaking === "mai" ? await loadAzureSpeech({
    subscription: name("subscription"), resourceGroup: name("resourceGroup"),
    resourceName: name("resourceName"), region: name("region"),
    deployment: listening === "mai" ? name("deployment") : undefined,
    voice: speaking === "mai" ? name("voice", DEFAULT_MAI_VOICE) : DEFAULT_MAI_VOICE,
    voiceStyle: speaking === "mai" ? name("voiceStyle", "neutral") : "neutral",
  }) : undefined;
  const local = listening === "whisper" || speaking === "kokoro" ? await localSpeech({
    python: localPath(record, "localPython"),
    whisperModel: localPath(record, "whisperModel"),
    kokoroModel: localPath(record, "kokoroModel"),
    kokoroVoices: localPath(record, "kokoroVoices"),
    kokoroVoice: name("kokoroVoice", "bf_emma"),
  }, listening === "whisper", speaking === "kokoro", signal) : undefined;
  const listener = listening === "mai" ? azure! : local!.listener;
  const speaker = speaking === "mai" ? azure! : local!.speaker;
  const computer = { voice: speaking === "mai" ? name("voice", DEFAULT_MAI_VOICE) : DEFAULT_MAI_VOICE, kokoroVoice: speaking === "kokoro" ? name("kokoroVoice", "bf_emma") : "bf_emma" };
  return { selection, listen: listener.listen, speak: speaker.speak, officerVoice: (officer) => crewVoice(officer, speaking, computer), close: local?.close };
}
