import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startFixture, wikipediaFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { makeClient } from "../server/engine.js";
import { projectDirectory } from "../server/process.js";

const project = await projectDirectory(process.cwd());
const fixture = await startFixture(project);
const settings = await mkdtemp(resolve(tmpdir(), "picard-preview-"));
const app = await startApp({ client: makeClient(fixture.url, fixture.password), openCodeSource: "installed", project, webRoot: resolve("web-dist"), port: 4173, modelFile: resolve(settings, "model.json"), speechFile: resolve(settings, "speech.json"), readWikipedia: wikipediaFixture });
console.log(`Test fixture only; no provider or tool execution.\n${app.url}`);
const shutdown = () => {
  void app.close().then(() => fixture.close()).then(() => rm(settings, { recursive: true })).catch((error) => { console.error(error); process.exitCode = 1; });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
