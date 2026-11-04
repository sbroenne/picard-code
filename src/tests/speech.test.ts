import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { setTimeout as wait } from "node:timers/promises";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Utterance, firstSentence, replyFailed, speakable, spokenReply, spokenSummary, type SpeechEvent } from "../shared/speech.js";
import { addressed, changedSpeed, interruptsSpeech, voiceCommand } from "../shared/wake.js";
import { canAskAloud, matchSpokenAnswer, spokenQuestion } from "../shared/questions.js";
import type { FormField, FormRequest } from "../shared/types.js";
import { speakingDocument } from "../server/azure-speech.js";
import { DEFAULT_MAI_VOICE, describeSpeechSettings, mergeSpeechSettings, needsListenerMigration, speechFromSettings, loadSpeech } from "../server/speech.js";
import { attachSpeech } from "../server/speech-bridge.js";
import { speechFixture } from "./speech-fixture.js";
import { SPEECH_FRAME, SpeechFrames, sileroDetector } from "../shared/speech-detector.js";
import { packets, steadyNoise, syntheticVoice } from "./test-audio.js";

test("an utterance starts with a short run of voice, ends after a real pause, and a click is dropped", () => {
  const detector = new Utterance();
  for (let index = 0; index < 100; index++) assert.equal(detector.update(0, 32), undefined);
  assert.equal(detector.update(0.9, 32), undefined);
  assert.equal(detector.update(0.1, 32), undefined, "A single voice-like frame is not speech.");
  assert.equal(detector.update(0.9, 32), undefined);
  assert.equal(detector.update(0.9, 32), "start");
  assert.equal(detector.update(0, 880), undefined);
  assert.equal(detector.update(0, 20), "drop", "Voice too short to be words is dropped.");
  assert.equal(detector.active, false);
  assert.equal(detector.update(0.9, 64), "start");
  assert.equal(detector.update(0.9, 200), undefined);
  assert.equal(detector.update(0, 200), "check");
  assert.equal(detector.finishCheck(detector.revision, false), false);
  assert.equal(detector.update(0, 200), undefined);
  assert.equal(detector.update(0.9, 100), undefined, "A short breath does not end the utterance.");
  assert.equal(detector.update(0, 199), undefined);
  assert.equal(detector.update(0, 1), "check");
  assert.equal(detector.finishCheck(detector.revision, true), true);
  assert.equal(detector.update(0, 1000), undefined);
  assert.equal(detector.update(0.9, 64), "start");
  for (let index = 0; index < 1872; index++) assert.equal(detector.update(0.9, 32), undefined);
  assert.equal(detector.update(0.9, 32), "end", "Endless speech is ended after a minute.");
});

test("a request needs a clear voice to start but continues through softer words", () => {
  const detector = new Utterance();
  for (let index = 0; index < 10; index++) assert.equal(detector.update(0.45, 32), undefined, "An uncertain sound does not open a request.");
  assert.equal(detector.update(0.6, 32), undefined);
  assert.equal(detector.update(0.6, 32), "start");
  for (let index = 0; index < 60; index++) assert.equal(detector.update(0.4, 32), undefined, "Softer words keep the request open.");
  assert.equal(detector.update(0.3, 199), undefined);
  assert.equal(detector.update(0.3, 1), "check");
  assert.equal(detector.finishCheck(detector.revision, true), true);
});

test("the voice detector cuts 20 ms microphone packets into 32 ms frames with the samples before each", () => {
  const frames = new SpeechFrames();
  const packet = (value: number) => { const view = new DataView(new ArrayBuffer(640)); for (let index = 0; index < 320; index++) view.setInt16(index * 2, value, true); return view.buffer; };
  assert.equal(frames.push(packet(16384)).length, 0);
  const [first] = frames.push(packet(-16384));
  assert.equal(first?.length, 576);
  assert.deepEqual([first![0], first![63], first![64], first![383], first![384], first![575]], [0, 0, 0.5, 0.5, -0.5, -0.5]);
  const [second] = frames.push(packet(8192)).concat(frames.push(packet(8192)));
  assert.deepEqual([second![0], second![63], second![64], second![191], second![192]], [-0.5, -0.5, -0.5, -0.5, 0.25], "Each frame begins with the last 64 samples of the one before.");
  frames.reset();
  assert.equal(frames.push(packet(0)).length, 0, "A reset starts a fresh frame.");
});

