import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { startFixture } from "../src/tests/fixture";
import { startApp } from "../src/server/app";
import { makeClient } from "../src/server/engine";
import { saveModelSettings } from "../src/server/model-settings";
import { speechFixture } from "../src/tests/speech-fixture";
import { officeFile, pdfFile, silentWav } from "../src/tests/output-files";
import type { ContentItem } from "../src/server/opencode";

const audioFolder = resolve(`.picard-test-outputs-microphone-${process.pid}`);
const microphone = join(audioFolder, "silence.wav");
test.beforeAll(async () => { await mkdir(audioFolder); await writeFile(microphone, silentWav(60)); });
test.afterAll(async () => { await rm(audioFolder, { recursive: true }); });
test.use({ permissions: ["microphone"], launchOptions: { args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-audio-output",
  `--use-file-for-fake-audio-capture=${microphone}`,
] } });

const chart = `xychart-beta
  title "TEST ONLY: USD to EUR"
  x-axis "Stardate" ["-296238.4", "-296219.2", "-296200.0", "-296180.8", "-296156.2"]
  y-axis "EUR per USD" 0.885 --> 0.900
  line [0.88739, 0.89381, 0.89166, 0.89686, 0.89095]`;

async function setup(page: import("@playwright/test").Page, text: string, extra: ContentItem[] = []) {
  const temporary = await mkdtemp(resolve(".picard-test-outputs-"));
  const project = await realpath(temporary);
  const fixture = await startFixture(project);
  const session = fixture.createSession(project, "Output stand-in");
  fixture.messages.get(session.id)!.push({
    id: "output-answer", type: "assistant", time: { created: 1 },
    content: [{ type: "text", text }, {
      type: "tool", id: "shell-result", name: "shell",
      state: { status: "completed", input: { command: "printf 'TEST ONLY command result'" },
        content: [{ type: "text", text: "TEST ONLY command result" }] },
    }, ...extra],
  });
  const modelFile = join(project, "model.json");
  for (const name of ["startup", "request-accepted", "input-failed", "request-failed"]) await writeFile(join(project, `${name}.mp3`), silentWav(0.1));
  await saveModelSettings(modelFile, { providerID: "github-copilot", modelID: "fixture-model" });
  const app = await startApp({ client: makeClient(fixture.url, fixture.password), project,
    webRoot: resolve(process.env.PICARD_OUTPUT_BASELINE_WEB ?? "web-dist"), modelFile, speech: speechFixture([""]).service,
    soundFolder: project, speechFile: join(project, "unused.json") });
  try {
    await page.goto(app.url);
    await expect(page.locator("#messages")).toContainText("TEST ONLY");
  } catch (error) {
    await app.close(); await fixture.close(); await rm(temporary, { recursive: true });
    throw error;
  }
  return { fixture, session, project, cleanup: async () => {
    await app.close(); await fixture.close(); await rm(temporary, { recursive: true });
  } };
}

test("OpenCode charts render as graphs rather than source and survive reopening", async ({ page }) => {
  const context = await setup(page, `TEST ONLY: generated chart fixture.\n\n## On screen\n\n\`\`\`mermaid\n${chart}\n\`\`\``);
  try {
    const graph = page.getByRole("img", { name: /TEST ONLY: USD to EUR/ });
    await expect(graph).toBeVisible();
    expect(await graph.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.getByText("View source", { exact: true }).click();
    await expect(page.locator(".reply-output pre")).toContainText("0.885 --> 0.900");
    await expect(page.locator(".reply-output pre")).toContainText("0.88739");
    await page.getByRole("button", { name: "Switch microphone off" }).click();
    await page.getByRole("button", { name: "Switch microphone on" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    await expect(graph).toBeVisible();
    const other = await page.context().newPage();
    await other.goto(page.url());
    await expect(other.getByRole("img", { name: /TEST ONLY: USD to EUR/ })).toBeVisible();
    await other.close();
    await page.getByRole("link", { name: "Captain’s log" }).click();
    await page.locator(".conversation-button", { hasText: "Output stand-in" }).click();
    await expect(graph).toBeVisible();
    await page.reload();
    await expect(graph).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.cleanup(); }
});

test("OpenCode completed work remains inspectable instead of being hidden", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: the result is on screen.");
  try {
    await page.getByText("Work details", { exact: true }).click();
    await expect(page.locator(".work-details")).toContainText("TEST ONLY command result");
    await expect(page.locator(".work-details")).toContainText("printf");
  } finally { await context.cleanup(); }
});

test("OpenCode maths and code render without executing model HTML", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: maths and code.\n\n$x^2 + y^2 = z^2$\n\n"
    + "```typescript\nconst safe = true;\n```\n\n<img src=x onerror=alert(1)>");
  try {
    await expect(page.locator("#messages math")).toBeVisible();
    await expect(page.locator("#messages code .code-token")).not.toHaveCount(0);
    await expect(page.locator("#messages")).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator("#messages img[onerror]")).toHaveCount(0);
  } finally { await context.cleanup(); }
});

