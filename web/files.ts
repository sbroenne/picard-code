import { replyFile, fileFormat, fileFormatForMime } from "../src/shared/files";
import { errorMessage } from "../src/shared/messages";
import { renderMarkdown } from "./markdown";
import { markOutputs, mountOutputs } from "./outputs";
import DOMPurify from "dompurify";

const purify = DOMPurify(window);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  return result;
}

export function markFiles(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-file-href]").forEach((item, index) => {
    item.className = "reply-file";
    item.dataset.keep = `file:${index}:${item.dataset.fileHref}`;
  });
}

export class ReplyFiles {
  private mounted = new Map<HTMLElement, () => void>();
  constructor(private attach: (element: HTMLElement, media: HTMLMediaElement) => () => void) {}

  mount(root: HTMLElement, project: string) {
    for (const [element, dispose] of this.mounted) {
      if (element.isConnected) continue;
      dispose();
      this.mounted.delete(element);
    }
    for (const element of root.querySelectorAll<HTMLElement>(".reply-file")) {
      if (this.mounted.has(element)) continue;
      if (element.closest<HTMLElement>("[data-media-ready]")?.dataset.mediaReady === "false") continue;
      const label = element.textContent || "Result file";
      const href = element.dataset.fileHref ?? "";
      const format = fileFormat(label) ?? replyFile(href) ?? fileFormatForMime(element.dataset.fileMime ?? "");
      const reference = replyFile(href);
      if (!format || !reference && !href.startsWith("data:")) {
        element.textContent = `${label}: this file format or reference cannot be previewed.`;
        this.mounted.set(element, () => {});
        continue;
      }
      const article = element.closest<HTMLElement>("[data-message-id]")!;
      const parameters = new URLSearchParams({ project });
      if (element.dataset.filePart) parameters.set("part", element.dataset.filePart);
      else parameters.set("href", href);
      const source = reference?.local || href.startsWith("data:")
        ? `/api/conversations/${encodeURIComponent(article.dataset.sessionId!)}/file/${encodeURIComponent(article.dataset.messageId!)}?${parameters}`
        : href;
      const link = node("a", "Open source");
      link.href = source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (!reference?.local && !href.startsWith("data:")) {
        link.textContent = "Open in browser";
        element.replaceChildren(node("span", label), link);
        this.mounted.set(element, () => {});
        continue;
      }
      const open = node("button", `Preview: ${label}`);
      open.type = "button";
      open.className = "peach-button";
      const close = node("button", `Close preview: ${label}`);
      close.type = "button";
      close.className = "peach-button";
      close.hidden = true;
      const preview = node("div");
      preview.className = "file-preview";
      preview.setAttribute("aria-label", label);
      preview.hidden = true;
      let controller: AbortController | undefined;
      let dispose: (() => void) | undefined;
      const clear = () => {
        controller?.abort();
        dispose?.();
        dispose = undefined;
        preview.replaceChildren();
        preview.hidden = true;
        close.hidden = true;
        open.hidden = false;
      };
      close.addEventListener("click", () => { clear(); open.focus(); });
      open.addEventListener("click", () => {
        clear();
        controller = new AbortController();
        const signal = controller.signal;
        open.hidden = true; close.hidden = false; preview.hidden = false;
        preview.textContent = "Preparing the preview.";
        void (async () => {
          const response = await fetch(source, { signal });
          if (!response.ok) {
            const result: unknown = await response.json();
            throw new Error(result && typeof result === "object" && "error" in result ? String(result.error) : `The file check returned HTTP ${response.status}.`);
          }
          if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error("This file is larger than the 32 MB preview limit.");
          const bytes = await response.arrayBuffer();
          if (signal.aborted) return;
          if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("This file is larger than the 32 MB preview limit.");
          const checkedFormat = fileFormatForMime(response.headers.get("content-type")?.split(";")[0] ?? "");
          if (!checkedFormat) throw new Error("The file check returned an unsupported file type.");
          const content = node("div");
          content.setAttribute("aria-label", label);
          preview.replaceChildren(content);
          const result = await showFile(content, bytes, checkedFormat.kind, checkedFormat.mime, signal);
          if (signal.aborted) result?.();
          else {
            const media = content.querySelector("audio, video");
            const detach = media instanceof HTMLMediaElement ? this.attach(media, media) : undefined;
            dispose = () => { detach?.(); result?.(); };
          }
        })().catch((error: unknown) => {
          if (signal.aborted) return;
          dispose?.(); dispose = undefined;
          preview.replaceChildren(node("p", `This file could not be previewed. ${errorMessage(error)}`));
          preview.firstElementChild?.setAttribute("role", "alert");
        });
      });
      element.replaceChildren(node("span", label), open, close, link, preview);
      this.mounted.set(element, clear);
    }
  }
}

