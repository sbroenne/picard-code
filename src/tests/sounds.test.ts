import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setupSounds } from "../../scripts/setup-sounds.mjs";

test("sound setup reports failed downloads instead of continuing without sounds", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-sounds-"));
  t.after(() => rm(folder, { recursive: true }));
  await assert.rejects(setupSounds(folder, undefined, async () => new Response("Unavailable", { status: 503 })), /HTTP 503/);
  await assert.rejects(readFile(join(folder, "startup.mp3")), { code: "ENOENT" });
});

test("sound setup rejects an unexpected recording without replacing the existing file", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-sounds-"));
  t.after(() => rm(folder, { recursive: true }));
  const file = join(folder, "startup.mp3");
  await writeFile(file, "damaged recording");
  await assert.rejects(setupSounds(folder, undefined, async () => new Response("unexpected recording")), /did not match the expected file/);
  assert.equal(await readFile(file, "utf8"), "damaged recording");
});

test("sound setup reports connection errors", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-sounds-"));
  t.after(() => rm(folder, { recursive: true }));
  await assert.rejects(setupSounds(folder, undefined, async () => { throw new Error("Connection failed"); }), /Connection failed/);
});

test("stopping startup cancels sound setup before making a download", async (t) => {
  const folder = await mkdtemp(resolve(".picard-test-sounds-"));
  t.after(() => rm(folder, { recursive: true }));
  let downloaded = false;
  await assert.rejects(setupSounds(folder, AbortSignal.abort(), async () => {
    downloaded = true;
    return new Response();
  }), { name: "AbortError" });
  assert.equal(downloaded, false);
});