for (const kind of ["docx", "xlsx", "pptx", "pdf"] as const) {
  test(`OpenCode ${kind} results have real read-only previews`, async ({ page }) => {
    const context = await setup(page, `TEST ONLY: document fixture.\n\n[Document](result.${kind})`);
    try {
      await writeFile(join(context.project, `result.${kind}`), kind === "pdf" ? pdfFile() : await officeFile(kind));
      await page.getByRole("button", { name: "Preview: Document" }).click();
      const preview = page.locator(".file-preview");
      if (kind === "docx") {
        await expect(preview).toContainText("TEST ONLY Word document");
        await expect(preview.locator("section")).toBeVisible();
      } else {
        await expect(preview.locator("canvas")).toBeVisible();
        if (kind === "pdf") await expect(preview).toContainText("TEST ONLY PDF");
        if (kind === "xlsx") {
          await page.getByRole("combobox", { name: "Sheet", exact: true }).selectOption("1");
          await expect(preview).toContainText("Second");
          await preview.getByText("Readable sheet content", { exact: true }).click();
          await expect(preview).toContainText("TEST ONLY Sheet 2");
        }
        if (kind === "pptx") {
          await page.getByRole("combobox", { name: "Slide", exact: true }).selectOption("1");
          await expect(preview).toContainText("TEST ONLY Slide 2");
        }
      }
      await page.getByRole("button", { name: "Close preview: Document" }).click();
      await expect(preview).toBeHidden();
      await page.getByRole("button", { name: "Preview: Document" }).click();
      await expect(preview.locator('[role="alert"]')).toHaveCount(0);
      if (kind === "docx") await expect(preview).toContainText("TEST ONLY Word document");
      else await expect(preview.locator("canvas")).toBeVisible();
    } finally { await context.cleanup(); }
  });
}

test("graphs keep decimal scales and plotted data, not just a source-shaped image", async ({ page }) => {
  const context = await setup(page, `TEST ONLY\n\n\`\`\`mermaid\n${chart}\n\`\`\``);
  try {
    const image = page.getByRole("img", { name: /TEST ONLY: USD to EUR/ });
    await expect(image).toBeVisible();
    const plotted = await image.evaluate((img: HTMLImageElement) => {
      const source = decodeURIComponent(img.src.split(",").slice(1).join(","));
      const svg = new DOMParser().parseFromString(source, "image/svg+xml");
      return { text: svg.documentElement.textContent,
        points: [...svg.querySelectorAll(".pele-line circle")].map((point) => Number(point.getAttribute("cy"))),
        grid: svg.querySelector(".pele-grid")?.getAttribute("d") };
    });
    expect(plotted.text).toContain("Stardate");
    expect(plotted.text).toContain("-296238.4");
    expect(plotted.text).toContain("0.886");
    expect(plotted.text).toContain("0.9");
    const ticks = [...plotted.grid!.matchAll(/M[\d.]+,([\d.]+)/g)].map((match) => Number(match[1]));
    const pixelsPerUnit = (ticks[0]! - ticks.at(-1)!) / (0.9 - 0.886);
    expect(plotted.points).toHaveLength(5);
    for (const [index, value] of [0.88739, 0.89381, 0.89166, 0.89686, 0.89095].entries()) {
      expect(0.9 - (plotted.points[index]! - ticks.at(-1)!) / pixelsPerUnit).toBeCloseTo(value, 5);
    }
    await expect(page.locator(".reply-output [role=alert]")).toHaveCount(0);
  } finally { await context.cleanup(); }
});

