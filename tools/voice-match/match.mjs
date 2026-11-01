// Runs match.py in its own Python environment under ~/.picard-code/voice-match, so the
// models and their downloads never land in the repository.
// Usage: npm run voices:match -- --clips <folder of your own clips> [other match.py options]
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { KOKORO_CANDIDATES, MAI_CANDIDATES } from "./candidates.mjs";

const home = join(homedir(), ".picard-code", "voice-match");
const tool = fileURLToPath(new URL(".", import.meta.url));
const env = {
  ...process.env,
  UV_PROJECT_ENVIRONMENT: join(home, "env"), UV_CACHE_DIR: join(home, "uv-cache"),
  HF_HOME: join(home, "huggingface"), TORCH_HOME: join(home, "torch"), PICARD_VOICE_MATCH: home,
  PICARD_VOICE_CANDIDATES: JSON.stringify({ kokoro: KOKORO_CANDIDATES, mai: MAI_CANDIDATES }),
};
const result = spawnSync("uv", ["run", "--project", tool, "--python", "3.12", "python", join(tool, "match.py"), ...process.argv.slice(2)], { stdio: "inherit", env });
if (result.error) console.error(`Could not start uv: ${result.error.message}. Install uv from https://docs.astral.sh/uv/.`);
process.exit(result.status ?? 1);
