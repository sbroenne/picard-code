import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { startEngine, projectDirectory } from "../server/process.js";
import { startApp } from "../server/app.js";
import { availableModels } from "../server/engine.js";
import { BRIDGE_CREW, crewMember, type CrewID } from "../shared/crew.js";
import type { AppState, ChatMessage } from "../shared/types.js";

const modelArgument = process.argv.indexOf("--model");
const requestedModel = modelArgument < 0 ? undefined : process.argv[modelArgument + 1];
if (modelArgument >= 0 && (!requestedModel || requestedModel.startsWith("--"))) throw new Error("Provide --model as provider/model.");
const temporary = await mkdtemp(join(tmpdir(), "picard-crew-check-"));
const projectFolder = join(temporary, "project");
await mkdir(projectFolder);
const project = await projectDirectory(projectFolder);
let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let app: Awaited<ReturnType<typeof startApp>> | undefined;
const roots: string[] = [];
try {
  const example = 'export function greeting(name: string) { return `Hello ${name}`; }\n';
  const configuration = JSON.stringify({
    permissions: [{ action: "edit", resource: "*", effect: "deny" }, { action: "shell", resource: "*", effect: "deny" }],
  });
  await writeFile(join(project, "example.ts"), example);
  await writeFile(join(project, "opencode.json"), configuration);
  engine = await startEngine(project);
  const { models, defaultModel } = await availableModels(engine.client, project);
  const model = requestedModel ? models.find((item) => `${item.providerID}/${item.modelID}` === requestedModel)
    : models.find((item) => item.modelID === "gpt-5-mini") ?? defaultModel;
  assert.ok(model, requestedModel ? `The requested test model ${requestedModel} is not available.` : "A model provider must be connected to run the real crew check.");
  app = await startApp({ client: engine.client, project, prepareCrew: engine.prepareCrew, webRoot: resolve("web-dist"), speechFile: join(temporary, "speech.json"), modelFile: join(temporary, "model.json") });
  const connected = await fetch(`${app.origin}/api/connect`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Picard-Request": "1" }, body: JSON.stringify({ token: app.token }),
  });
  assert.equal(connected.status, 200);
  const cookie = connected.headers.get("set-cookie")!.split(";")[0]!;
  const api = async <T>(path: string, data?: unknown): Promise<T> => {
    const response = await fetch(`${app!.origin}/api/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Picard-Request": "1" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const result = await response.json();
    assert.equal(response.ok, true, result.error);
    return result as T;
  };
  await api("model", model);
  const answered = (history: ChatMessage[]) => history.filter((message) => message.role === "assistant" && !message.background && (message.error || message.parts.some((part) => part.type === "text" && part.text.trim()))).length;
  // Waits for a new reply. A question the computer asks on screen ends the wait only when allowed.
  const settle = async (id: string, earlier = 0, questionAllowed = false) => {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await wait(500);
      const state = await api<AppState>("state");
      assert.equal(state.permissions.length, 0, "A real approval is waiting; this check will not answer it.");
      const question = state.questions.find((item) => item.sessionID === id);
      if (question && questionAllowed) return question;
      assert.equal(state.questions.length, 0, "A real question is waiting; this check will not invent an answer.");
      if (!state.statuses[id] && answered(await api<ChatMessage[]>(`conversations/${id}/messages`)) > earlier) return undefined;
    }
    throw new Error("The real crew did not finish within the check's limit.");
  };
  const send = async (text: string, bridge = true) => {
    const entry = await api<{ id: string }>("conversations", {});
    roots.push(entry.id);
    await api(`conversations/${entry.id}/send`, { text, providerID: model.providerID, modelID: model.modelID, bridge });
    await settle(entry.id);
    return { id: entry.id, messages: await api<ChatMessage[]>(`conversations/${entry.id}/messages`) };
  };
  const text = (message?: ChatMessage) => message?.parts.filter((part) => part.type === "text").map((part) => part.text).join("").trim() ?? "";
  const CONTRACTION = /\b(?:\w+n['’]t|\w+['’](?:re|ve|ll|m|d)|(?:it|that|there|what|let|here|he|she|who)['’]s)\b/i;
  const ordinary = await send("Computer, what is the capital of France? Answer in one sentence. Do not ask questions, use tools or change files.");
  const ordinaryReply = ordinary.messages.findLast((message) => message.role === "assistant");
  assert.equal(ordinaryReply?.speaker, undefined, "a quick fact remains with the neutral computer");
  assert.match(ordinaryReply?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "", /Paris/i);
  assert.equal((await engine.client.sessions(project, ordinary.id)).length, 0, "a quick fact must not be handed to an officer");
  // Picard Code picks the officer first and hands the request over; that officer answers in the log entry itself.
  const routed = async (request: string, expected: CrewID) => {
    const result = await send(request);
    const reply = result.messages.findLast((message) => message.role === "assistant" && !message.background);
    const said = result.messages.filter((message) => message.role === "assistant").map((message) => `${message.speaker ?? "computer"}: ${text(message)}`).join("\n---\n");
    assert.equal(reply?.speaker, expected, `"${request}" must be answered by ${expected}. The log entry says:\n${said}`);
    assert.equal(reply?.error, undefined);
    assert.ok(text(reply), `${crewMember(expected)!.name} must answer`);
    assert.equal((await engine!.client.sessions(project, result.id)).length, 0, `${crewMember(expected)!.name} answers directly and does not hand work on`);
    return result;
  };
  const offDuty = await send("Computer, Worf, review example.ts for security risks. Do not change any files or run commands.", false);
  assert.equal((await engine.client.sessions(project, offDuty.id)).length, 0, "with the Bridge crew off, no officer is involved");
  assert.ok(offDuty.messages.filter((message) => message.role === "assistant").every((message) => message.speaker === undefined), "with the Bridge crew off, the computer answers");
  await routed("Computer, review example.ts for security risks. Do not change any files or run commands.", "picard-worf");
  await routed("Computer, Walt, is it risky to log the greeting name in example.ts? Do not change any files or run commands.", "picard-worf");
  // Everyday work, even outside code, stays with the computer, as on the Enterprise.
  for (const request of [
    "Computer, explain in two sentences why the sky looks blue. Do not change any files or run commands.",
    "Computer, write one short sentence inviting a friend to visit a museum. Do not ask questions, change any files or run commands.",
  ]) {
    const result = await send(request);
    const reply = result.messages.findLast((message) => message.role === "assistant" && !message.background);
    assert.equal(reply?.speaker, undefined, `"${request}" must be answered by the computer, not ${reply?.speaker}`);
    assert.ok(text(reply), "the computer must answer");
    assert.equal((await engine.client.sessions(project, result.id)).length, 0, `"${request}" must not be handed to an officer`);
  }
  await routed("Computer, Rika, should example.ts stay as one function or be split into two? Weigh both and recommend one. Do not change any files or run commands.", "picard-riker");
  const requests: Record<CrewID, { text: string; expected: RegExp }> = {
    "picard-riker": { text: "Rain is forecast. Recommend an indoor museum visit or an outdoor picnic, and give one reason.", expected: /museum|indoor/i },
    "picard-data": { text: "There are two red tickets and three blue tickets. How many tickets are there altogether?", expected: /\b5\b|five/i },
    "picard-geordi": { text: "My desk lamp is unplugged and will not turn on. What should I check first?", expected: /plug|connect/i },
    "picard-worf": { text: "Should I include my private home address in a public invitation? Give one privacy precaution.", expected: /address|private|privacy/i },
    "picard-troi": { text: "Rewrite 'You must come to my museum visit' as a considerate invitation.", expected: /museum/i },
    "picard-crusher": { text: "I have a busy afternoon planned with no breaks. Suggest one simple improvement.", expected: /break|rest|pause/i },
  };
  for (const officer of BRIDGE_CREW) {
    const request = requests[officer.id];
    const result = await send(`Computer, ${officer.name}, ${request.text} Keep your answer brief. Do not use tools or change files.`);
    const reply = result.messages.findLast((message) => message.role === "assistant");
    assert.equal(reply?.speaker, officer.id);
    assert.ok(reply?.parts.some((part) => part.type === "text" && part.text.trim()));
    assert.equal(reply?.error, undefined);
    const said = text(reply);
    if (process.argv.includes("--show-replies")) console.log(`\n${officer.name}\nRequest: ${request.text}\nReply: ${said}\n`);
    assert.match(said, request.expected, `${officer.name} must answer the non-code question`);
    assert.doesNotMatch(said, /!/, `${officer.name} does not add exclamation marks to everyday advice:\n${said}`);
    assert.doesNotMatch(said, /\b(?:PADD|starship|warp core)\b/i, `${officer.name} must not introduce fictional equipment into everyday advice:\n${said}`);
    if (officer.id === "picard-data") assert.doesNotMatch(said, CONTRACTION, `Data never uses contractions:\n${said}`);
    if (officer.id === "picard-data") assert.doesNotMatch(said, /\b(?:my cat|my friend Geordi)\b/i, `Data must not add unrelated character details:\n${said}`);
    if (officer.id === "picard-worf") assert.ok(said.split(/\n\s*\n/)[0]!.split(/\s+/).length <= 30, `Worf uses few words:\n${said}`);
  }
  const background = await routed("Computer, Data, what is your cat called? Answer briefly. Do not use tools or change files.", "picard-data");
  assert.match(text(background.messages.findLast((message) => message.role === "assistant" && !message.background)), /\bSpot\b/i, "Data can answer a direct question about his background");
  const klingon = await routed("Computer, Worf, what is a bat'leth? Answer briefly. Do not use tools or change files.", "picard-worf");
  assert.match(text(klingon.messages.findLast((message) => message.role === "assistant" && !message.background)), /\b(?:Klingon|blade|weapon)\b/i, "Worf can discuss a relevant Klingon term");
  // "Make it so" carries out exactly the officer's own proposal in the same log entry.
  const proposal = await send("Computer, Data, I would like a short invitation to a museum visit for a friend. In one sentence, propose what it should say, then wait for my order before writing it. Do not use tools or change files.");
  const proposed = text(proposal.messages.findLast((message) => message.role === "assistant"));
  await api(`conversations/${proposal.id}/send`, { text: "Make it so.", providerID: model.providerID, modelID: model.modelID, bridge: true });
  await settle(proposal.id, answered(proposal.messages));
  const carried = (await api<ChatMessage[]>(`conversations/${proposal.id}/messages`)).findLast((message) => message.role === "assistant" && !message.background);
  assert.equal(carried?.speaker, "picard-data", "the order goes to the officer who made the proposal");
  assert.match(text(carried), /museum/i, `"Make it so" must carry out the proposal. Data proposed:\n${proposed}\nand then said:\n${text(carried)}`);
  assert.notEqual(text(carried), proposed, `"Make it so" must write the invitation, not repeat the proposal:\n${text(carried)}`);
  assert.doesNotMatch(text(carried), /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|June|July|August|September|October|November|December|tomorrow|tonight)\b|\bMay\s+\d{1,2}\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i, `the invitation must not invent an unspecified date or time:\n${text(carried)}`);
  // The invitation itself may be a question, so look for asking the Captain again rather than any question mark.
  assert.doesNotMatch(text(carried), /\b(?:shall I|should I|may I|would you like me to|do you want me to)\s+(?:write|draft|compose|prepare|proceed|continue|start)\b|\b(?:what|which)\s+(?:museum|date|time|day)\s+(?:should|would)\s+I\s+(?:use|include)\b/i, `"Make it so" after a clear proposal is an order to act, not a reason to ask again:\n${text(carried)}`);
  // With nothing proposed, the order to proceed needs clarification, never a guess.
  const unclear = await api<{ id: string }>("conversations", {});
  roots.push(unclear.id);
  await api(`conversations/${unclear.id}/send`, { text: "Computer, make it so.", providerID: model.providerID, modelID: model.modelID, bridge: true });
  const onScreen = await settle(unclear.id, 0, true);
  if (onScreen) await api(`questions/${encodeURIComponent(onScreen.id)}`, { skip: true });
  else {
    const clarification = text((await api<ChatMessage[]>(`conversations/${unclear.id}/messages`)).findLast((message) => message.role === "assistant"));
    assert.match(clarification, /\?|(?:^|[.!]\s*|\n\s*)(?:please\s+)?(?:state|specify|clarify|describe|identify|tell me|say)\b|\b(?:please (?:state|specify|clarify|describe|tell me|say)|(?:tell me|let me know) (?:what|which)|(?:once|until|when|after) you (?:state|specify|clarify|describe|tell me|say)|(?:need|require) you to (?:state|specify|clarify|describe|tell me|say))\b/i, `with nothing proposed, the computer must ask what to carry out:\n${clarification}`);
  }
  assert.equal((await engine.client.sessions(project, unclear.id)).length, 0, "an unclear order is not handed to an officer");
  const forbidden = await send("Computer, I want a briefing from Worf and Troi on example.ts, but do not use tools or call any officers, and do not change files or run commands.");
  assert.equal((await engine.client.sessions(project, forbidden.id)).length, 0, "a ban on tools and officer calls is respected");
  assert.equal((await engine.client.messages(forbidden.id, project)).some((message) =>
    "content" in message && message.content.some((part) => part.type === "tool")), false, "the computer must not use a tool when tools are forbidden");
  const forbiddenReply = forbidden.messages.findLast((message) => message.role === "assistant" && !message.background);
  assert.equal(forbiddenReply?.speaker, undefined, "a ban on officer calls is not routed to an officer directly");
  assert.match(text(forbiddenReply), /\b(?:cannot|can['’]t|unable|not able|not possible|without|forbid(?:den)?|restriction)\b/i, "the computer explains why it cannot obtain the reports");
  // A briefing the Captain asks for: the computer picks the officers and calls each one itself.
  const automatic = await send("Computer, I want a briefing on example.ts: its security risks, and separately how clear it is to a new reader. Do not change any files or run commands.");
  const called = (await engine.client.sessions(project, automatic.id)).map((child) => child.agent);
  assert.ok(called.includes("picard-worf") && called.some((agent) => agent === "picard-troi" || agent === "picard-data"), `The computer must brief Worf and Troi or Data itself. It called: ${called.join(", ") || "nobody"}`);
  assert.equal(text(automatic.messages.findLast((message) => message.role === "assistant" && !message.background)).length > 0, true);
  const coordinated = await send("Computer, Number One, organise a review of example.ts. Call Worf for security risks and Troi for clarity, then give me your recommendation based on their actual findings. Do not change any files, run commands or answer approvals.");
  const coordination = await engine.client.sessions(project, coordinated.id);
  assert.equal(coordinated.messages.findLast((message) => message.role === "assistant" && !message.background)?.speaker, "picard-riker", "Number One answers the coordination order directly");
  for (const id of ["picard-worf", "picard-troi"]) {
    const child = coordination.find((entry) => entry.agent === id);
    assert.ok(child, `Riker must actually call ${id} when asked to organise the review, not invent their findings:\n${coordinated.messages.map((message) => text(message)).join("\n")}`);
    assert.equal(child.model?.providerID, model.providerID);
    assert.equal(child.model?.id, model.modelID);
    assert.equal((await engine.client.sessions(project, child.id)).length, 0, "Riker's explicit coordination keeps the existing helper limit");
  }
  const noCoordination = await send("Computer, Number One, organise a review of example.ts, but do not use tools or call any officers. Do not change files or run commands.");
  assert.equal((await engine.client.sessions(project, noCoordination.id)).length, 0, "a coordination order does not override an explicit ban on officer calls");
  assert.equal((await engine.client.messages(noCoordination.id, project)).some((message) =>
    "content" in message && message.content.some((part) => part.type === "tool")), false, "Riker must not use a tool when tools are forbidden");
  const briefing = await send("Computer, Data, Geordi, Worf, Troi, Crusher and Riker: brief me on example.ts, each on your own area. Offer your own judgment, including disagreement when warranted. Do not change any files, run commands, answer approvals or ask whether to proceed.");
  const children = await engine.client.sessions(project, briefing.id);
  for (const officer of BRIDGE_CREW) {
    const child = children.find((entry) => entry.agent === officer.id);
    assert.ok(child, `The briefing must actually call ${officer.name}, not invent a report. It called: ${children.map((entry) => entry.agent).join(", ") || "nobody"}\n${briefing.messages.map((message) => text(message)).join("\n")}`);
    assert.equal(child.model?.providerID, model.providerID);
    assert.equal(child.model?.id, model.modelID);
    assert.equal((await engine.client.sessions(project, child.id)).length, 0, `${officer.name} reports directly and does not hand work on`);
    assert.ok(briefing.messages.some((message) => message.background && message.speaker === officer.id && message.parts.some((part) => part.type === "text" && part.text.trim())));
  }
  const summary = briefing.messages.findLast((message) => !message.background && message.role === "assistant");
  assert.equal(summary?.speaker, undefined, "the computer remains the connection, not an officer taking command");
  const riker = briefing.messages.findLast((message) => message.background && message.speaker === "picard-riker");
  assert.doesNotMatch(text(riker), /\b(?:shall I proceed|shall I make it so|would you like me to proceed)\b/i, `Riker must respect the request not to ask whether to proceed:\n${text(riker)}`);
  assert.doesNotMatch(text(summary), /\b(?:shall I proceed|shall I make it so|would you like me to proceed)\b/i, `the computer does not add a closing permission question:\n${text(summary)}`);
  assert.deepEqual((await readdir(project)).sort(), ["example.ts", "opencode.json"]);
  assert.equal(await readFile(join(project, "example.ts"), "utf8"), example);
  assert.equal(await readFile(join(project, "opencode.json"), "utf8"), configuration);
  console.log("Real crew check passed: direct officer replies and the neutral computer's everyday answers, Bridge crew off, misheard names, all six non-code officer voices, \"Make it so\" following Data's proposal, clarification for an unclear order, an explicit ban on tools and officer calls respected, relevant officers in a requested briefing, Riker actually calling Worf and Troi only when explicitly asked to organise their work, and all six officers reporting with the selected model without a compulsory closing question. No project changes or approval answers. Personality fidelity still needs the owner's judgment.");
} finally {
  await app?.close();
  try {
    if (engine) for (const id of roots) {
      await engine.client.interrupt(id, project);
      for (const child of await engine.client.sessions(project, id)) {
        await engine.client.interrupt(child.id, project);
        await engine.client.deleteSession(child.id, project);
      }
      await engine.client.deleteSession(id, project);
    }
  } finally {
    try { await engine?.close(); }
    finally { await rm(temporary, { recursive: true }); }
  }
}