test("steady background noise after a quiet spell never opens a request, but a voice in that noise still does", async () => {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = 1;
  const detector = await sileroDetector(ort, await readFile(new URL("../../node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx", import.meta.url)));
  const listen = async (audio: Float32Array) => {
    const frames = new SpeechFrames();
    const utterance = new Utterance();
    const changes: string[] = [];
    detector.reset();
    for (const piece of packets(audio)) for (const frame of frames.push(piece)) {
      const change = utterance.update(await detector.speech(frame), SPEECH_FRAME / 16);
      if (change === "check") {
        // This check isolates Silero's noise rejection, not completion-model accuracy.
        if (utterance.finishCheck(utterance.revision, true)) changes.push("end");
      } else if (change) changes.push(change);
    }
    return { changes, open: utterance.active };
  };
  for (const kind of ["white", "pink", "brown"] as const) {
    // The room was nearly silent, then a fan or air conditioning starts just above the old 0.002 cutoff.
    const noisy = await listen(Float32Array.from([...steadyNoise("white", 5, 0.0003), ...steadyNoise(kind, 70, 0.003, 7)]));
    assert.deepEqual(noisy, { changes: [], open: false }, `${kind} noise must not be taken for a request.`);
    const voice = syntheticVoice(2.5, 0.05);
    const room = steadyNoise(kind, 6, 0.003, 11);
    for (let index = 0; index < voice.length; index++) room[16000 + index]! += voice[index]!;
    assert.deepEqual(await listen(room), { changes: ["start", "end"], open: false }, `A voice over ${kind} noise is still heard and ends after its pause.`);
  }
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
  for (const words of ["stop", "Stop.", "Cancel that, please.", "belay that", "Belay that.", "belay", "Delay that.", "Never mind", "abort", "stop work"]) assert.equal(voiceCommand(words), "stop", words);
  for (const words of ["stop the server from crashing", "don't stop", "cancel the subscription code", "", "explain the stop button", "delay the release until Friday", "delay"]) assert.equal(voiceCommand(words), undefined, words);
  for (const words of ["New log entry.", "Begin a new log entry", "New starlog entry.", "Start a new star log entry, please", "New task.", "start over", "Start a new conversation, please", "clear"]) assert.equal(voiceCommand(words), "new", words);
  for (const words of ["Stop listening.", "stand by", "go to sleep, please", "That will be all."]) assert.equal(voiceCommand(words), "standby", words);
  for (const words of ["mute", "Microphone off."]) assert.equal(voiceCommand(words), "mute", words);
  for (const words of ["add a new task to the list", "write a new log entry function", "stop listening to the socket", "mute the test output", "clear the cache", "start over the build"]) assert.equal(voiceCommand(words), undefined, words);
});

test("interruptions need Computer and reject words repeated from the spoken answer", () => {
  assert.equal(interruptsSpeech("Computer", "The result is on screen."), true);
  assert.equal(interruptsSpeech("Computer, do not change src/main.ts.", "The result is on screen."), true);
  assert.equal(interruptsSpeech("Hello again", "The result is on screen."), false);
  assert.equal(interruptsSpeech("Computer", "Say Computer to continue."), false);
  assert.equal(interruptsSpeech("Computer, stop!", "You can say “Computer, stop” to cancel work."), false);
  assert.equal(interruptsSpeech("", "The result is on screen."), false);
  // Misheard echo of the reply has no "Computer", so it never interrupts.
  assert.equal(interruptsSpeech("Bogbook called How to Solve", "I bought a book called “How to Solve Half Your Problems.”"), false);
});