test("finished broken diagrams show their error and source without executing HTML", async ({ page }) => {
  const context = await setup(page, 'TEST ONLY\n\n```mermaid\nnot-a-diagram\n```\n\n```mermaid\nflowchart LR\nA["<img src=x onerror=alert(1)>"] --> B[End]\n```');
  try {
    await expect(page.locator(".reply-output").first().getByRole("alert")).toContainText("This diagram type is not supported");
    await expect(page.locator(".reply-output").first().locator("details")).toHaveAttribute("open", "");
    await expect(page.locator("#messages img[onerror], #messages script")).toHaveCount(0);
    await expect(page.locator(".reply-output").last().getByRole("img")).toBeVisible();
  } finally { await context.cleanup(); }
});

test("tool errors retain partial results, file changes and unsupported attachments", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: partial work result.", [{
    type: "tool", id: "patch-result", name: "patch", state: { status: "error", input: { file: "a.ts", apiKey: "TEST-SECRET-DO-NOT-SHOW" },
      error: { type: "test", message: "TEST ONLY patch failed" }, metadata: { credential: "TEST-SECRET-METADATA",
        files: [{ file: "a.ts", before: "old value", after: "new value" }, { file: "b.ts", patch: "-old\n+new" }] },
      content: [{ type: "text", text: "TEST ONLY partial output" }, { type: "file", uri: "unknown.future", mime: "application/x-test", name: "Unsupported result" }] },
  }]);
  try {
    await page.getByText("Work details", { exact: true }).click();
    await expect(page.locator(".work-details")).toContainText("TEST ONLY partial output");
    await expect(page.locator("#messages")).toContainText("TEST ONLY patch failed");
    await page.locator(".work-details").getByText("a.ts", { exact: true }).click();
    await expect(page.locator(".work-details")).toContainText("old value");
    await expect(page.locator(".work-details")).toContainText("new value");
    await expect(page.locator("#messages")).toContainText("Unsupported result: this file format or reference cannot be previewed.");
    await expect(page.locator("#messages")).not.toContainText("TEST-SECRET");
  } finally { await context.cleanup(); }
});

test("unrelated updates retain diagram instances, open work details and previews", async ({ page }) => {
  const context = await setup(page, `TEST ONLY\n\n\`\`\`mermaid\n${chart}\n\`\`\`\n\n[Table](result.csv)`);
  try {
    await writeFile(join(context.project, "result.csv"), "Name,Value\nTest,42\n");
    await page.getByRole("button", { name: "Preview: Table" }).click();
    await expect(page.locator(".file-preview td")).toHaveCount(4);
    await page.getByText("Work details", { exact: true }).click();
    const image = page.getByRole("img", { name: /TEST ONLY: USD to EUR/ });
    await expect(image).toBeVisible();
    await image.evaluate((node) => { node.setAttribute("data-instance-test", "kept"); });
    context.fixture.publish(context.project, "session.text.ended", { sessionID: context.session.id });
    await expect.poll(() => context.fixture.requests.filter((item) => item.path.endsWith("/message")).length).toBeGreaterThan(1);
    await expect(image).toHaveAttribute("data-instance-test", "kept");
    await expect(page.locator(".work-details")).toHaveAttribute("open", "");
    await expect(page.locator(".file-preview td")).toHaveCount(4);
  } finally { await context.cleanup(); }
});

test("OpenCode reply files have protected read-only previews", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: file previews.\n\n[Readme](result.md)\n\n[Table](result.csv)\n\n[Page](result.html)");
  try {
    await writeFile(join(context.project, "result.md"), "# TEST ONLY document\n\nA real preview.");
    await writeFile(join(context.project, "result.csv"), "Name,Value\nTest,42\n");
    await writeFile(join(context.project, "result.html"), "<h1>TEST ONLY page</h1><script>parent.alert('unsafe')</script>");
    await page.getByRole("button", { name: "Preview: Readme" }).click();
    await expect(page.getByRole("heading", { name: "TEST ONLY document" })).toBeVisible();
    await page.getByRole("button", { name: "Preview: Table" }).click();
    await expect(page.locator(".file-preview td")).toHaveText(["Name", "Value", "Test", "42"]);
    await page.getByRole("button", { name: "Preview: Page" }).click();
    await expect(page.frameLocator(".file-preview iframe").getByRole("heading", { name: "TEST ONLY page" })).toBeVisible();
    await expect(page.locator(".file-preview iframe")).toHaveAttribute("sandbox", "");
  } finally { await context.cleanup(); }
});

