import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, SITE_FPS } from "../video/quality.mjs";

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

/** When the slow scroll through the finished site starts and how long it takes, in seconds of the site footage. */
export const SITE_SCROLL = { start: 1.5, duration: 4 };
/** How long the site footage lasts: the scroll, then two seconds at the bottom. */
export const SITE_END = SITE_SCROLL.start + SITE_SCROLL.duration + 2;

/**
 * Records the site the crew built: its top as it loads, then one slow scroll to the bottom, so the shot moves.
 * The scroll is captured one frame at a time at twice the pixel density, so it is smooth and sharp in 4K
 * however long each screenshot takes. Writes site-frames/, site.json (each frame's time in the footage)
 * and site.png (the top of the page) into `output`, and returns the page's own errors.
 */
export async function recordSite(browser, project, output) {
  const server = createServer(async (request, response) => {
    try {
      const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname)).replace(/^[/\\]+/, "") || "index.html";
      const file = join(project, path);
      if (!file.startsWith(`${project}${sep}`)) { response.writeHead(403).end(); return; }
      if ((await stat(file)).isDirectory()) throw new Error("Folder");
      response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const context = await browser.newContext({ viewport: { width: SITE.width, height: SITE.height }, deviceScaleFactor: SITE.scale });
  const folder = join(output, "site-frames");
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder);
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.screenshot({ path: join(output, "site.png") });
    const frames = [];
    const shoot = async (time) => {
      const file = `${String(frames.length).padStart(6, "0")}.jpg`;
      await page.screenshot({ path: join(folder, file), type: "jpeg", quality: 92 });
      frames.push({ file, time });
    };
    await shoot(0);
    // Smooth scrolling in the site's own style would blur the steps together.
    const distance = await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      return document.scrollingElement.scrollHeight - innerHeight;
    });
    const steps = Math.round(SITE_SCROLL.duration * SITE_FPS);
    let top = 0;
    for (let step = 1; step <= steps; step++) {
      top = await page.evaluate(([distance, progress]) => {
        const scroller = document.scrollingElement;
        scroller.scrollTop = distance * (1 - Math.cos(Math.PI * progress)) / 2;
        return scroller.scrollTop;
      }, [distance, step / steps]);
      await shoot(SITE_SCROLL.start + step / SITE_FPS);
    }
    await writeFile(join(output, "site.json"), `${JSON.stringify({ frames, end: SITE_END }, null, 2)}\n`);
    return { errors, top, distance };
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

// Records the site again for an existing take: node tools/record-site.mjs video/out/episode-…
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { chromium } = await import("@playwright/test");
  const episode = resolve(process.argv[2] ?? "");
  const browser = await chromium.launch();
  try {
    const result = await recordSite(browser, join(episode, "tribute-site"), episode);
    if (result.errors.length) throw new Error(`The site reported errors: ${result.errors.join("; ")}`);
    console.log(`Recorded the site: scrolled ${Math.round(result.top)} of ${Math.round(result.distance)} pixels.`);
  } finally { await browser.close(); }
}
