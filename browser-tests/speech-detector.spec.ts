import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { syntheticVoice, steadyNoise } from "../src/tests/test-audio";

declare global {
  interface Window { startDetectorAudio(): void }
}

test.use({ permissions: ["microphone"], launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-audio-output",
] } });
test.setTimeout(60000);

async function detectorPage(page: Page, samples: Float32Array, prediction: (bytes: number, check: number) => boolean | undefined) {
  const silence = Buffer.alloc(44 + 4800);
  silence.write("RIFF"); silence.writeUInt32LE(silence.length - 8, 4); silence.write("WAVEfmt ", 8);
  silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(24000, 24); silence.writeUInt32LE(48000, 28);
  silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
  silence.write("data", 36); silence.writeUInt32LE(4800, 40);
  await page.route("**/api/sounds/*", (route) => route.fulfill({ contentType: "audio/wav", body: silence }));
  await page.addInitScript((audio) => {
    const original = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function () {
      const destination = this.createMediaStreamDestination();
      const buffer = this.createBuffer(1, audio.length, 16000);
      buffer.getChannelData(0).set(audio);
      const source = this.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      window.startDetectorAudio = () => source.start();
      return original.call(this, destination.stream);
    };
  }, Array.from(samples));
  const commands: string[] = [];
  const trace: string[] = [];
  const assets: string[] = [];
  // Only backend pause predictions are stand-ins. Silero, WebAssembly and browser audio run unchanged.
  await page.routeWebSocket("**/api/speech", (browser) => {
    const server = browser.connectToServer();
    let bytes = 0;
    let checks = 0;
    browser.onMessage((payload) => {
      if (typeof payload === "string") {
        const command = JSON.parse(payload) as { type: string; id?: number };
        commands.push(command.type);
        trace.push(`${command.type} at ${Date.now()} (${bytes} bytes)`);
        if (command.type === "listen") bytes = 0;
        if (command.type === "check-turn") {
          const complete = prediction(bytes, ++checks);
          if (complete !== undefined) browser.send(JSON.stringify({ type: "turn-result", id: command.id, complete }));
          return;
        }
      } else bytes += payload.length;
      server.send(payload);
    });
  });
  page.on("response", (response) => {
    if (response.ok() && /\.(onnx|wasm)(?:$|\?)/.test(response.url())) assets.push(response.url());
  });
  const child = spawn(process.execPath, ["dist/tests/browser-launch.js", "--speech"], { stdio: ["ignore", "pipe", "pipe"] });
  page.on("close", () => child.kill());
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  const url = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(new Error(`The browser check did not start. ${errors}`)); }, 15000);
    child.once("error", (error) => { clearTimeout(timer); fail(error); });
    child.once("exit", () => { clearTimeout(timer); fail(new Error(`The browser check stopped. ${errors}`)); });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const address = /http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]+/.exec(output);
      if (address) { clearTimeout(timer); done(address[0]); }
    });
  });
  await page.goto(url);
  await expect(page.getByRole("status")).toHaveText(/Standing by|Click to enable sound/, { timeout: 15000 });
  await page.locator("#status").click();
  await expect(page.getByRole("status")).toHaveText("Standing by");
  await expect.poll(() => assets.some((asset) => asset.includes(".onnx"))).toBe(true);
  await expect.poll(() => assets.some((asset) => asset.includes(".wasm"))).toBe(true);
  return { commands, trace };
}

test("shipped Silero and WebAssembly reject noise, hear speech and retain a thinking pause", async ({ page }) => {
  const audio = new Float32Array(16000 * 12);
  audio.set(steadyNoise("pink", 3, 0.003), 0);
  audio.set(syntheticVoice(1, 0.1), 16000 * 4);
  audio.set(syntheticVoice(1, 0.1), 16000 * 7);
  const { commands, trace } = await detectorPage(page, audio, (bytes) => bytes >= 32000 * 3);
  await page.evaluate(() => window.startDetectorAudio());
  await page.waitForTimeout(3300);
  expect(commands).not.toContain("listen");
  await expect.poll(() => commands.filter((type) => type === "check-turn").length, { timeout: 6000 }).toBe(1);
  expect(commands).not.toContain("commit");
  await expect.poll(() => commands.filter((type) => type === "commit").length, { timeout: 6000 }).toBe(1);
  // Automatic listening may already have resumed by the time polling observes the completed request.
  const request = commands.slice(0, commands.indexOf("commit") + 1);
  expect(request.filter((type) => type === "listen"), trace.join("\n")).toHaveLength(1);
  expect(request.filter((type) => type === "check-turn").length).toBeGreaterThanOrEqual(2);
});

test("microphone restart resets real browser detection without submitting the abandoned audio", async ({ page }) => {
  const audio = new Float32Array(16000 * 6);
  audio.set(syntheticVoice(1, 0.1), 8000);
  const { commands } = await detectorPage(page, audio, (_bytes, check) => check === 1 ? undefined : true);
  await page.evaluate(() => window.startDetectorAudio());
  await expect.poll(() => commands.filter((type) => type === "check-turn").length, { timeout: 6000 }).toBe(1);
  await page.getByRole("button", { name: "Switch microphone off" }).click();
  await page.getByRole("button", { name: "Switch microphone on" }).click();
  await expect(page.getByRole("status")).toHaveText("Standing by");
  expect(commands).not.toContain("commit");
  await page.evaluate(() => window.startDetectorAudio());
  await expect.poll(() => commands.filter((type) => type === "commit").length, { timeout: 6000 }).toBe(1);
  expect(commands.filter((type) => type === "listen")).toHaveLength(2);
});
