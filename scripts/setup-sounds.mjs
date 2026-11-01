// Downloads computer sounds into .picard-code/sounds in the user's home folder.
// The recordings are not part of this repository; see THIRD_PARTY_NOTICES.md.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const sounds = [
  { name: "startup", source: "https://www.trekcore.com/audio/computer/hail_allship_ep.mp3", checksum: "adbd63135d6158b4459f8e3ca67c936c5c92ab4dfdd6109cc63adfc08fad82e1" },
  { name: "request-accepted", source: "https://www.trekcore.com/audio/computer/computer_work_beep.mp3", checksum: "7cbec756350ca677e919a033e12f4b3364e6777ad8febc5a67d6fb1ecb897c44" },
  { name: "input-failed", source: "https://www.trekcore.com/audio/computer/input_failed_clean.mp3", checksum: "fbfb2dcd0cbdcb5d76196daa4d76f87cbeb87a1ce761e303e34fdf31bfc9fbaa" },
  { name: "request-failed", source: "https://www.trekcore.com/audio/computer/denybeep1.mp3", checksum: "d6f29d6df17d72eec41e500f9114d186c83f72210ce9f1e6fcac61ba195558e0" },
  { name: "tribute-fact", source: "https://www.trekcore.com/audio/tricorder/tng_tricorder_open.mp3", checksum: "2f3df1597c1770dded181b2d1b415f2c0bb6f9af9244c573dd8c042215eeaaac" },
];
export const soundFolder = join(homedir(), ".picard-code", "sounds");

export async function setupSounds(folder = soundFolder, signal, download = fetch) {
  await mkdir(folder, { recursive: true });
  for (const sound of sounds) {
    signal?.throwIfAborted();
    const file = join(folder, `${sound.name}.mp3`);
    let existing;
    try { existing = await readFile(file); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const matches = (data) => createHash("sha256").update(data).digest("hex") === sound.checksum;
    if (existing && matches(existing)) continue;
    const timeout = AbortSignal.timeout(30_000);
    const response = await download(sound.source, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`Could not download ${sound.source} (HTTP ${response.status}).`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!matches(data)) {
      throw new Error(`${sound.source} did not match the expected file, so it was not saved.`);
    }
    signal?.throwIfAborted();
    await writeFile(file, data);
    console.log(`Saved the ${sound.name} sound.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await setupSounds();
  console.log(`The sounds are in ${soundFolder}.`);
}
