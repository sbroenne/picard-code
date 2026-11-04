import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { speechScope } from "./speech-scope.mjs";
import { serverChecksPassed } from "./check-results.mjs";

const neither = { localSpeech: false, browserSpeech: false };
const nativeOnly = { localSpeech: true, browserSpeech: false };
const browserOnly = { localSpeech: false, browserSpeech: true };
const fixture = () => ({
  manifest: { version: "1.0.0", dependencies: { ws: "1", other: "1" }, devDependencies: { "onnxruntime-web": "1" } },
  lock: { lockfileVersion: 3, packages: {
    "": { version: "1.0.0" },
    "node_modules/ws": { version: "1", integrity: "ws-1" },
    "node_modules/other": { version: "1" },
    "node_modules/onnxruntime-web": { version: "1", dependencies: { tensor: "1" } },
    "node_modules/tensor": { version: "1" },
  } },
});

test("unrelated changes start zero extra model jobs, including general workflow wiring", () => {
  for (const file of [
    "README.md", "AGENTS.md", "CONTRIBUTING.md", "CHANGELOG.md", "docs/speech.md",
    ".changeset/quiet-checks.md", "site/index.html", "tools/voice-match/match.py",
    "web/main.ts", "web/style.css", "src/shared/speech.ts", "src/shared/crew.ts",
    "src/shared/tribute-data.ts", "src/server/app.ts", "src/tests/app.test.ts",
    "browser-tests/site.spec.ts", "browser-tests/voice.spec.ts",
    ".github/workflows/checks.yml", ".github/scripts/check-scope.mjs",
    ".github/scripts/speech-scope.mjs", ".github/scripts/check-results.mjs",
  ]) assert.deepEqual(speechScope([file]), neither, file);
});

test("local setup, workers, models and actual local check inputs select only local execution", () => {
  for (const file of [
    "scripts/setup-speech.mjs", "scripts/setup-turn.mjs", "scripts/setup-nemotron.mjs",
    "scripts/setup-local-speech.py", "scripts/turn-detector-worker.py", "scripts/local-speech-worker.py",
    "scripts/requirements-turn.in", "scripts/requirements-turn.txt",
    "scripts/requirements-kokoro.in", "scripts/requirements-kokoro.txt", "scripts/smart-turn-LICENSE.txt",
    "src/server/speech.ts", "src/server/speech-types.ts", "src/server/speech-bridge.ts",
    "src/server/local-speech.ts", "src/server/nemotron-speech.ts", "src/server/turn-detector.ts",
    "src/shared/crew-voices.ts", "src/tests/speech-local-check.ts", "src/tests/officer-voices-check.ts",
    ".github/workflows/local-speech.yml",
  ]) assert.deepEqual(speechScope([file]), nativeOnly, file);
});

test("browser detection inputs never select large local models", () => {
  for (const file of [
    "web/voice.ts", "web/speech-detector.ts", "web/public/microphone-worklet.js",
    "src/shared/speech-detector.ts", "src/shared/utterance.ts", "src/tests/test-audio.ts",
    "browser-tests/speech-detector.spec.ts", ".github/workflows/browser-speech.yml",
    "vite.config.ts", "playwright.config.ts", "tsconfig.web.json",
  ]) assert.deepEqual(speechScope([file]), browserOnly, file);
  assert.deepEqual(speechScope(["tsconfig.json"]), { localSpeech: true, browserSpeech: true });
});

test("deletions, renames and later documentation do not hide relevant PR changes", () => {
  assert.deepEqual(speechScope(["src/server/local-speech.ts", "docs/old-local-speech.ts"]), nativeOnly);
  assert.deepEqual(speechScope(["src/shared/utterance.ts", "docs/utterance.ts", "README.md"]), browserOnly);
  assert.deepEqual(speechScope(["src/server/local-speech.ts", "README.md", "src/shared/utterance.ts"]),
    { localSpeech: true, browserSpeech: true });
});

test("release versions, JSON key order, lock metadata and unrelated dependencies do not select models", () => {
  const before = fixture();
  const after = fixture();
  after.manifest.version = "1.0.1";
  after.lock.packages[""].version = "1.0.1";
  after.manifest.dependencies.other = "2";
  after.lock.packages["node_modules/other"].version = "2";
  after.lock.packages["node_modules/ws"].license = "MIT";
  assert.deepEqual(speechScope(["package.json", "package-lock.json"], before, after), neither);
  after.manifest.dependencies = { other: "2", ws: "1" };
  assert.deepEqual(speechScope(["package.json"], before, after), neither);
});

test("relevant resolved dependencies and their transitive changes select only their users", () => {
  for (const [path, expected] of [["ws", nativeOnly], ["onnxruntime-web", browserOnly], ["tensor", browserOnly]]) {
    const before = fixture();
    const after = fixture();
    after.lock.packages[`node_modules/${path}`].version = "2";
    assert.deepEqual(speechScope(["package-lock.json"], before, after), expected);
  }
  const before = fixture();
  const after = fixture();
  after.manifest.dependencies.ws = "2";
  assert.deepEqual(speechScope(["package.json"], before, after), nativeOnly);
});

test("nested packages, required peers and optional dependencies are compared", () => {
  const before = fixture();
  before.lock.packages["node_modules/onnxruntime-web"].peerDependencies = { peer: "1" };
  before.lock.packages["node_modules/onnxruntime-web"].optionalDependencies = { optional: "1" };
  before.lock.packages["node_modules/peer"] = { version: "1" };
  before.lock.packages["node_modules/optional"] = { version: "1" };
  before.lock.packages["node_modules/onnxruntime-web/node_modules/tensor"] = { version: "nested" };
  for (const path of ["peer", "optional", "onnxruntime-web/node_modules/tensor"]) {
    const after = structuredClone(before);
    after.lock.packages[`node_modules/${path}`].version = "2";
    assert.deepEqual(speechScope(["package-lock.json"], before, after), browserOnly);
  }
});

