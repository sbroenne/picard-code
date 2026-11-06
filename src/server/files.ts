import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileFormat, fileFormatForMime } from "../shared/files.js";
import { MediaError } from "./media.js";
import { inflateRawSync } from "node:zlib";

const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** Reads only an already-authorized result, with the same opened-file identity checks as media. */
export async function serveFile(request: IncomingMessage, response: ServerResponse, project: string, href: string, name?: string, mime?: string) {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    let bytes: Buffer;
    let format = href.startsWith("data:") ? fileFormatForMime(mime ?? "") ?? fileFormat(name ?? "")
      : fileFormat(name ?? href);
    if (href.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(href);
      if (!match || match[2]!.length > MAX_FILE_BYTES * 4 / 3 + 4 || match[1] !== mime) throw new MediaError(415, "This attached file cannot be read safely.");
      bytes = Buffer.from(match[2]!, "base64");
      if (bytes.length > MAX_FILE_BYTES) throw new MediaError(413, "This file is larger than the 32 MB preview limit.");
    } else {
      const root = await realpath(project);
      const path = href.startsWith("file:///") ? fileURLToPath(href) : decodeURIComponent(href);
      if (path.split(/[\\/]/).includes("..")) throw new MediaError(403, "That file is outside this Project.");
      const requested = resolve(root, path);
      const expected = await stat(requested);
      if (!expected.isFile()) throw new MediaError(415, "That result is not a file.");
      const target = await realpath(requested);
      const inside = relative(root, target);
      if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new MediaError(403, "That file is outside this Project.");
      // Resolve the real suffix too: a link named notes.txt must not expose a key or binary file.
      format = fileFormat(target);
      if (!format) throw new MediaError(415, "This file format cannot be previewed.");
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const opened = await file.stat();
      if (!opened.isFile()) throw new MediaError(415, "That result is not a file.");
      if (opened.dev !== expected.dev || opened.ino !== expected.ino || await realpath(requested) !== target) throw new MediaError(403, "That file changed while it was being opened. Ask for it again.");
      if (opened.size > MAX_FILE_BYTES) throw new MediaError(413, "This file is larger than the 32 MB preview limit.");
      // Bound the read even if another process grows the file after stat.
      bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }

      bytes = bytes.subarray(0, offset);
    }
    if (!format) throw new MediaError(415, "This file format cannot be previewed.");
    if (["document", "spreadsheet", "presentation"].includes(format.kind)) checkArchive(bytes);
    if (format.kind === "pdf" && bytes.toString("ascii", 0, 5) !== "%PDF-"
      || ["document", "spreadsheet", "presentation"].includes(format.kind) && bytes.toString("ascii", 0, 2) !== "PK") {
      throw new MediaError(415, "The file does not match its format.");
    }
    if (["text", "markdown", "mermaid", "table", "html", "svg"].includes(format.kind) && bytes.includes(0)) throw new MediaError(415, "This result contains binary data, not readable text.");
    response.setHeader("Content-Type", format.mime);
    response.setHeader("Content-Disposition", "attachment");
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Content-Length", bytes.length);
    response.writeHead(200);
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") throw new MediaError(404, "That file is no longer available.");
      if (error.code === "EACCES" || error.code === "EPERM") throw new MediaError(403, "This file could not be read. Check its file permissions.");
    }
    throw error;
  } finally { await file?.close(); }
}

function checkArchive(bytes: Buffer) {
  const invalid = () => new MediaError(415, "This document is not a readable, unencrypted Office file.");
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break;
  }
  if (end < 0 || bytes.length < 22 || bytes.readUInt32LE(end) !== 0x06054b50
    || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) throw invalid();
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw invalid();
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16), expanded = 0;
  const limit = offset + bytes.readUInt32LE(end + 12);
  if (!entries || entries > 10000 || limit > end) throw invalid();
  for (let entry = 0; entry < entries; entry++) {
    if (offset + 46 > limit || bytes.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const size = bytes.readUInt32LE(offset + 24), compressed = bytes.readUInt32LE(offset + 20);
    expanded += size;
    if (size === 0xffffffff || expanded > 128 * 1024 * 1024) throw new MediaError(413, "This document expands beyond the preview limit.");
    const method = bytes.readUInt16LE(offset + 10), local = bytes.readUInt32LE(offset + 42);
    if (bytes.readUInt16LE(offset + 8) & 1 || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50
      || bytes.readUInt16LE(local + 6) & 1 || bytes.readUInt16LE(local + 8) !== method) throw invalid();
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > bytes.length || ![0, 8].includes(method)) throw invalid();
    // Verify actual expansion too; trusting a forged ZIP size would leave the
    // browser's document reader exposed to a much larger compressed payload.
    if (method === 0) { if (compressed !== size) throw invalid(); }
    else {
      try {
        const content = inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: Math.max(1, size) });
        if (content.length !== size) throw invalid();
      } catch (error) {
        if (error instanceof MediaError) throw error;
        throw new MediaError(415, "A compressed file in this document does not match its declared size or cannot be read.");
      }
    }
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  if (offset !== limit) throw invalid();
}
