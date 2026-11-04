import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

// Every file in site/ is served under the GitHub Pages project path, without a real server.
const address = "http://127.0.0.1/picard-code/";
const site = resolve("site");

test.beforeEach(async ({ page }) => {
  await page.route((url) => url.href.startsWith(address), (route) => {
    const file = resolve(site, new URL(route.request().url()).pathname.slice("/picard-code/".length) || "index.html");
    return file.startsWith(site + sep) && existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
  });
});

for (const width of [1440, 390]) {
  test(`project website works at ${width}px under the Pages project path`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const failures: string[] = [];
    page.on("response", (response) => { if (response.status() >= 400) failures.push(response.url()); });
    page.on("requestfailed", (request) => failures.push(request.url()));
    await page.goto(address);
    await expect(page).toHaveTitle("Picard Code — A tribute to Sir Patrick Stewart and Captain Jean-Luc Picard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A tribute to Sir Patrick Stewart and Captain Jean-Luc Picard");
    await expect(page.locator("main h1, main h2").first()).toHaveText(/tribute/i);
    await expect(page.getByRole("link", { name: "Help shape the computer", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Watch the video on YouTube" })).toHaveAttribute("href", "https://youtu.be/_OKnpwS9dOI");
    await expect(page.locator(".console figcaption")).toContainText("staged example conversation");
    await expect(page.locator("#start pre code")).toHaveText([
      "npx picard-code",
      "git clone https://github.com/sbroenne/picard-code.git\ncd picard-code\nnpm install\nnpm run build\nnpm start",
    ]);
    await expect(page.getByRole("heading", { name: "Or run a repository clone" })).toBeVisible();
    await expect(page.locator("#start .intro")).toContainText("The first start-up begins");
    await expect(page.locator("#start .intro")).toContainText("Advanced setup");
    await expect(page.locator(".site-footer")).toContainText("Not connected with or endorsed by Sir Patrick Stewart");
    await expect(page.locator('script:not([type="application/ld+json"]), iframe, audio, video')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
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
