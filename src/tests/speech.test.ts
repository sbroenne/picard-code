import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { setTimeout as wait } from "node:timers/promises";
import { Utterance, replyFailed, speakable, spokenReply, spokenSummary, type SpeechEvent } from "../shared/speech.js";
import { addressed, voiceCommand } from "../shared/wake.js";
import { canAskAloud, matchSpokenAnswer, spokenQuestion } from "../shared/questions.js";
import { speakingDocument } from "../server/azure-speech.js";
import { DEFAULT_MAI_VOICE } from "../server/speech.js";
import { attachSpeech } from "../server/speech-bridge.js";
import { speechFixture } from "./speech-fixture.js";

test("an utterance starts with a short run of voice, ends after a real pause, and a click is dropped", () => {
  const detector = new Utterance();
  for (let index = 0; index < 100; index++) assert.equal(detector.update(0, 20), undefined);
  assert.equal(detector.update(0.1, 20), undefined);
  assert.equal(detector.update(0, 20), undefined, "A single loud frame is not speech.");
  assert.equal(detector.update(0.1, 20), undefined);
  assert.equal(detector.update(0.1, 20), undefined);
  assert.equal(detector.update(0.1, 20), "start");
  assert.equal(detector.update(0, 880), undefined);
  assert.equal(detector.update(0, 20), "drop", "Voice too short to be words is dropped.");
  assert.equal(detector.active, false);
  assert.equal(detector.update(0.02, 60), "start");
  assert.equal(detector.update(0.02, 200), undefined);
  assert.equal(detector.update(0, 400), undefined);
  assert.equal(detector.update(0.02, 100), undefined, "A short breath does not end the utterance.");
  assert.equal(detector.update(0, 899), undefined);
  assert.equal(detector.update(0, 1), "end");
  assert.equal(detector.update(0, 1000), undefined);
  assert.equal(detector.update(0.02, 60), "start");
  for (let index = 0; index < 2996; index++) assert.equal(detector.update(0.02, 20), undefined);
  assert.equal(detector.update(0.02, 20), "end", "Endless sound is ended after a minute.");
});

test("only speech that starts with Computer is addressed; stop commands are whole short phrases", () => {
  assert.equal(addressed("Computer, explain this project."), "explain this project.");
  assert.equal(addressed("computer what files are here"), "what files are here");
  assert.equal(addressed("Okay, computer. Run the tests"), "Run the tests");
  assert.equal(addressed("Computer."), "");
  assert.equal(addressed("Computer — stop!"), "stop!");
  assert.equal(addressed("Is the computer on?"), undefined);
  assert.equal(addressed("Computers are fast."), undefined);
  assert.equal(addressed("Computer's fan is loud."), undefined);
  assert.equal(addressed("Hello computer"), undefined);
  for (const words of ["stop", "Stop.", "Cancel that, please.", "belay that", "Never mind", "abort", "stop work"]) assert.equal(voiceCommand(words), "stop", words);
  for (const words of ["stop the server from crashing", "don't stop", "cancel the subscription code", "", "explain the stop button"]) assert.equal(voiceCommand(words), undefined, words);
  for (const words of ["New task.", "start over", "Start a new conversation, please", "clear"]) assert.equal(voiceCommand(words), "new", words);
  for (const words of ["Stop listening.", "mute", "go to sleep, please", "microphone off"]) assert.equal(voiceCommand(words), "sleep", words);
  for (const words of ["add a new task to the list", "stop listening to the socket", "mute the test output", "clear the cache", "start over the build"]) assert.equal(voiceCommand(words), undefined, words);
});

