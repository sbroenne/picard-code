import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import fs, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { connectNemotron, nemotronSpeech } from "../server/nemotron-speech.js";
import { canSetUpLocalSpeech, localSpeechReady } from "../server/speech.js";
import { downloadVerified, nemotronArchive, NEMOTRON_MODEL, NEMOTRON_NOTICES, NEMOTRON_VERSION, setupNemotron } from "../../scripts/setup-nemotron.mjs";

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

test("Nemotron reports missing files without substituting another service", async (t) => {
  await assert.rejects(nemotronSpeech({ program: resolve("picard-missing-nemotron"), model: resolve("picard-missing-model") }), /Nemotron speech file is missing/);
  const lookup = t.mock.method(fs, "realpath", async () => { throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" }); });
  syncBuiltinESMExports();
  t.after(() => { lookup.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(nemotronSpeech({ program: process.execPath, model: join(fileURLToPath(import.meta.url), "not-a-directory") }), { code: "ENOTDIR", message: "not a directory" });
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
  assert.throws(() => nemotronArchive("linux", "x64", "2.28"), /glibc 2.31.*own Azure speech resource/);
  assert.throws(() => nemotronArchive("linux", "x64", "unknown"), /glibc 2.31/);
  assert.throws(() => nemotronArchive("linux", "x64", ""), /glibc 2.31/);
  assert.throws(() => nemotronArchive("darwin", "x64"), /own Azure speech resource/);
});

test("local readiness and custom paths concern only the selected speech services", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-speech-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const present = join(folder, "present");
  await writeFile(present, "");
  const record = { localPython: present, whisperModel: present, kokoroModel: present, kokoroVoices: present,
    nemotronProgram: join(folder, "missing"), nemotronModel: join(folder, "missing") };
  assert.equal(await localSpeechReady({ ...record, nemotronProgram: present, nemotronModel: present, listening: "nemotron", speaking: "kokoro" }), true);
  assert.equal(await localSpeechReady({ ...record, listening: "nemotron", speaking: "kokoro" }), false);
  assert.equal(await localSpeechReady({ ...record, listening: "mai", speaking: "mai" }), true);
  assert.equal(await localSpeechReady({ ...record, listening: "nemotron", speaking: "kokoro" }, false, true), true);
  assert.equal(canSetUpLocalSpeech({ listening: "nemotron", speaking: "mai", whisperModel: "/old/custom/whisper" }), true);
  assert.equal(canSetUpLocalSpeech({ listening: "nemotron", speaking: "mai", nemotronModel: "/custom/nemotron" }), false);
});

test("the standard Nemotron model is ready only with its NVIDIA licence and notice", { timeout: 10_000 }, async (t) => {
  const home = await mkdtemp(resolve(".picard-test-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const models = join(home, ".picard-code", "voice", "models");
  await mkdir(models, { recursive: true });
  const program = join(home, "nemo-speech");
  await writeFile(program, "");
  await writeFile(join(models, NEMOTRON_MODEL), "");
  const ready = async () => {
    const script = `const { localSpeechReady } = await import(${JSON.stringify(new URL("../server/speech.js", import.meta.url).href)});
      process.stdout.write(String(await localSpeechReady({ listening: "nemotron", speaking: "mai", nemotronProgram: ${JSON.stringify(program)} })));`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, HOME: home, USERPROFILE: home } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    return output;
  };
  assert.equal(await ready(), "false", "A finished model without its licence must not skip the licence download.");
  await writeFile(join(models, NEMOTRON_NOTICES[0]), "");
  assert.equal(await ready(), "false");
  await writeFile(join(models, NEMOTRON_NOTICES[1]), "");
  assert.equal(await ready(), "true");
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

test("a cancelled model download removes only its partial file and preserves the previous model", { timeout: 10_000 }, async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-download-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const target = join(folder, "model");
  await writeFile(target, "previous model");
  const server = createServer((_request, response) => { response.write("generated incomplete model"); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const download = downloadVerified(`http://127.0.0.1:${address.port}/generated-model`, target, "0".repeat(64), controller.signal);
  const rejected = assert.rejects(download, /aborted/);
  while (!(await readdir(folder)).some((file) => file.endsWith(".download"))) await wait(10);
  controller.abort();
  await rejected;
  assert.equal(await readFile(target, "utf8"), "previous model");
  assert.deepEqual(await readdir(folder), ["model"]);
});

test("a stopped download is removed on retry without touching a running process's files", { timeout: 10_000 }, async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-download-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const bytes = Buffer.from("original generated interrupted download");
  const expected = createHash("sha256").update(bytes).digest("hex");
  let interrupted = true;
  const server = createServer((_request, response) => {
    response.write(bytes);
    if (!interrupted) response.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/generated-model`;
  const target = join(folder, "model");
  const module = new URL("../../scripts/setup-nemotron.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import { downloadVerified } from ${JSON.stringify(module)}; await downloadVerified(...process.argv.slice(1));`,
    url, target, expected], { stdio: "ignore" });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  assert.ok(child.pid);
  const partial = `${target}.${child.pid}.download`;
  while (!(await readdir(folder)).includes(`model.${child.pid}.download`)) await wait(10);
  while (!(await readFile(partial)).length) await wait(10);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.ok((await readFile(partial)).length);
  const live = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => { live.kill(); });
  assert.ok(live.pid);
  const livePartial = `${target}.${live.pid}.download`;
  await writeFile(livePartial, "another running download");
  await writeFile(join(folder, "unrelated.download"), "keep");
  interrupted = false;
  await downloadVerified(url, target, expected);
  assert.deepEqual(await readFile(target), bytes);
  await assert.rejects(readFile(partial), { code: "ENOENT" });
  assert.equal(await readFile(livePartial, "utf8"), "another running download");
  assert.equal(await readFile(join(folder, "unrelated.download"), "utf8"), "keep");
});

test("a checksum marker without the runtime executable never skips runtime preparation", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-runtime-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const root = join(folder, "voice", "nemotron", NEMOTRON_VERSION);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, ".picard-checksum"), nemotronArchive().checksum);
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    requests.push(String(url));
    throw new Error("Runtime download stopped by the labeled test fixture.");
  });
  await assert.rejects(setupNemotron(folder), /Runtime download stopped/);
  assert.deepEqual(requests, [`https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${NEMOTRON_VERSION}/${nemotronArchive().file}`]);
});
