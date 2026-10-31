import { resolve } from "node:path";
import { startFixture, wikipediaFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { makeClient } from "../server/engine.js";
import { projectDirectory } from "../server/process.js";

const project = await projectDirectory(process.cwd());
const fixture = await startFixture(project);
const app = await startApp({ client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"), port: 4173, readWikipedia: wikipediaFixture });
console.log(`Test fixture only; no provider or tool execution.\n${app.url}`);
const shutdown = () => {
  void app.close().then(() => fixture.close()).catch((error) => { console.error(error); process.exitCode = 1; });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