test("microphone off preserves pending speech; stopped speech cannot send late audio into a new reply", async (t) => {
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  const service = {
    ...speechFixture().service,
    async *speak(_text: string, signal: AbortSignal) {
      signals.push(signal);
      await new Promise<void>((resolve) => releases.push(resolve));
      // Native inference can finish after cancellation; the bridge must discard it.
      yield Buffer.alloc(4800);
    },
  };
  const server = createServer((_request, response) => response.end());
  let origin = "";
  const closeSpeech = attachSpeech(server, service, (request) => request.headers.origin === origin);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { closeSpeech(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/speech`, { headers: { Origin: origin } });
  const events: SpeechEvent[] = [];
  let audioBytes = 0;
  socket.on("message", (data, binary) => {
    if (binary) audioBytes += Buffer.isBuffer(data) ? data.length
      : Array.isArray(data) ? data.reduce((size, chunk) => size + chunk.length, 0) : data.byteLength;
    else events.push(JSON.parse(data.toString()));
  });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  t.after(() => { releases.forEach((release) => release()); socket.terminate(); });
  const next = async (type: SpeechEvent["type"], phase?: string) => {
    const deadline = AbortSignal.timeout(3000);
    while (true) {
      const index = events.findIndex((event) => event.type === type && (!phase || event.type === "state" && event.phase === phase));
      if (index >= 0) return events.splice(index, 1)[0]!;
      await wait(5, undefined, { signal: deadline });
    }
  };
  socket.send(JSON.stringify({ type: "speak", text: "First answer.", id: 1 }));
  await next("state", "thinking");
  socket.send(JSON.stringify({ type: "pause" }));
  await wait(20);
  assert.equal(signals[0]?.aborted, false, "Microphone off must not cancel preparation of a spoken answer.");
  releases[0]!();
  const first = await next("audio-start");
  assert.equal(first.type === "audio-start" && first.id, 1);
  await next("audio-end");
  assert.equal(audioBytes, 4800);

  socket.send(JSON.stringify({ type: "speak", text: "Cancelled answer.", id: 2 }));
  await next("state", "thinking");
  socket.send(JSON.stringify({ type: "stop-speaking" }));
  await next("state", "off");
  assert.equal(signals[1]?.aborted, true);
  socket.send(JSON.stringify({ type: "speak", text: "Fresh answer.", id: 3 }));
  await next("state", "thinking");
  releases[1]!();
  await wait(20);
  assert.equal(audioBytes, 4800, "Cancelled native audio must not enter the fresh reply.");
  assert.ok(!events.some((event) => event.type === "audio-start" && event.id === 2));
  releases[2]!();
  const fresh = await next("audio-start");
  assert.equal(fresh.type === "audio-start" && fresh.id, 3);
  await next("audio-end");
  assert.equal(audioBytes, 9600);
});

test("spoken answers preserve a concise first paragraph without reading code or making up success", () => {
  assert.equal(spokenSummary("I could not complete that change.\n\n```js\nconst x = 1;\n```"), "I could not complete that change.");
  assert.equal(spokenSummary("**Two problems** remain. Read [the details](https://example.com).\n\nLong details."), "Two problems remain. Read the details.");
  assert.equal(spokenSummary("```js\nconst x = 1;\n```"), "The result is on screen.");
  assert.ok(spokenSummary("A very long explanation. ".repeat(100)).length <= 420);
});

test("a reply that opens with a list is spoken completely, not cut off at the colon", () => {
  const written = "The missing required release settings are:\n\n- `SERVICE_URL`: the address of the service\n- `RELEASE_TOKEN` — used for signing\n- `BUILD_NUMBER`\n\nSet them in `config/release.json`.";
  assert.equal(spokenSummary(written), "The missing required release settings are: service URL, release token, and build number.");
  assert.equal(spokenSummary("Here is the fix:\n\n```ts\nconst x = 1;\n```"), "Here is the fix. The details are on screen.");
  assert.equal(spokenSummary("1. First step\n2. Second step"), "First step and Second step.");
  const many = `Changed files:\n${Array.from({ length: 7 }, (_value, index) => `- file${index}`).join("\n")}`;
  assert.equal(spokenSummary(many), "Changed files: file0, file1, file2, file3, file4, and 2 more on screen.");
});

test("technical names are spoken understandably while the written text keeps exact names", () => {
  const written = "The token in `fixtures/session.json` expired on 2025-01-01T00:00:00Z. See `src/app.ts:3-5` and `spokenSummary`.";
  assert.equal(spokenSummary(written),
    "The token in fixtures slash session dot json expired on January 1, 2025 at midnight UTC. See src slash app dot ts, lines 3 to 5 and spoken summary.");
  assert.equal(speakable("Read README.md and package.json at https://example.com/a/b."), "Read README dot md and package dot json at the link on screen.");
  assert.equal(speakable("Set API_KEY and MAX_RETRY_COUNT on 2026-03-09 14:05."), "Set API key and max retry count on March 9, 2026 at 14:05.");
  assert.equal(speakable("Use one and/or the other, version 1.2.3, e.g. this."), "Use one and/or the other, version 1.2.3, e.g. this.");
  assert.equal(spokenSummary("`src/config.ts` sets `MAX_RETRIES` to `3`."), "src slash config dot ts sets max retries to 3.");
});

test("a finished reply is described truthfully even when it has no text", () => {
  assert.equal(spokenReply({ parts: [{ type: "text", text: "Analysis complete." }] }), "Analysis complete.");
  assert.equal(spokenReply({ error: "Copilot is not connected.", parts: [] }), "Copilot is not connected.");
  assert.equal(spokenReply({ parts: [{ type: "tool", status: "error", text: "bash\nThe user rejected permission to use this specific tool call." }] }),
    "Request denied. The action was not carried out.");
  assert.equal(spokenReply({ parts: [{ type: "tool", status: "error", text: "bash\nCommand exited with code 1" }] }),
    "Unable to complete the request. The action failed. The details are on screen.");
  assert.equal(spokenReply({ parts: [] }), "The work finished without a written reply.");
});

test("only a final error or an unexplained failed action counts as a failed request", () => {
  const failedTool = { type: "tool", status: "error", text: "bash\nCommand exited with code 1" };
  assert.equal(replyFailed({ error: "Copilot is not connected.", parts: [] }), true);
  assert.equal(replyFailed({ parts: [failedTool] }), true);
  assert.equal(replyFailed({ parts: [failedTool, { type: "text", text: "The first attempt failed; the second worked." }] }), false);
  assert.equal(replyFailed({ parts: [{ type: "text", text: "Analysis complete." }] }), false);
  assert.equal(replyFailed({ parts: [] }), false);
});

test("spoken question answers match only clear, offered choices and keep the user's own words", () => {
  const question = { header: "Direction", question: "Which approach should I use?", options: [{ label: "Small change", description: "" }, { label: "Explain first", description: "" }] };
  const closed = { ...question, custom: false };
  assert.equal(spokenQuestion(question), "Which approach should I use? The options are Small change or Explain first. You may also give a different answer.");
  assert.equal(spokenQuestion(closed), "Which approach should I use? The options are Small change or Explain first.");
  assert.deepEqual(matchSpokenAnswer(question, "Explain first."), { answer: "Explain first" });
  assert.deepEqual(matchSpokenAnswer(question, "the second one"), { answer: "Explain first" });
  assert.deepEqual(matchSpokenAnswer(question, "Option 1"), { answer: "Small change" });
  assert.deepEqual(matchSpokenAnswer(question, "Let's go with the small change please"), { answer: "Small change" });
  assert.deepEqual(matchSpokenAnswer(question, "Not the small change."), { answer: "Not the small change." }, "A negated reply must never become that choice.");
  assert.deepEqual(matchSpokenAnswer(closed, "Not the small change."), { retry: "Please choose Small change or Explain first." });
  assert.deepEqual(matchSpokenAnswer(closed, "small change or explain first"), { retry: "Please choose Small change or Explain first." });
  assert.deepEqual(matchSpokenAnswer(closed, "Something else entirely"), { retry: "Please choose Small change or Explain first." });
  const skip = matchSpokenAnswer(question, "Skip");
  assert.match("retry" in skip ? skip.retry : "", /Skip question on screen/);
  const negativeLabel = { ...closed, options: [{ label: "Do not change files", description: "" }, { label: "Change files", description: "" }] };
  assert.deepEqual(matchSpokenAnswer(negativeLabel, "do not change files"), { answer: "Do not change files" });
  assert.equal(canAskAloud([question]), true);
  assert.equal(canAskAloud([{ ...question, multiple: true }]), false);
  assert.equal(canAskAloud([question, question]), false);
});

test("MAI speaking uses the British default voice with its neutral style unless configured otherwise", () => {
  assert.equal(DEFAULT_MAI_VOICE, "en-GB-Emily:MAI-Voice-2.1-Flash");
  const british = speakingDocument({ voice: DEFAULT_MAI_VOICE, voiceStyle: "neutral" }, "Ready & <waiting>.");
  assert.match(british, /xml:lang="en-GB"><voice name="en-GB-Emily:MAI-Voice-2\.1-Flash"><mstts:express-as style="neutral">Ready &amp; &lt;waiting&gt;\.<\/mstts:express-as>/);
  assert.doesNotMatch(speakingDocument({ voice: "en-US-Harper:MAI-Voice-2.1-Flash", voiceStyle: "none" }, "Ready."), /express-as/);
});

test("voice transport rejects other websites, pauses recognition during speech, and stops speaking without starting work", async (t) => {
  const fixture = speechFixture();
  const server = createServer((_request, response) => response.end());
  let origin = "";
  const closeSpeech = attachSpeech(server, fixture.service, (request) => request.headers.origin === origin && request.headers.cookie === "private=browser");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { closeSpeech(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const denied = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/speech`, { headers: { Origin: "https://unrelated.example", Cookie: "private=browser" } });
    socket.on("error", reject);
    socket.on("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode!); socket.terminate(); });
  });
  assert.equal(denied, 403);
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/speech`, { headers: { Origin: origin, Cookie: "private=browser" } });
  const queue: SpeechEvent[] = [];
  const waiters: (() => void)[] = [];
  socket.on("message", (data, binary) => {
    if (!binary) queue.push(JSON.parse(data.toString()));
    waiters.splice(0).forEach((wake) => wake());
  });
  const next = async (type: SpeechEvent["type"], phase?: string) => {
    const deadline = AbortSignal.timeout(3000);
    while (true) {
      const index = queue.findIndex((event) => event.type === type && (!phase || event.type === "state" && event.phase === phase));
      if (index >= 0) return queue.splice(index, 1)[0]!;
      await new Promise<void>((resolve, reject) => {
        const done = () => { deadline.removeEventListener("abort", timeout); resolve(); };
        const timeout = () => reject(new Error("The expected voice event did not arrive."));
        waiters.push(done);
        deadline.addEventListener("abort", timeout, { once: true });
      });
    }
  };
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  t.after(() => socket.terminate());
  socket.send(JSON.stringify({ type: "listen", id: 7 }));
  const opened = await next("state", "listening");
  assert.equal(opened.type === "state" && opened.id, 7, "The open listening state names the request it belongs to.");
  socket.send(Buffer.alloc(640));
  socket.send(JSON.stringify({ type: "commit" }));
  const transcript = await next("transcript");
  assert.equal(transcript.type === "transcript" && transcript.text, "Hello computer");
  assert.equal(fixture.audioWrites, 1);
  socket.send(JSON.stringify({ type: "speak", text: "The written result is available.", id: 1 }));
  await next("state", "speaking");
  socket.send(Buffer.alloc(640));
  await next("audio-end");
  assert.equal(fixture.audioWrites, 1, "The computer's own audio cannot become a new request.");
  assert.ok(fixture.closes > 0);
  assert.equal(fixture.spoken, "The written result is available.");
  socket.send(JSON.stringify({ type: "stop-speaking" }));
  await next("state", "off");
  socket.send(JSON.stringify({ type: "listen" }));
  await next("state", "listening");
  socket.send(Buffer.alloc(3));
  const error = await next("error");
  assert.match(error.type === "error" ? error.message : "", /complete 16-bit/);
});
