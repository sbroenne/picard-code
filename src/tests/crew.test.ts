import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BRIDGE_CREW, chosenCrew, continuesOfficer, addressedOfficer, addressedOfficers, repeatsReport } from "../shared/crew.js";
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

test("explicit address lists select every named officer without mistaking mentions or negations for orders", () => {
  for (const text of [
    "Computer, Data and Geordi, review this.",
    "Computer, ask Data and Geordi to review this.",
    "Data, Geordi and Mr. Worf: report.",
    "Computer, have Data and Geordi look at the repair",
  ]) {
    assert.deepEqual(addressedOfficers(text), text.includes("Worf") ? ["picard-data", "picard-geordi", "picard-worf"] : ["picard-data", "picard-geordi"], text);
    assert.equal(addressedOfficer(text), undefined, "a list is not silently reduced to one officer");
  }
  assert.deepEqual(addressedOfficers("Computer, Data and Riker"), ["picard-data", "picard-riker"]);
  assert.deepEqual(addressedOfficers("Computer, Data, explain Worf's advice."), ["picard-data"]);
  assert.deepEqual(addressedOfficers("Computer, do not call Data and Geordi."), []);
  assert.deepEqual(addressedOfficers("Computer, Data and his cat are interesting."), []);
  assert.deepEqual(addressedOfficers("Computer, Data and Geordi must not be called."), [], "an unrecognised continuation is left to the officer check");
  assert.deepEqual(addressedOfficers("Computer, Number One, organise a review."), ["picard-riker"]);
  for (const command of ["have", "ask"]) {
    assert.deepEqual(addressedOfficers(`Computer, Number One, ${command} Worf to review example.ts and then give me your recommendation.`), ["picard-riker"]);
    assert.deepEqual(addressedOfficers(`Computer, ${command} Number One, ${command} Worf to review example.ts.`), ["picard-riker"]);
  }
});

test("only explicit officer addresses select crew, without changing the user's words", () => {
  for (const officer of BRIDGE_CREW) {
    assert.equal(addressedOfficer(`Computer, ask ${officer.name} to review this`)?.id, officer.id);
    assert.equal(addressedOfficer(`Computer, ${officer.name}, explain this`)?.id, officer.id);
    assert.equal(addressedOfficer(`Have ${officer.name} coordinate this`)?.id, officer.id);
  }
  assert.equal(addressedOfficer("Computer, Doctor Crusher, check recovery")?.id, "picard-crusher");
  const ranks: [string, string][] = [
    ["Computer, Number One, report.", "picard-riker"], ["Will, coordinate this", "picard-riker"], ["Computer, ask Will to help", "picard-riker"], ["Have Will read this", "picard-riker"], ["Computer, Commander Riker, explain this", "picard-riker"],
    ["Computer, Mr. Data, explain this", "picard-data"], ["Computer, Lieutenant Commander Data, analyse this", "picard-data"],
    ["Computer, Mr. La Forge, repair the build", "picard-geordi"], ["Computer, LaForge, check this", "picard-geordi"], ["Have Geordi La Forge build it", "picard-geordi"],
    ["Computer, Mr. Worf, review the login", "picard-worf"], ["Computer, Lieutenant Worf, check this", "picard-worf"],
    ["Computer, Counselor, review this message", "picard-troi"], ["Computer, Deanna, explain this", "picard-troi"],
    ["Computer, Doctor, check recovery", "picard-crusher"], ["Computer, Beverly, review this plan", "picard-crusher"], ["Computer, Dr. Crusher, check this", "picard-crusher"],
  ];
  for (const [text, id] of ranks) assert.equal(addressedOfficer(text)?.id, id, text);
  for (const text of ["Computer, Commander, review this", "Computer, will the build pass?", "Computer, will help be available offline?", "Computer, will read-only access prevent writes?", "Computer, will review help?", "Computer, Doctor Who facts, please", "Computer, number one priority: fix the build"]) {
    assert.equal(addressedOfficer(text), undefined, text);
  }
  for (const text of ["Computer, do not ask Data to review this", "Computer, don't have Riker coordinate this", "Computer, explain what Geordi does", "Data is missing from this file", "Review Riker's suggestion"]) {
    assert.equal(addressedOfficer(text), undefined);
  }
});

