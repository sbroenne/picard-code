// Sets up local Whisper listening and Kokoro speaking in the ignored .picard-voice folder.
// Needs uv (https://docs.astral.sh/uv/). Downloads about 432 MB of models plus Python packages.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const python = process.platform === "win32" ? ".picard-voice\\Scripts\\python.exe" : ".picard-voice/bin/python";

function run(command, args, step) {
  console.log(`\n${step}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error?.code === "ENOENT" && command === "uv") {
    console.error("uv is not installed. Install it from https://docs.astral.sh/uv/getting-started/installation/ and run this again.");
    process.exit(1);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`That step failed (exit code ${result.status}). Nothing else was run.`);
    process.exit(result.status ?? 1);
  }
}

run("uv", ["venv", "--allow-existing", "--python", "3.11", ".picard-voice"], "Creating the Python 3.11 environment in .picard-voice...");
run("uv", ["pip", "install", "--python", python, "-r", "scripts/requirements-speech.txt"], "Installing the speech packages...");
run(python, ["scripts/setup-local-speech.py"], "Downloading and checking the Whisper and Kokoro models (about 432 MB)...");
console.log("\nLocal speech is ready. Choose Whisper and Kokoro in Voice settings, or start with: npm start -- --listening whisper --speaking kokoro");
