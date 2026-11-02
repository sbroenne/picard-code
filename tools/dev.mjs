import { spawn } from "node:child_process";
import { openBrowser } from "../dist/server/process.js";
import { startDevelopmentServer } from "./dev-server.mjs";

const child = spawn(process.execPath, ["dist/server/cli.js", "--no-open", ...process.argv.slice(2)], {
  stdio: ["ignore", "pipe", "inherit"],
});
const exited = new Promise((resolve) => { child.once("exit", (code, signal) => resolve([code, signal])); });
let server;
let closing;
const close = () => closing ??= (async () => {
  if (child.pid) {
    child.kill("SIGTERM");
    await exited;
  }
  await server?.close();
})();
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
process.once("SIGHUP", () => { void close(); });

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
  await openBrowser(address);
  const [code, signal] = await exited;
  if (!closing) throw new Error(`Picard Code stopped (${signal ?? code}).`);
} catch (error) {
  if (!closing) {
    console.error(`Could not run Picard Code for development: ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  await close();
  await server?.close();
}
