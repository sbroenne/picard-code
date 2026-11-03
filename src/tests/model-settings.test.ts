import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelSelection, readModelSettings, saveModelSettings } from "../server/model-settings.js";

test("model settings require valid IDs and keep only the confirmed choice", () => {
  for (const value of [null, [], {}, { providerID: "a" }, { providerID: " ", modelID: "a" },
    { providerID: "a", modelID: " b" }, { providerID: 2, modelID: "a" }, { providerID: "a", modelID: "x".repeat(257) }]) {
    assert.throws(() => modelSelection(value), /Choose/);
  }
  assert.deepEqual(modelSelection({ providerID: "any-provider", modelID: "family/model:latest", name: "Example", key: "not-saved" }),
    { providerID: "any-provider", modelID: "family/model:latest" });
});

test("confirmed choices persist across reads and are safely replaced without leftover files", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "picard-model-"));
  t.after(() => rm(folder, { recursive: true }));
  const file = join(folder, "settings", "model.json");
  assert.equal(await readModelSettings(file), undefined);
  const first = { providerID: "provider-one", modelID: "capable-model" };
  await saveModelSettings(file, first);
  assert.deepEqual(await readModelSettings(file), first);
  const next = { providerID: "provider-two", modelID: "another-model" };
  await saveModelSettings(file, next);
  assert.deepEqual(await readModelSettings(file), next);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), next);
  assert.deepEqual(await readdir(join(folder, "settings")), ["model.json"]);
});

test("invalid settings and file failures are explicit and a confirmed replacement can repair invalid data", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "picard-model-errors-"));
  t.after(() => rm(folder, { recursive: true }));
  const file = join(folder, "model.json");
  for (const text of ["{", "null", '{"providerID":"a"}']) {
    await writeFile(file, text);
    await assert.rejects(readModelSettings(file), /saved model choice is not valid/);
  }
  const choice = { providerID: "provider", modelID: "model" };
  await saveModelSettings(file, choice);
  assert.deepEqual(await readModelSettings(file), choice);
  await mkdir(join(folder, "directory"));
  await assert.rejects(readModelSettings(join(folder, "directory")), /Could not read the saved model choice/);
  await assert.rejects(saveModelSettings(join(file, "model.json"), choice), /Could not save the model choice/);
  await assert.rejects(saveModelSettings(join(folder, "directory"), choice), /Could not save the model choice/);
  assert.deepEqual((await readdir(folder)).sort(), ["directory", "model.json"]);
  assert.deepEqual(await readModelSettings(file), choice);
});
