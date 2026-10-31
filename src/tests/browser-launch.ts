import { resolve } from "node:path";
import { startFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { makeClient } from "../server/engine.js";
import { projectDirectory } from "../server/process.js";
import { speechFixture } from "./speech-fixture.js";

const project = await projectDirectory(process.cwd());
const fixture = await startFixture(project);
const phrases = process.argv.includes("--approval") ? "Request an approval"
  : process.argv.includes("--question") ? ["Ask a question and let me choose", "Not the small change", "the second one"]
  : process.argv.includes("--unclear") ? ["", "Hello computer"]
  : process.argv.includes("--slow") ? ["Take a slow look", "Hello computer"] : "Hello computer";
const speech = process.argv.includes("--speech") ? speechFixture(phrases).service : undefined;
const soundIndex = process.argv.indexOf("--sounds");
const soundFolder = soundIndex > 0 ? process.argv[soundIndex + 1] : undefined;
const app = await startApp({ client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"), speech, soundFolder });
console.log(app.url);
process.once("SIGTERM", () => { void app.close().then(() => fixture.close()); });
process.once("SIGINT", () => { void app.close().then(() => fixture.close()); });