test("the browser renders different Mermaid diagram families", async ({ page }) => {
  const diagrams = [
    "flowchart LR\nA[TEST ONLY] --> B[End]",
    "sequenceDiagram\nAlice->>Bob: TEST ONLY",
    "classDiagram\nclass First\nclass Second\nFirst <|-- Second",
    "stateDiagram-v2\n[*] --> First\nFirst --> [*]",
    "erDiagram\nFIRST ||--o{ SECOND : contains",
    'pie title TEST ONLY\n"First" : 40\n"Second" : 60',
    "mindmap\n root((TEST ONLY))\n  First\n  Second",
    "timeline\n title TEST ONLY\n First : Entry\n Second : Another entry",
    'gitGraph\n commit id: "first"\n commit id: "second"',
    "sankey-beta\nFirst,Second,10",
    "block-beta\ncolumns 2\nFirst Second\nFirst --> Second",
    'packet-beta\n0-7: "TEST ONLY"',
    "journey\n title TEST ONLY\n section First\n Read: 5: Person",
    "quadrantChart\nx-axis Low --> High\ny-axis Low --> High\nFirst: [0.3, 0.6]",
  ];
  const context = await setup(page, "TEST ONLY: original diagrams.\n\n" + diagrams.map((source) => `\`\`\`mermaid\n${source}\n\`\`\``).join("\n\n"));
  try {
    await expect(page.locator(".reply-output img")).toHaveCount(diagrams.length);
    await expect(page.locator(".reply-output [role=alert]")).toHaveCount(0);
    await expect.poll(() => page.locator(".reply-output img").evaluateAll((images) =>
      images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0))).toBe(true);
  } finally { await context.cleanup(); }
});

for (const savedFirst of [true, false]) {
  test(`streaming diagrams finish correctly with ${savedFirst ? "saved history" : "live text"} arriving first`, async ({ page }) => {
    const context = await setup(page, "TEST ONLY: earlier answer.");
    try {
      context.fixture.active.add(context.session.id);
      context.fixture.publish(context.project, "session.execution.started", { sessionID: context.session.id });
      await expect(page.locator("#voice-console")).toHaveAttribute("data-working", "true");
      const partial = "TEST ONLY: streaming diagram.\n\n```mermaid\nflowchart LR\nA[";
      const ending = "Start] --> B[End]\n```";
      context.fixture.publish(context.project, "session.text.delta", {
        sessionID: context.session.id, assistantMessageID: "stream", ordinal: 0, delta: partial,
      });
      await expect(page.locator(".reply-output")).toContainText("Waiting for the complete graph or diagram.");
      await expect(page.locator(".reply-output img")).toHaveCount(0);
      const saved = () => {
        context.fixture.messages.get(context.session.id)!.push({ id: "stream", type: "assistant", time: { created: 2 },
          content: [{ type: "text", text: partial + ending }] });
        context.fixture.publish(context.project, "session.text.ended", { sessionID: context.session.id });
      };
      if (savedFirst) saved();
      else context.fixture.publish(context.project, "session.text.delta", {
        sessionID: context.session.id, assistantMessageID: "stream", ordinal: 0, delta: ending,
      });
      await expect(page.locator(".reply-output img")).toBeVisible();
      if (!savedFirst) saved();
      context.fixture.active.delete(context.session.id);
      context.fixture.publish(context.project, "session.execution.succeeded", { sessionID: context.session.id });
      await expect(page.locator("#voice-console")).toHaveAttribute("data-working", "false");
      await expect(page.locator(".reply-output img")).toHaveCount(1);
      await expect(page.locator(".reply-output [role=alert]")).toHaveCount(0);
    } finally { await context.cleanup(); }
  });
}

