import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { installRecording } from "./record-intro-browser.mjs";

const execute = promisify(execFile);
const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "NODE_TEST_CONTEXT"));

test("the example exposes the real bug and checks mixed, all-passed and empty results", { timeout: 20000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), "picard-intro-tests-"));
  try {
    await cp(new URL("./intro-demo/", import.meta.url), folder, { recursive: true });
    await assert.rejects(execute(process.execPath, ["--test", "--test-reporter=tap", "checks.mjs"], { cwd: folder, env: childEnvironment }), (error) => {
      assert.match(error.stdout, /not ok 1 - one failed check/);
      assert.match(error.stdout, /ok 2 - all checks/);
      assert.match(error.stdout, /ok 3 - no checks/);
      return true;
    });
    const code = await readFile(join(folder, "status.mjs"), "utf8");
    await writeFile(join(folder, "status.mjs"), code.replace("checks.some", "checks.length > 0 && checks.every"));
    const result = await execute(process.execPath, ["--test", "--test-reporter=tap", "checks.mjs"], { cwd: folder, env: childEnvironment });
    assert.match(result.stdout, /# pass 3/);
  } finally { await rm(folder, { recursive: true }); }
});

test("the browser records generated input and actual output without playing the input through the speakers", { timeout: 20000 }, async () => {
  const server = createServer((request, response) => response.end("<!doctype html><button>Start</button>"));
  await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  let browser;
  try {
    browser = await chromium.launch({ args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
    const page = await browser.newPage();
    await page.addInitScript(installRecording);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator("button").click();
    const result = await page.evaluate(async () => {
      const context = new AudioContext();
      await context.resume();
      const microphone = context.createMediaStreamSource(new MediaStream());
      const analyzer = context.createAnalyser();
      microphone.connect(analyzer);
      await Promise.race([
        window.startDemoRecording(),
        new Promise((done, fail) => setTimeout(() => fail(new Error("Recording did not start during silence.")), 3000)),
      ]);
      const bytes = new Uint8Array(24000);
      const data = new DataView(bytes.buffer);
      for (let index = 0; index < bytes.length / 2; index++) data.setInt16(index * 2, Math.round(Math.sin(index * 2 * Math.PI * 440 / 24000) * 6000), true);
      const speaking = window.demoSpeak(btoa(String.fromCharCode(...bytes)));
      await new Promise((done) => setTimeout(done, 200));
      const samples = new Float32Array(analyzer.fftSize);
      analyzer.getFloatTimeDomainData(samples);
      const microphonePeak = Math.max(...samples.map(Math.abs));
      await speaking;
      const tone = context.createOscillator();
      tone.connect(context.destination);
      tone.start();
      await new Promise((done) => setTimeout(done, 300));
      tone.stop();
      await new Promise((done) => setTimeout(done, 100));
      const recording = await window.finishDemoRecording();
      await context.close();
      return { microphonePeak, ...recording };
    });
    assert.ok(result.microphonePeak > 0.05, "The generated input must reach the app's actual microphone stream.");
    assert.ok(Buffer.from(result.audio, "base64").length > 4000, "The real mixed audio must be saved.");
    assert.ok(Number.isFinite(result.start));
    const folder = await mkdtemp(join(tmpdir(), "picard-intro-audio-"));
    try {
      const file = join(folder, "audio.webm");
      await writeFile(file, Buffer.from(result.audio, "base64"));
      const { stdout: pcm } = await execute("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ar", "24000", "-ac", "1", "pipe:1"], { encoding: "buffer" });
      const level = (start, end) => {
        let energy = 0;
        const from = Math.round(start * 24000);
        const to = Math.round(end * 24000);
        for (let index = from; index < to; index++) energy += (pcm.readInt16LE(index * 2) / 32768) ** 2;
        return Math.sqrt(energy / (to - from));
      };
      assert.ok(level(0.1, 0.4) > 0.1, "The actual recording must contain the prepared spoken-input track.");
      assert.ok(level(0.6, 0.75) > 0.2, "The actual recording must contain the browser's separate output track.");
    } finally { await rm(folder, { recursive: true }); }
  } finally {
    try { await browser?.close(); }
    finally { await new Promise((done, fail) => server.close((error) => error ? fail(error) : done())); }
  }
});
