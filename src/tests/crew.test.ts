import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_CREW, chosenCrew, addressedOfficer, repeatsReport } from "../shared/crew.js";
import { crewConfiguration, loadedAgents, verifiedCrew } from "../server/crew.js";
import { OpenCode, type AgentInfo, type PermissionRule } from "../server/opencode.js";
import { chatMessages } from "../server/history.js";
import { CAPTAINS_ORDERS, COMPUTER_MANNER, CREW_KEPT, computerInstructions, computerManner, crewBriefing, crewChoice } from "../server/instructions.js";
import { crewInstructions } from "../server/crew.js";

test("startup and reload wait for real agents without swallowing errors or cancellation", async () => {
  const permissions: PermissionRule[] = [{ action: "edit", resource: "*", effect: "ask" }];
  const build: AgentInfo = { id: "build", mode: "primary", permissions };
  const crew: AgentInfo[] = [
    build,
    ...Object.entries(crewConfiguration(permissions).agents).map(([id, agent]): AgentInfo => ({ ...agent, id, mode: "all", permissions })),
  ];
  const client = new OpenCode("http://127.0.0.1:1", "test");
  let calls = 0;
  client.agents = async () => ++calls === 1 ? [] : [build];
  assert.deepEqual(await loadedAgents(client, "."), [build]);
  assert.equal(calls, 2);
  calls = 0;
  client.agents = async () => ++calls === 1 ? [build] : crew;
  assert.deepEqual(await loadedAgents(client, ".", true), crew);
  assert.equal(calls, 2);
  client.agents = async () => { throw new Error("The agent request failed."); };
  await assert.rejects(loadedAgents(client, "."), /The agent request failed/);
  await assert.rejects(loadedAgents(client, ".", false, AbortSignal.abort()), { name: "AbortError" });
});

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
  assert.match(crewChoice("Make it so."), /"Number One" or "Will" is Riker/);
  assert.match(crewChoice("Make it so.", "Data"), /follows up on an officer's earlier reply[\s\S]*"Make it so"[\s\S]*choose that officer\. The latest\s+reply in this log entry came from Data\./);
});

