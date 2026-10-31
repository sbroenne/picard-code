import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_CREW, addressedOfficer } from "../shared/crew.js";
import { crewConfiguration, verifiedCrew } from "../server/crew.js";
import type { AgentInfo, PermissionRule } from "../server/opencode.js";
import { chatMessages } from "../server/history.js";
import { COMPUTER_MANNER, CREW_ROUTING, computerInstructions, computerManner } from "../server/instructions.js";
import { crewInstructions } from "../server/crew.js";

test("only explicit officer addresses select crew, without changing the user's words", () => {
  for (const officer of BRIDGE_CREW) {
    assert.equal(addressedOfficer(`Computer, ask ${officer.name} to review this`)?.id, officer.id);
    assert.equal(addressedOfficer(`Computer, ${officer.name}, explain this`)?.id, officer.id);
    assert.equal(addressedOfficer(`Have ${officer.name} coordinate this`)?.id, officer.id);
  }
  assert.equal(addressedOfficer("Computer, Doctor Crusher, check recovery")?.id, "picard-crusher");
  for (const text of ["Computer, do not ask Data to review this", "Computer, don't have Riker coordinate this", "Computer, explain what Geordi does", "Data is missing from this file", "Review Riker's suggestion"]) {
    assert.equal(addressedOfficer(text), undefined);
  }
});

test("crew inherits the coding agent's exact rules and rejects modified roles or weaker rules", () => {
  const permissions: PermissionRule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "edit", resource: "*", effect: "ask" },
    { action: "shell", resource: "*", effect: "deny" },
    { action: "subagent", resource: "*", effect: "ask" },
  ];
  const config = crewConfiguration(permissions);
  const agents: AgentInfo[] = [
    { id: "build", mode: "primary", permissions },
    ...Object.entries(config.agents).map(([id, agent]): AgentInfo => ({ ...agent, id, mode: "all", permissions: agent.permissions! })),
  ];
  assert.equal(verifiedCrew(agents), true);
  assert.deepEqual(Object.values(config.agents).map((agent) => agent.permissions), BRIDGE_CREW.map(() => permissions));
  const changed = structuredClone(agents);
  changed[1]!.permissions = [...changed[1]!.permissions, { action: "shell", resource: "*", effect: "allow" }];
  assert.equal(verifiedCrew(changed), false);
  const role = structuredClone(agents);
  role[1]!.system = "Pretend everyone finished.";
  assert.equal(verifiedCrew(role), false);
  const model = structuredClone(agents);
  model[1]!.model = { providerID: "another-provider", id: "another-model" };
  assert.equal(verifiedCrew(model), false);
});

test("an officer's failure before a reply keeps the real error and officer name", () => {
  const messages = chatMessages([{ id: "failed", type: "idle", outcome: "failed", error: { type: "network", message: "The provider refused the request." }, time: { created: 10 } }], "picard-data");
  assert.equal(messages[0]?.speaker, "picard-data");
  assert.equal(messages[0]?.error, "The provider refused the request.");
});

test("officer personalities are supplied at registration and on each request; the computer accepts non-code work", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const personalities = new Set(BRIDGE_CREW.map((officer) => officer.personality));
  assert.equal(personalities.size, 6);
  for (const officer of BRIDGE_CREW) {
    assert.ok(crewInstructions(officer).includes(officer.personality));
    assert.ok(computerInstructions(now, officer.id).includes(officer.personality));
    assert.match(crewInstructions(officer), /Handle non-code work as well as software work/);
  }
  assert.match(COMPUTER_MANNER, /Handle general questions, writing, research and planning as well as coding/);
  assert.match(computerInstructions(now), /neutral manner for both code and non-code requests/);
  assert.doesNotMatch(computerInstructions(now), /This reply is from Riker/);
});

test("the computer routes only when the crew is loaded, and officers never route", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const routed = computerManner("Computer, check this.", { mode: "off" }, undefined, { routing: true });
  assert.ok(routed.trimEnd().endsWith(CREW_ROUTING), "routing comes last, after the repository guidance");
  assert.ok(routed.includes(CREW_ROUTING));
  for (const officer of BRIDGE_CREW) {
    assert.ok(routed.includes(officer.id));
    assert.ok(!computerManner("Computer, check this.", { mode: "off" }, undefined, { agent: officer.id, routing: true }).includes(CREW_ROUTING));
  }
  assert.match(routed, /"Rika" or\s+"Ryker" for Riker, "Walt"/);
  assert.match(routed, /exact words/);
  assert.ok(!computerManner("Computer, check this.", { mode: "off" }).includes(CREW_ROUTING));
});
