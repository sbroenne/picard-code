import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { speechScope } from "./speech-scope.mjs";

export function needsFullChecks(files) {
  return files.some((file) =>
    !/^(?:[^/]+\.md|LICENSE|docs\/.*|tools\/.*|\.changeset\/[^/]+\.md|\.github\/(?:copilot-instructions\.md|PULL_REQUEST_TEMPLATE\.md|ISSUE_TEMPLATE\/.*)|site\/.*|browser-tests\/site\.spec\.ts)$/.test(file));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { BASE, HEAD, EVENT_NAME, GITHUB_OUTPUT, SPEECH_CHECKS = "none", GITHUB_STEP_SUMMARY } = process.env;
  let full = true;
  let localSpeech = false;
  let browserSpeech = false;
  if (!["none", "local", "browser", "all"].includes(SPEECH_CHECKS)) throw new Error("Choose none, local, browser or all for speech checks.");
  if (EVENT_NAME === "pull_request" && (!BASE || /^0+$/.test(BASE))) throw new Error("Speech check selection needs the pull request's comparison commits.");
  if (EVENT_NAME !== "workflow_dispatch" && BASE && !/^0+$/.test(BASE)) {
    if (!/^[a-f0-9]{40}$/.test(BASE) || !/^[a-f0-9]{40}$/.test(HEAD ?? "")) {
      throw new Error("The changed-file check needs valid Git commit identifiers.");
    }
    // List both sides of renames so moving app code into a documentation folder still runs full checks.
    const files = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", BASE, HEAD], { encoding: "utf8" })
      .split("\0").filter(Boolean);
    full = needsFullChecks(files);
    if (EVENT_NAME === "pull_request") {
      const readPackages = (commit) => ({
        manifest: JSON.parse(execFileSync("git", ["show", `${commit}:package.json`], { encoding: "utf8" })),
        lock: JSON.parse(execFileSync("git", ["show", `${commit}:package-lock.json`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })),
      });
      const dependencyChange = files.some((file) => file === "package.json" || file === "package-lock.json");
      ({ localSpeech, browserSpeech } = speechScope(files, dependencyChange ? readPackages(BASE) : undefined, dependencyChange ? readPackages(HEAD) : undefined));
    }
  }
  if (EVENT_NAME === "workflow_dispatch") {
    localSpeech = SPEECH_CHECKS === "local" || SPEECH_CHECKS === "all";
    browserSpeech = SPEECH_CHECKS === "browser" || SPEECH_CHECKS === "all";
  }
  appendFileSync(GITHUB_OUTPUT, `full=${full}\nlocal-speech=${localSpeech}\nbrowser-speech=${browserSpeech}\n`);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY,
    `## Selected checks\n\nFull checks: ${full}. Real local speech: ${localSpeech}. Cross-system browser detection: ${browserSpeech}.\n\nModel downloads are cached; test results are not. Speech selection uses the complete pull-request comparison. Pushes to main do not repeat model jobs; manual runs require an explicit speech choice.\n`);
}
