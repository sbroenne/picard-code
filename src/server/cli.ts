#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp } from "./app.js";
import { checkVersion, makeClient, localServerUrl, errorMessage } from "./engine.js";
import { projectDirectory, startEngine, openBrowser } from "./process.js";
import { loadSpeech } from "./speech.js";
import type { SpeechService } from "./speech-types.js";

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string", short: "p" },
      port: { type: "string" },
      connect: { type: "string" },
      "no-open": { type: "boolean" },
      listening: { type: "string" },
      speaking: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Picard Code - a local browser interface for OpenCode

  ${process.platform === "win32" ? "npm.cmd" : "npm"} start -- --project "path to your project"

  --project, -p   Project folder (defaults to the current folder)
  --port          Browser port (defaults to a free local port)
  --connect       Reuse a password-protected local OpenCode server
  --no-open       Print the address without opening a browser
  --listening     whisper (on this computer, the default) or mai (Azure)
  --speaking      kokoro (on this computer, the default) or mai (Azure)
  --help, -h      Show these instructions

Picard Code works with any model provider OpenCode supports, such as GitHub
Copilot, Anthropic or OpenAI. To sign in, run "npm run opencode -- auth login"
and choose your provider.`);
    return;
  }
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a whole number from 0 to 65535.");
  const project = await projectDirectory(resolve(values.project ?? process.cwd()));
  let cleanupEngine: (() => Promise<void>) | undefined;
  let cleanupApp: (() => Promise<void>) | undefined;
  let cleanupSpeech: (() => Promise<void> | undefined) | undefined;
  let stopping = false;
  const controller = new AbortController();
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    try { await cleanupApp?.(); }
    finally {
      try { await cleanupSpeech?.(); }
      finally { await cleanupEngine?.(); }
    }
  };
  const shutdown = () => {
    controller.abort();
    void cleanup().then(() => { process.exitCode = 0; }).catch((error) => {
      console.error(`Could not fully stop Picard Code: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
  };
  // npm passes Ctrl+C on as well, so the same signal can arrive twice; keep handling it until OpenCode has stopped.
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  try {
    let client;
    if (values.connect) {
      const baseUrl = localServerUrl(values.connect);
      const password = process.env.OPENCODE_SERVER_PASSWORD;
      if (!password) throw new Error("To reuse OpenCode, set OPENCODE_SERVER_PASSWORD to that server's password in this terminal. Never put it in a browser address.");
      client = makeClient(baseUrl, password, process.env.OPENCODE_SERVER_USERNAME ?? "opencode");
      await client.info();
      // Make sure unauthenticated callers cannot use the reused server.
      const unauthenticated = await fetch(`${baseUrl}/api/info`, { redirect: "error", signal: AbortSignal.timeout(5000) });
      if (unauthenticated.status !== 401) throw new Error("The existing OpenCode server is not password-protected. Restart it with OPENCODE_SERVER_PASSWORD.");
    } else {
      console.log("Starting OpenCode on this computer...");
      const engine = await startEngine(project, controller.signal);
      client = engine.client;
      cleanupEngine = engine.close;
      engine.child.once("exit", () => {
        if (!stopping) {
          console.error("OpenCode stopped. Restart Picard Code to reconnect.");
          void cleanup().then(() => { process.exitCode = 1; });
        }
      });
    }
    await checkVersion(client);
    const path = await client.location(project);
    controller.signal.throwIfAborted();
    if (resolve(path.directory) !== project) throw new Error("OpenCode did not select the requested project folder.");
    // A speech mistake should not stop the app; it is shown on the settings page so it can be fixed there.
    let speech: SpeechService | undefined;
    let speechError: string | undefined;
    try { speech = await loadSpeech({ listening: values.listening, speaking: values.speaking }, controller.signal); }
    catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      speechError = `Speech did not start. ${errorMessage(error)}`;
      console.error(speechError);
    }
    cleanupSpeech = () => speech?.close?.();
    controller.signal.throwIfAborted();
    const app = await startApp({
      client, project, port,
      speech, speechError,
      webRoot: fileURLToPath(new URL("../../web-dist/", import.meta.url)),
      soundFolder: fileURLToPath(new URL("../../.picard-sounds/", import.meta.url)),
    });
    // From here the app owns speech, including any service chosen later in settings.
    cleanupSpeech = undefined;
    cleanupApp = app.close;
    console.log(`\nPicard Code is ready.\nProject: ${project}\n\n${app.url}\n\nKeep this terminal open. Press Ctrl+C to stop.\n`);
    if (!values["no-open"]) {
      try { await openBrowser(app.url); }
      catch (error) { console.error(`Could not open your browser: ${errorMessage(error)}\nOpen the full address above yourself.`); }
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.name === "AbortError") return;
  console.error(`Picard Code could not start: ${errorMessage(error)}`);
  process.exitCode = 1;
});
