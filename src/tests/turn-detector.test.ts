import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { WebSocket } from "ws";
import type { SpeechEvent } from "../shared/speech.js";
import { Utterance } from "../shared/utterance.js";
import { connectTurnDetector, type TurnDetector } from "../server/turn-detector.js";
import { attachSpeech } from "../server/speech-bridge.js";
import { speechFixture } from "./speech-fixture.js";

function speaking() {
  const utterance = new Utterance();
  assert.equal(utterance.update(0.9, 64), "start");
  assert.equal(utterance.update(0.9, 200), undefined);
  return utterance;
}

test("a short pause completes only after a real prediction", () => {
  const utterance = speaking();
  assert.equal(utterance.update(0, 199), undefined);
  assert.equal(utterance.update(0, 1), "check");
  assert.equal(utterance.active, true);
  assert.equal(utterance.update(0, 4000), undefined, "A stalled checker must not silently become a three-second auto-send.");
  assert.equal(utterance.finishCheck(utterance.revision, true), true);
  assert.equal(utterance.active, false);
});

test("unfinished thoughts can pause, resume softly, and finish without another long wait", () => {
  const utterance = speaking();
  assert.equal(utterance.update(0, 200), "check");
  assert.equal(utterance.finishCheck(utterance.revision, false), false);
  assert.equal(utterance.update(0, 1800), undefined);
  const old = utterance.revision;
  assert.equal(utterance.update(0.4, 200), undefined);
  assert.equal(utterance.finishCheck(old, true), false, "A late result cannot end resumed speech.");
  assert.equal(utterance.update(0, 200), "check");
  assert.equal(utterance.finishCheck(utterance.revision, true), true);
});

test("an incomplete prediction has a bounded wait; resets, short noises and the minute limit still hold", () => {
  const utterance = speaking();
  assert.equal(utterance.update(0, 200), "check");
  assert.equal(utterance.finishCheck(utterance.revision, false), false);
  assert.equal(utterance.update(0, 2799), undefined);
  assert.equal(utterance.update(0, 1), "end");
  const again = speaking();
  assert.equal(again.update(0, 200), "check");
  const revision = again.revision;
  again.reset();
  assert.equal(again.finishCheck(revision, true), false);
  const click = new Utterance();
  assert.equal(click.update(0.9, 64), "start");
  assert.equal(click.update(0, 900), "drop");
  const long = speaking();
  assert.equal(long.update(0.9, 59735), undefined);
  assert.equal(long.update(0.9, 1), "end");
});

