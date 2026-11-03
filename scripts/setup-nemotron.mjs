import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const NEMOTRON_VERSION = "0.3.0";
export const NEMOTRON_MODEL = "nemotron-speech-streaming-en-0.6b.q8_0.gguf";
const MODEL_REVISION = "ebe59e5a817142986528bbbee5dba8db7b38ed50";
const MODEL_SHA256 = "d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d";
const ARCHIVES = {
  "darwin-arm64": ["macos-aarch64-cpu.tar.gz", "2c3a7a719b778daeb14f147e011891f16e4b2ac62388d8b8d8b365cc2eebdf15"],
  "win32-x64": ["windows-x86_64-cpu.zip", "4ed9740e361e4653f56c3dce7d1e81883a1c8b831c1bd7d01567fff1130b5b05"],
  "win32-arm64": ["windows-x86_64-cpu.zip", "4ed9740e361e4653f56c3dce7d1e81883a1c8b831c1bd7d01567fff1130b5b05"],
  "linux-x64": ["linux-x86_64-cpu.tar.gz", "255f12b722ab15b2a38a51cf125d56e3fa97058b528f7e895b39d6a473deb06e"],
  "linux-arm64": ["linux-aarch64-cpu.tar.gz", "56858eaf50d19b05902c043f65d0057352bdc107ae380c41053bfbddfc204bf1"],
};

export function nemotronArchive(platform = process.platform, arch = process.arch, glibc = process.platform === "linux" ? process.report.getReport().header.glibcVersionRuntime : undefined) {
  const asset = ARCHIVES[`${platform}-${arch}`];
  if (!asset) throw new Error("Nemotron runs on Apple silicon Macs, Windows, and Linux with an x64 or arm64 processor. Azure MAI is available with your own Azure speech resource.");
  if (platform === "linux") {
    const [major, minor] = (glibc ?? "0.0").split(".").map(Number);
    if (!Number.isInteger(major) || !Number.isInteger(minor) || major * 1000 + minor < 2031) throw new Error("Nemotron needs Linux with glibc 2.31 or newer. Azure MAI is available with your own Azure speech resource.");
  }
  return { file: `nemo-speech-${NEMOTRON_VERSION}-${asset[0]}`, checksum: asset[1] };
}

async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function removeStoppedDownloads(target) {
  const folder = dirname(target);
  let entries;
  try { entries = await readdir(folder); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const prefix = `${basename(target)}.`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const suffix = entry.slice(prefix.length);
    if (!/^[1-9]\d*\.download$/.test(suffix)) continue;
    const pid = Number(suffix.slice(0, -".download".length));
    if (!Number.isSafeInteger(pid) || pid > 2_147_483_647) continue;
    // Forced shutdown cannot run finally; only reclaim files whose process has ended.
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") await rm(join(folder, entry), { recursive: true, force: true });
      else if (error.code !== "EPERM") throw error;
    }
  }
}

export async function downloadVerified(url, target, expected) {
  await removeStoppedDownloads(target);
  try { if (await checksum(target) === expected) return; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.download`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
    }
    const hash = createHash("sha256");
    const check = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), check, createWriteStream(temporary, { flags: "wx" }));
    if (hash.digest("hex") !== expected) throw new Error(`The published checksum does not match ${url}. Nothing was installed.`);
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

export async function setupNemotron(home) {
  const asset = nemotronArchive();
  const root = join(home, "voice", "nemotron", NEMOTRON_VERSION);
  const executable = join(root, "bin", process.platform === "win32" ? "nemo-speech.exe" : "nemo-speech");
  await removeStoppedDownloads(root);
  let installed = false;
  try { await access(executable); installed = (await readFile(join(root, ".picard-checksum"), "utf8")) === asset.checksum; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!installed) {
    console.log(`Downloading and checking Nemotron ${NEMOTRON_VERSION} for this computer...`);
    const archive = join(home, "voice", "downloads", asset.file);
    await downloadVerified(`https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${NEMOTRON_VERSION}/${asset.file}`, archive, asset.checksum);
    const staging = `${root}.${process.pid}.download`;
    await mkdir(staging, { recursive: true });
    try {
      const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      const result = spawnSync(tar, ["-xf", archive, "-C", staging], { stdio: "inherit", windowsHide: true });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Could not unpack Nemotron (exit ${result.status}).`);
      const entries = await readdir(staging, { withFileTypes: true });
      const extracted = entries.length === 1 && entries[0].isDirectory() ? join(staging, entries[0].name) : staging;
      await access(join(extracted, "bin", process.platform === "win32" ? "nemo-speech.exe" : "nemo-speech"));
      await writeFile(join(extracted, ".picard-checksum"), asset.checksum);
      // Do not replace an installed runtime underneath another Picard Code process.
      try { await access(root); throw new Error("The Nemotron runtime folder already exists but could not be verified. Check that folder before trying again."); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await rename(extracted, root);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  console.log("Downloading and checking the Nemotron English model (about 700 MB)...");
  await downloadVerified(`https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b/resolve/${MODEL_REVISION}/${NEMOTRON_MODEL}`,
    join(home, "voice", "models", NEMOTRON_MODEL), MODEL_SHA256);
  await downloadVerified("https://www.nvidia.com/content/dam/en-zz/Solutions/license-agreements/enterprise-software/nvidia-open-model-license-agreements-24-10-2025.pdf",
    join(home, "voice", "models", "NVIDIA-Open-Model-License.pdf"), "4d2fb590aa9b30c47f2058bff17291df7fa2aa0c1bd775a20703da9bb267cfab");
  await writeFile(join(home, "voice", "models", "NVIDIA-NOTICE.txt"), "Licensed by NVIDIA Corporation under the NVIDIA Open Model License\n");
}
