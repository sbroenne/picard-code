import { spawn, execFile, type ChildProcess } from "node:child_process";
import { access, realpath, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { delimiter, dirname, join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { makeClient } from "./engine.js";
import { CREW_UNAVAILABLE, crewConfiguration, verifiedCrew } from "./crew.js";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

export async function projectDirectory(path: string): Promise<string> {
  const directory = await realpath(path);
  if (!(await stat(directory)).isDirectory()) throw new Error("Choose a project folder, not a file.");
  return directory;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not find a local port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function exists(file: string) {
  try { await access(file); return true; }
  catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function openCodeCommand(): Promise<{ command: string; prefix: string[] }> {
  if (process.env.PICARD_OPENCODE_PATH) {
    const file = await realpath(process.env.PICARD_OPENCODE_PATH);
    if ([".cmd", ".bat"].includes(extname(file).toLowerCase())) {
      throw new Error("PICARD_OPENCODE_PATH must point to OpenCode's executable or JavaScript entry, not a command wrapper.");
    }
    return extname(file) === ".js" || extname(file) === ".mjs" || extname(file) === "" && process.platform === "win32"
      ? { command: process.execPath, prefix: [file] }
      : { command: file, prefix: [] };
  }
  // An OpenCode 2 already installed comes first; the copy included with Picard Code is the fallback.
  const installed = await installedOpenCode();
  if (installed) return { command: installed, prefix: [] };
  const bundled = bundledOpenCode();
  if (bundled && await exists(bundled)) return { command: bundled, prefix: [] };
  throw new Error("OpenCode was not found. Picard Code includes it for Windows, macOS and Linux on x64 and arm64 processors; if this computer is one of those, install Picard Code again. Otherwise install OpenCode 2 from https://opencode.ai, then restart your terminal.");
}

async function installedOpenCode() {
  for (const path of (process.env.PATH ?? "").split(delimiter)) {
    const directory = path.replace(/^"|"$/g, "");
    const entries = process.platform !== "win32" ? [join(directory, "opencode")] : [
      join(directory, "opencode.exe"),
      // npm's Windows .cmd wrapper cannot be safely spawned without a shell.
      join(directory, "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
      join(directory, "..", "@opencode", "cli", "bin", "opencode.exe"),
    ];
    for (const entry of entries) {
      if (await exists(entry) && await isOpenCode2(entry)) return entry;
    }
  }
  return undefined;
}

/** An older OpenCode on PATH is skipped, so it does not stop Picard Code from using its own copy. */
async function isOpenCode2(file: string) {
  try { return /^(?:opencode )?v?2\./.test((await execute(file, ["--version"], { timeout: 10000 })).stdout.trim()); }
  catch { return false; }
}

/**
 * OpenCode's program for this computer, from the matching @opencode/cli-* package in optionalDependencies.
 * Picard Code depends on these directly: the @opencode/cli wrapper needs a setup script that npx blocks.
 * On x64 only the baseline build is listed, because it runs on every x64 processor.
 */
export function bundledOpenCode(platform = process.platform, arch = process.arch) {
  try { return join(dirname(require.resolve(`${openCodePackage(platform, arch)}/package.json`)), "bin", platform === "win32" ? "opencode.exe" : "opencode"); }
  catch { return undefined; }
}

export function openCodePackage(platform: string, arch: string) {
  return `@opencode/cli-${platform === "win32" ? "windows" : platform}-${arch}${arch === "x64" ? "-baseline" : ""}`;
}

export async function stopOwnedProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      await execute("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("OpenCode did not confirm it stopped after shutdown.")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return;
  }
  const pid = child.pid;
  const send = (signal: NodeJS.Signals) => {
    try { process.kill(-pid, signal); }
    catch (error) {
      if (!(typeof error === "object" && error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  send("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { send("SIGKILL"); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  // A tool child can outlive the server; clear any remaining owned process group.
  send("SIGKILL");
}

export async function startEngine(directory: string, signal?: AbortSignal) {
  const port = await freePort();
  const password = randomBytes(32).toString("hex");
  const command = await openCodeCommand();
  const configuration = await mkdtemp(join(tmpdir(), "picard-crew-"));
  const configFile = join(configuration, "opencode.json");
  const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: "opencode" };
  // Without a separate settings location the crew cannot be loaded, but the computer still works.
  let crewBlocked: string | undefined;
  if (!env.OPENCODE_CONFIG_DIR) env.OPENCODE_CONFIG_DIR = configuration;
  else if (!env.OPENCODE_CONFIG) env.OPENCODE_CONFIG = configFile;
  else crewBlocked = "The bridge crew needs a separate OpenCode settings location, but both OPENCODE_CONFIG and OPENCODE_CONFIG_DIR are already set. Keep one unset to use the crew.";
  if (!crewBlocked) {
    try { await writeFile(configFile, JSON.stringify(crewConfiguration()), { mode: 0o600 }); }
    catch (error) {
      await rm(configuration, { recursive: true });
      throw error;
    }
  }
  const child = spawn(command.command, [...command.prefix, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let failed: Error | undefined;
  child.on("error", (error) => { failed = error; });
  // Drain output without passing configuration, credentials, or noisy server logs to the browser.
  child.stdout?.resume();
  child.stderr?.resume();
  const client = makeClient(`http://127.0.0.1:${port}`, password);
  /** Loads the crew for a project. Returns why the crew is unavailable, if it is; the computer keeps working either way. */
  const prepareCrew = async (project: string): Promise<string | undefined> => {
    if (crewBlocked) return crewBlocked;
    const build = (await client.agents(project)).find((agent) => agent.id === "build");
    if (!build) throw new Error("OpenCode did not provide the current coding agent's permission rules.");
    await writeFile(configFile, JSON.stringify(crewConfiguration(build.permissions)), { mode: 0o600 });
    await client.reload(project);
    return verifiedCrew(await client.agents(project)) ? undefined : CREW_UNAVAILABLE;
  };
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (failed) throw failed;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`OpenCode stopped during startup (exit ${child.exitCode ?? child.signalCode}). Run opencode in your terminal to check its configuration.`);
      try {
        await client.info(1000);
      } catch (error) {
        if (failed) throw failed;
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      let crewProblem: string | undefined;
      try { crewProblem = await prepareCrew(directory); }
      catch (error) { crewProblem = `The bridge crew could not be loaded. ${error instanceof Error ? error.message : String(error)}`; }
      return { client, child, prepareCrew, crewProblem, close: async () => {
        try { await stopOwnedProcess(child); }
        finally { await rm(configuration, { recursive: true, force: true }); }
      } };
    }
    throw new Error("OpenCode did not start within 45 seconds. Run opencode in your terminal to check its configuration.");
  } catch (error) {
    try { await stopOwnedProcess(child); }
    finally { await rm(configuration, { recursive: true, force: true }); }
    if (failed && "code" in failed && failed.code === "ENOENT") {
      throw new Error("OpenCode was not found. Install it from https://opencode.ai, then restart your terminal.");
    }
    throw error;
  }
}

export async function openBrowser(url: string): Promise<void> {
  const [command, args] = process.platform === "win32"
    ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] as const
    : process.platform === "darwin" ? ["open", [url]] as const : ["xdg-open", [url]] as const;
  await execute(command, [...args]);
}
