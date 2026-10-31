import type { PermissionRule } from "@opencode-ai/sdk/v2";

/**
 * Actions that only look at things. Everything else (file changes, commands, helpers,
 * extension tools) must be confirmed by the captain.
 */
export const LOOK_ONLY = [
  "read", "glob", "grep", "list", "lsp", "todoread", "todowrite", "question", "webfetch", "websearch",
  "codesearch", "skill", "plan_enter", "plan_exit", "external_directory", "doom_loop",
];

/** OpenCode's wildcard rule: `*` is any text, `?` is one character, and a trailing " *" is optional. */
export function wildcard(text: string, pattern: string) {
  let escaped = pattern.replaceAll("\\", "/").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`;
  return new RegExp(`^${escaped}$`, "s").test(text.replaceAll("\\", "/"));
}

/**
 * Rules added to a conversation so that every change or command asks first.
 *
 * OpenCode checks the agent's rules and then the conversation's rules, and the last
 * matching rule wins. These rules repeat the rules already in force, in order, with each
 * "allow" for a change or command turned into "ask". Every "deny" and every "ask" stays
 * exactly as configured, and looking at files keeps its existing setting.
 */
export function confirmChanges(rules: readonly PermissionRule[]): PermissionRule[] {
  const result: PermissionRule[] = [{ permission: "*", pattern: "*", action: "ask" }];
  for (const rule of rules) {
    if (rule.action !== "allow" || LOOK_ONLY.includes(rule.permission)) {
      result.push({ ...rule });
      continue;
    }
    result.push({ ...rule, action: "ask" });
    for (const permission of LOOK_ONLY) {
      if (wildcard(permission, rule.permission)) result.push({ permission, pattern: rule.pattern, action: "allow" });
    }
  }
  return result;
}

/** Whether a conversation's rules already end with the confirmation rules. */
function endsWith(rules: readonly PermissionRule[], tail: readonly PermissionRule[]) {
  if (rules.length < tail.length) return false;
  const start = rules.length - tail.length;
  return tail.every((rule, index) => {
    const other = rules[start + index]!;
    return other.permission === rule.permission && other.pattern === rule.pattern && other.action === rule.action;
  });
}

/** Marks where Picard Code's own rules begin; it matches no real tool. */
export const MARKER: PermissionRule = { permission: "picard-code", pattern: "confirm-changes", action: "ask" };

/**
 * The rules to add to a conversation, or nothing when it already asks first.
 * Picard Code's earlier blocks are left out of the calculation, so a "deny" added to
 * OpenCode's settings later is never hidden by an older block.
 */
export function rulesToAdd(agent: readonly PermissionRule[], conversation: readonly PermissionRule[]) {
  const first = conversation.findIndex((rule) => rule.permission === MARKER.permission && rule.pattern === MARKER.pattern);
  const own = first === -1 ? conversation : conversation.slice(0, first);
  const wanted = [MARKER, ...confirmChanges([...agent, ...own])];
  return endsWith(conversation, wanted) ? undefined : wanted;
}