test("real crew and behavior checks require an explicit model before starting", () => {
  for (const file of ["crew-live-check.js", "behavior-live-check.js"]) {
    for (const args of [[], ["--model"], ["--model", "--show-replies"], ["--model", "gpt-6.1-sol"]]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 1, `${file} ${args.join(" ")} must stop before starting services`);
      assert.match(result.stderr, /Choose an available current-generation model and provide --model as provider\/model/);
    }
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
  assert.deepEqual(Object.keys(config), ["agents"], "Riker's explicit coordination does not raise OpenCode's helper limit");
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
    assert.match(crewInstructions(officer), /When the Captain permits file reads but says not to run commands, use read or\s+search tools, not the shell/);
    assert.match(crewInstructions(officer), /Do not claim a file is missing or describe its\s+contents as a finding without checking/);
    assert.match(crewInstructions(officer), /If the Captain supplies file contents, distinguish those from a file you\s+read in the Project/);
  }
  assert.match(COMPUTER_MANNER, /Handle general questions, writing, research and planning as well as coding/);
  assert.match(COMPUTER_MANNER, /complete conversational answer is spoken aloud, including later paragraphs/);
  assert.match(COMPUTER_MANNER, /"### On screen" on its own line/);
  assert.match(COMPUTER_MANNER, /Do not put conversational conclusions, important warnings or questions after/);
  assert.doesNotMatch(COMPUTER_MANNER, /later paragraphs appear on screen only/);
  assert.match(computerInstructions(now), /neutral manner for both code and non-code requests/);
  assert.doesNotMatch(computerInstructions(now), /This reply is from Riker/);
});

test("officers do not know events after their own deaths, but the computer keeps its knowledge", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const configuration = crewConfiguration();
  for (const officer of BRIDGE_CREW) {
    for (const instructions of [configuration.agents[officer.id]!.system, computerInstructions(now, officer.id)]) {
      assert.match(instructions, /You do not know about events after your death\./, officer.name);
      assert.match(instructions, /fictional\s+character's death, not the actor's/);
      assert.match(instructions, /say plainly that you do not know/);
      assert.match(instructions, /do not supply the answer through later accounts, lookups or a return from death/);
      assert.match(instructions, /Do not invent a death or death date/);
      assert.match(instructions, /not a TNG-era knowledge cutoff:\s+Star Trek: Picard is included/);
      assert.match(instructions, /Keep helping with ordinary real-world work/);
    }
  }
  for (const instructions of [COMPUTER_MANNER, computerInstructions(now)]) {
    assert.doesNotMatch(instructions, /events after your death/);
  }
});

test("officers speak in their own bridge voices, not the computer's neutral one", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  for (const officer of BRIDGE_CREW) {
    for (const instructions of [crewInstructions(officer), computerInstructions(now, officer.id)]) {
      assert.doesNotMatch(instructions, /restrained manner of a helpful ship computer|use no other titles or names/, `${officer.name} must not be told to sound like the computer`);
      assert.match(instructions, /Starfleet officer reporting to the Captain/);
      assert.match(instructions, /Speak to the Captain directly; do not\s+announce how the request was routed/);
      assert.match(instructions, /Never copy dialogue from the show or mention famous scenes/);
      assert.match(instructions, /Draw on known\s+character backgrounds and relationships when relevant/);
      assert.match(instructions, /Captain asks about them; say when you are unsure/);
      assert.match(instructions, /Do not invent anecdotes or\s+add unrelated trivia to work answers/);
      assert.match(instructions, /Keep fiction separate from present-day\s+work/);
      assert.match(instructions, /Brief, original humour can suit light conversation/);
      assert.match(instructions, /never mock sensitive\s+traits or joke about serious matters, errors, refusals or unfinished work/);
      assert.match(instructions, /Respect a request for facts without jokes/);
      assert.match(instructions, /never invent\s+ship status/);
      assert.match(instructions, /fictional devices into real-world\s+advice/);
      assert.match(instructions, /Never invent completion/);
      assert.match(instructions, /Use wording and sentence rhythm natural to the speaker/);
      assert.match(instructions, /Do not add a\s+report about files or checks to an unrelated conversation/);
      assert.match(instructions, /"Make it so"/);
    }
  }
  const voice = (name: string) => BRIDGE_CREW.find((officer) => officer.name === name)!.personality;
  assert.match(voice("Riker"), /Number One/);
  assert.match(voice("Data"), /Never use contractions/);
  assert.match(voice("Data"), /Geordi is your close friend.*cat named Spot/);
  assert.match(voice("Data"), /keep quoted words and code exact/);
  assert.match(voice("Geordi"), /chief engineer/);
  assert.match(voice("Geordi"), /if they already point to a simple next step/);
  assert.match(voice("Worf"), /few, direct words/);
  assert.match(voice("Worf"), /no more than 25 words in the spoken opening/);
  assert.match(voice("Worf"), /use Klingon terms only when they are relevant/);
  assert.match(voice("Troi"), /rather than claiming to sense them/);
  assert.match(voice("Crusher"), /"Jean-Luc"/);
  assert.match(COMPUTER_MANNER, /use no other titles or names/, "the computer keeps calling him only Captain");
  assert.match(computerManner("Computer, Riker, hello.", { mode: "off" }, undefined, { agent: "picard-riker" }), /Do not add vanity jokes or tease the Captain about his vanity or reputation/);
});

