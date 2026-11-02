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
const phrases = process.argv.includes("--interrupt") ? ["Computer, hello there", "Computer", "Keep the exact name and do not change files.", ""]
  : process.argv.includes("--interrupt-request") || process.argv.includes("--interrupt-final") ? ["Computer, hello there", "Computer, keep the exact name and do not change files.", ""]
  : process.argv.includes("--interrupt-room") ? ["Computer, hello there", "Hello again", ""]
  : process.argv.includes("--interrupt-approval") ? ["Computer, request an approval", "Computer, allow once", ""]
  : process.argv.includes("--briefing-parent-failure") ? ["Computer, have Data and Riker brief me when the computer's action is denied with a repeated close", ""]
  : process.argv.includes("--briefing-failure-only") ? ["Computer, have Data and Riker brief me when Data's action is denied but no computer close", ""]
  : process.argv.includes("--briefing-failure-copy") ? ["Computer, have Data and Riker brief me when Data's action is denied with a repeated close", ""]
  : process.argv.includes("--briefing-copy") ? ["Computer, have Data and Riker brief me with a repeated close", ""]
  : process.argv.includes("--briefing-filename") ? ["Computer, have Data and Riker brief me about changing retry_policy.ts", ""]
  : process.argv.includes("--briefing-late-failure") ? ["Computer, have Data and Riker brief me when Data's action is denied after a successful step", ""]
  : process.argv.includes("--briefing-repeat") ? ["Computer, have Data and Riker brief me when Data's action is denied but a second succeeds", ""]
  : process.argv.includes("--briefing-failure") ? ["Computer, have Data and Riker brief me when Data's action is denied", ""]
  : process.argv.includes("--briefing-recovered") ? ["Computer, have Data and Riker brief me after a recovered action", ""]
  : process.argv.includes("--briefing") ? ["Computer, have Data and Riker brief me on the next step", ""]
  : process.argv.includes("--crew") ? ["Computer, have Data and Geordi look at the repair", ""]
  : process.argv.includes("--officer") ? ["Computer, I wanted to have an answer from Data", ""]
  : process.argv.includes("--news") ? ["Computer, get the news from Data", ""]
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
  : process.argv.includes("--showcase") ? ["Computer, Mr. Data, why do the shields read full when they are failing?", "Computer, Number One, fix it now or after we reach Starbase 74?", ""]
  : process.argv.includes("--example") ? ["Computer, why is the settings test failing?", ""]
  : process.argv.includes("--broken") ? ["Computer, the model is broken", ""]
  : process.argv.includes("--missing-outcome") ? ["Computer, show a reply without an ending", ""]
  : ["Computer, hello there", "Hello again", ""];
const speech = process.argv.includes("--speech") ? speechFixture(phrases,
  process.argv.some((arg) => arg.startsWith("--interrupt")) ? 20 : 1, !process.argv.includes("--interrupt-final")).service : undefined;
const soundIndex = process.argv.indexOf("--sounds");
const soundFolder = soundIndex > 0 ? process.argv[soundIndex + 1] : undefined;
// A throwaway settings file, so checks never read or change the owner's real speech settings.
const speechFile = join(await mkdtemp(join(tmpdir(), "picard-browser-")), "speech.json");
const app = await startApp({ client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"), speech, soundFolder, speechFile, readWikipedia: wikipediaFixture });
console.log(app.url);
process.once("SIGTERM", () => { void app.close().then(() => fixture.close()); });
process.once("SIGINT", () => { void app.close().then(() => fixture.close()); });
