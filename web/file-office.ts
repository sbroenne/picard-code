import DOMPurify from "dompurify";
import { errorMessage } from "../src/shared/messages";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  return result;
}

export async function previewOffice(host: HTMLElement, bytes: ArrayBuffer, kind: string, signal: AbortSignal): Promise<() => void> {
  if (kind === "document") return previewDocument(host, bytes, signal);
  if (kind === "spreadsheet") return previewWorkbook(host, bytes, signal);
  return previewPresentation(host, bytes, signal);
}

async function previewDocument(host: HTMLElement, bytes: ArrayBuffer, signal: AbortSignal) {
  const { renderAsync } = await import("docx-preview");
  const content = node("div"), definitions = node("div");
  const className = `docx-${crypto.randomUUID()}`;
  await renderAsync(bytes, content, definitions, { className, ignoreFonts: true, useBase64URL: true,
    renderAltChunks: false, renderComments: true, ignoreLastRenderedPageBreak: false });
  if (signal.aborted) return () => {};
  const purify = DOMPurify(window);
  const safe = purify.sanitize(content.innerHTML, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "input"],
    ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/(?:png|jpeg|gif|webp);base64,|#)/i });
  const sheet = new CSSStyleSheet();
  // Viewer layout is installed through CSSOM, not unsafe-inline. Do not retain
  // document-controlled URLs, imports or selectors that reach outside this view.
  for (const style of definitions.querySelectorAll("style")) {
    const parsed = new CSSStyleSheet();
    parsed.replaceSync(style.textContent ?? "");
    for (const rule of parsed.cssRules) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.split(",").every((selector) => selector.trim().startsWith(`.${className}`))) continue;
      if (/url\s*\(|@import|expression\s*\(/i.test(rule.cssText)) continue;
      sheet.insertRule(rule.cssText);
    }
  }
  let index = 0;
  for (const element of safe.querySelectorAll<HTMLElement>("[style]")) {
    const style = element.getAttribute("style") ?? "";
    element.removeAttribute("style");
    if (/url\s*\(|@import|expression\s*\(/i.test(style)) continue;
    const name = `${className}-inline-${index++}`;
    element.classList.add(name);
    sheet.insertRule(`.${name} { ${style} }`);
  }
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  host.append(safe);
  return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet); };
}

async function previewWorkbook(host: HTMLElement, bytes: ArrayBuffer, signal: AbortSignal) {
  const engine = await import("@betteroffice/xlsx");
  await engine.initWasm();
  if (signal.aborted) return () => {};
  const workbook = engine.openWorkbook(new Uint8Array(bytes));
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    workbook.dispose();
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const select = node("select");
    select.setAttribute("aria-label", "Sheet");
    workbook.sheetInfo().sheetNames.forEach((name, index) => {
      const option = node("option", name); option.value = String(index); select.append(option);
    });
    const canvas = node("canvas");
    canvas.setAttribute("aria-label", "Spreadsheet preview");
    canvas.width = 1000; canvas.height = 600;
    const status = node("p");
    let x = 0, y = 0;
    const paint = () => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not draw the spreadsheet.");
      engine.paintDisplayList(context, workbook.displayList({ x, y, width: 1000, height: 600 }), 1);
      status.textContent = `${workbook.sheetInfo().sheetNames[workbook.sheetInfo().activeSheet]}: horizontal position ${x}, vertical position ${y}. Read-only preview.`;
    };
    const run = (action: () => void) => {
      try { action(); paint(); }
      catch (error) { status.textContent = `The spreadsheet could not be displayed. ${errorMessage(error)}`; status.setAttribute("role", "alert"); }
    };
    select.addEventListener("change", () => run(() => { workbook.setActiveSheet(Number(select.value)); x = y = 0; }));
    host.append(select);
    for (const [label, dx, dy] of [["Previous columns", -900, 0], ["Next columns", 900, 0], ["Previous rows", 0, -500], ["Next rows", 0, 500]] as const) {
      const button = node("button", label); button.type = "button";
      button.addEventListener("click", () => run(() => {
        const info = workbook.sheetInfo();
        x = Math.max(0, Math.min(Math.max(0, info.contentWidth - 1000), x + dx));
        y = Math.max(0, Math.min(Math.max(0, info.contentHeight - 600), y + dy));
      }));
      host.append(button);
    }
    const accessible = node("details");
    accessible.append(node("summary", "Readable sheet content"));
    // The engine exports cell text and tables for screen readers, without executing formulas or macros in the page.
    const exported = await engine.exportXlsxMarkdown(new Uint8Array(bytes));
    if (signal.aborted) return () => {};
    const pre = node("pre", exported.markdown);
    accessible.append(pre);
    host.append(status, canvas, accessible);
    paint();
    return dispose;
  } catch (error) { dispose(); throw error; }
}

async function previewPresentation(host: HTMLElement, bytes: ArrayBuffer, signal: AbortSignal) {
  const engine = await import("@betteroffice/pptx");
  await engine.initWasm();
  const font = await fetch(new URL("../node_modules/@betteroffice/fonts/assets/LiberationSans-Regular.ttf", import.meta.url), { signal });
  if (!font.ok) throw new Error(`The presentation font could not be read (HTTP ${font.status}).`);
  const fontBytes = new Uint8Array(await font.arrayBuffer());
  if (signal.aborted) return () => {};
  const deck = engine.openPresentation(new Uint8Array(bytes), { fonts: [{ family: "Liberation Sans", bytes: fontBytes }],
    fallbackFonts: [{ family: "Liberation Sans", bytes: fontBytes }] });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    deck.dispose();
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const snapshot = deck.snapshot();
    const select = node("select");
    select.setAttribute("aria-label", "Slide");
    snapshot.slides.forEach((_slide, index) => { const option = node("option", `Slide ${index + 1}`); option.value = String(index); select.append(option); });
    const status = node("p", "Read-only preview. Fonts may differ from the original.");
    const canvas = node("canvas");
    canvas.setAttribute("aria-label", "Presentation slide");
    const text = node("pre");
    let revision = 0;
    const paint = async () => {
      const version = ++revision;
      select.disabled = true;
      const index = Number(select.value);
      const frame = deck.layoutSlide(index);
      engine.sizeCanvasForSlide(canvas, frame, 1, Math.min(1, 1000 / frame.width));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not draw the slide.");
      await engine.paintSlide(context, frame, 1, Math.min(1, 1000 / frame.width), {
        resolveImage: (path) => engine.decodePresentationImage(deck.mediaBytes(path), "A slide image could not be decoded."),
      });
      if (signal.aborted || version !== revision) return;
      const exported = deck.exportMarkdown();
      if (!exported.ok) throw new Error("Readable slide text could not be prepared.");
      text.textContent = exported.content.markdown;
      status.textContent = "Read-only preview. Fonts may differ from the original.";
      status.removeAttribute("role");
      select.disabled = false;
    };
    select.addEventListener("change", () => {
      void paint().catch((error: unknown) => {
        if (signal.aborted) return;
        status.textContent = errorMessage(error);
        status.setAttribute("role", "alert");
        select.disabled = false;
      });
    });
    host.append(select, status, canvas, text);
    await paint();
    return dispose;
  } catch (error) { dispose(); throw error; }
}
