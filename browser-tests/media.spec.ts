import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startFixture } from "../src/tests/fixture";
import { startApp } from "../src/server/app";
import { makeClient } from "../src/server/engine";
import { speechFixture } from "../src/tests/speech-fixture";
import { saveModelSettings } from "../src/server/model-settings";
import { syntheticVoice } from "../src/tests/test-audio";

// Original canvas pixels and recordings, not downloaded media.
const folder = resolve(`.picard-test-media-microphone-${process.pid}`);
const microphone = join(folder, "silence.wav");
test.use({ permissions: ["microphone"], launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-audio-output",
  `--use-file-for-fake-audio-capture=${microphone}`,
] } });
test.beforeAll(async () => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(folder);
  const audio = Buffer.alloc(48000 * 2 * 60);
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(audio.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(audio.length, 40);
  await writeFile(microphone, Buffer.concat([header, audio]));
});
test.afterAll(async () => { await rm(folder, { recursive: true }); });

async function setup(page: Page, phrase: string | string[] = "") {
  await page.addInitScript(() => {
    const original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends original {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args);
        Object.assign(window, { mediaCapturePort: this.port });
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: unknown) => {
          if (typeof message === "boolean") Object.assign(window, { mediaCapture: message });
          post(message);
        };
      }
    };
  });
  const temporary = await mkdtemp(resolve(".picard-test-media-"));
  const project = await realpath(temporary);
  // A real, silent, browser-playable WebM made from original canvas frames.
  await page.goto("about:blank");
  const generated = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 240;
    const context = canvas.getContext("2d")!;
    const draw = () => {
      context.fillStyle = "#221b35";
      context.fillRect(0, 0, 480, 240);
      context.fillStyle = "#ffb14d";
      context.fillRect(20, 20, 440, 16);
      context.font = "22px sans-serif";
      context.fillText("TEST ONLY: original media", 30, 120);
    };
    draw();
    const image = canvas.toDataURL("image/png").split(",")[1]!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const result = new Promise<number[]>((done) => {
      recorder.onstop = async () => done([...new Uint8Array(await new Blob(chunks).arrayBuffer())]);
    });
    recorder.start();
    const timer = setInterval(draw, 100);
    setTimeout(() => { clearInterval(timer); recorder.stop(); stream.getTracks().forEach((track) => track.stop()); }, 1100);
    return { image, video: await result };
  });
  const pixel = Buffer.from(generated.image, "base64");
  const videoBytes = generated.video;
  await writeFile(join(project, "demo.webm"), Buffer.from(videoBytes));
  await writeFile(join(project, "test image.png"), pixel);
  const fixture = await startFixture(project);
  const session = fixture.createSession(project, "Media stand-in");
  const text = "These are original test media, not a model result.\n\n![Local image](<test image.png>)\n\n"
    + "![Website image](https://media.example.com/picture.png)\n\n[Local video](demo.webm)\n\n"
    + "[Website video](https://media.example.com/demo.webm)\n\n[YouTube example](https://www.youtube.com/watch?v=abcdefghijk)\n\n"
    + "[Vimeo example](https://vimeo.com/123456)\n\n![Blocked](https://127.0.0.1/private.png)\n\n"
    + "![Missing](missing.png)\n\n[Original source](https://example.com \"Original source title\")\n\n"
    + "`![Code sample](code.png)`\n\n<img src=x onerror=alert(1)>";
  fixture.messages.get(session.id)!.push({ id: "media-answer", type: "assistant", time: { created: 1 }, content: [{ type: "text", text }] });
  const speech = speechFixture([...(Array.isArray(phrase) ? phrase : [phrase]), ""]);
  const sound = Buffer.alloc(4844);
  sound.write("RIFF"); sound.writeUInt32LE(sound.length - 8, 4); sound.write("WAVEfmt ", 8);
  sound.writeUInt32LE(16, 16); sound.writeUInt16LE(1, 20); sound.writeUInt16LE(1, 22);
  sound.writeUInt32LE(24000, 24); sound.writeUInt32LE(48000, 28); sound.writeUInt16LE(2, 32); sound.writeUInt16LE(16, 34);
  sound.write("data", 36); sound.writeUInt32LE(4800, 40);
  for (const name of ["startup", "request-accepted", "input-failed", "request-failed"]) await writeFile(join(project, `${name}.mp3`), sound);
  const modelFile = join(project, "model.json");
  await saveModelSettings(modelFile, { providerID: "github-copilot", modelID: "fixture-model" });
  const app = await startApp({ client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"), speech: speech.service, soundFolder: project, speechFile: join(project, "unused-settings.json"), modelFile });
  await page.route("https://media.example.com/**", async (route) => {
    if (route.request().url().endsWith(".webm")) await route.fulfill({ contentType: "video/webm", body: Buffer.from(videoBytes) });
    else await route.fulfill({ contentType: "image/png", body: pixel });
  });
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>TEST ONLY player stand-in</title><p>TEST ONLY player stand-in</p>" }));
  await page.route("https://player.vimeo.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>TEST ONLY player stand-in</title><p>TEST ONLY player stand-in</p>" }));
  await page.goto(app.url);
  await expect(page.getByAltText("Local image")).toBeVisible();
  return { fixture, session, project, text, speech, cleanup: async () => { await app.close(); await fixture.close(); await rm(temporary, { recursive: true }); } };
}

