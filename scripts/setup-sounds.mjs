// Downloads the three optional computer sounds into .picard-code/sounds in the user's home folder.
// The recordings are not part of this repository; see THIRD_PARTY_NOTICES.md.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const sounds = [
  { name: "request-accepted", source: "https://www.trekcore.com/audio/computer/computer_work_beep.mp3", checksum: "7cbec756350ca677e919a033e12f4b3364e6777ad8febc5a67d6fb1ecb897c44" },
  { name: "input-failed", source: "https://www.trekcore.com/audio/computer/input_failed_clean.mp3", checksum: "fbfb2dcd0cbdcb5d76196daa4d76f87cbeb87a1ce761e303e34fdf31bfc9fbaa" },
  { name: "request-failed", source: "https://www.trekcore.com/audio/computer/denybeep1.mp3", checksum: "d6f29d6df17d72eec41e500f9114d186c83f72210ce9f1e6fcac61ba195558e0" },
];
const folder = join(homedir(), ".picard-code", "sounds");

await mkdir(folder, { recursive: true });
for (const sound of sounds) {
  const response = await fetch(sound.source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not download ${sound.source} (HTTP ${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== sound.checksum) {
    throw new Error(`${sound.source} did not match the expected file, so it was not saved.`);
  }
  await writeFile(join(folder, `${sound.name}.mp3`), data);
  console.log(`Saved the ${sound.name} sound.`);
}
console.log(`The sounds are in ${folder}. Restart Picard Code to use them.`);