test("a finished reply renders an unclosed diagram fence after work stops", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: earlier answer.");
  try {
    context.fixture.active.add(context.session.id);
    context.fixture.publish(context.project, "session.execution.started", { sessionID: context.session.id });
    await expect(page.locator("#voice-console")).toHaveAttribute("data-working", "true");
    context.fixture.messages.get(context.session.id)!.push({ id: "unclosed", type: "assistant", time: { created: 2 },
      content: [{ type: "text", text: "TEST ONLY\n\n```mermaid\nflowchart LR\nA --> B" }] });
    context.fixture.publish(context.project, "session.text.ended", { sessionID: context.session.id });
    await expect(page.locator(".reply-output")).toContainText("Waiting for the complete graph or diagram.");
    context.fixture.active.delete(context.session.id);
    context.fixture.messages.get(context.session.id)!.push({ id: "outcome", type: "idle", outcome: "succeeded", time: { created: 3 } });
    context.fixture.publish(context.project, "session.execution.succeeded", { sessionID: context.session.id });
    await expect(page.locator(".reply-output img")).toBeVisible();
  } finally { await context.cleanup(); }
});

test("tool-only steps and rich work results remain available beside the final answer", async ({ page }) => {
  const context = await setup(page, "", [{ type: "tool", id: "chart", name: "test-only", state: { status: "completed", content: [
    { type: "text", text: `TEST ONLY: work result.\n\n\`\`\`mermaid\n${chart}\n\`\`\`\n\n[Work file](work.csv)` },
  ] } }]);
  try {
    await writeFile(join(context.project, "work.csv"), 'Name,Value\n"With, comma","With ""quote"""\n"Two\nlines",42\n');
    await page.getByText("Work details", { exact: true }).click();
    await expect(page.locator(".work-details img")).toBeVisible();
    await page.getByRole("button", { name: "Preview: Work file" }).click();
    await expect(page.locator(".file-preview td")).toHaveText(["Name", "Value", "With, comma", 'With "quote"', "Two\nlines", "42"]);
    context.fixture.messages.get(context.session.id)!.push({ id: "final", type: "assistant", time: { created: 3 },
      content: [{ type: "text", text: "TEST ONLY: final answer." }] });
    context.fixture.publish(context.project, "session.step.ended", { sessionID: context.session.id });
    await expect(page.locator("#messages")).toContainText("TEST ONLY: final answer.");
    await expect(page.locator(".work-details img")).toBeVisible();
    await expect(page.locator(".file-preview td")).toHaveCount(6);
  } finally { await context.cleanup(); }
});

test("attached audio pauses listening, and unnamed inline images use their MIME type", async ({ page }) => {
  const drawing = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="orange"/></svg>';
  const context = await setup(page, "TEST ONLY: file attachments.", [{ type: "tool", id: "files", name: "test-only", state: {
    status: "completed", content: [{ type: "file", uri: "audio.wav", mime: "audio/wav", name: "Test audio" },
      { type: "file", uri: `data:image/svg+xml;base64,${Buffer.from(drawing).toString("base64")}`, mime: "image/svg+xml", name: "Test drawing" }],
  } }]);
  try {
    await writeFile(join(context.project, "audio.wav"), silentWav(10));
    await page.getByRole("button", { name: "Preview: Test drawing" }).click();
    await expect.poll(() => page.getByAltText("Test drawing").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(32);
    await page.getByRole("button", { name: "Preview: Test audio" }).click();
    await expect(page.locator("audio")).toBeVisible();
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.play());
    await expect(page.locator("#voice-channel")).toHaveText("Paused");
    await page.locator("audio").evaluate((audio) => { Object.assign(window, { oldPreviewAudio: audio }); });
    await page.getByRole("button", { name: "Close preview: Test audio" }).click();
    await expect(page.locator("#voice-channel")).toHaveText("Listening");
    await expect(page.locator("audio")).toHaveCount(0);
    await page.getByRole("button", { name: "Preview: Test audio" }).click();
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.play());
    await expect(page.locator("#voice-channel")).toHaveText("Paused");
    await page.evaluate(() => (window as unknown as { oldPreviewAudio: HTMLAudioElement }).oldPreviewAudio.dispatchEvent(new Event("pause")));
    await expect(page.locator("#voice-channel")).toHaveText("Paused");
  } finally { await context.cleanup(); }
});