test("listening can run during speech and stopping playback preserves the captured request", async (t) => {
  let speechSignal: AbortSignal | undefined;
  const fixture = speechFixture("Computer, do not change files.");
  const service = {
    ...fixture.service,
    async *speak(_text: string, signal: AbortSignal) {
      speechSignal = signal;
      yield Buffer.alloc(4800);
      await wait(60_000, undefined, { signal });
    },
  };
  const server = createServer();
  const closeSpeech = attachSpeech(server, service, () => true);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/speech`);
  t.after(async () => { socket.terminate(); closeSpeech(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const events: SpeechEvent[] = [];
  socket.on("message", (data, binary) => { if (!binary) events.push(JSON.parse(data.toString())); });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const next = async (type: SpeechEvent["type"], phase?: string) => {
    const deadline = AbortSignal.timeout(3000);
    while (true) {
      const index = events.findIndex((event) => event.type === type && (!phase || event.type === "state" && event.phase === phase));
      if (index >= 0) return events.splice(index, 1)[0]!;
      await wait(5, undefined, { signal: deadline });
    }
  };
  socket.send(JSON.stringify({ type: "speak", text: "The answer is still playing.", id: 1 }));
  await next("audio-start");
  socket.send(JSON.stringify({ type: "listen", id: 1 }));
  await next("state", "listening");
  assert.equal(speechSignal?.aborted, false, "Opening listening must not stop speech.");
  socket.send(Buffer.alloc(640));
  await next("partial");
  socket.send(JSON.stringify({ type: "stop-speaking" }));
  await next("state", "off");
  assert.equal(speechSignal?.aborted, true);
  socket.send(Buffer.alloc(640));
  socket.send(JSON.stringify({ type: "commit" }));
  const transcript = await next("transcript");
  assert.equal(transcript.type === "transcript" && transcript.text, "Computer, do not change files.");
  assert.equal(fixture.audioWrites, 2, "Stopping playback must not lose the rest of the utterance.");
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

test("spoken answers include every conversational paragraph without reading code or making up success", () => {
  assert.equal(spokenSummary("I could not complete that change.\n\n```js\nconst x = 1;\n```"), "I could not complete that change.");
  assert.equal(spokenSummary("**Two problems** remain. Read [the details](https://example.com).\n\nThe second paragraph explains why."),
    "Two problems remain. Read the details. The second paragraph explains why.");
  assert.equal(spokenSummary("```js\nconst x = 1;\n```"), "The result is on screen.");
  assert.equal(spokenSummary("A long but complete explanation. ".repeat(100)), "A long but complete explanation. ".repeat(100).trim());
  assert.equal(spokenSummary("## The question\n\nA complete explanation.\n\n## The answer\n\nThe conclusion matters."),
    "The question. A complete explanation. The answer. The conclusion matters.");
});

test("technical appendices, tables and code stay on screen without dropping later conversational prose", () => {
  const prose = "The change is not safe.\n\nThere is a second risk. Do not deploy it.\n\nWhat should we check first?";
  for (const heading of ["On screen", "**On screen**", "_On screen_", "[On screen](https://example.com)", "On **screen**"]) {
    assert.equal(spokenSummary(`${prose}\n\n### ${heading}\n\nTechnical details and [sources](https://example.com).\n\n\`\`\`ts\nconst unsafe = true;\n\`\`\``),
      "The change is not safe. There is a second risk. Do not deploy it. What should we check first?", heading);
  }
  assert.equal(spokenSummary("First paragraph.\n\n~~~md\n### On screen\n~~~\n\n| Setting | Value |\n| --- | --- |\n| token | secret |\n\nLast paragraph."),
    "First paragraph. Last paragraph.");
  assert.equal(spokenSummary("First.\n\n    const x = 1;\n\nLast."), "First. Last.");
  assert.equal(spokenSummary("First.\n\n```ts\nconst unfinished = true;"), "First.");
});

test("a reply that opens with a list is spoken completely, not cut off at the colon", () => {
  const written = "The missing required release settings are:\n\n- `SERVICE_URL`: the address of the service\n- `RELEASE_TOKEN` — used for signing\n- `BUILD_NUMBER`\n\n### On screen\n\nSet them in `config/release.json`.";
  assert.equal(spokenSummary(written), "The missing required release settings are: service URL: the address of the service. release token — used for signing. build number.");
  assert.equal(spokenSummary("Here is the fix:\n\n```ts\nconst x = 1;\n```"), "Here is the fix. The details are on screen.");
  assert.equal(spokenSummary("1. First step\n2. Second step"), "First step. Second step.");
  const many = `Changed files:\n${Array.from({ length: 7 }, (_value, index) => `- file${index}`).join("\n")}`;
  assert.equal(spokenSummary(many), "Changed files: file0. file1. file2. file3. file4. file5. file6.");
});

