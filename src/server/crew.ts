import { BRIDGE_CREW } from "../shared/crew.js";
import { COMPUTER_MANNER } from "./instructions.js";
import type { AgentInfo, PermissionRule, OpenCode } from "./opencode.js";

export function crewInstructions(officer: typeof BRIDGE_CREW[number]) {
  return `${COMPUTER_MANNER}

You are the ${officer.name} bridge officer profile, inspired by that officer's
TNG personality, not an imitation of an actor or an official franchise product.
Use this personality instead of the computer's neutral manner, while keeping
its brevity, truthfulness and respect for the Captain:
${officer.personality}
${officer.role}
Handle non-code work as well as software work. Apply your expertise to the
actual subject; do not turn every request into a coding task.
Only Riker coordinates other officers. The computer is a separate interface;
never invent dialogue or pretend another officer performed work.
Keep the Captain's exact request, negations, scope and approval boundaries.
Use the selected session model; do not choose another provider or model.
Report one concise answer, with supporting detail later. Do not write team
configuration, instructions, skills or memory into the Captain's project.
When delegating, pass the exact relevant request, its limits and the current
stardate to the child. Approvals must be answered by the Captain on screen.

The bridge officers are:
${BRIDGE_CREW.map((member) => `${member.id}: ${member.name} - ${member.duty}`).join("\n")}`;
}

// The computer hands work to an officer, who may hand it on again (Riker
// coordinating others), so helpers need two levels instead of OpenCode's one.
export const CREW_SUBAGENT_DEPTH = 2;

export function crewConfiguration(permissions?: PermissionRule[]) {
  return { experimental: { subagent_depth: CREW_SUBAGENT_DEPTH }, agents: Object.fromEntries(BRIDGE_CREW.map((officer) => [officer.id, {
    mode: "all",
    description: `${officer.name}: ${officer.duty}`,
    system: crewInstructions(officer),
    ...(permissions ? { permissions } : {}),
  }])) };
}

function normalizedPermissions(rules: PermissionRule[]) {
  return rules.filter((rule, index) => !rules.slice(index + 1).some((later) => later.action === rule.action && later.resource === rule.resource));
}

export function verifiedCrew(agents: AgentInfo[]) {
  const build = agents.find((agent) => agent.id === "build");
  return !!build && BRIDGE_CREW.every((officer) => {
    const agent = agents.find((item) => item.id === officer.id);
    return agent?.system === crewInstructions(officer) && agent.mode === "all" && !agent.model
      && JSON.stringify(normalizedPermissions(agent.permissions)) === JSON.stringify(normalizedPermissions(build.permissions));
  });
}

export async function requireCrew(client: OpenCode, directory: string) {
  const agents = await client.agents(directory);
  if (!verifiedCrew(agents)) throw new Error('The bridge crew is not available with the current OpenCode settings. Start Picard Code with its own OpenCode server, and check for settings that override the "picard-" crew definitions.');
  return agents;
}
