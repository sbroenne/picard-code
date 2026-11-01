import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { bundledOpenCode, openCodeCommand, openCodePackage } from "../server/process.js";

test("every computer the README promises maps to an OpenCode package Picard Code lists", () => {
  const { optionalDependencies } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { optionalDependencies: Record<string, string> };
  const promised = ["win32", "darwin", "linux"].flatMap((platform) => ["x64", "arm64"].map((arch) => openCodePackage(platform, arch)));
  assert.deepEqual(promised.sort(), Object.keys(optionalDependencies).filter((name) => name.startsWith("@opencode/cli-")).sort());
});

test("the included OpenCode is found on this computer and is the pinned version", async () => {
  const { optionalDependencies } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { optionalDependencies: Record<string, string> };
  const versions = new Set(Object.entries(optionalDependencies).filter(([name]) => name.startsWith("@opencode/cli-")).map(([, version]) => version));
  assert.equal(versions.size, 1, "Every @opencode/cli-* package must be pinned to the same version.");
  const program = bundledOpenCode();
  assert.ok(program, "No included OpenCode package matches this computer.");
  const saved = process.env.PICARD_OPENCODE_PATH;
  delete process.env.PICARD_OPENCODE_PATH;
  try { assert.equal((await openCodeCommand()).command, program); }
  finally { if (saved !== undefined) process.env.PICARD_OPENCODE_PATH = saved; }
  assert.equal(execFileSync(program, ["--version"], { encoding: "utf8" }).trim(), `opencode v${[...versions][0]}`);
});