async function showFile(host: HTMLElement, bytes: ArrayBuffer, kind: string, mime: string, signal: AbortSignal): Promise<(() => void) | undefined> {
  const text = () => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  host.replaceChildren();
  if (kind === "markdown" || kind === "mermaid") {
    host.classList.add("markdown");
    host.append(renderMarkdown(kind === "mermaid" ? `\`\`\`mermaid\n${text()}\n\`\`\`` : text()));
    markOutputs(host);
    mountOutputs(host);
  } else if (kind === "table") {
    const table = node("table");
    for (const row of delimitedRows(text(), mime === "text/csv" ? "," : "\t")) {
      const tr = node("tr");
      for (const cell of row) tr.append(node("td", cell));
      table.append(tr);
    }
    host.append(table);
  } else if (kind === "html") {
    const frame = node("iframe");
    frame.title = "Page preview";
    frame.setAttribute("sandbox", "");
    frame.referrerPolicy = "no-referrer";
    frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; form-action \'none\'; base-uri \'none\'">'
      + purify.sanitize(text(), { FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"], FORBID_ATTR: ["style", "src", "srcset", "href"] });
    host.append(frame);
  } else if (["image", "svg", "audio", "video"].includes(kind)) {
    const safeBytes = kind === "svg" ? purify.sanitize(text(), { USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["foreignObject", "image", "a", "animate", "set"] }) : bytes;
    const url = URL.createObjectURL(new Blob([safeBytes], { type: mime }));
    const media = kind === "audio" ? node("audio") : kind === "video" ? node("video") : node("img");
    if (media instanceof HTMLImageElement) media.alt = host.getAttribute("aria-label") ?? "Image";
    else { media.controls = true; media.preload = "metadata"; }
    media.src = url;
    media.addEventListener("error", () => {
      media.replaceWith(node("p", "The browser cannot display this file. Its format may not be supported, or the file may be damaged."));
    });
    // Audio/video is routed through ReplyPlayers by the caller so listening is paused.
    host.append(media);
    return () => { if (media instanceof HTMLMediaElement) media.pause(); URL.revokeObjectURL(url); };
  } else if (kind === "pdf") {
    const { previewPdf } = await import("./file-pdf");
    if (signal.aborted) return;
    return previewPdf(host, bytes, signal);
  } else if (["document", "spreadsheet", "presentation"].includes(kind)) {
    const { previewOffice } = await import("./file-office");
    if (signal.aborted) return;
    return previewOffice(host, bytes, kind, signal);
  } else if (kind === "font") {
    const face = new FontFace(`picard-preview-${crypto.randomUUID()}`, bytes);
    await face.load();
    if (signal.aborted) return;
    document.fonts.add(face);
    const sample = node("p", "The quick brown fox jumps over the lazy dog. ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789");
    sample.style.fontFamily = face.family;
    host.append(sample);
    return () => { document.fonts.delete(face); };
  } else {
    const pre = node("pre"); pre.append(node("code", text())); host.append(pre);
  }
}

/** CSV and TSV support quoted separators, escaped quotes and embedded newlines. */
export function delimitedRows(text: string, separator: string) {
  const rows: string[][] = [], row: string[] = [];
  let cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += char;
    } else if (!quoted && (char === separator || char === "\n" || char === "\r")) {
      row.push(cell); cell = "";
      if (char !== separator) {
        rows.push(row.splice(0));
        if (char === "\r" && text[index + 1] === "\n") index++;
      }
    } else cell += char;
  }
  if (quoted) throw new Error("The table has an unfinished quoted field.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