test("the computer holds briefings itself; Riker weighs options instead of coordinating", () => {
  const briefing = crewBriefing(["picard-worf", "picard-troi", "picard-riker"]);
  assert.match(briefing, /briefing on this\s+request with Worf, Troi and Riker/);
  assert.match(briefing, /Hold a briefing[\s\S]*as\s+your first step, give each of these officers a separate assignment/);
  assert.match(briefing, /except picard-riker:\n- picard-worf: Worf, review risks[\s\S]*\n- picard-troi: Troi, review clarity[^\n]*\nDo not read files/, "Riker is called after the others, not at the same time");
  assert.match(briefing, /give picard-riker their actual findings/);
  assert.match(briefing, /Allow at\s+most one officer to change files/);
  assert.match(briefing, /Officers do not hand work to each other; you call each one/);
  assert.doesNotMatch(crewBriefing(["picard-worf", "picard-troi"]), /picard-riker|Riker's recommendation/);
  assert.doesNotMatch(briefing, /to coordinate/);
  const riker = BRIDGE_CREW.find((officer) => officer.id === "picard-riker")!;
  assert.equal(riker.duty, "Weigh options and recommend, including plans and decisions");
  assert.doesNotMatch(`${riker.personality} ${riker.role}`, /coordinat|delegate|assignments/i);
  for (const officer of BRIDGE_CREW) {
    assert.match(crewInstructions(officer), /Do not hand work to other officers/);
    assert.doesNotMatch(crewInstructions(officer), /When delegating|Only Riker/);
  }
});

test("the computer relays an officer's report briefly; a word-for-word copy is recognised", () => {
  const briefing = crewBriefing(["picard-data", "picard-worf"]);
  assert.match(briefing, /begin the report with the main finding in one complete\s+sentence/);
  assert.match(briefing, /spoken aloud before you speak/);
  assert.match(briefing, /already shown on\s+screen, so do not repeat them/);
  assert.match(crewBriefing(["picard-data", "picard-riker"]), /with Riker's last/);
  assert.match(crewBriefing(["picard-data", "picard-riker"]), /ends with one short\s+question asking the Captain whether to proceed/);
  assert.match(crewBriefing(["picard-data", "picard-riker"]), /shown on screen only unless an officer failed, so do not\s+restate Riker's recommendation/);
  assert.doesNotMatch(crewBriefing(["picard-data", "picard-riker"]), /name the course Riker recommends/);
  assert.doesNotMatch(crewBriefing(["picard-data", "picard-worf"]), /Riker/);
  const report = "Captain, I refused because the procedure risked losing the experiences and memories that make me who I am.";
  assert.equal(repeatsReport(`**Data:** ${report}`, report, "Data"), true);
  assert.equal(repeatsReport(`Data reports: "${report}"`, report, "Data"), true);
  assert.equal(repeatsReport("**Data:** Captain, I refused because the proc", report, "Data"), true, "a copy still arriving is already recognised");
  assert.equal(repeatsReport(`${report} I could not confirm this in the project.`, report, "Data"), false, "anything the computer adds stays visible");
  assert.equal(repeatsReport("Data refused to protect his memories.", report, "Data"), false);
  assert.equal(repeatsReport(`Worf: ${report}`, report, "Data"), false);
});

test("Picard Code asks who handles a request, and the computer is told the answer", () => {
  const question = crewChoice("Computer, Walt, review the login code.");
  for (const officer of BRIDGE_CREW) assert.ok(question.includes(`- ${officer.id}: ${officer.name}, ${officer.duty.toLowerCase()}`));
  assert.match(question, /Do\s+not answer the request, do not use tools/);
  assert.match(question, /the ids of the officers who should handle it, separated by commas, or the\s+single word computer/);
  assert.match(question, /The computer answers most requests/);
  assert.match(question, /Choose computer for facts, look-ups, explanations, news,\s+research,\s+summaries, writing[\s\S]*small talk[\s\S]*Picard Code\s+itself[\s\S]*Sir Patrick Stewart/);
  assert.match(question, /Choose one officer only when the request asks for a substantial expert\s+judgment/);
  assert.match(question, /When in doubt, choose computer\./);
  assert.match(question, /Choose several officers only when the Captain asks for options,\s+recommendations or a briefing/);
  assert.match(question, /"Rika" or\s+"Ryker" for Riker, "Walt"/);
  assert.ok(question.endsWith('word for word:\n"""\nComputer, Walt, review the login code.\n"""'), "the Captain's words are passed unchanged");
  assert.doesNotMatch(question, /latest\s+reply/);
  assert.deepEqual(chosenCrew("picard-worf"), ["picard-worf"]);
  assert.deepEqual(chosenCrew("Worf."), ["picard-worf"]);
  assert.deepEqual(chosenCrew("picard-data, picard-worf, picard-data"), ["picard-data", "picard-worf"]);
  assert.deepEqual(chosenCrew("computer"), []);
  assert.deepEqual(chosenCrew(""), []);
  const kept = computerManner("Computer, what is the capital of France?", { mode: "off" }, undefined, { onDuty: true });
  assert.ok(kept.trimEnd().endsWith(CREW_KEPT), "the computer is told it keeps this request");
  const briefed = computerManner("Computer, check this.", { mode: "off" }, undefined, { onDuty: true, briefing: ["picard-data", "picard-worf"] });
  assert.ok(briefed.trimEnd().endsWith(crewBriefing(["picard-data", "picard-worf"])), "the briefing comes last, after the repository guidance");
  assert.ok(!briefed.includes(CREW_KEPT));
  for (const officer of BRIDGE_CREW) {
    const own = computerManner("Computer, check this.", { mode: "off" }, undefined, { agent: officer.id, onDuty: true, briefing: ["picard-data", "picard-worf"] });
    assert.ok(!own.includes(CREW_KEPT) && !own.includes("Hold a briefing"), "officers never route");
  }
  const plain = computerManner("Computer, check this.", { mode: "off" });
  assert.ok(!plain.includes(CREW_KEPT) && !plain.includes("Hold a briefing"));
});
