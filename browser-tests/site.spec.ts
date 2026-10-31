import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let server: Server;
let address: string;
const files: Record<string, { path: string; mime: string }> = {
  "/picard-code/": { path: "index.html", mime: "text/html" },
  "/picard-code/style.css": { path: "style.css", mime: "text/css" },
  "/picard-code/assets/mark.svg": { path: "assets/mark.svg", mime: "image/svg+xml" },
  "/picard-code/assets/console.png": { path: "assets/console.png", mime: "image/png" },
};

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = files[path];
    if (!file) { response.writeHead(404); response.end(); return; }
    void readFile(resolve("site", file.path)).then((content) => {
      response.writeHead(200, { "Content-Type": file.mime });
      response.end(content);
    }, (error: unknown) => {
      console.error(`Could not serve website test file ${file.path}:`, error);
      response.writeHead(500); response.end("The website test file could not be read.");
    });
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("The website test server has no port.");
  address = `http://127.0.0.1:${bound.port}/picard-code/`;
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
});

for (const width of [1440, 390]) {
  test(`project website works at ${width}px under the Pages project path`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const failures: string[] = [];
    page.on("response", (response) => { if (response.status() >= 400) failures.push(response.url()); });
    page.on("requestfailed", (request) => failures.push(request.url()));
    await page.goto(address);
    await expect(page).toHaveTitle("Picard Code — Help shape the computer");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You speak.The computer answers.");
    await expect(page.getByRole("link", { name: "Help shape the computer", exact: true })).toBeVisible();
    await expect(page.locator("script, iframe, audio, video")).toHaveCount(0);
    await page.locator(".console").scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator("img").evaluateAll((images) =>
      images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const localLinks = await page.locator('a[href^="#"]').evaluateAll((links) =>
      links.every((link) => document.querySelector(link.getAttribute("href")!) !== null));
    expect(localLinks).toBe(true);
    expect(failures).toEqual([]);
    await page.screenshot({ path: info.outputPath(`website-${width}.png`), fullPage: true });
  });
}

test("website keyboard access, reduced motion, and guide links stay intact", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(address);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  const targets = await page.locator("a").evaluateAll((links) => links.map((link) => link.href));
  for (const target of targets) {
    const url = new URL(target);
    expect(["http:", "https:"]).toContain(url.protocol);
    if (url.hostname === "github.com" && url.pathname.startsWith("/sbroenne/picard-code/blob/main/")) {
      const path = decodeURIComponent(url.pathname.slice("/sbroenne/picard-code/blob/main/".length));
      expect((await readFile(resolve(path))).length).toBeGreaterThan(0);
    }
    if (url.origin !== new URL(address).origin) expect(url.protocol).toBe("https:");
  }
});
