import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { connectNemotron, nemotronSpeech } from "../server/nemotron-speech.js";
import { canSetUpLocalSpeech, localSpeechReady } from "../server/speech.js";
import { downloadVerified, nemotronArchive } from "../../scripts/setup-nemotron.mjs";

async function fixture(t: TestContext) {
  const server = createServer();
  const sockets = new WebSocketServer({ server, verifyClient: (info: { req: IncomingMessage }) => info.req.headers.authorization === "Bearer test-only-key" });
  const events: string[] = [];
  let connection: WebSocket | undefined;
  sockets.on("connection", (socket) => {
    connection = socket;
    socket.send(JSON.stringify({ type: "session.created" }));
    socket.on("message", (raw, binary) => {
      if (binary) {
        events.push("audio");
        socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: events.filter((item) => item === "audio").length === 1 ? "Computer," : " do not change files." }));
      } else {
        const event = JSON.parse(raw.toString()) as { type: string; session?: Record<string, unknown> };
        events.push(event.type);
        if (event.type === "session.update") {
          assert.equal(event.session?.sample_rate, 16000);
          assert.equal(event.session?.verbatim, true);
          assert.equal(event.session?.profanity_filter, false);
          socket.send(JSON.stringify({ type: "session.updated" }));
        } else if (event.type === "input_audio_buffer.commit") {
          socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "Computer, do not change files." }));
        }
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((done) => sockets.close(() => done()));
    await new Promise<void>((done) => server.close(() => done()));
  });
  return { origin: `http://127.0.0.1:${address.port}`, events, send: (event: object | string) => {
    assert.ok(connection);
    connection.send(typeof event === "string" ? event : JSON.stringify(event));
  }, disconnect: () => connection?.close() };
}

