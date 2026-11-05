import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MIN_FRAME_RATE, UPLOAD, checkFrameRate, checkSize } from "./quality.mjs";

test("a 1080p or stretched 720p picture is refused, a 4K one is accepted", () => {
  assert.throws(() => checkSize("The render", { width: 1920, height: 1080 }, UPLOAD), /The render is 1920×1080 pixels; it must be 3840×2160/);
  assert.throws(() => checkSize("The app footage", { width: 1280, height: 720 }, UPLOAD), /1280×720/);
  assert.doesNotThrow(() => checkSize("The render", { width: 3840, height: 2160 }, UPLOAD));
});

test("app footage captured too slowly is refused", () => {
  const at = (rate) => Array.from({ length: 50 }, (_, index) => ({ file: `${index}.jpg`, time: 1000 + index / rate }));
  assert.throws(() => checkFrameRate(at(MIN_FRAME_RATE - 1)), /frames a second; at least/);
  assert.ok(Math.abs(checkFrameRate(at(12)) - 12) < 0.01);
});

test("npm run render makes a sharp 4K render from lossless frames", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  assert.match(scripts.render, /--resolution 4k/);
  assert.match(scripts.render, /--crf 1[0-4]\b/);
  assert.match(scripts.render, /--video-frame-format png/);
});