async function worker(t: TestContext, startupDelay = 0) {
  const folder = await mkdtemp(resolve(".picard-test-turn-worker-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, "stand-in.mjs");
  await writeFile(path, `
import { createInterface } from "node:readline";
const send = (data) => console.log(JSON.stringify(data));
const pending = new Map();
let blocked = false;
setTimeout(() => send({type:"ready"}), Number(process.argv[2]));
createInterface({input:process.stdin}).on("line", (line) => {
  const data = JSON.parse(line);
  if (data.method === "cancel") { clearTimeout(pending.get(data.id)); pending.delete(data.id); return; }
  if (blocked) return;
  const first = Buffer.from(data.audio,"base64")[0];
  if (first === 3) { send({id:data.id,type:"done"}); return; }
  if (first === 8) { process.exit(1); return; }
  if (first === 9) { blocked = true; process.on("SIGTERM",()=>{}); return; }
  const finish = () => {
    send({id:data.id,type:"turn",probability:first===2?2:first===0?0.2:first===5?0.5:first===7?null:0.9});
    if (first === 6) send({id:data.id,type:"turn",probability:0.9});
    send({id:data.id,type:"done"});
  };
  if (first === 4) pending.set(data.id,setTimeout(finish,1000)); else finish();
});
`);
  const detector = await connectTurnDetector(process.execPath, [path, String(startupDelay)]);
  t.after(() => detector.close());
  return detector;
}

test("the local protocol validates completion scores and keeps cancellation separate from fresh checks", async (t) => {
  const detector = await worker(t);
  const signal = AbortSignal.timeout(5000);
  assert.equal(await detector.complete(Buffer.from([1, 0]), signal), true);
  assert.equal(await detector.complete(Buffer.from([0, 0]), signal), false);
  assert.equal(await detector.complete(Buffer.from([5, 0]), signal), false);
  await assert.rejects(detector.complete(Buffer.from([2, 0]), signal), /invalid completion score/);
  await assert.rejects(detector.complete(Buffer.from([3, 0]), signal), /no completion score/);
  await assert.rejects(detector.complete(Buffer.from([6, 0]), signal), /invalid completion score/);
  await assert.rejects(detector.complete(Buffer.from([7, 0]), signal), /invalid completion score/);
  await assert.rejects(detector.complete(Buffer.alloc(256002), signal), /eight seconds/);
  await assert.rejects(detector.complete(Buffer.alloc(1), signal), /complete audio/);
  const cancelled = new AbortController();
  const abandoned = detector.complete(Buffer.from([4, 0]), cancelled.signal);
  await wait(20);
  cancelled.abort();
  await assert.rejects(abandoned, /aborted|stopped/);
  assert.equal(await detector.complete(Buffer.from([1, 0]), signal), true);
});

test("the checker bounds pending work and skips a cancelled queued check", async (t) => {
  const detector = await worker(t);
  const stopped = new AbortController();
  const first = detector.complete(Buffer.from([4, 0]), AbortSignal.timeout(3000));
  const second = assert.rejects(detector.complete(Buffer.from([4, 0]), stopped.signal), /aborted|stopped/);
  await assert.rejects(detector.complete(Buffer.from([1, 0]), stopped.signal), /earlier check/);
  stopped.abort();
  await second;
  assert.equal(await first, true);
  assert.equal(await detector.complete(Buffer.from([1, 0]), AbortSignal.timeout(3000)), true);
});

test("a checker that never becomes ready can be stopped during startup", async () => {
  await assert.rejects(connectTurnDetector(process.execPath, ["-e", "setInterval(() => {}, 1000)"], AbortSignal.timeout(50)), /stopped/);
});

test("a missing or non-executable worker fails promptly rather than hanging during cleanup", { timeout: 5000 }, async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-turn-worker-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await assert.rejects(connectTurnDetector(join(folder, "missing"), []), /Could not start local speech/);
  const program = join(folder, "not-executable");
  await writeFile(program, "Test-only file, not a program.", { mode: 0o600 });
  await assert.rejects(connectTurnDetector(program, []), /Could not start local speech|Local speech stopped/);
});

test("a failed worker rejects that request and a fresh worker handles a later microphone attempt", async (t) => {
  const detector = await worker(t);
  await assert.rejects(detector.complete(Buffer.from([8, 0]), AbortSignal.timeout(5000)), /Local speech stopped/);
  assert.equal(await detector.complete(Buffer.from([1, 0]), AbortSignal.timeout(5000)), true);
  await detector.close();
  await assert.rejects(detector.complete(Buffer.from([1, 0]), AbortSignal.timeout(5000)), /stopped/);
});

test("cancelling during recovery does not close the worker needed by another check", { timeout: 5000 }, async (t) => {
  const detector = await worker(t, 200);
  await assert.rejects(detector.complete(Buffer.from([8, 0]), AbortSignal.timeout(3000)), /Local speech stopped/);
  const cancelled = new AbortController();
  const first = assert.rejects(detector.complete(Buffer.from([1, 0]), cancelled.signal), /aborted|stopped/);
  await wait(20);
  const next = detector.complete(Buffer.from([1, 0]), AbortSignal.timeout(3000));
  cancelled.abort();
  await first;
  assert.equal(await next, true);
});

test("microphone-off cannot leave stuck inference cached or discard another browser's queued check", { timeout: 15000 }, async (t) => {
  const detector = await worker(t);
  const cancelled = new AbortController();
  const first = assert.rejects(detector.complete(Buffer.from([9, 0]), cancelled.signal), /aborted|stopped/);
  await wait(20);
  const next = detector.complete(Buffer.from([1, 0]), AbortSignal.timeout(12000));
  cancelled.abort();
  await first;
  assert.equal(await next, true);
});

test("closing the checker stops both active and queued work without reopening a worker", { timeout: 5000 }, async (t) => {
  const detector = await worker(t);
  const first = assert.rejects(detector.complete(Buffer.from([4, 0]), AbortSignal.timeout(3000)), /stopped/);
  const next = assert.rejects(detector.complete(Buffer.from([1, 0]), AbortSignal.timeout(3000)), /stopped/);
  await wait(20);
  await detector.close();
  await Promise.all([first, next]);
});

test("a hung worker is killed after its deadline, never retried, and the next request can recover", { timeout: 15000 }, async (t) => {
  const detector = await worker(t);
  await assert.rejects(detector.complete(Buffer.from([9, 0]), AbortSignal.timeout(12000)), /did not finish within five seconds/);
  assert.equal(await detector.complete(Buffer.from([1, 0]), AbortSignal.timeout(3000)), true);
});

async function transport(t: TestContext, detector?: TurnDetector, prepared = true) {
  const speech = speechFixture("Computer, do not change any files.");
  if (!prepared) delete speech.service.turnDetector;
  const server = createServer();
  const close = attachSpeech(server, speech.service, () => true, detector);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/speech`);
  const events: SpeechEvent[] = [];
  socket.on("message", (raw, binary) => { if (!binary) events.push(JSON.parse(raw.toString())); });
  t.after(async () => { socket.terminate(); close(); await new Promise<void>((done) => server.close(() => done())); });
  await new Promise<void>((done, fail) => { socket.once("open", done); socket.once("error", fail); });
  const next = async (type: SpeechEvent["type"], phase?: string) => {
    const signal = AbortSignal.timeout(3000);
    while (true) {
      const index = events.findIndex((event) => event.type === type && (!phase || event.type === "state" && event.phase === phase));
      if (index >= 0) return events.splice(index, 1)[0]!;
      await wait(5, undefined, { signal });
    }
  };
  return { socket, events, next, speech };
}

test("pause checks retain only the latest eight seconds and never commit the selected listener", async (t) => {
  const audio: Uint8Array[] = [];
  const detector: TurnDetector = { async complete(bytes) { audio.push(bytes); return true; }, async close() {} };
  const { socket, events, next, speech } = await transport(t, detector);
  socket.send(JSON.stringify({ type: "listen", id: 1 }));
  await next("state", "listening");
  for (let index = 0; index < 410; index++) socket.send(Buffer.alloc(640, index % 256));
  socket.send(JSON.stringify({ type: "check-turn", id: 7 }));
  assert.deepEqual(await next("turn-result"), { type: "turn-result", id: 7, complete: true });
  assert.equal(audio[0]?.length, 256000);
  assert.equal(audio[0]?.[0], 10);
  assert.equal(audio[0]?.at(-1), 409 % 256);
  assert.equal(speech.audioWrites, 410);
  assert.equal(events.some((event) => event.type === "transcript"), false);
  socket.send(Buffer.alloc(640));
  socket.send(JSON.stringify({ type: "commit" }));
  assert.deepEqual(await next("transcript"), { type: "transcript", text: "Computer, do not change any files." });
});

for (const action of ["pause", "commit", "listen", "disconnect"] as const) test(`${action} aborts a pending check and drops late results`, async (t) => {
  let release!: (complete: boolean) => void;
  let signal: AbortSignal | undefined;
  const detector: TurnDetector = {
    complete(_audio, stopped) { signal = stopped; return new Promise((done) => { release = done; }); },
    async close() {},
  };
  const { socket, events, next } = await transport(t, detector);
  socket.send(JSON.stringify({ type: "listen", id: 1 }));
  await next("state", "listening");
  socket.send(Buffer.alloc(640));
  socket.send(JSON.stringify({ type: "check-turn", id: 1 }));
  for (let attempt = 0; !signal && attempt < 600; attempt++) await wait(5);
  assert.ok(signal, "The fixture must receive a pause check.");
  if (action === "disconnect") {
    const closed = new Promise<void>((done) => socket.once("close", () => done()));
    socket.close();
    await closed;
  } else {
    socket.send(JSON.stringify({ type: action, ...action === "listen" ? { id: 2 } : {} }));
    await next("state", action === "pause" ? "off" : action === "commit" ? "thinking" : "listening");
    if (action === "commit") await next("transcript");
  }
  if (!signal.aborted) await once(signal, "abort", { signal: AbortSignal.timeout(3000) });
  assert.equal(signal.aborted, true);
  release(true);
  await wait(20);
  assert.equal(events.some((event) => event.type === "turn-result" || event.type === "transcript"), false);
});

test("a service without prepared pause detection cannot start capturing or silently use a fixed delay", async (t) => {
  const { socket, events, next, speech } = await transport(t, undefined, false);
  socket.send(JSON.stringify({ type: "listen", id: 1 }));
  const error = await next("error");
  assert.match(error.type === "error" ? error.message : "", /Pause detection is not ready/);
  assert.equal(speech.audioWrites, 0);
  assert.equal(events.some((event) => event.type === "transcript"), false);
});

for (const mode of ["empty", "invalid-id"] as const) test(`pause checks reject ${mode} requests explicitly`, async (t) => {
  const detector: TurnDetector = { async complete() { assert.fail("Invalid checks must not reach the model."); }, async close() {} };
  const { socket, events, next } = await transport(t, detector);
  socket.send(JSON.stringify({ type: "listen", id: 1 }));
  await next("state", "listening");
  if (mode !== "empty") socket.send(Buffer.alloc(640));
  socket.send(JSON.stringify({ type: "check-turn", id: mode === "invalid-id" ? -1 : 1 }));
  const error = await next("error");
  assert.match(error.type === "error" ? error.message : "", /No spoken audio|not valid/);
  assert.equal(events.some((event) => event.type === "turn-result" || event.type === "transcript"), false);
});

test("checker errors stop listening visibly without sending a transcript or switching services", async (t) => {
  const detector: TurnDetector = { async complete() { throw new Error("Test-only checker failure."); }, async close() {} };
  const { socket, events, next } = await transport(t, detector);
  socket.send(JSON.stringify({ type: "listen", id: 1 }));
  await next("state", "listening");
  socket.send(Buffer.alloc(640));
  socket.send(JSON.stringify({ type: "check-turn", id: 1 }));
  const error = await next("error");
  assert.match(error.type === "error" ? error.message : "", /Test-only checker failure/);
  assert.equal(events.some((event) => event.type === "transcript"), false);
});
