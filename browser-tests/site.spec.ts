import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { marked } from "marked";

// Every file in site/ is served under the GitHub Pages project path, without a real server.
const address = "http://127.0.0.1/picard-code/";
const site = resolve("site");

test("the npm and GitHub README is a short front page with a launch command and user guide", async () => {
  const readme = await readFile("README.md", "utf8");
  expect(readme.split("\n").length).toBeLessThanOrEqual(150);
  expect(Buffer.byteLength(readme)).toBeLessThanOrEqual(8_000);
  expect(readme).toContain("npx picard-code");
  const sourceCommands = "git clone https://github.com/sbroenne/picard-code.git\ncd picard-code\nnpm start";
  expect(readme).toContain(sourceCommands);
  expect(await readFile("docs/USER_GUIDE.md", "utf8")).toContain(sourceCommands);
  expect(readme).toContain("https://github.com/sbroenne/picard-code/blob/main/docs/USER_GUIDE.md");
});

test("the README and linked guides keep working repository links and section anchors", async ({ page }) => {
  const repository = "https://github.com/sbroenne/picard-code/blob/main/";
  const sources = ["README.md", "PRODUCT.md", "DESIGN.md", "docs/USER_GUIDE.md", "SUPPORT.md", "CONTRIBUTING.md", "docs/DEVELOPMENT.md", "docs/research/bridge-crew-voices.md", "tools/README.md", "site/index.html", "web/index.html"];
  const documents = new Map<string, { links: string[]; anchors: string[] }>();
  const document = async (path: string) => {
    const saved = documents.get(path);
    if (saved) return saved;
    const text = await readFile(resolve(path), "utf8");
    if (path.endsWith(".md")) {
      marked.walkTokens(marked.lexer(text), (token) => {
        if (token.type === "strong" || token.type === "em") {
          expect(token.raw, `${path}: keep emphasis on one source line for Markdown previews`).not.toContain("\n");
        }
      });
    }
    const html = path.endsWith(".md") ? await marked.parse(text) : text;
    const parsed = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const counts = new Map<string, number>();
      const headings = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) => {
        const slug = (heading.textContent ?? "").toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/ /g, "-");
        const count = counts.get(slug) ?? 0;
        counts.set(slug, count + 1);
        return count ? `${slug}-${count}` : slug;
      });
      return {
        links: [...doc.querySelectorAll("a[href], img[src]")].map((node) => node.getAttribute("href") ?? node.getAttribute("src") ?? ""),
        anchors: [...headings, ...[...doc.querySelectorAll("[id]")].map((node) => node.id)],
      };
    }, html);
    documents.set(path, parsed);
    return parsed;
  };
  for (const source of sources) {
    for (const link of (await document(source)).links) {
      // The app handles its fragment routes in JavaScript, not document anchors.
      if (source === "web/index.html" && link.startsWith("#")) continue;
      const url = new URL(link, repository + source);
      const raw = "https://raw.githubusercontent.com/sbroenne/picard-code/main/";
      const readme = url.origin === "https://github.com" && /^\/sbroenne\/picard-code\/?$/.test(url.pathname) && url.hash;
      const prefix = url.href.startsWith(repository) ? repository : url.href.startsWith(raw) ? raw : undefined;
      if (!prefix && !readme) continue;
      const path = readme ? "README.md" : decodeURIComponent(url.href.slice(prefix!.length).split(/[?#]/)[0]!);
      expect(existsSync(resolve(path)), `${source}: ${link}`).toBe(true);
      if (url.hash) {
        expect((await document(path)).anchors, `${source}: ${link}`).toContain(decodeURIComponent(url.hash.slice(1)));
      }
    }
  }
});

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
    await expect(page.getByRole("link", { name: "Watch the video on YouTube" })).toHaveAttribute("href", "https://youtu.be/pFGjNWeaHJI");
    const screenshots = page.locator(".screenshots figure");
    await expect(screenshots).toHaveCount(3);
    for (const [index, name] of ["Current log entry", "The bridge crew", "Captain’s log"].entries()) {
      const figure = screenshots.nth(index);
      await expect(figure.locator("figcaption")).toContainText(name);
      await expect(figure.locator("figcaption")).toContainText("Staged example");
      await expect(figure.locator("img")).toHaveAttribute("alt", /.+/);
      const image = await figure.locator("img").getAttribute("src");
      await expect(figure.getByRole("link")).toHaveAttribute("href", image!);
      await figure.scrollIntoViewIfNeeded();
    }
    await expect(page.locator("#start pre code")).toHaveText([
      "npx picard-code",
      "git clone https://github.com/sbroenne/picard-code.git\ncd picard-code\nnpm start",
    ]);
    await expect(page.getByRole("heading", { name: "Or run a repository clone" })).toBeVisible();
    await expect(page.locator("#start .source")).toContainText("installs the needed packages and builds the app before launching");
    await expect(page.locator("#start .intro")).toContainText("The first start-up begins");
    await expect(page.locator("#start .intro")).toContainText("Advanced setup");
    await expect(page.locator(".site-footer")).toContainText("Not connected with or endorsed by Sir Patrick Stewart");
    await expect(page.locator('script:not([type="application/ld+json"]), iframe, audio, video')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
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