test("reply media loads safely, survives updates, and reopens with its log entry", async ({ page }, info) => {
  const context = await setup(page);
  try {
    for (const label of ["Local image", "Website image"]) {
      await expect.poll(() => page.getByAltText(label).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(480);
    }
    await expect(page.locator("video")).toHaveCount(2);
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByText("Blocked: this media reference cannot be shown.")).toBeVisible();
    await expect(page.getByText("That media file is no longer available.")).toBeVisible();
    await expect(page.locator("img[onerror]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Original source", exact: true })).toHaveAttribute("title", "Original source title");
    await expect(page.locator("#messages code")).toContainText("![Code sample](code.png)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => {
      Object.assign(window, { copiedMedia: "", firstMedia: document.querySelector(".reply-media img") });
      Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => Object.assign(window, { copiedMedia: text }) });
    });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { copiedMedia: string }).copiedMedia)).toBe(context.text);
    context.fixture.publish(context.project, "session.step.ended", { sessionID: context.session.id });
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveText("Copy");
    expect(await page.evaluate(() => (window as unknown as { firstMedia: Element }).firstMedia === document.querySelector(".reply-media img"))).toBe(true);
    await page.reload();
    await expect(page.getByAltText("Local image")).toBeVisible();
    await expect(page.locator("video")).toHaveCount(2);
    await page.locator("#reading-area").evaluate((area) => { area.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath("media-test-stand-ins.png"), fullPage: true });
  } finally { await context.cleanup(); }
});

test("actual video playback pauses capture, survives updates, and respects a manually disabled microphone", async ({ page }) => {
  const context = await setup(page);
  try {
    await page.locator("#status-detail").click();
    const capture = () => page.evaluate(() => (window as unknown as { mediaCapture: boolean }).mediaCapture);
    await expect.poll(capture).toBe(true);
    const video = page.getByLabel("Local video", { exact: true });
    await video.evaluate(async (item: HTMLVideoElement) => {
      item.loop = true;
      Object.assign(window, { playingVideo: item });
      await item.play();
    });
    await expect(page.locator("#status")).toHaveText("Listening paused");
    await expect.poll(capture).toBe(false);
    context.fixture.publish(context.project, "session.step.ended", { sessionID: context.session.id });
    await page.waitForTimeout(500);
    expect(await video.evaluate((item: HTMLVideoElement) => !item.paused && (window as unknown as { playingVideo: HTMLVideoElement }).playingVideo === item)).toBe(true);
    await expect.poll(() => video.evaluate((item: HTMLVideoElement) => item.currentTime)).toBeGreaterThan(0);
    await video.evaluate((item: HTMLVideoElement) => { item.currentTime = 0.3; item.pause(); });
    await expect.poll(capture).toBe(true);
    await video.evaluate(async (item: HTMLVideoElement) => { item.loop = false; item.currentTime = 0; await item.play(); });
    await expect.poll(capture).toBe(false);
    await expect.poll(() => video.evaluate((item: HTMLVideoElement) => item.ended)).toBe(true);
    await expect.poll(capture).toBe(true);
    await video.evaluate((item: HTMLVideoElement) => item.play());
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await video.evaluate((item: HTMLVideoElement) => item.pause());
    await expect.poll(capture).toBe(false);
    await expect(page.locator("#status")).toHaveText("Channel closed");
  } finally { await context.cleanup(); }
});

