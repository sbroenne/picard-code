import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_CREW, addressedOfficer, repeatsReport } from "../shared/crew.js";
import { crewConfiguration, verifiedCrew } from "../server/crew.js";
import type { AgentInfo, PermissionRule } from "../server/opencode.js";
import { chatMessages } from "../server/history.js";
import { CAPTAINS_ORDERS, COMPUTER_MANNER, CREW_ROUTING, computerInstructions, computerManner } from "../server/instructions.js";
import { crewInstructions } from "../server/crew.js";

test("only explicit officer addresses select crew, without changing the user's words", () => {
  for (const officer of BRIDGE_CREW) {
    assert.equal(addressedOfficer(`Computer, ask ${officer.name} to review this`)?.id, officer.id);
    assert.equal(addressedOfficer(`Computer, ${officer.name}, explain this`)?.id, officer.id);
    assert.equal(addressedOfficer(`Have ${officer.name} coordinate this`)?.id, officer.id);
  }
  assert.equal(addressedOfficer("Computer, Doctor Crusher, check recovery")?.id, "picard-crusher");
  const ranks: [string, string][] = [
    ["Computer, Number One, report.", "picard-riker"], ["Will, coordinate this", "picard-riker"], ["Computer, Commander Riker, explain this", "picard-riker"],
    ["Computer, Mr. Data, explain this", "picard-data"], ["Computer, Lieutenant Commander Data, analyse this", "picard-data"],
    ["Computer, Mr. La Forge, repair the build", "picard-geordi"], ["Computer, LaForge, check this", "picard-geordi"], ["Have Geordi La Forge build it", "picard-geordi"],
    ["Computer, Mr. Worf, review the login", "picard-worf"], ["Computer, Lieutenant Worf, check this", "picard-worf"],
    ["Computer, Counselor, review this message", "picard-troi"], ["Computer, Deanna, explain this", "picard-troi"],
    ["Computer, Doctor, check recovery", "picard-crusher"], ["Computer, Beverly, review this plan", "picard-crusher"], ["Computer, Dr. Crusher, check this", "picard-crusher"],
  ];
  for (const [text, id] of ranks) assert.equal(addressedOfficer(text)?.id, id, text);
  for (const text of ["Computer, Commander, review this", "Computer, will the build pass?", "Computer, Doctor Who facts, please", "Computer, number one priority: fix the build"]) {
    assert.equal(addressedOfficer(text), undefined, text);
  }
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
  assert.deepEqual(Object.keys(config), ["agents"], "OpenCode's own helper limit is kept, because officers do not hand work on");
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

test("officers speak in their own bridge voices, not the computer's neutral one", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  for (const officer of BRIDGE_CREW) {
    for (const instructions of [crewInstructions(officer), computerInstructions(now, officer.id)]) {
      assert.doesNotMatch(instructions, /restrained manner of a helpful ship computer|use no other titles or names/, `${officer.name} must not be told to sound like the computer`);
      assert.match(instructions, /Starfleet officer reporting to the Captain/);
      assert.match(instructions, /Never quote or paraphrase lines from the show/);
      assert.match(instructions, /never invent\s+ship status/);
      assert.match(instructions, /Never invent completion/);
      assert.match(instructions, /"Make it so"/);
    }
  }
  const voice = (name: string) => BRIDGE_CREW.find((officer) => officer.name === name)!.personality;
  assert.match(voice("Riker"), /Number One/);
  assert.match(voice("Data"), /Never use contractions/);
  assert.match(voice("Geordi"), /chief engineer/);
  assert.match(voice("Worf"), /few words/);
  assert.match(voice("Troi"), /I sense/);
  assert.match(voice("Crusher"), /"Jean-Luc"/);
  assert.match(COMPUTER_MANNER, /use no other titles or names/, "the computer keeps calling him only Captain");
});

test("the Captain's orders are understood, but never answer an approval or widen a request", () => {
  for (const instructions of [COMPUTER_MANNER, ...BRIDGE_CREW.map((officer) => crewInstructions(officer))]) {
    assert.ok(instructions.includes(CAPTAINS_ORDERS));
  }
  assert.match(CAPTAINS_ORDERS, /"Make it so"[\s\S]*carry out exactly what\s+was just proposed[\s\S]*nothing more/);
  assert.match(CAPTAINS_ORDERS, /unclear which proposal he means[\s\S]*ask one short question instead of guessing/);
  assert.match(CAPTAINS_ORDERS, /"Engage" means start the agreed work now/);
  assert.match(CAPTAINS_ORDERS, /never answer an approval or a\s+question waiting on screen/);
  assert.match(CREW_ROUTING, /"Number One" or "Will" is Riker/);
  assert.match(CREW_ROUTING, /"Make it so" after that officer's proposal, give it to the same\s+officer and pass the sessionID/);
});

test("the computer holds briefings itself; Riker weighs options instead of coordinating", () => {
  assert.match(CREW_ROUTING, /hold a briefing[\s\S]*give each\s+officer needed a separate assignment/);
  assert.match(CREW_ROUTING, /give picard-riker the other\s+officers' actual findings after they report/);
  assert.match(CREW_ROUTING, /Allow at most one officer to change files/);
  assert.match(CREW_ROUTING, /Officers do not hand work to each other; you\s+call each one/);
  assert.doesNotMatch(CREW_ROUTING, /to coordinate/);
  const riker = BRIDGE_CREW.find((officer) => officer.id === "picard-riker")!;
  assert.equal(riker.duty, "Weigh options and recommend");
  assert.doesNotMatch(`${riker.personality} ${riker.role}`, /coordinat|delegate|assignments/i);
  for (const officer of BRIDGE_CREW) {
    assert.match(crewInstructions(officer), /Do not hand work to other officers/);
    assert.doesNotMatch(crewInstructions(officer), /When delegating|Only Riker/);
  }
});

test("the computer relays an officer's report briefly; a word-for-word copy is recognised", () => {
  assert.match(CREW_ROUTING, /relay it\s+briefly in your own neutral manner, naming the officer/);
  assert.match(CREW_ROUTING, /full reports are already shown on\s+screen, so do not repeat them/);
  const report = "Captain, I refused because the procedure risked losing the experiences and memories that make me who I am.";
  assert.equal(repeatsReport(`**Data:** ${report}`, report, "Data"), true);
  assert.equal(repeatsReport(`Data reports: "${report}"`, report, "Data"), true);
  assert.equal(repeatsReport("**Data:** Captain, I refused because the proc", report, "Data"), true, "a copy still arriving is already recognised");
  assert.equal(repeatsReport(`${report} I could not confirm this in the project.`, report, "Data"), false, "anything the computer adds stays visible");
  assert.equal(repeatsReport("Data refused to protect his memories.", report, "Data"), false);
  assert.equal(repeatsReport(`Worf: ${report}`, report, "Data"), false);
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