test("original examples reach each officer without becoming claims about the Captain's request", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const replies = new Set<string>();
  for (const officer of BRIDGE_CREW) {
    assert.ok(officer.examples.length >= 2, `${officer.name} needs examples in different situations`);
    const instructions = [crewInstructions(officer), computerInstructions(now, officer.id)];
    for (const text of instructions) {
      assert.match(text, /original examples of your manner, not answers to repeat/);
      assert.match(text, /Do not copy an example\s+or let it change his request or imply that an example's work was performed/);
    }
    for (const example of officer.examples) {
      assert.ok(!replies.has(example.reply), `${officer.name} must have distinct examples`);
      replies.add(example.reply);
      assert.match(example.reply, /[.!?]$/);
      assert.ok(example.reply.length <= 200, `${officer.name}'s example should remain speakable`);
      for (const text of instructions) {
        assert.ok(text.includes(example.situation));
        assert.ok(text.includes(example.reply));
      }
    }
  }
  const data = BRIDGE_CREW.find((officer) => officer.id === "picard-data")!;
  for (const example of data.examples) assert.doesNotMatch(example.reply, /\b\w+(?:n't|'(?:re|ve|ll|m|d|s))\b/i);
});

test("the Captain's orders are understood, but never answer an approval or widen a request", () => {
  for (const instructions of [COMPUTER_MANNER, ...BRIDGE_CREW.map((officer) => crewInstructions(officer))]) {
    assert.ok(instructions.includes(CAPTAINS_ORDERS));
  }
  assert.match(CAPTAINS_ORDERS, /"Make it so"[\s\S]*carry out exactly what\s+was just proposed[\s\S]*nothing more/);
  assert.match(CAPTAINS_ORDERS, /For a requested draft, choose minor\s+wording yourself instead of asking again/);
  assert.match(CAPTAINS_ORDERS, /use clear placeholders for\s+missing names, dates or places rather than inventing them/);
  assert.match(CAPTAINS_ORDERS, /unclear which proposal he means[\s\S]*ask one short question or request for\s+clarification instead of guessing/);
  assert.match(CAPTAINS_ORDERS, /"Engage" means start the agreed work now/);
  assert.match(CAPTAINS_ORDERS, /never answer an approval or a\s+question waiting on screen/);
  assert.match(crewChoice("Make it so."), /"Number One" or "Will" is Riker/);
  assert.match(crewChoice("Make it so.", "Data"), /follows up on an officer's earlier reply[\s\S]*"Make it so"[\s\S]*choose that officer\. The latest\s+reply in this log entry came from Data\./);
  assert.match(crewChoice("Make it so."), /several officers offered different proposals[\s\S]*choose computer to clarify rather than treating the last speaker\s+as his decision/);
});

test("only short, unambiguous orders continue the current officer without another choice", () => {
  for (const text of ["Make it so.", "Computer, engage!", "Please proceed.", "Carry on, please.", "Do it."]) {
    assert.equal(continuesOfficer(text), true, text);
  }
  for (const text of ["Do not make it so.", "Make it so, Worf.", "Do it only after asking Troi.", "Why?", "Proceed with a different plan."]) {
    assert.equal(continuesOfficer(text), false, text);
  }
});

test("the Captain leads briefings; Riker coordinates only when explicitly asked", () => {
  const briefing = crewBriefing(["picard-worf", "picard-troi", "picard-riker"]);
  assert.match(briefing, /briefing on this\s+request with Worf, Troi and Riker/);
  assert.match(briefing, /The Captain leads this briefing and makes the decision/);
  assert.match(briefing, /computer connecting his requests, not the chair or commander/);
  assert.match(briefing, /start\s+now: give each of these officers a separate assignment with the subagent tool/);
  assert.match(briefing, /Calling an officer with the subagent tool is not running a shell or terminal\s+command and does not change files/);
  assert.match(briefing, /"do not change files, run\s+commands or answer approvals" forbids edits, shell commands and answering\s+approvals; it does not forbid calling officers or using read and search tools/);
  assert.match(briefing, /Pass those restrictions to each officer/);
  assert.match(briefing, /Do not infer a ban on tools from a\s+ban on commands, edits or answering approvals/);
  assert.match(briefing, /If he explicitly forbids using tools, subagents or calling officers, respect\s+that limit and say you cannot hold the briefing without their reports/);
  assert.match(briefing, /If OpenCode asks for approval,\s+leave it for the Captain/);
  assert.match(briefing, /Never\s+answer an approval for him/);
  assert.match(briefing, /does not permit that officer to run commands or change files against\s+the Captain's instructions/);
  assert.match(briefing, /Independent assignments may run at the same time; follow any order or\s+dependency the Captain specified/);
  assert.match(briefing, /- picard-riker: Riker/, "Riker is called as a peer, not excluded until a closing round");
  assert.match(briefing, /officers can read and search named project files\s+themselves[\s\S]*Report actual failures and never invent file\s+contents/);
  assert.match(briefing, /pass the actual reports to that\s+officer after they arrive/);
  assert.match(briefing, /Officers may disagree and offer alternatives/);
  assert.match(briefing, /Do not give them a scripted sentence to repeat/);
  assert.match(briefing, /Allow at most one officer\s+to change files, and only if the Captain requested changes/);
  assert.doesNotMatch(crewBriefing(["picard-worf", "picard-troi"]), /picard-riker|Riker's recommendation/);
  const riker = BRIDGE_CREW.find((officer) => officer.id === "picard-riker")!;
  assert.equal(riker.duty, "Weigh options and recommend, including plans and decisions");
  assert.match(riker.role, /Only when the Captain explicitly asks you to organise or coordinate work/);
  assert.match(crewInstructions(riker), /use the subagent tool to call the relevant officers/);
  assert.match(crewInstructions(riker), /Pass his exact words and\s+limits to each officer/);
  assert.match(crewInstructions(riker), /at most one officer permission to change files/);
  assert.match(crewInstructions(riker), /opinion, options\s+or a recommendation alone does not authorise delegation/);
  assert.match(crewInstructions(riker), /Keep OpenCode's\s+existing helper limit/);
  for (const officer of BRIDGE_CREW) {
    if (officer.id !== "picard-riker") assert.match(crewInstructions(officer), /Do not hand work to other officers/);
    assert.match(crewInstructions(officer), /Never invent dialogue,\s+consensus or work by another officer/);
    assert.match(crewInstructions(officer), /it does not command you or decide for the Captain/);
  }
});

test("officers address the Captain without a scripted closing round; word-for-word copies are recognised", () => {
  const briefing = crewBriefing(["picard-data", "picard-worf"]);
  assert.match(briefing, /officer to address the Captain directly/);
  assert.match(briefing, /complete conversational\s+answer is spoken aloud in their own voice/);
  assert.match(briefing, /Do not introduce, repeat or summarise the officers'\s+reports unless the Captain requested a summary/);
  assert.match(briefing, /Do not decide for him, speak\s+as him or add a closing permission question/);
  assert.match(briefing, /If an officer fails or does not report, say so plainly/);
  assert.match(crewBriefing(["picard-data", "picard-riker"]), /he does not automatically speak\s+last/);
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
    assert.ok(!own.includes(CREW_KEPT) && !own.includes("The Captain leads this briefing"), "a direct officer does not receive computer connection instructions");
  }
  const plain = computerManner("Computer, check this.", { mode: "off" });
  assert.ok(!plain.includes(CREW_KEPT) && !plain.includes("The Captain leads this briefing"));
  assert.ok(!plain.includes("Spoken replies currently play"), "no speed is claimed when the browser sent none");
  assert.match(computerManner("Computer, how fast do you speak?", { mode: "off" }, undefined, { speed: 1 }), /currently play at normal speed[\s\S]*"Computer, speak faster"/);
});

test("each officer wears their own rank and division colour on screen", () => {
  assert.deepEqual(
    Object.fromEntries(BRIDGE_CREW.map((officer) => [officer.name, `${officer.rank}, ${officer.division}`])),
    {
      Riker: "Commander, command",
      Data: "Lieutenant Commander, operations",
      Geordi: "Lieutenant Commander, operations",
      Worf: "Lieutenant, operations",
      Troi: "Commander, sciences",
      Crusher: "Commander, sciences",
    },
  );
});