test("a cancelled viewer import cannot mount into a reopened preview", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: delayed viewer.\n\n[Document](pending.pdf)");
  let release!: () => void;
  const pending = new Promise<void>((done) => { release = done; });
  try {
    await writeFile(join(context.project, "pending.pdf"), pdfFile());
    let requested = false;
    await page.route("**/assets/file-pdf-*.js", async (route) => { requested = true; await pending; await route.continue(); });
    await page.evaluate(() => {
      Object.assign(window, { previewWorkers: 0 });
      const original = window.Worker;
      window.Worker = class extends original {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          const state = window as unknown as { previewWorkers: number };
          state.previewWorkers++;
        }
      };
    });
    await page.getByRole("button", { name: "Preview: Document" }).click();
    await expect.poll(() => requested).toBe(true);
    await page.getByRole("button", { name: "Close preview: Document" }).click();
    await page.getByRole("button", { name: "Preview: Document" }).click();
    release();
    await expect(page.locator(".file-preview")).toContainText("TEST ONLY PDF");
    await expect(page.locator(".file-preview canvas")).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { previewWorkers: number }).previewWorkers)).toBe(1);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); await context.cleanup(); }
});

test("closing a pending preview and leaving the log entry cancels its request", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: pending file.\n\n[Document](pending.pdf)");
  try {
    await writeFile(join(context.project, "pending.pdf"), pdfFile());
    let release!: () => void;
    const pending = new Promise<void>((done) => { release = done; });
    await page.route("**/file/output-answer?**", async (route) => { await pending; await route.continue(); });
    await page.getByRole("button", { name: "Preview: Document" }).click();
    await expect(page.locator(".file-preview")).toContainText("Preparing the preview.");
    await page.getByRole("button", { name: "Close preview: Document" }).click();
    await page.getByRole("button", { name: "New log entry", exact: true }).click();
    release();
    await expect(page.locator(".file-preview")).toHaveCount(0);
    await page.unrouteAll({ behavior: "wait" });
    await page.getByRole("link", { name: "Captain’s log" }).click();
    await page.locator(".conversation-button", { hasText: "Output stand-in" }).click();
    await page.getByRole("button", { name: "Preview: Document" }).click();
    await expect(page.locator(".file-preview canvas")).toBeVisible();
  } finally { await context.cleanup(); }
});

test("font files use their real font and release it when the preview closes", async ({ page }) => {
  const context = await setup(page, "TEST ONLY: licensed font fixture.\n\n[Font](sample.ttf)");
  try {
    await writeFile(join(context.project, "sample.ttf"), await readFile(resolve("node_modules/@betteroffice/fonts/assets/LiberationSans-Regular.ttf")));
    const before = await page.evaluate(() => document.fonts.size);
    await page.getByRole("button", { name: "Preview: Font" }).click();
    await expect(page.locator(".file-preview p")).toContainText("The quick brown fox");
    const family = await page.locator(".file-preview p").evaluate((sample) => getComputedStyle(sample).fontFamily);
    expect(family).toContain("picard-preview-");
    expect(await page.evaluate(() => document.fonts.size)).toBe(before + 1);
    await page.getByRole("button", { name: "Close preview: Font" }).click();
    expect(await page.evaluate(() => document.fonts.size)).toBe(before);
  } finally { await context.cleanup(); }
});

test("damaged files report errors and website documents open outside Picard without disturbing a graph", async ({ page }) => {
  const context = await setup(page, `TEST ONLY: preview errors.\n\n\`\`\`mermaid\n${chart}\n\`\`\`\n\n[Table](bad.csv)\n[Document](bad.pdf)\n[Website document](https://documents.example.com/test.pdf)`);
  try {
    const outsideRequests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("documents.example.com")) outsideRequests.push(request.url()); });
    await writeFile(join(context.project, "bad.csv"), 'Name,Value\n"unfinished');
    await writeFile(join(context.project, "bad.pdf"), "TEST ONLY not a PDF");
    await page.getByRole("button", { name: "Preview: Table" }).click();
    await expect(page.locator(".file-preview [role=alert]")).toContainText("unfinished quoted field");
    await page.getByRole("button", { name: "Preview: Document" }).click();
    await expect(page.locator(".file-preview [role=alert]").last()).toContainText("does not match its format");
    const website = page.locator(".reply-file").filter({ hasText: "Website document" });
    await expect(website.getByRole("button")).toHaveCount(0);
    const link = website.getByRole("link", { name: "Open in browser" });
    await expect(link).toHaveAttribute("href", "https://documents.example.com/test.pdf");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(outsideRequests).toEqual([]);
    await expect(page.getByRole("img", { name: /TEST ONLY: USD to EUR/ })).toBeVisible();
  } finally { await context.cleanup(); }
});
