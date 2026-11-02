import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function needsFullChecks(files) {
  return files.some((file) =>
    !/^(?:[^/]+\.md|LICENSE|docs\/.*|tools\/.*|\.changeset\/[^/]+\.md|\.github\/(?:copilot-instructions\.md|PULL_REQUEST_TEMPLATE\.md|ISSUE_TEMPLATE\/.*)|site\/.*|browser-tests\/site\.spec\.ts)$/.test(file));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { BASE, HEAD, EVENT_NAME, GITHUB_OUTPUT } = process.env;
  let full = true;
  if (EVENT_NAME !== "workflow_dispatch" && BASE && !/^0+$/.test(BASE)) {
    if (!/^[a-f0-9]{40}$/.test(BASE) || !/^[a-f0-9]{40}$/.test(HEAD ?? "")) {
      throw new Error("The changed-file check needs valid Git commit identifiers.");
    }
    // List both sides of renames so moving app code into a documentation folder still runs full checks.
    const files = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", BASE, HEAD], { encoding: "utf8" })
      .split("\0").filter(Boolean);
    full = needsFullChecks(files);
  }
  appendFileSync(GITHUB_OUTPUT, `full=${full}\n`);
}
