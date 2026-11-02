import { Marked } from "marked";

export const MEDIA_TYPES = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"],
  ["mp4", "video/mp4"], ["webm", "video/webm"],
]);

export interface ReplyMedia {
  href: string;
  label: string;
  kind: "image" | "video" | "embed";
  local: boolean;
  embed?: string;
}

function publicUrl(href: string): URL | undefined {
  let url: URL;
  try { url = new URL(href); } catch { return undefined; }
  const host = url.hostname.replace(/\.+$/, "");
  // Remote media needs a public HTTPS name, not a local service or an IP literal.
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !host.includes(".") || /[:[\]]|^[\d.]+$/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(host)) return undefined;
  return url;
}

/** Classifies references, never HTML supplied by a model. Local paths are checked again on the server. */
export function replyMedia(href: string, label = "", image = false): ReplyMedia | undefined {
  if (!href || href.length > 8192 || [...href].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return undefined;
  const remote = publicUrl(href);
  if (remote) {
    let embed: string | undefined;
    const host = remote.hostname;
    const youtube = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host);
    const videoID = host === "youtu.be" ? remote.pathname.slice(1)
      : youtube && remote.pathname === "/watch" ? remote.searchParams.get("v")
      : youtube ? /^\/(?:shorts|embed)\/([^/]+)$/.exec(remote.pathname)?.[1] : undefined;
    if (videoID && /^[\w-]{11}$/.test(videoID)) embed = `https://www.youtube-nocookie.com/embed/${videoID}`;
    const vimeo = ["vimeo.com", "www.vimeo.com"].includes(host) ? /^\/(\d+)$/.exec(remote.pathname)?.[1] : undefined;
    if (vimeo) embed = `https://player.vimeo.com/video/${vimeo}`;
    if (embed && !image) return { href: remote.href, label: label || "Video", kind: "embed", local: false, embed };
    const mime = MEDIA_TYPES.get(remote.pathname.split(".").at(-1)?.toLowerCase() ?? "");
    if (image || mime?.startsWith("image/")) return { href: remote.href, label: label || "Image", kind: "image", local: false };
    if (mime?.startsWith("video/")) return { href: remote.href, label: label || "Video", kind: "video", local: false };
    return undefined;
  }
  if (/^(?![A-Za-z]:[\\/])[A-Za-z][\w+.-]*:/.test(href) && !href.startsWith("file:///")) return undefined;
  if (href.startsWith("//") || href.startsWith("\\\\")) return undefined;
  let path: string;
  try { path = decodeURIComponent(href); } catch { return undefined; }
  if (path.includes("\0") || path.split(/[\\/]/).includes("..")) return undefined;
  const mime = MEDIA_TYPES.get(path.split(".").at(-1)?.toLowerCase() ?? "");
  if (!mime) return undefined;
  return { href, label: label || (mime.startsWith("image/") ? "Image" : "Video"), kind: mime.startsWith("image/") ? "image" : "video", local: true };
}

const reader = new Marked({ gfm: true, async: false });

/** Markdown parsing keeps code samples and ordinary prose out of file authorization. */
export function mediaReferences(text: string): ReplyMedia[] {
  const result: ReplyMedia[] = [];
  reader.walkTokens(reader.lexer(text), (token) => {
    if (token.type !== "image" && token.type !== "link") return;
    const media = replyMedia(token.href, token.text, token.type === "image");
    if (media) result.push(media);
  });
  return result;
}
