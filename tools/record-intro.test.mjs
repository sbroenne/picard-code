import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { installRecording } from "./record-intro-browser.mjs";
import { recordSite, SITE_SCROLL } from "./record-site.mjs";
import { addressedOfficers } from "../dist/shared/crew.js";
import { TRIBUTE_ENTRIES } from "../dist/shared/tribute-data.js";
import { TributeCycle } from "../dist/shared/tribute.js";
import { CAPTAINS_LOG, ORDERS, TRIBUTE_FACT, captainVoice, checkTribute, tightenPauses, chapterList, demoPermissions, readSrt, screenAlert, sentEvent, srt, srtTime, tributeCue } from "./intro-episode.mjs";

const execute = promisify(execFile);

test("the episode orders are a bare call, a two-officer briefing, Make it so and Data's short report", () => {
  assert.deepEqual(ORDERS.map((order) => order.id), ["computer", "briefing", "engage", "report"]);
  assert.equal(ORDERS[0].say, "Computer.");
  assert.equal(ORDERS[0].heard, undefined);
  for (const order of ORDERS.slice(1)) assert.ok(order.heard instanceof RegExp, order.id);
  for (const order of ORDERS) assert.equal(order.say.match(/[.?!]/g).length, 1, `Smart Turn ends the turn at a pause after a full stop: ${order.id}`);
});

test("the briefing asks only Riker and Data, one short sentence each, so both are heard in full", () => {
  const briefing = ORDERS.find((order) => order.id === "briefing").say;
  assert.match(briefing, /^Number One and Mr Data, give me one short sentence each on your options for building a tribute site .*\.$/);
  for (const order of ORDERS) {
    // Smart Turn may end the turn at any pause, so the Captain's voice has none; the caption keeps its commas.
    assert.ok(!/[,:;]/.test(captainVoice(order)), `A pause inside the order can end the turn early: ${order.id}`);
    assert.equal(captainVoice(order).split(" ").length, order.say.split(" ").length, `Every word is still spoken: ${order.id}`);
    // The whole order must be heard, including its length limit.
    if (order.heard) assert.match(order.say, order.heard, order.id);
  }
  assert.doesNotMatch("Number One and Mister Data, give me one short sentence each on your options", ORDERS[1].heard, "an order cut short is a failed take");
  for (const heard of [
    "Number one and Mister Data give me one short sentence. Each on your options for building a tribute site to Sir Patrick with a stardate clock",
    "Number one and mister data give me one short sentence each on your options for building attribute site to Sir Patrick with a stardate clock",
  ]) {
    assert.match(heard, ORDERS[1].heard, "Nemotron's own punctuation and spacing are not a failed take");
    assert.deepEqual(addressedOfficers(heard), ["picard-riker", "picard-data"], heard);
  }
  for (const officer of ["Geordi", "Crusher", "Worf", "Troi"]) assert.ok(!briefing.includes(officer), officer);
  // The app must address both officers however Nemotron punctuates the order, or Riker answers alone.
  for (const heard of [briefing, captainVoice({ say: briefing }).replace("Mr", "Mister")]) assert.deepEqual(addressedOfficers(heard), ["picard-riker", "picard-data"], heard);
  // Riker and Data may propose different builds; naming Number One carries out his proposal without a question.
  assert.equal(ORDERS.find((order) => order.id === "engage").say, "Make it so, Number One.");
  assert.match(ORDERS.find((order) => order.id === "report").say, /^Mr Data, .*one sentence\.$/);
});

test("Data's test order is shown on screen exactly as spoken; a misheard order is a failed take", () => {
  const report = ORDERS.find((order) => order.id === "report");
  // Heard word for word when the Captain's Kokoro voice was played to Nemotron.
  const heard = "Mister Data, please run the tests and report in one sentence";
  assert.match(heard, report.heard);
  assert.deepEqual(addressedOfficers(heard), ["picard-data"]);
  // Nemotron's real mishearings of earlier wordings must not pass as a good take.
  for (const misheard of ["Mister Data tested and report in one sentence", "Mister Dayta run the tests and report in one sentence"]) {
    assert.doesNotMatch(misheard, report.heard, misheard);
  }
});

test("the app's own tribute cycle shows the chosen Personnel file right after Data's report, and not before", () => {
  const fact = TRIBUTE_ENTRIES.find((entry) => entry.id === TRIBUTE_FACT);
  assert.equal(fact?.subject, "Picard", "a Personnel file record, not one about Sir Patrick");
  const cue = tributeCue(TRIBUTE_ENTRIES);
  assert.ok(!cue.seen.includes(TRIBUTE_FACT) && cue.seen.length === TRIBUTE_ENTRIES.length - 1);
  // The same class and settings the page builds when it loads, with its random draw fixed as the recorder fixes it.
  const cycle = new TributeCycle(TRIBUTE_ENTRIES, cue.seen, () => cue.random);
  cycle.setEnabled(true);
  const answered = ORDERS.filter((order) => order.heard);
  assert.equal(answered.at(-1).id, "report");
  const shown = answered.map((order) => cycle.completed({
    id: order.id, outcome: "succeeded", blocked: false, explicit: false,
    reply: { id: order.id, role: "assistant", parts: [{ type: "text", text: "Done, Captain." }] },
  }));
  assert.deepEqual(shown.map((entry) => entry?.id), [undefined, undefined, TRIBUTE_FACT]);
});