test("Nemotron sends audio before commit, displays partial words, and finalizes exactly once", { timeout: 5000 }, async (t) => {
  const service = await fixture(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const partials: string[] = [];
  const finals: string[] = [];
  const errors: string[] = [];
  const input = await connectNemotron(service.origin, "test-only-key", { partial: (text) => partials.push(text), final: (text) => finals.push(text), error: (message) => errors.push(message) }, controller.signal);
  input.write(Buffer.alloc(640));
  input.write(Buffer.alloc(640));
  while (partials.length < 2) await wait(5);
  assert.deepEqual(partials, ["Computer,", "Computer, do not change files."]);
  assert.deepEqual(finals, [], "Live words cannot submit an unfinished request.");
  assert.deepEqual(service.events, ["session.update", "audio", "audio"]);
  input.commit();
  while (!finals.length) await wait(5);
  assert.deepEqual(finals, ["Computer, do not change files."]);
  assert.deepEqual(errors, []);
  assert.throws(() => input.write(Buffer.alloc(640)), /closed/);
  assert.throws(() => input.commit(), /No Nemotron listening request/);
  input.close();
});

test("Nemotron requires server authentication", { timeout: 5000 }, async (t) => {
  const service = await fixture(t);
  await assert.rejects(connectNemotron(service.origin, "wrong-key", { partial() {}, final() {}, error() {} }, AbortSignal.timeout(3000)), /HTTP 401/);
});

for (const [label, event, expected] of [
  ["early final", { type: "conversation.item.input_audio_transcription.completed", transcript: "unfinished" }, /before the spoken request ended/],
  ["malformed JSON", "{", /unreadable/],
  ["unexpected event", { type: "something.else" }, /unexpected/],
  ["service error", { type: "error", error: { message: "Model failed with test-only-key" } }, /Model failed with \[removed\]/],
  ["oversized transcript", { type: "conversation.item.input_audio_transcription.delta", delta: "a".repeat(32_001) }, /too many words/],
] as const) {
  test(`Nemotron reports ${label} without dispatching a request`, { timeout: 5000 }, async (t) => {
    const service = await fixture(t);
    const errors: string[] = [];
    let finals = 0;
    const input = await connectNemotron(service.origin, "test-only-key", { partial() {}, final() { finals++; }, error: (message) => errors.push(message) }, AbortSignal.timeout(3000));
    service.send(event);
    while (!errors.length) await wait(5);
    assert.match(errors[0]!, expected);
    assert.equal(finals, 0);
    input.close();
  });
}

test("cancelled Nemotron streams cannot publish late results and the next request still works", { timeout: 5000 }, async (t) => {
  const service = await fixture(t);
  const controller = new AbortController();
  let results = 0;
  const first = await connectNemotron(service.origin, "test-only-key", { partial() { results++; }, final() { results++; }, error() {} }, controller.signal);
  controller.abort();
  first.close();
  await wait(20);
  assert.equal(results, 0);
  let finished = false;
  const next = await connectNemotron(service.origin, "test-only-key", { partial() {}, final() { finished = true; }, error: assert.fail }, AbortSignal.timeout(3000));
  next.write(Buffer.alloc(640));
  next.commit();
  while (!finished) await wait(5);
  next.close();
});

test("Nemotron reports a disconnected service and rejects incomplete audio", { timeout: 5000 }, async (t) => {
  const service = await fixture(t);
  const errors: string[] = [];
  const input = await connectNemotron(service.origin, "test-only-key", { partial() {}, final: assert.fail, error: (message) => errors.push(message) }, AbortSignal.timeout(3000));
  assert.throws(() => input.write(Buffer.alloc(3)), /complete 16-bit/);
  assert.throws(() => input.commit(), /No Nemotron listening request/);
  service.disconnect();
  while (!errors.length) await wait(5);
  assert.match(errors[0]!, /closed its listening connection/);
});

test("Nemotron reports missing files and never substitutes Whisper", async () => {
  await assert.rejects(nemotronSpeech({ program: resolve("picard-missing-nemotron"), model: resolve("picard-missing-model") }), /Nemotron speech file is missing/);
  await assert.rejects(nemotronSpeech({ program: process.execPath, model: join(fileURLToPath(import.meta.url), "not-a-directory") }), /ENOTDIR/);
});

test("a native process that fails during startup is reported and closed", { timeout: 5000 }, async () => {
  // Node is a stand-in executable that cannot run the native runtime's arguments.
  await assert.rejects(nemotronSpeech({ program: process.execPath, model: fileURLToPath(import.meta.url) }), /Nemotron stopped/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(nemotronSpeech({ program: process.execPath, model: fileURLToPath(import.meta.url) }, controller.signal), /aborted/);
});

test("Nemotron bounds audio before sending an oversized request", { timeout: 5000 }, async (t) => {
  const service = await fixture(t);
  const errors: string[] = [];
  const input = await connectNemotron(service.origin, "test-only-key", { partial() {}, final: assert.fail, error: (message) => errors.push(message) }, AbortSignal.timeout(3000));
  input.write(Buffer.alloc(16000 * 2 * 62));
  assert.match(errors[0]!, /too long/);
  assert.deepEqual(service.events, ["session.update"]);
  input.close();
});

test("Nemotron platform selection preserves explicit alternatives on unsupported computers", () => {
  assert.match(nemotronArchive("darwin", "arm64").file, /macos-aarch64-cpu/);
  assert.deepEqual(nemotronArchive("win32", "arm64"), nemotronArchive("win32", "x64"));
  assert.match(nemotronArchive("linux", "arm64", "2.31").file, /linux-aarch64-cpu/);
  assert.match(nemotronArchive("linux", "x64", "2.40").checksum, /^[a-f0-9]{64}$/);
  assert.throws(() => nemotronArchive("linux", "x64", "2.28"), /glibc 2.31.*Choose Whisper/);
  assert.throws(() => nemotronArchive("linux", "x64", "unknown"), /glibc 2.31/);
  assert.throws(() => nemotronArchive("linux", "x64", undefined), /glibc 2.31/);
  assert.throws(() => nemotronArchive("darwin", "x64"), /Choose Whisper or Azure MAI/);
});

test("local readiness and custom paths concern only the selected speech services", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-speech-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const present = join(folder, "present");
  await writeFile(present, "");
  const record = { localPython: present, whisperModel: present, kokoroModel: present, kokoroVoices: present,
    nemotronProgram: join(folder, "missing"), nemotronModel: join(folder, "missing") };
  assert.equal(await localSpeechReady({ ...record, listening: "whisper", speaking: "kokoro" }), true);
  assert.equal(await localSpeechReady({ ...record, listening: "nemotron", speaking: "kokoro" }), false);
  assert.equal(await localSpeechReady({ ...record, listening: "mai", speaking: "mai" }), true);
  assert.equal(await localSpeechReady({ ...record, listening: "nemotron", speaking: "kokoro" }, false, true), true);
  assert.equal(canSetUpLocalSpeech({ listening: "nemotron", speaking: "mai", whisperModel: "/old/custom/whisper" }), true);
  assert.equal(canSetUpLocalSpeech({ listening: "nemotron", speaking: "mai", nemotronModel: "/custom/nemotron" }), false);
});

test("speech downloads verify checksums, preserve a previous file on failure, and can retry", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-download-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const bytes = Buffer.from("original generated download fixture");
  const expected = createHash("sha256").update(bytes).digest("hex");
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end(bytes); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/test-only-model`;
  const file = join(folder, "model");
  await writeFile(file, "previous file");
  await assert.rejects(downloadVerified(url, file, "0".repeat(64)), /checksum does not match/);
  assert.equal(await readFile(file, "utf8"), "previous file");
  assert.deepEqual(await readdir(folder), ["model"]);
  await downloadVerified(url, file, expected);
  assert.deepEqual(await readFile(file), bytes);
  await downloadVerified(url, file, expected);
  assert.equal(requests, 2, "A verified existing model is not downloaded again.");
});
