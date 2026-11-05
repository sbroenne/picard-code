import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Captures the page as full-density JPEG frames until stopped. Chrome's own screen recorder
 * only delivers the layout size (1280×720), so each frame is a real screenshot at the page's
 * pixel density. Each frame records when it was taken, in seconds since 1970, like the audio.
 */
export function startCapture(page, folder, now = () => Date.now() / 1000) {
  const frames = [];
  let running = true;
  let failure;
  let writing = Promise.resolve();
  const loop = (async () => {
    while (running && !failure) {
      const time = now();
      const image = await page.screenshot({ type: "jpeg", quality: 92, caret: "initial" });
      const file = `${String(frames.length).padStart(6, "0")}.jpg`;
      frames.push({ file, time });
      writing = writing.then(() => writeFile(join(folder, file), image)).catch((error) => { failure ??= error; });
    }
  })().catch((error) => { failure ??= error; });
  return {
    frames,
    /** Stops after the current frame, waits until every frame is on disk, and reports a capture failure. */
    async stop() {
      running = false;
      await loop;
      await writing;
      if (failure) throw failure;
      return frames;
    },
  };
}
