// Picture quality rules for the YouTube episode. YouTube re-compresses every
// upload and gives 1080p uploads little detail, so small interface text turns
// soft. A 4K upload gets YouTube's sharper streams, even for 1080p viewers.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** The size of the render and the upload. */
export const UPLOAD = { width: 3840, height: 2160 };
/** The app is shown in its 1280×720 layout at three times the pixel density, so it fills 4K without stretching. */
export const FOOTAGE = { width: 1280, height: 720, scale: 3 };
/** The finished site is shown in a 1920×1080 layout at twice the pixel density. */
export const SITE = { width: 1920, height: 1080, scale: 2 };
/** Frames per second of the site scroll, which is captured one frame at a time. */
export const SITE_FPS = 30;
/** Below this the app footage looks jerky; the 4K capture usually manages about 12 frames a second. */
export const MIN_FRAME_RATE = 6;

/** Fails unless a picture has exactly the expected size in pixels. */
export function checkSize(label, actual, expected) {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(`${label} is ${actual.width}×${actual.height} pixels; it must be ${expected.width}×${expected.height} so the YouTube video stays sharp.`);
  }
}

/** The pixel size of a layout at its pixel density. */
export const pixels = ({ width, height, scale }) => ({ width: width * scale, height: height * scale });

/** Fails when the app footage was captured too slowly to play smoothly. */
export function checkFrameRate(frames) {
  const times = frames.map((frame) => frame.time).toSorted((first, second) => first - second);
  const span = times.at(-1) - times[0];
  const rate = span > 0 ? (times.length - 1) / span : 0;
  if (rate < MIN_FRAME_RATE) throw new Error(`The app was captured at ${rate.toFixed(1)} frames a second; at least ${MIN_FRAME_RATE} are needed. Close other busy programs and record again.`);
  return rate;
}

/** The width and height of the first video stream or image in a file, from ffprobe. */
export async function mediaSize(file) {
  const { stdout } = await execute("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}
