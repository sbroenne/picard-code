import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { installRecording } from "./record-intro-browser.mjs";
import { ORDERS, allowWaitingCommand, chapterList, demoPermissions, readSrt, sentEvent, srt, srtTime } from "./intro-episode.mjs";

const execute = promisify(execFile);

test("the episode orders open with a bare call and keep tribute questions brief", () => {
  assert.equal(ORDERS[0].say, "Computer.");
  assert.equal(ORDERS[0].heard, undefined);
  for (const order of ORDERS.slice(1)) assert.ok(order.heard instanceof RegExp, order.id);
  assert.match(ORDERS.find((order) => order.id === "picard").say, /^Briefly,/);
  assert.match(ORDERS.find((order) => order.id === "stewart").say, /^In brief,/);
  assert.equal(new Set(ORDERS.map((order) => order.id)).size, ORDERS.length);
});

test("the briefing order names the four officers in one spoken phrase", () => {
  const options = ORDERS.find((order) => order.id === "options").say;
  for (const officer of ["Number One", "Geordi", "Data", "Doctor Crusher"]) assert.ok(options.includes(officer), officer);
  assert.equal(options.match(/[.?!]/g).length, 1, "Smart Turn ends the turn at a pause after a full stop.");
});

test("Riker proposes how he would organise the build, and only \"Make it so\" starts it", () => {
  const organise = ORDERS.find((order) => order.id === "organise").say;
  assert.match(organise, /^Number One, .*organise the crew to build it\?$/, "A question asks for a proposal, so OpenCode need not ask whether to plan or build.");
  assert.equal(ORDERS.at(-1).say, "Make it so.");
});

test("the demo project asks before every command and changes nothing else", () => {
  assert.deepEqual(demoPermissions().permissions, [{ action: "shell", resource: "*", effect: "ask" }]);
  assert.deepEqual(Object.keys(demoPermissions()).sort(), ["$schema", "permissions"]);
});

test("an answered approval that is still on screen is not answered again", { timeout: 20000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="approvals"></div><script>
      window.answers = [];
      window.ask = (command) => {
        const panel = document.createElement("section");
        panel.className = "approval";
        panel.innerHTML = "<h3>Approval required.</h3><pre></pre><button>Allow once</button><button>Deny</button>";
        panel.querySelector("pre").textContent = command;
        panel.querySelector("button").onclick = () => {
          panel.querySelectorAll("button").forEach((node) => { node.disabled = true; });
          answers.push(command);
          setTimeout(() => panel.remove(), 400);
        };
        document.querySelector("#approvals").append(panel);
      };
    </script>`);
    assert.equal(await allowWaitingCommand(page, { pause: 0 }), undefined);
    await page.evaluate(() => window.ask("node --test clock.test.mjs"));
    const first = await allowWaitingCommand(page, { pause: 50, timeout: 2000 });
    assert.equal(first.command, "node --test clock.test.mjs");
    assert.match(first.request, /Approval required/);
    assert.equal(await page.locator(".approval").count(), 0, "The answered box has gone before the next look.");
    assert.equal(await allowWaitingCommand(page, { pause: 50, timeout: 2000 }), undefined);
    await page.evaluate(() => { window.ask("npm test"); setTimeout(() => document.querySelector(".approval").remove(), 20); });
    assert.equal(await allowWaitingCommand(page, { pause: 200, timeout: 2000 }), undefined, "A withdrawn request is left alone.");
    assert.deepEqual(await page.evaluate(() => window.answers), ["node --test clock.test.mjs"]);
  } finally {
    await browser?.close();
  }
});

test("the recording keeps what the page asked to be spoken, with each speaker", () => {
  const briefing = { type: "speak", id: 4, parts: [{ text: "Options, Captain.", speaker: "picard-riker" }, { text: "Easy build.", speaker: "picard-geordi" }] };
  assert.deepEqual(sentEvent(JSON.stringify(briefing), 5), { time: 5, type: "speak", parts: briefing.parts, speed: 1 });
  assert.deepEqual(sentEvent(JSON.stringify({ type: "speak", id: 5, text: "Standing by.", speed: 1.1 }), 6), { time: 6, type: "speak", parts: [{ text: "Standing by." }], speed: 1.1 });
  assert.deepEqual(sentEvent(JSON.stringify({ type: "check-turn" }), 7), { time: 7, type: "check-turn" });
  assert.equal(sentEvent(JSON.stringify({ type: "stop-speaking" }), 8), undefined);
});

test("chapters follow YouTube's rules", () => {
  const chapters = [{ start: 0, title: "Opening" }, { start: 18, title: "Title" }, { start: 75, title: "Engage" }];
  assert.equal(chapterList(chapters, 103), "0:00 Opening\n0:18 Title\n1:15 Engage");
  assert.throws(() => chapterList(chapters.slice(0, 2), 103), /at least three/);
  assert.throws(() => chapterList([{ start: 1, title: "A" }, ...chapters.slice(1)], 103), /0:00/);
  assert.throws(() => chapterList(chapters, 80), /"Engage" is shorter than ten seconds/);
  assert.throws(() => chapterList([chapters[0], { start: 9, title: "Short" }, chapters[2]], 103), /"Opening"/);
});

test("captions are valid SRT and reject empty or overlapping lines", () => {
  assert.equal(srtTime(3723.4567), "01:02:03,457");
  assert.equal(srt([{ start: 0, end: 1.5, text: "Computer." }, { start: 1.5, end: 3, text: "Go ahead." }]),
    "1\n00:00:00,000 --> 00:00:01,500\nComputer.\n\n2\n00:00:01,500 --> 00:00:03,000\nGo ahead.\n");
  assert.throws(() => srt([{ start: 2, end: 2, text: "x" }]), /no duration/);
  assert.throws(() => srt([{ start: 0, end: 3, text: "a" }, { start: 2, end: 4, text: "b" }]), /overlaps/);
  const cues = [{ start: 0.8, end: 6.696, text: "Picard: Captain's log,\nstardate." }, { start: 3723.457, end: 3725, text: "Engage." }];
  assert.deepEqual(readSrt(srt(cues)), cues);
  assert.throws(() => readSrt("1\n0:00:01 --> 00:00:02,000\nx\n"), /not an SRT time stamp/);
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
