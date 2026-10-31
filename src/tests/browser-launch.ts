import { resolve } from "node:path";
import { startFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { makeClient } from "../server/engine.js";
import { projectDirectory } from "../server/process.js";
import { speechFixture } from "./speech-fixture.js";

const project = await projectDirectory(process.cwd());
const fixture = await startFixture(project);
const speech = process.argv.includes("--speech")
  ? speechFixture(process.argv.includes("--approval") ? "Request an approval" : "Hello computer").service : undefined;
const app = await startApp({ client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"), speech });
console.log(app.url);
process.once("SIGTERM", () => { void app.close().then(() => fixture.close()); });
process.once("SIGINT", () => { void app.close().then(() => fixture.close()); });