test("technical names are spoken understandably while the written text keeps exact names", () => {
  const written = "The token in `fixtures/session.json` expired on 2025-01-01T00:00:00Z. See `src/app.ts:3-5` and `spokenSummary`.";
  assert.equal(spokenSummary(written),
    "The token in fixtures slash session dot json expired on January 1, 2025 at midnight UTC. See src slash app dot ts, lines 3 to 5 and spoken summary.");
  assert.equal(speakable("Read README.md and package.json at https://example.com/a/b."), "Read README dot md and package dot json at the link on screen.");
  assert.equal(speakable("Set API_KEY and MAX_RETRY_COUNT on 2026-03-09 14:05."), "Set API key and max retry count on March 9, 2026 at 14:05.");
  assert.equal(spokenSummary("Review _example.ts_ and retry_policy.ts."), "Review example dot ts and retry policy dot ts.");
  assert.equal(speakable("Use one and/or the other, version 1.2.3, e.g. this."), "Use one and/or the other, version 1.2.3, e.g. this.");
  assert.equal(spokenSummary("`src/config.ts` sets `MAX_RETRIES` to `3`."), "src slash config dot ts sets max retries to 3.");
});

test("a finished reply is described truthfully even when it has no text", () => {
  assert.equal(spokenReply({ parts: [{ type: "text", text: "Analysis complete." }] }), "Analysis complete.");
  assert.equal(firstSentence("Mr. Data's finding holds. I recommend the fix."), "Mr. Data's finding holds.");
  assert.equal(firstSentence("Dr. Crusher, e.g. the logs, agree. More follows."), "Dr. Crusher, e.g. the logs, agree.");
  assert.equal(firstSentence("Version 2.1 is stable! Next."), "Version 2.1 is stable!");
  assert.equal(firstSentence("No ending"), "No ending");
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
  const question = { key: "q0", type: "string" as const, title: "Direction", description: "Which approach should I use?", options: [{ value: "small", label: "Small change" }, { value: "explain", label: "Explain first" }], custom: true };
  const closed = { ...question, custom: false };
  const form = (...fields: FormField[]): FormRequest => ({ id: "frm", sessionID: "ses", title: "Questions", fields });
  assert.equal(spokenQuestion(form(question)), "Which approach should I use? The options are Small change or Explain first. You may also give a different answer.");
  assert.equal(spokenQuestion(form(closed)), "Which approach should I use? The options are Small change or Explain first.");
  assert.equal(spokenQuestion(form({ key: "name", type: "string", title: "Branch name" })), "Branch name");
  assert.deepEqual(matchSpokenAnswer(question, "Explain first."), { answer: "explain" }, "the offered value is sent, not the label");
  assert.deepEqual(matchSpokenAnswer(question, "the second one"), { answer: "explain" });
  assert.deepEqual(matchSpokenAnswer(question, "Option 1"), { answer: "small" });
  assert.deepEqual(matchSpokenAnswer(question, "Let's go with the small change please"), { answer: "small" });
  assert.deepEqual(matchSpokenAnswer(question, "Not the small change."), { answer: "Not the small change." }, "A negated reply must never become that choice.");
  assert.deepEqual(matchSpokenAnswer(closed, "Not the small change."), { retry: "Please choose Small change or Explain first." });
  assert.deepEqual(matchSpokenAnswer(closed, "small change or explain first"), { retry: "Please choose Small change or Explain first." });
  assert.deepEqual(matchSpokenAnswer(closed, "Something else entirely"), { retry: "Please choose Small change or Explain first." });
  const skip = matchSpokenAnswer(question, "Skip");
  assert.match("retry" in skip ? skip.retry : "", /Skip question on screen/);
  const negativeLabel = { ...closed, options: [{ value: "keep", label: "Do not change files" }, { value: "change", label: "Change files" }] };
  assert.deepEqual(matchSpokenAnswer(negativeLabel, "do not change files"), { answer: "keep" });
  const proceed = { ...closed, options: [{ value: "y", label: "Yes, apply the fix" }, { value: "n", label: "No" }] };
  for (const words of ["Make it so.", "Make it so, Number One.", "Engage!", "make it so, Mr. La Forge"]) assert.deepEqual(matchSpokenAnswer(proceed, words), { answer: "y" }, words);
  assert.deepEqual(matchSpokenAnswer(closed, "Make it so."), { retry: "Please choose Small change or Explain first." }, "with no plain yes on offer, the order to proceed chooses nothing");
  assert.deepEqual(matchSpokenAnswer({ ...proceed, options: [...proceed.options, { value: "both", label: "Yes, and add a test" }] }, "Make it so."), { retry: "Please choose Yes, apply the fix, No, or Yes, and add a test." });
  assert.deepEqual(matchSpokenAnswer(proceed, "Don't make it so."), { retry: "Please choose Yes, apply the fix or No." });
  assert.equal(canAskAloud(form(question)), true);
  assert.equal(canAskAloud(form({ key: "many", type: "multiselect", options: question.options })), false);
  assert.equal(canAskAloud(form(question, { ...question, key: "q1" })), false);
  assert.equal(canAskAloud(form({ ...question, when: [{ key: "x", op: "eq", value: "y" }] } as FormField)), false);
  assert.equal(canAskAloud(form(question, { ...question, key: "q1", hidden: true })), true);
});

