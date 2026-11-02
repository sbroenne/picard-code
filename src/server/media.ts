import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MEDIA_TYPES } from "../shared/media.js";

export class MediaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function matchesType(bytes: Buffer, mime: string) {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === "image/gif") return /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6));
  if (mime === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (mime === "video/mp4") return bytes.toString("ascii", 4, 8) === "ftyp";
  return mime === "video/webm" && bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) && bytes.includes(Buffer.from("webm"));
}

function byteRange(header: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || (!match[1] && !match[2])) return undefined;
  const first = Number(match[1]), last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return undefined;
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  return start <= end && start < size && (match[1] || last > 0) ? { start, end } : undefined;
}

/** Streams one already-authorized reply reference. Never exposes a general Project file route. */
export async function serveMedia(request: IncomingMessage, response: ServerResponse, project: string, href: string) {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const root = await realpath(project);
    const path = href.startsWith("file:///") ? fileURLToPath(href) : decodeURIComponent(href);
    if (path.split(/[\\/]/).includes("..")) throw new MediaError(403, "That media file is outside this Project.");
    const target = await realpath(resolve(root, path));
    const inside = relative(root, target);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new MediaError(403, "That media file is outside this Project.");
    }
    const mime = MEDIA_TYPES.get(extname(target).slice(1).toLowerCase());
    if (!mime) throw new MediaError(415, "This media format cannot be shown. Use PNG, JPEG, GIF, WebP, MP4, or WebM.");
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) throw new MediaError(415, "That media reference is not a file.");
    const bytes = Buffer.alloc(Math.min(stat.size, 4096));
    await file.read(bytes, 0, bytes.length, 0);
    if (!matchesType(bytes, mime)) throw new MediaError(415, "The media file does not match its format.");
    response.setHeader("Content-Type", mime);
    response.setHeader("Accept-Ranges", "bytes");
    const range = request.headers.range ? byteRange(request.headers.range, stat.size) : undefined;
    if (request.headers.range && !range) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}`, "Content-Length": "0" });
      response.end();
      return;
    }
    const start = range?.start ?? 0, end = range?.end ?? stat.size - 1;
    response.setHeader("Content-Length", end - start + 1);
    if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    response.writeHead(range ? 206 : 200);
    if (request.method === "HEAD") { response.end(); return; }
    await pipeline(file.createReadStream({ start, end, autoClose: false }), response);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") throw new MediaError(404, "That media file is no longer available.");
      if (error.code === "EISDIR") throw new MediaError(415, "That media reference is not a file.");
      if (error.code === "EACCES" || error.code === "EPERM") throw new MediaError(403, "This media file could not be read. Check its file permissions.");
    }
    throw error;
  } finally { await file?.close(); }
}