test("only opened YouTube and Vimeo players pause listening, and closing or leaving restores it", async ({ page }) => {
  const context = await setup(page);
  try {
    await page.locator("#status-detail").click();
    const capture = () => page.evaluate(() => (window as unknown as { mediaCapture: boolean }).mediaCapture);
    await expect.poll(capture).toBe(true);
    for (const label of ["YouTube example", "Vimeo example"]) {
      await page.getByRole("button", { name: `Open player: ${label}` }).click();
      await expect(page.getByTitle(label, { exact: true })).toBeVisible();
      const frame = page.getByTitle(label, { exact: true });
      await expect(frame).toHaveAttribute("referrerpolicy", label.startsWith("YouTube") ? "origin" : "no-referrer");
      await expect(page.locator("#status")).toHaveText("Listening paused");
      await expect.poll(capture).toBe(false);
      await frame.evaluate((item) => Object.assign(window, { openMediaFrame: item }));
      context.fixture.publish(context.project, "session.step.ended", { sessionID: context.session.id });
      await page.waitForTimeout(300);
      expect(await frame.evaluate((item) => item === (window as unknown as { openMediaFrame: Element }).openMediaFrame)).toBe(true);
      await page.getByRole("button", { name: "Close player", exact: true }).click();
      await expect(page.locator("iframe")).toHaveCount(0);
      await expect.poll(capture).toBe(true);
    }
    await page.getByRole("button", { name: "Open player: YouTube example" }).click();
    await page.getByRole("button", { name: "Open player: Vimeo example" }).click();
    await expect(page.locator("iframe")).toHaveCount(1);
    await expect.poll(capture).toBe(false);
    await page.getByRole("button", { name: "New log entry", exact: true }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect.poll(capture).toBe(true);
  } finally { await context.cleanup(); }
});

test("streamed local references wait for saved history, and structured officer media can appear without text", async ({ page }) => {
  const context = await setup(page);
  try {
    const text = "An original streamed image.\n\n![Streamed image](<test image.png>)";
    context.fixture.publish(context.project, "session.text.delta", {
      sessionID: context.session.id, assistantMessageID: "streamed-answer", ordinal: 0, delta: text,
    });
    await expect(page.getByText("Waiting for the completed reply before loading this file.")).toBeVisible();
    context.fixture.messages.get(context.session.id)!.push({
      id: "streamed-answer", type: "assistant", time: { created: 2 }, content: [{ type: "text", text }],
    });
    context.fixture.publish(context.project, "session.text.ended", { sessionID: context.session.id });
    await expect.poll(() => page.getByAltText("Streamed image").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(480);
    const officer = context.fixture.createSession(context.project, "Officer media", context.session.id, "picard-data");
    context.fixture.messages.get(officer.id)!.push({
      id: "tool-image", type: "assistant", agent: "picard-data", time: { created: 3 }, content: [{
        type: "tool", id: "picture", name: "test-only", state: { status: "completed", content: [
          { type: "file", uri: "test%20image.png", mime: "image/png", name: "Officer image" },
        ] },
      }],
    });
    context.fixture.publish(context.project, "session.step.ended", { sessionID: officer.id });
    await expect.poll(() => page.getByAltText("Officer image").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(480);
    await expect(page.locator(".crew-report strong")).toHaveText("Data");
  } finally { await context.cleanup(); }
});

test("a computer reply keeps its unique media when its text repeats an officer report", async ({ page }) => {
  const context = await setup(page);
  try {
    const text = "An original media result.";
    const officer = context.fixture.createSession(context.project, "Officer report", context.session.id, "picard-data");
    context.fixture.messages.get(officer.id)!.push({
      id: "officer-text", type: "assistant", agent: "picard-data", time: { created: 2 },
      content: [{ type: "text", text }],
    });
    context.fixture.messages.get(context.session.id)!.push({
      id: "computer-media", type: "assistant", time: { created: 3 }, content: [
        { type: "text", text },
        { type: "tool", id: "video", name: "test-only", state: { status: "completed", content: [
          { type: "file", uri: "demo.webm", mime: "video/webm", name: "Unique computer video" },
        ] } },
      ],
    });
    context.fixture.publish(context.project, "session.step.ended", { sessionID: context.session.id });
    await expect(page.locator(".crew-report strong")).toHaveText("Data");
    await expect(page.getByLabel("Unique computer video", { exact: true })).toBeVisible();
  } finally { await context.cleanup(); }
});

test("a new spoken decision stops an open player before the computer speaks", async ({ page }) => {
  const context = await setup(page, ["Computer, hello there", "take a very slow look"]);
  try {
    await page.locator("#status-detail").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { mediaCapture: boolean }).mediaCapture)).toBe(true);
    const voice = Array.from(syntheticVoice(1, 0.1), (value) => Math.round(value * 32767));
    const utterance = async () => {
      // These synthetic packets arrive together; let the 100 ms cue and echo guard finish first.
      await page.waitForTimeout(350);
      await page.evaluate((voice) => {
        const port = (window as unknown as { mediaCapturePort: MessagePort }).mediaCapturePort;
        for (let frame = 0; frame < 110; frame++) {
          const samples = new Int16Array(320);
          if (frame < 50) samples.set(voice.slice(frame * 320, frame * 320 + 320));
          port.dispatchEvent(new MessageEvent("message", { data: samples.buffer }));
        }
      }, voice);
    };
    await utterance();
    await expect.poll(() => context.speech.said.length).toBeGreaterThan(0);
    await expect(page.locator("#status")).toHaveText("Standing by");
    const session = context.session;
    expect(context.fixture.sessions.size).toBe(1);
    await expect(page.locator(".message[data-role=user]").last()).toContainText("hello there");
    await expect(page.getByRole("button", { name: "Open player: YouTube example" })).toBeVisible();
    await utterance();
    await expect(page.locator(".message[data-role=user]").last()).toContainText("take a very slow look");
    await page.getByRole("button", { name: "Open player: YouTube example" }).click();
    await expect(page.locator("#status")).toHaveText("Listening paused");
    context.fixture.permissions.push({ id: "test-media-decision", sessionID: session.id, action: "shell", resources: ["test-only command"] });
    context.fixture.publish(context.project, "permission.asked", { sessionID: session.id });
    await expect(page.getByRole("heading", { name: "Approval required." })).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator("#status")).not.toHaveText("Listening paused");
    await expect.poll(() => context.speech.said.some((item) => item.text.includes("approval is required"))).toBe(true);
  } finally { await context.cleanup(); }
});
