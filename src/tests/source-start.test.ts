import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { scripts } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  scripts: { start: string; build: string };
};

for (const failure of [undefined, "install", "build"] as const) {
  test(`npm start ${failure ? `stops when ${failure} fails` : "installs, builds and forwards launch options from a fresh clone"}`, () => {
    const folder = mkdtempSync(join(tmpdir(), "picard-source-start-"));
    try {
      const tools = join(folder, "tools");
      mkdirSync(tools);
      writeFileSync(join(tools, "package.json"), JSON.stringify({
        name: "source-build-stand-in",
        version: "1.0.0",
        bin: { tsc: "tsc.cjs", vite: "vite.cjs" },
      }));
      writeFileSync(join(tools, "tsc.cjs"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync("events.jsonl", JSON.stringify(["tsc", ...process.argv.slice(2)]) + "\\n");
if (process.env.PICARD_TEST_BUILD_FAILURE) process.exit(7);
`, { mode: 0o755 });
      writeFileSync(join(tools, "vite.cjs"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync("events.jsonl", JSON.stringify(["vite", ...process.argv.slice(2)]) + "\\n");
fs.mkdirSync("dist/server", { recursive: true });
fs.writeFileSync("dist/server/cli.js", 'import { appendFileSync } from "node:fs"; appendFileSync("events.jsonl", JSON.stringify(["launch", ...process.argv.slice(2)]) + "\\\\n");');
`, { mode: 0o755 });
      writeFileSync(join(folder, "package.json"), JSON.stringify({
        name: "picard-source-start-test",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts,
        devDependencies: { "source-build-stand-in": failure === "install" ? "file:./missing.tgz" : "file:./tools" },
      }));
      const npmCli = process.env.npm_execpath;
      assert.ok(npmCli, "Run this test through npm so its CLI path is available.");
      const result = spawnSync(process.execPath,
        [npmCli, "start", "--", "--no-open", "--project", "Captain project"], {
          cwd: folder,
          encoding: "utf8",
          timeout: 60_000,
          env: {
            ...process.env,
            NODE_ENV: "production",
            npm_config_audit: "false",
            npm_config_fund: "false",
            npm_config_update_notifier: "false",
            ...(failure === "build" ? { PICARD_TEST_BUILD_FAILURE: "1" } : {}),
          },
        });
      assert.ifError(result.error);
      const output = result.stdout + result.stderr;
      if (failure === "install") {
        assert.notEqual(result.status, 0, output);
        assert.match(output, /ENOENT/);
        assert.throws(() => readFileSync(join(folder, "events.jsonl")), { code: "ENOENT" });
      } else {
        const events = readFileSync(join(folder, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
        assert.deepEqual(events, failure === "build"
          ? [["tsc", "-p", "tsconfig.json"]]
          : [["tsc", "-p", "tsconfig.json"], ["vite", "build"], ["launch", "--no-open", "--project", "Captain project"]]);
        if (failure === "build") assert.notEqual(result.status, 0, output);
        else assert.equal(result.status, 0, output);
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
}
