import assert from "node:assert/strict";
import { test } from "node:test";
import { reportReleaseChecks } from "./report-release-checks.mjs";

const SHA = "a".repeat(40);
const MERGE = "b".repeat(40);
const options = {
  repo: "owner/repo", pr: 35, sha: SHA, token: "test-token",
  runURL: "https://github.com/owner/repo/actions/runs/1",
  results: { scope: "success", browser: "success", systems: "success" },
};

function fixture({ head = SHA, ref = "release", repo = "owner/repo", state = "open", sameTree = true, reject = false } = {}) {
  const reported = [];
  const request = async (url, init) => {
    if (reject) return new Response(null, { status: 403 });
    const path = url.split("/repos/owner/repo/")[1];
    let value;
    if (path === "pulls/35") value = { state, head: { sha: head, ref, repo: { full_name: repo } } };
    else if (path === "git/ref/pull/35/merge") value = { object: { sha: MERGE } };
    else if (path === `git/commits/${SHA}`) value = { tree: { sha: "same" } };
    else if (path === `git/commits/${MERGE}`) value = { tree: { sha: sameTree ? "same" : "different" } };
    else if (path === "check-runs") { reported.push(JSON.parse(init.body)); value = {}; }
    else throw new Error(`Unexpected test request: ${path}`);
    return Response.json(value);
  };
  return { request, reported };
}

test("reports the real results on the identical merge files with links to their evidence", async () => {
  const mock = fixture();
  await reportReleaseChecks(options, mock.request);
  assert.equal(mock.reported.length, 4);
  for (const check of mock.reported) {
    assert.equal(check.head_sha, MERGE);
    assert.equal(check.conclusion, "success");
    assert.equal(check.details_url, options.runURL);
  }
});

test("failed, cancelled and skipped tests never become successful release checks", async () => {
  for (const result of ["failure", "cancelled", "skipped"]) {
    const mock = fixture();
    await reportReleaseChecks({ ...options, results: { scope: "success", browser: result, systems: result } }, mock.request);
    assert.ok(mock.reported.every((check) => check.conclusion === "failure"));
  }
  const mock = fixture();
  await reportReleaseChecks({ ...options, results: { ...options.results, scope: "failure" } }, mock.request);
  assert.ok(mock.reported.every((check) => check.conclusion === "failure"));
});

test("changed, closed, foreign or different release files cannot receive results", async () => {
  for (const change of [{ head: MERGE }, { state: "closed" }, { repo: "foreign/repo" }, { ref: "other" }, { sameTree: false }]) {
    const mock = fixture(change);
    await assert.rejects(reportReleaseChecks(options, mock.request), /No results were reported/);
    assert.equal(mock.reported.length, 0);
  }
});

test("API failures are reported rather than hidden", async () => {
  const mock = fixture({ reject: true });
  await assert.rejects(reportReleaseChecks(options, mock.request), /HTTP 403/);
});
