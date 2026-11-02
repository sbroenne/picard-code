import { spawn as spawnProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { openBrowser as openDefaultBrowser, stopOwnedProcess as stopProcess } from "../dist/server/process.js";
import { startDevelopmentServer as startServer } from "./dev-server.mjs";

export async function runDevelopment({
  spawn = spawnProcess,
  openBrowser = openDefaultBrowser,
  startDevelopmentServer = startServer,
  stopOwnedProcess = stopProcess,
  platform = process.platform,
} = {}) {
  const child = spawn(process.execPath, ["dist/server/cli.js", "--no-open", ...process.argv.slice(2)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = new Promise((resolve) => { child.once("exit", (code, signal) => resolve([code, signal])); });
  let server;
  let closing;
  const close = () => closing ??= (async () => {
    try {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (platform === "win32") await stopOwnedProcess(child);
        else { child.kill("SIGTERM"); await exited; }
      }
    } finally {
      await server?.close();
    }
  })();
  const shutdown = () => { void close(); };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.once(signal, shutdown);

  try {
    const url = await new Promise((resolve, reject) => {
      let output = "";
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Picard Code stopped before its development server started (${code}).`)));
      child.stdout.on("data", (chunk) => {
        process.stdout.write(chunk);
        output = (output + chunk.toString()).slice(-8192);
        const match = /http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/.exec(output);
        if (match) resolve(new URL(match[0]));
      });
    });
    server = await startDevelopmentServer(url.origin);
    if (closing) throw new Error("Development startup was stopped.");
    const address = `${server.origin}/${url.hash}`;
    console.log(`\nLive browser updates: ${address}\nBrowser changes update automatically. Restart this command after server changes.`);
    try { await openBrowser(address); }
    catch (error) {
      console.error(`Could not open your browser: ${error.message}\nOpen the full live browser updates address above yourself.`);
    }
    const [code, signal] = await exited;
    if (!closing) throw new Error(`Picard Code stopped (${signal ?? code}).`);
  } catch (error) {
    if (!closing) {
      console.error(`Could not run Picard Code for development: ${error.message}`);
      return 1;
    }
  } finally {
    for (const signal of signals) process.removeListener(signal, shutdown);
    try { await close(); }
    finally { await server?.close(); }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runDevelopment();
}
