import assert from "node:assert/strict";
import test from "node:test";
import { readyToLaunch } from "./status.mjs";

test("one failed check blocks the launch", () => {
  assert.equal(readyToLaunch([{ passed: true }, { passed: true }, { passed: false }]), false);
});

test("all checks must pass", () => {
  assert.equal(readyToLaunch([{ passed: true }, { passed: true }]), true);
});

test("no checks is not permission to launch", () => {
  assert.equal(readyToLaunch([]), false);
});
