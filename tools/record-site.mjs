import { createServer } from "node:http";
import { readFile, rename, stat } from "node:fs/promises";
import { join, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

/** When the slow scroll through the finished site starts and how long it takes, in seconds of site.webm. */
export const SITE_SCROLL = { start: 1.5, duration: 4 };

/**
 * Records the site the crew built: its top as it loads, then one slow scroll to the bottom, so the shot moves.
 * Writes site.webm and site.png (the top of the page) into `output` and returns the page's own errors.
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
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: output, size: { width: 1920, height: 1080 } } });
  try {
    const page = await context.newPage();
    const opened = Date.now();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.screenshot({ path: join(output, "site.png") });
    await page.waitForTimeout(Math.max(0, SITE_SCROLL.start * 1000 - (Date.now() - opened)));
    const bottom = await page.evaluate((duration) => new Promise((done) => {
      const scroller = document.scrollingElement;
      const distance = scroller.scrollHeight - innerHeight;
      const begun = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - begun) / duration);
        scroller.scrollTop = distance * (1 - Math.cos(Math.PI * progress)) / 2;
        if (progress < 1) requestAnimationFrame(step);
        else done({ top: scroller.scrollTop, distance });
      };
      requestAnimationFrame(step);
    }), SITE_SCROLL.duration * 1000);
    await page.waitForTimeout(2000);
    const video = await page.video().path();
    await context.close();
    await rename(video, join(output, "site.webm"));
    return { errors, ...bottom };
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