test("Nemotron is the default and retired Whisper settings describe their replacement without rewriting", async () => {
  assert.equal(describeSpeechSettings(undefined).listening, "nemotron");
  assert.equal(describeSpeechSettings({ listening: "whisper" }).listening, "nemotron");
  assert.equal(describeSpeechSettings({ listening: "mai" }).listening, "mai");
  const legacy = { listening: "whisper", whisperModel: "/custom/model", localPython: "/custom/python" };
  assert.deepEqual(mergeSpeechSettings(legacy, { listening: "nemotron", speaking: "kokoro" }), { listening: "nemotron", speaking: "kokoro", localPython: "/custom/python" });
  assert.equal(legacy.listening, "whisper");
  assert.throws(() => mergeSpeechSettings(undefined, { listening: "whisper", speaking: "mai" }), /Choose Nemotron or Azure MAI/);
  assert.throws(() => mergeSpeechSettings(undefined, { listening: "unknown", speaking: "kokoro" }), /Choose Nemotron or Azure MAI/);
  const missing = { localPython: "picard-missing-python" };
  await assert.rejects(speechFromSettings(missing), /local pause detector is not prepared/);
  await assert.rejects(speechFromSettings({ listening: "nemotron", speaking: "mai" }), /valid subscription/);
  await assert.rejects(speechFromSettings({ listening: "other", speaking: "kokoro" }), /never substituted silently/);
  await assert.rejects(speechFromSettings({ ...missing, listening: "mai", speaking: "mai" }), /valid subscription/);
});

test("MAI computer speaking uses Iris with its neutral style", () => {
  assert.equal(DEFAULT_MAI_VOICE, "en-US-Iris:MAI-Voice-2.1-Flash");
  const document = speakingDocument({ voice: DEFAULT_MAI_VOICE, voiceStyle: "neutral" }, "Ready & <waiting>.");
  assert.match(document, /xml:lang="en-US"><voice name="en-US-Iris:MAI-Voice-2\.1-Flash"><mstts:express-as style="neutral">Ready &amp; &lt;waiting&gt;\.<\/mstts:express-as>/);
  assert.doesNotMatch(speakingDocument({ voice: "en-US-Harper:MAI-Voice-2.1-Flash", voiceStyle: "none" }, "Ready."), /express-as/);
});

