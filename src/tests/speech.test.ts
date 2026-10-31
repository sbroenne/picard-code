import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { setTimeout as wait } from "node:timers/promises";
import { EndOfSpeech, spokenSummary, type SpeechEvent } from "../shared/speech.js";
import { attachSpeech } from "../server/speech-bridge.js";
import { speechFixture } from "./speech-fixture.js";

test("end of speech needs voice followed by a real pause, not silence or a click", () => {
  const detector = new EndOfSpeech();
  for (let index = 0; index < 100; index++) assert.equal(detector.update(0, 20), false);
  assert.equal(detector.update(0.1, 20), false);
  assert.equal(detector.update(0, 1000), false);
  detector.reset();
  assert.equal(detector.update(0.02, 120), false);
  assert.equal(detector.update(0, 880), false);
  assert.equal(detector.update(0, 20), true);
  assert.equal(detector.update(0, 1000), false);
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
  assert.ok(spokenSummary("A very long explanation. ".repeat(100)).length <= 700);
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
  socket.send(JSON.stringify({ type: "listen" }));
  await next("state", "listening");
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
