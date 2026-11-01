// Renders the same original sentences with every candidate voice, through Picard Code's own
// Kokoro and Azure speaking code, so the samples sound exactly as they would in the app.
// Run `npm run build` first. Usage: npm run voices:samples -- [--kokoro] [--mai] [--max-characters N] [--round-two plan.json]
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MAI_VOICE, speechSettingsFile, readSpeechSettings, PICARD_HOME } from "../../dist/server/speech.js";
import { COMPUTER_VOICES, DEFAULT_MAI_MODEL } from "../../dist/shared/crew-voices.js";
import { localSpeech } from "../../dist/server/local-speech.js";
import { loadAzureSpeech } from "../../dist/server/azure-speech.js";
import { KOKORO_CANDIDATES, MAI_CANDIDATES, SENTENCES } from "./candidates.mjs";

const { values } = parseArgs({ options: {
  kokoro: { type: "boolean", default: false },
  mai: { type: "boolean", default: false },
  "max-characters": { type: "string", default: "60000" },
  "round-two": { type: "string" },
  output: { type: "string", default: join(PICARD_HOME, "voice-match", "samples") },
} });
const services = values.kokoro || values.mai ? [values.kokoro && "kokoro", values.mai && "mai"].filter(Boolean) : ["kokoro", "mai"];
const limit = Number(values["max-characters"]);
const text = SENTENCES.join(" ");

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function render(speaker, voice, file) {
  try { await access(file); return "kept"; } catch { /* not rendered yet */ }
  const chunks = [];
  for await (const chunk of speaker.speak(text, AbortSignal.timeout(180_000), voice)) chunks.push(Buffer.from(chunk));
  await writeFile(file, wav(Buffer.concat(chunks)));
  return "made";
}

const fileName = (voice) => `${voice.name.split(":")[0]}${voice.style ? `__${voice.style}` : ""}${voice.speed ? `__speed${voice.speed}` : ""}.wav`;
const roundTwo = values["round-two"] ? JSON.parse(await readFile(values["round-two"], "utf8")) : undefined;
const record = await readSpeechSettings(await speechSettingsFile()) ?? {};

for (const service of services) {
  const folder = join(values.output, service);
  await mkdir(folder, { recursive: true });
  if (service === "kokoro") {
    const voices = roundTwo ? roundTwo.kokoro ?? [] : KOKORO_CANDIDATES.map(({ name }) => ({ name }));
    const home = join(PICARD_HOME, "voice");
    const local = await localSpeech({
      python: join(home, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      whisperModel: "", kokoroModel: join(home, "models", "kokoro-v1.0.onnx"), kokoroVoices: join(home, "models", "voices-v1.0.bin"),
      kokoroVoice: COMPUTER_VOICES.kokoro,
    }, false, true);
    try {
      for (const voice of voices) console.log(`Kokoro ${fileName(voice)}: ${await render(local.speaker, voice, join(folder, fileName(voice)))}`);
    } finally { await local.close(); }
  } else {
    const azureSettings = {
      subscription: record.subscription, resourceGroup: record.resourceGroup, resourceName: record.resourceName,
      region: record.region, voice: DEFAULT_MAI_VOICE, voiceStyle: "neutral",
    };
    for (const key of ["subscription", "resourceGroup", "resourceName", "region"]) {
      if (typeof azureSettings[key] !== "string") throw new Error(`Azure samples need ${key} in ${await speechSettingsFile()}.`);
    }
    const azure = await loadAzureSpeech(azureSettings);
    let voices = roundTwo?.mai;
    voices ??= MAI_CANDIDATES.map(({ name }) => ({ name: `${name}:${DEFAULT_MAI_MODEL}`, style: "neutral" }));
    const pending = [];
    for (const voice of voices) {
      try { await access(join(folder, fileName(voice))); } catch { pending.push(voice); }
    }
    const characters = pending.length * text.length;
    console.log(`Azure MAI: ${pending.length} samples to make, ${characters} characters in total (limit ${limit}).`);
    if (characters > limit) throw new Error(`That is more than the ${limit} character limit. Pass --max-characters to allow it.`);
    for (const voice of voices) {
      try { console.log(`MAI ${fileName(voice)}: ${await render(azure, voice, join(folder, fileName(voice)))}`); }
      catch (error) { console.log(`MAI ${fileName(voice)}: failed. ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
    }
  }
}
