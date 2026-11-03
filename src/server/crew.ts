import { BRIDGE_CREW } from "../shared/crew.js";
import { officerManner } from "./instructions.js";
import type { AgentInfo, PermissionRule, OpenCode } from "./opencode.js";

export function crewInstructions(officer: typeof BRIDGE_CREW[number]) {
  return `${officerManner(officer)}

${officer.role}
Handle non-code work as well as software work. Apply your expertise to the
actual subject; do not turn every request into a coding task.
${officer.id === "picard-riker" ? `Only when the Captain explicitly asks you to organise or coordinate work,
use the subagent tool to call the relevant officers. Pass his exact words and
limits to each officer. Calling an officer is not running a shell command or
changing files; an explicit ban on tools, subagents or officer calls still
applies. Give at most one officer permission to change files,
and only when the Captain requested changes; the others review. Wait for
actual results and identify any failure. A request for your opinion, options
or a recommendation alone does not authorise delegation. Keep OpenCode's
existing helper limit; if OpenCode refuses a call, explain the actual failure
rather than bypassing it. Do not assume a call is blocked before trying it.` : `Do not hand work to other officers. When another officer's expertise is
needed, name that officer and say why in your report.`}
Speak directly to the Captain. Respond to other officers' actual findings
when available; respectful disagreement is useful. Never invent dialogue,
consensus or work by another officer. The computer connects requests and
provides information; it does not command you or decide for the Captain.
Keep the Captain's exact request, negations, scope and approval boundaries.
Use the selected session model; do not choose another provider or model.
Report one concise answer, with supporting detail later. Do not write team
configuration, instructions, skills or memory into the Captain's project.
Approvals must be answered by the Captain on screen.

The bridge officers are:
${BRIDGE_CREW.map((member) => `${member.id}: ${member.name} - ${member.duty}`).join("\n")}`;
}

// Riker can call officers from the main log entry without raising OpenCode's helper limit.
export function crewConfiguration(permissions?: PermissionRule[]) {
  return { agents: Object.fromEntries(BRIDGE_CREW.map((officer) => [officer.id, {
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

export const CREW_UNAVAILABLE = 'The bridge crew is not available with the current OpenCode settings. Start Picard Code with its own OpenCode server, and check for settings that override the "picard-" crew definitions.';

/** OpenCode can answer during startup or reload before its agents have finished loading. */
export async function loadedAgents(client: OpenCode, directory: string, crew = false, signal?: AbortSignal) {
  const deadline = Date.now() + 5000;
  for (;;) {
    signal?.throwIfAborted();
    const agents = await client.agents(directory);
    if (crew ? verifiedCrew(agents) : agents.some((agent) => agent.id === "build")) return agents;
    if (Date.now() >= deadline) return agents;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

export async function requireCrew(client: OpenCode, directory: string) {
  const agents = await client.agents(directory);
  if (!verifiedCrew(agents)) throw new Error(CREW_UNAVAILABLE);
  return agents;
}