test("Azure speaking speed wraps the words in a rate change, and normal speed adds nothing", () => {
  const settings = { voice: DEFAULT_MAI_VOICE, voiceStyle: "neutral" };
  assert.match(speakingDocument(settings, "Ready.", 1.1), /<prosody rate="\+10%"><mstts:express-as style="neutral">Ready\.<\/mstts:express-as><\/prosody>/);
  assert.match(speakingDocument(settings, "Ready.", 0.8), /<prosody rate="-20%">/);
  assert.doesNotMatch(speakingDocument(settings, "Ready.", 1), /prosody/);
  assert.doesNotMatch(speakingDocument(settings, "Ready."), /prosody/);
});

test("speaking speed commands are whole short sentences and step within the supported range", () => {
  assert.equal(voiceCommand("Speak faster."), "faster");
  assert.equal(voiceCommand("Slow down, please."), "slower");
  assert.equal(voiceCommand("Normal speed"), "normal-speed");
  assert.equal(voiceCommand("Make the build faster"), undefined);
  assert.equal(voiceCommand("Slow down the animation"), undefined);
  assert.equal(changedSpeed(1, "faster"), 1.1);
  assert.equal(changedSpeed(1.1, "slower"), 1);
  assert.equal(changedSpeed(1.2, "faster"), undefined);
  assert.equal(changedSpeed(0.8, "slower"), undefined);
  assert.equal(changedSpeed(0.8, "normal-speed"), 1);
  assert.equal(voiceCommand("Speak slowest."), "slowest");
  assert.equal(voiceCommand("Fastest speed"), "fastest");
  assert.equal(changedSpeed(1.1, "slowest"), 0.8);
  assert.equal(changedSpeed(0.9, "fastest"), 1.2);
  assert.equal(changedSpeed(0.8, "slowest"), undefined);
});

test("loading retired Whisper defers replacement to the app without rewriting or starting it", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-retired-speech-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, "speech.json");
  const text = JSON.stringify({ listening: "whisper", speaking: "kokoro" });
  await writeFile(file, text);
  assert.equal(await loadSpeech({}, undefined, file), undefined);
  assert.equal(await loadSpeech({ speaking: "mai" }, undefined, file), undefined);
  await assert.rejects(loadSpeech({ speaking: "invalid" }, undefined, file), /Choose mai or kokoro/);
  await assert.rejects(loadSpeech({ listening: "whisper" }, undefined, file), /Choose nemotron or mai/);
  assert.equal(await readFile(file, "utf8"), text);
});

test("older settings without a listening choice used Whisper and are upgraded like Whisper", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-unlabelled-speech-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, "speech.json");
  const text = JSON.stringify({ speaking: "mai", region: "swedencentral" });
  await writeFile(file, text);
  assert.equal(needsListenerMigration({ speaking: "kokoro" }), true);
  assert.equal(needsListenerMigration({ listening: "whisper" }), true);
  assert.equal(needsListenerMigration({ listening: "nemotron" }), false);
  assert.equal(needsListenerMigration({ listening: "mai" }), false);
  assert.equal(needsListenerMigration(undefined), false);
  assert.equal(await loadSpeech({}, undefined, file), undefined);
  assert.equal(await loadSpeech({ speaking: "kokoro" }, undefined, file), undefined);
  assert.equal(await readFile(file, "utf8"), text);
});

test("retired voice settings are not exposed and are removed only when services are saved", () => {
  const legacy = { voice: "old", voiceStyle: "old", kokoroVoice: "old", localPython: "/custom/python" };
  const choice = { listening: "nemotron", speaking: "kokoro" };
  const described = describeSpeechSettings(legacy);
  for (const key of ["voice", "voiceStyle", "kokoroVoice"]) {
    assert.equal(key in described, false);
    assert.throws(() => mergeSpeechSettings(legacy, { ...choice, [key]: "custom" }), /voices are fixed/);
  }
  assert.deepEqual(mergeSpeechSettings(legacy, choice), { ...choice, localPython: "/custom/python" });
  assert.equal(legacy.voice, "old", "Reading and merging must not rewrite the original record.");
});

test("voice transport rejects other websites, requires a listening request, and stops speaking without starting work", async (t) => {
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
  assert.equal(fixture.audioWrites, 1, "Audio is ignored without an open listening request.");
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