test("installed optional peers are model inputs even when another package brought them in", () => {
  const before = fixture();
  before.lock.packages["node_modules/ws"].peerDependencies = { accelerator: "1" };
  before.lock.packages["node_modules/ws"].peerDependenciesMeta = { accelerator: { optional: true } };
  assert.deepEqual(speechScope(["package-lock.json"], before, before), neither);
  const after = structuredClone(before);
  after.lock.packages["node_modules/accelerator"] = { version: "1" };
  assert.deepEqual(speechScope(["package-lock.json"], before, after), nativeOnly);
  const updated = structuredClone(after);
  updated.lock.packages["node_modules/accelerator"].version = "2";
  assert.deepEqual(speechScope(["package-lock.json"], after, updated), nativeOnly);
});

test("changing, removing or adding the speech preparation command selects only local checks", () => {
  const before = fixture();
  before.manifest.scripts = { "setup:speech": "node scripts/setup-speech.mjs" };
  const after = structuredClone(before);
  after.manifest.scripts["setup:speech"] += " --listening nemotron --speaking kokoro";
  assert.deepEqual(speechScope(["package.json"], before, after), nativeOnly);
  delete after.manifest.scripts["setup:speech"];
  assert.deepEqual(speechScope(["package.json"], before, after), nativeOnly);
  assert.deepEqual(speechScope(["package.json"], after, before), nativeOnly);
});

test("model commands and Node runtime changes are relevant, unrelated npm scripts are not", () => {
  const before = fixture();
  const after = fixture();
  before.manifest.scripts = { build: "build", "test:speech:local": "local" };
  after.manifest.scripts = { ...before.manifest.scripts, lint: "changed" };
  assert.deepEqual(speechScope(["package.json"], before, after), neither);
  after.manifest.scripts["test:speech:local"] = "new-local";
  assert.deepEqual(speechScope(["package.json"], before, after), nativeOnly);
  after.manifest.scripts = before.manifest.scripts;
  after.manifest.engines = { node: ">=26" };
  assert.deepEqual(speechScope(["package.json"], before, after), { localSpeech: true, browserSpeech: true });
});

test("missing or unreadable dependency evidence fails instead of skipping or running everything", () => {
  assert.throws(() => speechScope(["package.json"]), /both package/);
  const after = fixture();
  delete after.lock.packages["node_modules/tensor"];
  assert.throws(() => speechScope(["package-lock.json"], fixture(), after), /missing.*tensor/);
  after.lock = {};
  assert.throws(() => speechScope(["package-lock.json"], fixture(), after), /package lock/);
});

test("required gates accept intentional skips only, never failures or unexpected skips", () => {
  const results = { scope: "success", full: "true", systems: "success", localRequired: "false",
    localSpeech: "skipped", browserRequired: "false", browserSpeech: "skipped" };
  assert.equal(serverChecksPassed(results), true);
  assert.equal(serverChecksPassed({ ...results, full: "false", systems: "skipped" }), true);
  assert.equal(serverChecksPassed({ ...results, localRequired: "true", localSpeech: "success",
    browserRequired: "true", browserSpeech: "success" }), true);
  for (const status of ["failure", "cancelled", "skipped", "", undefined]) {
    assert.equal(serverChecksPassed({ ...results, localRequired: "true", localSpeech: status }), false);
    assert.equal(serverChecksPassed({ ...results, browserRequired: "true", browserSpeech: status }), false);
    assert.equal(serverChecksPassed({ ...results, systems: status }), false);
  }
  assert.equal(serverChecksPassed({ ...results, scope: "failure" }), false);
  assert.equal(serverChecksPassed({ ...results, localRequired: "" }), false);
  assert.equal(serverChecksPassed({ ...results, localSpeech: "failure" }), false);
});

test("workflow starts expensive reusable jobs conditionally and preserves required gate names", () => {
  const workflow = readFileSync(new URL("../workflows/checks.yml", import.meta.url), "utf8");
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /options: \[none, local, browser, all\]\n        default: none/);
  for (const name of ["local-speech", "browser-speech"]) {
    assert.match(workflow, new RegExp(`  ${name}:\\n    needs: changes\\n    if: needs.changes.outputs.${name} == 'true'\\n    uses: ./`));
  }
  for (const name of ["ubuntu", "windows", "macos"]) {
    assert.match(workflow, new RegExp(`  ${name}:\\n    name: Server and package \\(${name}-latest\\)\\n    needs: \\[changes, systems, local-speech, browser-speech\\]\\n    if: always\\(\\)`));
  }
  const localWorkflow = readFileSync(new URL("../workflows/local-speech.yml", import.meta.url), "utf8");
  assert.match(localWorkflow, /os: \[ubuntu-24.04, windows-2025, macos-15\]/);
  assert.match(localWorkflow, /run: npm run setup:speech/);
  assert.match(localWorkflow, /run: npm run test:speech:local/);
  assert.doesNotMatch(localWorkflow, /cache-hit|continue-on-error|pull_request_target|speech\.json/);
  const browserWorkflow = readFileSync(new URL("../workflows/browser-speech.yml", import.meta.url), "utf8");
  assert.match(browserWorkflow, /os: \[windows-2025, macos-15\]/);
  assert.match(browserWorkflow, /run: npx playwright test browser-tests\/speech-detector.spec.ts/);
});
