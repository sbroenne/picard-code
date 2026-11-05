import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const prepare = readFileSync(new URL("../workflows/prepare-release.yml", import.meta.url), "utf8");
const dependencies = readFileSync(new URL("../workflows/dependency-review.yml", import.meta.url), "utf8");
const checks = readFileSync(new URL("../workflows/checks.yml", import.meta.url), "utf8");

function step(name) {
  const text = prepare.split(`      - name: ${name}\n`)[1];
  assert.ok(text, `Missing workflow step: ${name}`);
  return text.split("      - name: ")[0].split("        run: |\n")[1].replace(/^ {10}/gm, "");
}

function update({ state = "OPEN", failed = "" } = {}) {
  return spawnSync("bash", ["-euc", `
    npm() { printf 'unexpected package execution'; return 1; }
    node() { printf '1701.4.6'; }
    awk() { printf 'Real release notes'; }
    git() {
      case "$*" in
        "config user.name test-app[bot]") printf 'App author\\n';;
        "config user.email 123+test-app[bot]@users.noreply.github.com") :;;
        "config user.name"*|"config user.email"*) return 1;;
        *push*)
          test "$*" = "-c http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\\n') push --force origin release" || return 1
          printf 'app push\\n'
          test "$FAILED" != push;;
        *) :;;
      esac
    }
    gh() {
      test "$GH_TOKEN" = app-token || return 1
      case "$*" in
        "api users/test-app[bot] --jq .id")
          test "$FAILED" != identity || return 1
          printf '123';;
        "pr list --head release --base main --state open --json number --jq .[0].number // empty")
          test "$FAILED" != lookup || return 1
          if [ "$PR_STATE" = OPEN ]; then printf '73'; fi;;
        "api --method PATCH repos/sbroenne/picard-code/pulls/73"*)
          printf 'edit PR\\n'; test "$FAILED" != edit;;
        "pr create --base main --head release"*)
          printf 'create PR\\n'; test "$FAILED" != create;;
        *) return 1;;
      esac
    }
    ${step("Update the release pull request")}
  `], {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: "app-token", APP_SLUG: "test-app", GITHUB_REPOSITORY: "sbroenne/picard-code", PR_STATE: state, FAILED: failed },
  });
}

test("release updates use the existing repository App, not GitHub's workflow token", () => {
  assert.match(prepare, /uses: actions\/create-github-app-token@[a-f0-9]{40}/);
  assert.match(prepare, /client-id: \$\{\{ vars.GH_AW_APP_CLIENT_ID \}\}/);
  assert.match(prepare, /private-key: \$\{\{ secrets.GH_AW_APP_PRIVATE_KEY \}\}/);
  assert.match(prepare, /repositories: \$\{\{ github.event.repository.name \}\}/);
  assert.match(prepare, /permission-contents: write/);
  assert.match(prepare, /permission-pull-requests: write/);
  assert.match(prepare, /GH_TOKEN: \$\{\{ steps.app-token.outputs.token \}\}/);
  assert.match(prepare, /APP_SLUG: \$\{\{ steps.app-token.outputs.app-slug \}\}/);
  assert.match(prepare, /persist-credentials: false/);
  assert.doesNotMatch(prepare, /^\s+(?:contents|pull-requests|actions): write$/m);
  assert.doesNotMatch(prepare, /outputs.token \|\|/);
  assert.ok(prepare.indexOf("npm run release:version") < prepare.indexOf("uses: actions/create-github-app-token"));
});

test("normal pull-request workflows supply required results without copied checks or dispatches", () => {
  assert.match(checks, /on:\n  pull_request:/);
  assert.match(dependencies, /on:\n  pull_request:/);
  assert.doesNotMatch(prepare, /gh workflow run/);
  assert.doesNotMatch(checks, /release-results:|inputs.pull-request|checks: write/);
});

test("release notes are prepared before App access and no notes skip both write steps", () => {
  assert.match(prepare, /id: version/);
  assert.equal((prepare.match(/if: steps.version.outputs.ready == 'true'/g) || []).length, 2);
  const result = spawnSync("bash", ["-euc", `
    find() { :; }
    npm() { printf 'unexpected package execution'; return 1; }
    ${step("Prepare the release notes")}
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "No release notes are waiting.");
});

test("failed package installation or note preparation never marks a release ready", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "picard-release-checks-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const output = join(folder, "output");
  for (const failed of ["ci", "run", ""]) {
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-euc", `
      find() { printf '.changeset/example.md\\n'; }
      npm() { test "$1" != "$FAILED"; }
      ${step("Prepare the release notes")}
    `], { encoding: "utf8", env: { ...process.env, FAILED: failed, GITHUB_OUTPUT: output } });
    assert.equal(result.status === 0, failed === "", result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(readFileSync(output, "utf8"), failed === "" ? "ready=true\n" : "");
  }
});

test("creating, updating and replacing a closed release PR all use App-authenticated writes", () => {
  for (const state of ["OPEN", "CLOSED", "MISSING"]) {
    const result = update({ state });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /app push/);
    assert.match(result.stdout, /App author/);
    assert.match(result.stdout, state === "OPEN" ? /edit PR/ : /create PR/);
    assert.doesNotMatch(result.stdout, /app-token/);
  }
});

test("App identity, push, lookup, update and creation failures stop release preparation", () => {
  for (const failed of ["identity", "push", "lookup", "edit", "create"]) {
    const result = update({ failed, state: failed === "create" ? "MISSING" : "OPEN" });
    assert.notEqual(result.status, 0, `${failed} failure must be visible`);
    if (failed === "identity" || failed === "push" || failed === "lookup") assert.doesNotMatch(result.stdout, /edit PR|create PR/);
  }
});
