import { spawn, execFile, type ChildProcess } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, dirname, join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { makeClient } from "./engine.js";

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
  // Prefer the copy installed with Picard Code; it is the version Picard Code was checked against.
  const bundled = bundledOpenCode();
  if (bundled && await exists(bundled)) return { command: bundled, prefix: [] };
  for (const path of (process.env.PATH ?? "").split(delimiter)) {
    const directory = path.replace(/^"|"$/g, "");
    if (process.platform !== "win32") {
      const entry = join(directory, "opencode");
      if (await exists(entry)) return { command: entry, prefix: [] };
      continue;
    }
    if (await exists(join(directory, "opencode.exe"))) return { command: join(directory, "opencode.exe"), prefix: [] };
    // npm's Windows .cmd wrapper cannot be safely spawned without a shell.
    for (const entry of [
      join(directory, "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
      join(directory, "..", "@opencode", "cli", "bin", "opencode.exe"),
    ]) {
      if (await exists(entry)) return { command: entry, prefix: [] };
    }
  }
  throw new Error("OpenCode was not found. Picard Code includes it for Windows, macOS and Linux on x64 and arm64 processors; if this computer is one of those, install Picard Code again. Otherwise install OpenCode 2 from https://opencode.ai, then restart your terminal.");
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
  const child = spawn(command.command, [...command.prefix, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: directory,
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: "opencode" },
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
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (failed) throw failed;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`OpenCode stopped during startup (exit ${child.exitCode ?? child.signalCode}). Run opencode in your terminal to check its configuration.`);
      try {
        await client.info(1000);
        return { client, child, close: () => stopOwnedProcess(child) };
      } catch (error) {
        if (failed) throw failed;
        if (Date.now() >= deadline) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("OpenCode did not start within 45 seconds. Run opencode in your terminal to check its configuration.");
  } catch (error) {
    await stopOwnedProcess(child);
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
