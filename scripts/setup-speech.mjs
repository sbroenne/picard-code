// Downloads only the selected local speech services, inside .picard-code.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { nemotronArchive, setupNemotron } from "./setup-nemotron.mjs";

const { values } = parseArgs({ args: process.argv.slice(process.argv[2] === "setup-speech" ? 3 : 2), options: {
  listening: { type: "string", default: "nemotron" }, speaking: { type: "string", default: "kokoro" },
} });
const { listening, speaking } = values;

const scripts = fileURLToPath(new URL(".", import.meta.url));
const home = join(homedir(), ".picard-code");
const voice = join(home, "voice");
const windows = process.platform === "win32";
const python = join(voice, windows ? "Scripts" : "bin", windows ? "python.exe" : "python");
// Whisper's CTranslate2 has no Windows ARM build, so Windows ARM uses Intel-compatible Python through Windows' built-in emulation.
const windowsArm = windows && process.arch === "arm64";
// Keep Hugging Face's download logs inside .picard-code too.
const env = { ...process.env, HF_HOME: join(voice, "huggingface") };

// uv's release files and checksums, for the computers the speech packages support.
const UV_VERSION = "0.13.6";
const UV = {
  "darwin-arm64": ["aarch64-apple-darwin.tar.gz", "60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472"],
  "win32-x64": ["x86_64-pc-windows-msvc.zip", "a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f"],
  "win32-arm64": ["x86_64-pc-windows-msvc.zip", "a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f"],
  "linux-x64": ["x86_64-unknown-linux-gnu.tar.gz", "f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645"],
  "linux-arm64": ["aarch64-unknown-linux-gnu.tar.gz", "229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d"],
};

function unsupported() {
  if (!UV[`${process.platform}-${process.arch}`]) return "Local speech runs on Apple silicon Macs, on Windows, and on Linux with an x64 or arm64 processor.";
  if (process.platform === "darwin" && Number(release().split(".")[0]) < 23) return "Local speech needs macOS 14 or newer.";
  if (process.platform === "linux") {
    const [major, minor] = (process.report.getReport().header.glibcVersionRuntime ?? "0.0").split(".").map(Number);
    if (major * 1000 + minor < 2028) return "Local speech needs Linux with glibc 2.28 or newer, which most desktop Linux versions since 2019 have.";
  }
}

async function uv() {
  const installed = spawnSync("uv", ["--version"], { encoding: "utf8" });
  if (installed.status === 0) {
    console.log(`\nUsing the ${installed.stdout.trim()} already installed on this computer.`);
    return "uv";
  }
  // A downloaded uv keeps its Python inside .picard-code and leaves no download cache.
  Object.assign(env, { UV_PYTHON_INSTALL_DIR: join(home, "python"), UV_PYTHON_PREFERENCE: "only-managed", UV_NO_CACHE: "1" });
  const [file, checksum] = UV[`${process.platform}-${process.arch}`];
  const folder = join(home, "uv", UV_VERSION);
  const program = join(folder, windows ? "uv.exe" : "uv");
  try { await access(program); return program; }
  catch { /* not downloaded yet */ }
  console.log(`\nDownloading uv ${UV_VERSION}, which sets up Python for local speech...`);
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${file}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== checksum) throw new Error(`${url} did not match the expected file, so it was not used.`);
  const download = `${folder}.download`;
  await rm(download, { recursive: true, force: true });
  await mkdir(download, { recursive: true });
  const archive = join(download, file);
  await writeFile(archive, data);
  // Windows' own tar reads zip files; the macOS and Linux archives keep uv in a subfolder.
  const tar = windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const unpacked = spawnSync(tar, ["-xf", archive, ...(windows ? [] : ["--strip-components=1"]), "-C", download], { stdio: "inherit" });
  if (unpacked.error) throw unpacked.error;
  if (unpacked.status !== 0) throw new Error(`Could not unpack ${file} (exit code ${unpacked.status}).`);
  await rm(archive);
  await rm(folder, { recursive: true, force: true });
  await rename(download, folder);
  return program;
}

function run(command, args, step) {
  console.log(`\n${step}`);
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`That step failed (exit code ${result.status}). Nothing else was run.`);
}

try {
  if (!["nemotron", "whisper", "mai"].includes(listening) || !["kokoro", "mai"].includes(speaking)) {
    throw new Error("Choose nemotron, whisper or mai for listening, and kokoro or mai for speaking.");
  }
  const reason = unsupported();
  if (reason) throw new Error(`${reason} Choose Azure MAI speech in the Listen · Speak tile instead.`);
  if (listening === "nemotron") nemotronArchive();
  if (listening === "whisper" || speaking === "kokoro") {
    const program = await uv();
    run(program, ["venv", "--allow-existing", "--python", windowsArm ? "cpython-3.11-windows-x86_64-none" : "3.11", voice],
      `Creating the Python 3.11 environment in ${voice}${windowsArm ? " (Intel-compatible, run through Windows' emulation)" : ""}...`);
    const requirements = listening === "whisper" && speaking === "kokoro" ? "speech" : listening === "whisper" ? "whisper" : "kokoro";
    run(program, ["pip", "install", "--python", python, "-r", join(scripts, `requirements-${requirements}.txt`)], "Installing the selected speech packages...");
    run(python, [join(scripts, "setup-local-speech.py"), join(voice, "models"), listening, speaking], "Downloading and checking the selected Whisper and Kokoro model files...");
  }
  if (listening === "nemotron") await setupNemotron(home);
  console.log(`\nThe selected speech files are ready (${listening} listening, ${speaking} speaking). Saved speech choices have not changed.`);
} catch (error) {
  console.error(error instanceof Error ? `${error.message}${error.cause instanceof Error ? ` ${error.cause.message}` : ""}` : String(error));
  process.exitCode = 1;
}
