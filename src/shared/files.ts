import { Marked } from "marked";
import { publicUrl } from "./media.js";

export type FileKind = "text" | "markdown" | "mermaid" | "table" | "html" | "svg" | "pdf" | "document" | "spreadsheet" | "presentation" | "font" | "image" | "audio" | "video";
const types = new Map<string, [FileKind, string]>([
  ["md", ["markdown", "text/markdown"]], ["markdown", ["markdown", "text/markdown"]], ["mdx", ["markdown", "text/markdown"]],
  ["mmd", ["mermaid", "text/vnd.mermaid"]], ["mermaid", ["mermaid", "text/vnd.mermaid"]],
  ["csv", ["table", "text/csv"]], ["tsv", ["table", "text/tab-separated-values"]],
  ["html", ["html", "text/html"]], ["htm", ["html", "text/html"]], ["svg", ["svg", "image/svg+xml"]],
  ["pdf", ["pdf", "application/pdf"]],
  ["docx", ["document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  ["xlsx", ["spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  ["pptx", ["presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]],
  ...["txt", "json", "jsonl", "xml", "yaml", "yml", "toml", "ini", "log", "diff", "patch", "ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "py", "go", "rs", "java", "c", "h", "cpp", "cs", "sh", "sql", "rb", "r", "vue", "svelte"].map((ext): [string, [FileKind, string]] => [ext, ["text", "text/plain"]]),
  ...["ttf", "otf", "woff", "woff2"].map((ext): [string, [FileKind, string]] => [ext, ["font", `font/${ext}`]]),
  ...["avif", "bmp", "ico", "tif", "tiff", "heic"].map((ext): [string, [FileKind, string]] => [ext, ["image", `image/${ext === "ico" ? "x-icon" : ext === "tif" ? "tiff" : ext}`]]),
  ...["png", "jpg", "jpeg", "gif", "webp"].map((ext): [string, [FileKind, string]] => [ext, ["image", `image/${ext === "jpg" ? "jpeg" : ext}`]]),
  ["mp4", ["video", "video/mp4"]], ["webm", ["video", "video/webm"]],
  ...["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"].map((ext): [string, [FileKind, string]] => [ext, ["audio", ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : ext === "weba" ? "audio/webm" : `audio/${ext === "oga" || ext === "opus" ? "ogg" : ext}`]]),
  ...["mov", "m4v", "ogv", "mkv"].map((ext): [string, [FileKind, string]] => [ext, ["video", ext === "mov" ? "video/quicktime" : ext === "ogv" ? "video/ogg" : ext === "mkv" ? "video/x-matroska" : "video/mp4"]]),
]);

export function fileFormat(path: string) {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  if (!name || name.startsWith(".")) return undefined;
  const type = types.get(name.split(".").at(-1)?.toLowerCase() ?? "");
  return type && { kind: type[0], mime: type[1] };
}

export function fileFormatForMime(mime: string) {
  const type = [...types.values()].find((item) => item[1] === mime);
  return type && { kind: type[0], mime: type[1] };
}

/** Only explicit supported file links become file previews; code and prose never authorize reads. */
export function replyFile(href: string) {
  const control = (text: string) => [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (!href || href.length > 8192 || control(href)) return undefined;
  const remote = publicUrl(href);
  if (remote) {
    const format = fileFormat(remote.pathname);
    return format && { href, ...format, local: false };
  }
  if (/^(?![A-Za-z]:[\\/])[A-Za-z][\w+.-]*:/.test(href) && !href.startsWith("file:///")) return undefined;
  if (href.startsWith("//") || href.startsWith("\\\\")) return undefined;
  let path: string;
  try { path = decodeURIComponent(href); } catch { return undefined; }
  if (control(path) || path.split(/[\\/]/).includes("..")) return undefined;
  const format = fileFormat(path);
  return format && { href, ...format, local: true };
}

const reader = new Marked({ gfm: true, async: false });
export function fileReferences(text: string) {
  const result: NonNullable<ReturnType<typeof replyFile>>[] = [];
  reader.walkTokens(reader.lexer(text), (token) => {
    if (token.type !== "link" && token.type !== "image") return;
    const reference = replyFile(token.href);
    if (reference) result.push(reference);
  });
  return result;
}
