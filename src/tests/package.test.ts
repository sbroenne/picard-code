import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const saved = { path: process.env.PATH, openCode: process.env.PICARD_OPENCODE_PATH };
  delete process.env.PICARD_OPENCODE_PATH;
  process.env.PATH = "";
  try { assert.equal((await openCodeCommand()).command, program, "With no OpenCode installed, the included one is used."); }
  finally {
    process.env.PATH = saved.path;
    if (saved.openCode !== undefined) process.env.PICARD_OPENCODE_PATH = saved.openCode;
  }
  assert.equal(execFileSync(program, ["--version"], { encoding: "utf8" }).trim(), `opencode v${[...versions][0]}`);
});

test("an OpenCode 2 already installed is preferred; an older one is skipped", { skip: process.platform === "win32" && "needs a stand-in .exe" }, async () => {
  const folder = mkdtempSync(join(tmpdir(), "picard-opencode-"));
  const installed = join(folder, "opencode");
  const saved = { path: process.env.PATH, openCode: process.env.PICARD_OPENCODE_PATH };
  delete process.env.PICARD_OPENCODE_PATH;
  process.env.PATH = folder;
  try {
    writeFileSync(installed, "#!/bin/sh\necho opencode v2.9.0\n", { mode: 0o755 });
    assert.equal((await openCodeCommand()).command, installed);
    writeFileSync(installed, "#!/bin/sh\necho 1.14.0\n", { mode: 0o755 });
    assert.equal((await openCodeCommand()).command, bundledOpenCode());
  } finally {
    process.env.PATH = saved.path;
    if (saved.openCode !== undefined) process.env.PICARD_OPENCODE_PATH = saved.openCode;
    rmSync(folder, { recursive: true, force: true });
  }
});
