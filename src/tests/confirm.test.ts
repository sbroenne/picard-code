import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionRule } from "@opencode-ai/sdk/v2";
import { LOOK_ONLY, MARKER, rulesToAdd, wildcard } from "../server/confirm.js";

/** OpenCode's own decision: the last matching rule wins; with none, it asks. */
function decide(action: string, resource: string, rules: readonly PermissionRule[]) {
  return rules.findLast((rule) => wildcard(action, rule.permission) && wildcard(resource, rule.pattern))?.action ?? "ask";
}

const agent: PermissionRule[] = [
  { permission: "*", pattern: "*", action: "allow" },
  { permission: "doom_loop", pattern: "*", action: "ask" },
  { permission: "external_directory", pattern: "*", action: "ask" },
  { permission: "external_directory", pattern: "/tmp/opencode/*", action: "allow" },
  { permission: "read", pattern: "*.env", action: "ask" },
  { permission: "bash", pattern: "rm *", action: "deny" },
  { permission: "edit", pattern: "secret/*", action: "deny" },
  { permission: "mcp_*", pattern: "*", action: "allow" },
  { permission: "grep", pattern: "private/*", action: "deny" },
];
const actions = ["edit", "bash", "task", "mcp_github_create_issue", "custom_tool", ...LOOK_ONLY];
const resources = ["src/app.ts", "rm -rf build", "rm", "secret/key.txt", ".env", "/tmp/opencode/out.txt", "private/notes.md", "*"];

test("every change or command asks first, every deny stays, and looking keeps its setting", () => {
  const own: PermissionRule[] = [{ permission: "bash", pattern: "git push*", action: "deny" }];
  const added = rulesToAdd(agent, own)!;
  const all = [...agent, ...own, ...added];
  for (const action of actions) {
    for (const resource of resources) {
      const before = decide(action, resource, [...agent, ...own]);
      const after = decide(action, resource, all);
      if (before === "deny") assert.equal(after, "deny", `${action} ${resource} must stay denied`);
      else if (LOOK_ONLY.includes(action)) assert.equal(after, before, `${action} ${resource} must keep its setting`);
      else assert.equal(after, "ask", `${action} ${resource} must ask`);
    }
  }
  assert.equal(decide("bash", "git push origin", all), "deny");
  assert.equal(decide("bash", "npm test", all), "ask");
  assert.equal(decide("read", "src/app.ts", all), "allow");
  assert.equal(decide("read", ".env", all), "ask");
});

test("the rules are added once, and a deny added later is never hidden by an older block", () => {
  const first = rulesToAdd(agent, [])!;
  assert.deepEqual(first[0], MARKER);
  assert.equal(rulesToAdd(agent, first), undefined, "nothing more is added when the rules are already in place");

  const stricter: PermissionRule[] = [...agent, { permission: "bash", pattern: "npm *", action: "deny" }];
  const second = rulesToAdd(stricter, first)!;
  assert.ok(second, "a change in OpenCode's settings adds a fresh block");
  const all = [...stricter, ...first, ...second];
  assert.equal(decide("bash", "npm publish", all), "deny");
  assert.equal(decide("bash", "ls", all), "ask");
  assert.equal(rulesToAdd(stricter, [...first, ...second]), undefined);
});
