import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFixture, wikipediaFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { makeClient } from "../server/engine.js";
import { projectDirectory } from "../server/process.js";
import { speechFixture } from "./speech-fixture.js";

const project = await projectDirectory(process.cwd());
const fixture = await startFixture(project);
// Each utterance hears the next phrase; the last one repeats. Within a task everything said is sent,
// so most end in silence ("").
const phrases = process.argv.includes("--crew") ? ["Computer, have Riker coordinate the repair", ""]
  : process.argv.includes("--tribute") ? ["Computer, multi-message answer", "Hello again", "Another answer", "One more answer", "Keep going", "The last answer", ""]
  : process.argv.includes("--picard") ? ["Computer, tell me about myself", "Yes, please.", ""]
  : process.argv.includes("--picard-decline") ? ["Computer, tell me about myself", "Not now", ""]
  : process.argv.includes("--stewart") ? ["Computer, tell me a short story about Sir Patrick Stewart", ""]
  : process.argv.includes("--stewart-about") ? ["Computer, tell me about Patrick Stewart", "Yes, please.", ""]
  : process.argv.includes("--picard-story") ? ["Computer, tell me a short story about Captain Jean-Luc Picard", ""]
  : process.argv.includes("--repo") ? ["Computer, tell me about our Picard repo", ""]
  : process.argv.includes("--approval") ? ["Computer, request an approval", ""]
  : process.argv.includes("--question") ? ["Computer, ask a question and let me choose", "Not the small change", "the second one", ""]
  : process.argv.includes("--unclear") ? ["", "Is it raining outside", "Computer, hello there", ""]
  : process.argv.includes("--slow") ? ["Computer, take a very slow look", "Stop", ""]
  : process.argv.includes("--sleep") ? ["Stop listening", "Hello again", "Computer, hello there", ""]
  : process.argv.includes("--separate") ? ["Computer, hello there", "Stop listening", "Computer, show unsafe output", ""]
  : process.argv.includes("--long") ? ["Computer, take a very slow look", ""]
  : process.argv.includes("--choose") ? ["Computer, ask a question and let me choose", ""]
  : process.argv.includes("--unsafe") ? ["Computer, show unsafe output", ""]
  : process.argv.includes("--fresh") ? ["Computer, hello there", "New log entry", "Is anyone there"]
  : ["Computer, hello there", "Hello again", ""];
const speech = process.argv.includes("--speech") ? speechFixture(phrases).service : undefined;
const soundIndex = process.argv.indexOf("--sounds");
const soundFolder = soundIndex > 0 ? process.argv[soundIndex + 1] : undefined;
// A throwaway settings file, so checks never read or change the owner's real speech settings.
const speechFile = join(await mkdtemp(join(tmpdir(), "picard-browser-")), "speech.json");
const app = await startApp({ client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"), speech, soundFolder, speechFile, readWikipedia: wikipediaFixture });
console.log(app.url);
process.once("SIGTERM", () => { void app.close().then(() => fixture.close()); });
process.once("SIGINT", () => { void app.close().then(() => fixture.close()); });
