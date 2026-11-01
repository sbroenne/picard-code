import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const prepare = readFileSync(new URL("../workflows/prepare-release.yml", import.meta.url), "utf8");
const dependencies = readFileSync(new URL("../workflows/dependency-review.yml", import.meta.url), "utf8");
const checks = readFileSync(new URL("../workflows/checks.yml", import.meta.url), "utf8");
const dispatch = prepare.slice(prepare.indexOf("          gh workflow run checks.yml")).replace(/^ {10}/gm, "");

test("release preparation dispatches both checks against the release branch and exact comparison commits", () => {
  assert.match(prepare, /      actions: write/);
  assert.match(prepare, /GITHUB_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(checks, /  workflow_dispatch:/);
  assert.match(dependencies, /  workflow_dispatch:\n    inputs:\n      base-ref:/);
  assert.match(dependencies, /      head-ref:\n[\s\S]*?required: true/);
  assert.match(dependencies, /base-ref: \$\{\{ inputs.base-ref \|\| github.event.pull_request.base.sha \}\}/);
  assert.match(dependencies, /head-ref: \$\{\{ inputs.head-ref \|\| github.event.pull_request.head.sha \}\}/);
  const result = spawnSync("bash", ["-euc", `
    git() {
      case "$*" in
        "rev-parse origin/main") printf 'base-sha';;
        "rev-parse HEAD") printf 'release-sha';;
        *) return 1;;
      esac
    }
    gh() { printf '%s\\n' "$*"; }
    ${dispatch}
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "workflow run checks.yml --ref release",
    "workflow run dependency-review.yml --ref release -f base-ref=base-sha -f head-ref=release-sha",
  ]);
});

test("a failed dispatch fails release preparation instead of reporting that checks started", () => {
  const result = spawnSync("bash", ["-euc", `
    gh() { return 1; }
    ${dispatch}
    printf 'incorrect success'
  `], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
});
