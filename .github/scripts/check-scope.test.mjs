import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { needsFullChecks } from "./check-scope.mjs";

test("documentation, website and development-only tool changes use the lighter checks", () => {
  assert.equal(needsFullChecks([
    "README.md", "AGENTS.md", "CONTRIBUTING.md", "LICENSE",
    "docs/research/bridge-crew-voices.md", ".changeset/modern-foxes-love.md",
    ".github/copilot-instructions.md", ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/bug.yml", "site/index.html", "site/assets/console.png",
    "browser-tests/site.spec.ts",
    "tools/README.md", "tools/voice-match/match.py",
    "tools/voice-match/render-samples.mjs", "tools/voice-match/pyproject.toml",
    "tools/voice-match/uv.lock", "tools/voice-match/test_match.py",
  ]), false);
  assert.equal(needsFullChecks([]), false);
});

test("app, setup, dependency and check changes always use full checks", () => {
  for (const file of [
    "src/server/app.ts", "web/main.ts", "scripts/setup-speech.mjs",
    "package.json", "package-lock.json", "playwright.config.ts", "tsconfig.json",
    ".changeset/config.json", ".changeset/changelog.mjs",
    ".github/workflows/checks.yml", ".github/scripts/check-scope.mjs",
    ".github/scripts/check-scope.test.mjs", ".github/github-app.yml",
    "browser-tests/app.spec.ts", "browser-tests/voice.spec.ts", "unknown-file",
    "web/README.md", "README.md\nsrc/server/app.ts",
  ]) {
    assert.equal(needsFullChecks(["README.md", "site/index.html", "tools/voice-match/match.py", file]), true, file);
  }
});

test("moving app code to documentation still checks the removed app path", () => {
  assert.equal(needsFullChecks(["src/server/app.ts", "docs/app.ts"]), true);
  assert.equal(needsFullChecks(["src/server/app.ts", "tools/app.ts"]), true);
});

test("Git comparisons select light checks, while manual runs and comparison failures cannot skip full checks", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "picard-check-scope-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(folder, "README.md"), "Before\n");
  writeFileSync(join(folder, "package.json"), '{"version":"1.0.0"}\n');
  writeFileSync(join(folder, "package-lock.json"), '{"lockfileVersion":3,"packages":{}}\n');
  git("add", ".");
  git("commit", "--quiet", "-m", "Before");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(folder, "README.md"), "After\n");
  git("commit", "--quiet", "-am", "Documentation");
  const head = git("rev-parse", "HEAD");
  const output = join(folder, "output");
  const run = (overrides = {}) => {
    writeFileSync(output, "");
    return spawnSync(process.execPath, [fileURLToPath(new URL("./check-scope.mjs", import.meta.url))], {
      cwd: folder, encoding: "utf8",
      env: { ...process.env, BASE: base, HEAD: head, EVENT_NAME: "pull_request", SPEECH_CHECKS: "none", GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(folder, "summary"), ...overrides },
    });
  };
  for (const event of ["pull_request", "push"]) {
    assert.equal(run({ EVENT_NAME: event }).status, 0);
    assert.equal(readFileSync(output, "utf8"), "full=false\nlocal-speech=false\nbrowser-speech=false\n");
  }
  writeFileSync(join(folder, "package.json"), "{}\n");
  git("add", "package.json");
  git("commit", "--quiet", "-m", "Dependencies");
  assert.equal(run({ HEAD: git("rev-parse", "HEAD") }).status, 0);
  assert.equal(readFileSync(output, "utf8"), "full=true\nlocal-speech=false\nbrowser-speech=false\n");
  for (const overrides of [{ EVENT_NAME: "workflow_dispatch" }, { EVENT_NAME: "push", BASE: "" }, { EVENT_NAME: "push", BASE: "0".repeat(40) }]) {
    assert.equal(run(overrides).status, 0);
    assert.equal(readFileSync(output, "utf8"), "full=true\nlocal-speech=false\nbrowser-speech=false\n");
  }
  for (const overrides of [{ BASE: "not a commit" }, { BASE: "1".repeat(40) }, { BASE: "" }, { BASE: "0".repeat(40) }, { SPEECH_CHECKS: "invalid" }]) {
    assert.notEqual(run(overrides).status, 0);
    assert.equal(readFileSync(output, "utf8"), "");
  }
  for (const choice of ["none", "local", "browser", "all"]) {
    assert.equal(run({ EVENT_NAME: "workflow_dispatch", SPEECH_CHECKS: choice }).status, 0);
    assert.equal(readFileSync(output, "utf8"),
      `full=true\nlocal-speech=${choice === "local" || choice === "all"}\nbrowser-speech=${choice === "browser" || choice === "all"}\n`);
  }
  writeFileSync(join(folder, "local-speech.ts"), "Generated test source\n");
  git("add", "local-speech.ts");
  git("commit", "--quiet", "-m", "Unrelated source");
  const unrelated = git("rev-parse", "HEAD");
  // A real speech path selects the matrix even when a later commit only changes documentation.
  mkdirSync(join(folder, "src", "tests"), { recursive: true });
  git("mv", "local-speech.ts", "src/tests/speech-local-check.ts");
  git("commit", "--quiet", "-m", "Rename");
  assert.equal(run({ HEAD: unrelated }).status, 0);
  assert.equal(readFileSync(output, "utf8"), "full=true\nlocal-speech=false\nbrowser-speech=false\n");
  writeFileSync(join(folder, "README.md"), "Another documentation update\n");
  git("commit", "--quiet", "-am", "Documentation after speech");
  const speechHead = git("rev-parse", "HEAD");
  assert.equal(run({ HEAD: speechHead }).status, 0);
  assert.equal(readFileSync(output, "utf8"), "full=true\nlocal-speech=true\nbrowser-speech=false\n");
  assert.equal(run({ HEAD: speechHead, EVENT_NAME: "push" }).status, 0);
  assert.equal(readFileSync(output, "utf8"), "full=true\nlocal-speech=false\nbrowser-speech=false\n");
});
