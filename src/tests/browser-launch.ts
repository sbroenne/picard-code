import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFixture, wikipediaFixture } from "./fixture.js";
import { startApp } from "../server/app.js";
import { makeClient } from "../server/engine.js";
import { projectDirectory } from "../server/process.js";
import { speechFixture } from "./speech-fixture.js";
import { saveModelSettings } from "../server/model-settings.js";

const project = await projectDirectory(process.cwd());
const fixture = await startFixture(project);
if (process.argv.includes("--free-models")) {
  fixture.setModels([{ id: "free-model", providerID: "opencode", name: "Free test model", enabled: true }]);
  fixture.setProviders([{ id: "opencode", name: "OpenCode", integrationID: "opencode" }]);
}
if (process.argv.includes("--no-models")) fixture.setModels([]);
if (process.argv.includes("--no-providers")) fixture.setProviders([]);
if (process.argv.includes("--provider-error")) fixture.setProviderError("Test provider lookup failed.");
if (process.argv.includes("--opencode-account")) fixture.setIntegrations([{ id: "opencode", connections: [{ type: "credential" }] }]);
// Each utterance hears the next phrase; the last one repeats. Within a task everything said is sent,
// so most end in silence ("").
const phrases = process.argv.includes("--interrupt") ? ["Computer, hello there", "Computer", "Keep the exact name and do not change files.", ""]
  : process.argv.includes("--interrupt-request") || process.argv.includes("--interrupt-final") ? ["Computer, hello there", "Computer, keep the exact name and do not change files.", ""]
  : process.argv.includes("--interrupt-room") ? ["Computer, hello there", "Hello again", ""]
  : process.argv.includes("--speed-follow-up") ? ["Computer, hello there", "Computer, speak slowest", "Hello again", ""]
  : process.argv.includes("--faster") ? ["Computer, speak faster", "Computer, hello there", ""]
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
  : process.argv.includes("--resume") ? ["Computer, hello there", "Computer, hello again", ""]
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
  : process.argv.includes("--fresh-starlog") ? ["Computer, hello there", "New starlog entry", "Is anyone there"]
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
const settingsFolder = await mkdtemp(join(tmpdir(), "picard-browser-"));
const speechFile = join(settingsFolder, "speech.json");
const modelFileIndex = process.argv.indexOf("--model-file");
const modelFile = modelFileIndex > 0 ? process.argv[modelFileIndex + 1]! : join(settingsFolder, "model.json");
if (!process.argv.includes("--model-setup") || process.argv.includes("--model-unavailable")) {
  await saveModelSettings(modelFile, { providerID: "github-copilot", modelID: process.argv.includes("--model-unavailable") ? "missing-model" : "fixture-model" });
}
const settingsStandIn = process.argv.includes("--speech-settings");
let turnChecks = 0;
const smartTurn = process.argv.some((arg) => /^--smart-turn(?:-late|-error)?$/.test(arg));
if (smartTurn && speech) speech.turnDetector = {
    async complete(_audio, signal) {
      const first = ++turnChecks === 1;
      if (process.argv.includes("--smart-turn-error")) throw new Error("Test-only pause checker failure.");
      if (first && process.argv.includes("--smart-turn-late")) {
        await new Promise<void>((done) => setTimeout(done, 2000));
        return true;
      }
      signal.throwIfAborted();
      return !first;
    },
    async close() {},
  };
const app = await startApp({ client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"), speech, soundFolder, speechFile, modelFile, readWikipedia: wikipediaFixture,
  localSpeechReady: settingsStandIn ? async () => true : undefined,
  startSpeech: settingsStandIn ? async (settings) => {
    if (settings.region === "broken") throw new Error("Test speech service could not start.");
    return { ...speechFixture([""]).service, selection: {
      listening: settings.listening === "mai" ? "mai" : "nemotron",
      speaking: settings.speaking === "mai" ? "mai" : "kokoro",
    } };
  } : undefined,
});
console.log(app.url);
const close = () => { void app.close().then(() => fixture.close()).then(() => rm(settingsFolder, { recursive: true })); };
process.once("SIGTERM", close);
process.once("SIGINT", close);
