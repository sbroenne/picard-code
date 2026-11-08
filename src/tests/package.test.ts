import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledOpenCode, openCodeCommand, openCodePackage, usesCustomOpenCodeSettings } from "../server/process.js";

const launcher = fileURLToPath(new URL("../server/cli.js", import.meta.url));

test("launch help describes automatic startup without an existing-server option", () => {
  const help = execFileSync(process.execPath, [launcher, "--help"], { encoding: "utf8", timeout: 10_000 });
  assert.match(help, /--project/);
  assert.doesNotMatch(help, /--connect/);
});

for (const option of [["--connect", "http://127.0.0.1:4096"], ["--connect=http://127.0.0.1:4096"]]) {
  test(`the removed ${option[0]} option is rejected before startup, including with help`, () => {
    const result = spawnSync(process.execPath, [launcher, ...option, "--help"], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option '--connect'/);
    assert.doesNotMatch(result.stdout, /Checking computer sounds|Starting OpenCode/);
  });
}

test("custom OpenCode settings include inline settings and separate configuration or sign-in folders", () => {
  assert.equal(usesCustomOpenCodeSettings({}), false);
  for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "PICARD_OPENCODE_PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
    assert.equal(usesCustomOpenCodeSettings({ [key]: "test-setting" }), true, key);
    assert.equal(usesCustomOpenCodeSettings({ [key]: "" }), false, `${key} is empty`);
  }
});

test("every computer the README promises maps to an OpenCode package Picard Code lists", () => {
  const { optionalDependencies } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { optionalDependencies: Record<string, string> };
  const promised = ["win32", "darwin", "linux"].flatMap((platform) => ["x64", "arm64"].map((arch) => openCodePackage(platform, arch)));
  assert.deepEqual(promised.sort(), Object.keys(optionalDependencies).filter((name) => name.startsWith("@opencode/cli-")).sort());
});

test("the included OpenCode is found on this computer and meets the minimum version", async () => {
  const { optionalDependencies } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { optionalDependencies: Record<string, string> };
  const versions = new Set(Object.entries(optionalDependencies).filter(([name]) => name.startsWith("@opencode/cli-")).map(([, version]) => version));
  assert.equal(versions.size, 1, "Every @opencode/cli-* package must ask for the same minimum version.");
  const program = bundledOpenCode();
  assert.ok(program, "No included OpenCode package matches this computer.");
  const saved = { path: process.env.PATH, openCode: process.env.PICARD_OPENCODE_PATH };
  delete process.env.PICARD_OPENCODE_PATH;
  process.env.PATH = "";
  try {
    const selected = await openCodeCommand();
    assert.equal(selected.command, program, "With no OpenCode installed, the included one is used.");
    assert.equal(selected.source, "bundled");
  }
  finally {
    process.env.PATH = saved.path;
    if (saved.openCode !== undefined) process.env.PICARD_OPENCODE_PATH = saved.openCode;
  }
  const range = [...versions][0] ?? "";
  assert.match(range, /^\^2\.\d+\.\d+$/, "Ask for a minimum OpenCode 2 version, such as ^2.1.4, so newer 2 versions can be used.");
  const reported = execFileSync(program, ["--version"], { encoding: "utf8" }).trim();
  const version = /^opencode v(2\.\d+\.\d+)$/.exec(reported)?.[1] ?? "";
  assert.ok(version, `The included OpenCode is not version 2: ${reported}`);
  const sortable = (value: string) => value.split(".").map((part) => part.padStart(6, "0")).join(".");
  assert.ok(sortable(version) >= sortable(range.slice(1)), `The included OpenCode ${version} is older than ${range.slice(1)}.`);
});

test("an OpenCode 2 already installed is preferred; an older one is skipped", { skip: process.platform === "win32" && "needs a stand-in .exe" }, async () => {
  const folder = mkdtempSync(join(tmpdir(), "picard-opencode-"));
  const installed = join(folder, "opencode");
  const saved = { path: process.env.PATH, openCode: process.env.PICARD_OPENCODE_PATH };
  delete process.env.PICARD_OPENCODE_PATH;
  process.env.PATH = folder;
  try {
    writeFileSync(installed, "#!/bin/sh\necho opencode v2.9.0\n", { mode: 0o755 });
    const selected = await openCodeCommand();
    assert.equal(selected.command, installed);
    assert.equal(selected.source, "installed");
    writeFileSync(installed, "#!/bin/sh\necho 1.14.0\n", { mode: 0o755 });
    assert.equal((await openCodeCommand()).command, bundledOpenCode());
  } finally {
    process.env.PATH = saved.path;
    if (saved.openCode !== undefined) process.env.PICARD_OPENCODE_PATH = saved.openCode;
    rmSync(folder, { recursive: true, force: true });
  }
});

test("an explicitly selected OpenCode reports a custom source", async () => {
  const saved = process.env.PICARD_OPENCODE_PATH;
  process.env.PICARD_OPENCODE_PATH = process.execPath;
  try {
    const selected = await openCodeCommand();
    assert.equal(selected.source, "custom");
  } finally {
    if (saved === undefined) delete process.env.PICARD_OPENCODE_PATH;
    else process.env.PICARD_OPENCODE_PATH = saved;
  }
});