test("a take is refused when the tribute record is missing, early or a different fact", () => {
  const fact = TRIBUTE_ENTRIES.find((entry) => entry.id === TRIBUTE_FACT);
  assert.doesNotThrow(() => checkTribute("briefing", [], fact));
  assert.doesNotThrow(() => checkTribute("report", [`Personnel file\nJean-Luc Picard\n${fact.text}\nSource`], fact));
  assert.throws(() => checkTribute("engage", ["Personnel file"], fact), /Record again: a tribute record appeared after "engage"/);
  assert.throws(() => checkTribute("report", [], fact), /Record again: no tribute record appeared after Data's report/);
  assert.throws(() => checkTribute("report", ["Personnel file\nPicard was born in La Barre."], fact), /Record again: the tribute record after Data's report was not/);
});

test("the Captain's generated voice has no gap long enough for the app to end his turn mid-order", () => {
  const rate = 24000;
  const tone = (seconds) => Array.from({ length: rate * seconds }, (_, index) => Math.round(Math.sin(index * 2 * Math.PI * 220 / rate) * 8000));
  const quiet = (seconds) => Array.from({ length: rate * seconds }, () => 0);
  const samples = [...quiet(0.3), ...tone(0.5), ...quiet(0.5), ...tone(0.5), ...quiet(0.15), ...tone(0.5), ...quiet(0.4)];
  const audio = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => audio.writeInt16LE(value, index * 2));
  const tight = tightenPauses(audio, rate);
  assert.equal(Math.round(tight.length / 2 / rate * 1000), 300 + 500 + 120 + 500 + 120 + 500 + 400, "only gaps inside the order shrink to 120 ms; the start and end stay");
  assert.ok(tight.subarray(0.3 * rate * 2, 0.8 * rate * 2).equals(audio.subarray(0.3 * rate * 2, 0.8 * rate * 2)), "spoken sound is unchanged");
});

test("the demo project grants command runs before the take and changes nothing else", () => {
  assert.deepEqual(demoPermissions().permissions, [{ action: "shell", resource: "*", effect: "allow" }]);
  assert.deepEqual(Object.keys(demoPermissions()).sort(), ["$schema", "permissions"]);
});

test("any approval, alert or warning on screen is found so the take can be recorded again", { timeout: 20000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="notice" class="notice" data-alert="red" role="alert" hidden>Old failure</div>
      <p class="preparation-error" role="alert" hidden></p><main><p>Standing by.</p></main>`);
    assert.equal(await screenAlert(page), undefined, "Hidden alert areas are not on screen.");
    await page.evaluate(() => { const box = document.createElement("section"); box.className = "approval"; box.textContent = "Allow once"; document.body.append(box); });
    assert.match(await screenAlert(page), /Allow once/);
    await page.evaluate(() => document.querySelector(".approval").remove());
    await page.evaluate(() => { const notice = document.querySelector("#notice"); notice.hidden = false; notice.textContent = "OpenCode is retrying. Rate limited."; });
    assert.match(await screenAlert(page), /retrying/);
    await page.evaluate(() => { document.querySelector("#notice").hidden = true; document.querySelector("main").insertAdjacentHTML("beforeend", "<article data-alert='red'>Red alert: the command failed.</article>"); });
    assert.match(await screenAlert(page), /command failed/);
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

test("the recorder opens the Captain's log through the side-panel link and drawer the app really has", async () => {
  const page = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(page, /<a [^>]*data-drawer-link="records"[^>]*>Captain’s log<\/a>/);
  assert.equal(CAPTAINS_LOG.link, 'a[data-drawer-link="records"]');
  assert.match(page, new RegExp(`<section id="${CAPTAINS_LOG.panel.slice(1)}"`));
  assert.match(page, new RegExp(`id="${CAPTAINS_LOG.entries.split(" ")[0].slice(1)}"`));
});

test("the site the crew built is recorded with one slow scroll to its bottom, so its shot moves", { timeout: 30000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), "picard-site-"));
  const project = join(folder, "tribute-site");
  await execute("mkdir", [project]);
  await writeFile(join(project, "index.html"), '<!doctype html><body style="margin:0"><div style="height:3000px;background:linear-gradient(#000,#fa0)">Tribute</div></body>');
  const browser = await chromium.launch();
  try {
    const result = await recordSite(browser, project, folder);
    assert.deepEqual(result.errors, []);
    assert.equal(result.distance, 3000 - 1080);
    assert.ok(Math.abs(result.top - result.distance) < 1, "the scroll ends at the bottom of the page");
    assert.ok((await stat(join(folder, "site.webm"))).size > 0);
    assert.ok((await stat(join(folder, "site.png"))).size > 0);
    assert.ok(SITE_SCROLL.start >= 1 && SITE_SCROLL.start + SITE_SCROLL.duration <= 6, "the scroll fits the edit's site shot, from 1 s to 6 s");
  } finally {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  }
});
