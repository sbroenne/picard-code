import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { startEngine, projectDirectory } from "../server/process.js";
import { startApp } from "../server/app.js";
import { availableModels } from "../server/engine.js";
import { BRIDGE_CREW, crewMember, type CrewID } from "../shared/crew.js";
import type { AppState, ChatMessage } from "../shared/types.js";

const temporary = await mkdtemp(join(tmpdir(), "picard-crew-check-"));
const project = await projectDirectory(temporary);
let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let app: Awaited<ReturnType<typeof startApp>> | undefined;
const roots: string[] = [];
try {
  await writeFile(join(project, "example.ts"), 'export function greeting(name: string) { return `Hello ${name}`; }\n');
  await writeFile(join(project, "opencode.json"), JSON.stringify({
    permissions: [{ action: "edit", resource: "*", effect: "deny" }, { action: "shell", resource: "*", effect: "deny" }],
  }));
  engine = await startEngine(project);
  const { models, defaultModel } = await availableModels(engine.client, project);
  const model = models.find((item) => item.modelID === "gpt-5-mini") ?? defaultModel;
  assert.ok(model, "A model provider must be connected to run the real crew check.");
  app = await startApp({ client: engine.client, project, prepareCrew: engine.prepareCrew, webRoot: resolve("web-dist"), speechFile: join(project, "speech.json") });
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
  const ordinary = await send("Computer, write one short sentence inviting a friend to visit a museum. Do not ask questions, use tools or change files.");
  const ordinaryReply = ordinary.messages.findLast((message) => message.role === "assistant");
  assert.equal(ordinaryReply?.speaker, undefined, "ordinary requests remain with the neutral computer");
  assert.match(ordinaryReply?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "", /museum/i);
  assert.equal((await engine.client.sessions(project, ordinary.id)).length, 0, "an ordinary request must not be handed to an officer");
  const routed = async (text: string, expected: CrewID) => {
    const result = await send(text);
    const children = await engine!.client.sessions(project, result.id);
    const said = result.messages.filter((message) => message.role === "assistant").map((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("")).join("\n---\n");
    assert.deepEqual(children.map((child) => child.agent), [expected], `"${text}" must go to exactly ${expected}. The computer said:\n${said}`);
    const relay = result.messages.findLast((message) => message.role === "assistant" && !message.background);
    assert.equal(relay?.speaker, undefined, "the computer relays the officer's answer");
    assert.match(relay?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "", new RegExp(crewMember(expected)!.name, "i"));
    assert.ok(result.messages.some((message) => message.background && message.speaker === expected));
    return children[0]!;
  };
  const offDuty = await send("Computer, Worf, review example.ts for security risks. Do not change any files or run commands.", false);
  assert.equal((await engine.client.sessions(project, offDuty.id)).length, 0, "with the Bridge crew off, no officer is involved");
  assert.ok(offDuty.messages.filter((message) => message.role === "assistant").every((message) => message.speaker === undefined), "with the Bridge crew off, the computer answers");
  await routed("Computer, review example.ts for security risks. Do not change any files or run commands.", "picard-worf");
  await routed("Computer, Walt, is it risky to log the greeting name in example.ts? Do not change any files or run commands.", "picard-worf");
  const routedRiker = await routed("Computer, Rika, should example.ts stay as one function or be split into two? Weigh both and recommend one. Do not change any files or run commands.", "picard-riker");
  assert.equal((await engine.client.sessions(project, routedRiker.id)).length, 0, "Riker recommends; he does not hand work on");
  const requests: Record<CrewID, { text: string; expected: RegExp }> = {
    "picard-riker": { text: "Rain is forecast. Recommend an indoor museum visit or an outdoor picnic, and give one reason.", expected: /museum|indoor/i },
    "picard-data": { text: "There are two red tickets and three blue tickets. How many tickets are there altogether?", expected: /\b5\b|five/i },
    "picard-geordi": { text: "My desk lamp is unplugged and will not turn on. What should I check first?", expected: /plug|socket|power|connect/i },
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
    assert.match(said, request.expected, `${officer.name} must answer the non-code question`);
    assert.doesNotMatch(said, /!/, `${officer.name} speaks as a bridge officer, without exclamation marks:\n${said}`);
    if (officer.id === "picard-data") assert.doesNotMatch(said, CONTRACTION, `Data never uses contractions:\n${said}`);
    if (officer.id === "picard-worf") assert.ok(said.split(/\n\s*\n/)[0]!.split(/\s+/).length <= 30, `Worf uses few words:\n${said}`);
  }
  // "Make it so" carries out exactly the officer's own proposal in the same log entry.
  const proposal = await send("Computer, Data, I would like a short invitation to a museum visit for a friend. In one sentence, propose what it should say, then wait for my order before writing it. Do not use tools or change files.");
  const proposed = text(proposal.messages.findLast((message) => message.role === "assistant"));
  await api(`conversations/${proposal.id}/send`, { text: "Make it so.", providerID: model.providerID, modelID: model.modelID, bridge: true });
  await settle(proposal.id, answered(proposal.messages));
  const carried = (await api<ChatMessage[]>(`conversations/${proposal.id}/messages`)).findLast((message) => message.role === "assistant" && !message.background);
  assert.equal(carried?.speaker, "picard-data", "the order goes to the officer who made the proposal");
  assert.match(text(carried), /museum/i, `"Make it so" must carry out the proposal. Data proposed:\n${proposed}\nand then said:\n${text(carried)}`);
  assert.notEqual(text(carried), proposed, `"Make it so" must write the invitation, not repeat the proposal:\n${text(carried)}`);
  assert.doesNotMatch(text(carried), /\?\s*$/, `"Make it so" after a clear proposal is an order to act, not a reason to ask again:\n${text(carried)}`);
  // With nothing proposed, the order to proceed is a question, never a guess.
  const unclear = await api<{ id: string }>("conversations", {});
  roots.push(unclear.id);
  await api(`conversations/${unclear.id}/send`, { text: "Computer, make it so.", providerID: model.providerID, modelID: model.modelID, bridge: true });
  const onScreen = await settle(unclear.id, 0, true);
  if (onScreen) await api(`questions/${encodeURIComponent(onScreen.id)}`, { skip: true });
  else assert.match(text((await api<ChatMessage[]>(`conversations/${unclear.id}/messages`)).findLast((message) => message.role === "assistant")), /\?/, "with nothing proposed, the computer must ask what to carry out");
  assert.equal((await engine.client.sessions(project, unclear.id)).length, 0, "an unclear order is not handed to an officer");
  // A request that needs several officers becomes a briefing: the computer calls each one itself.
  const automatic = await send("Computer, review example.ts for security risks, and separately for how clear it is to a new reader. Do not change any files or run commands.");
  const called = (await engine.client.sessions(project, automatic.id)).map((child) => child.agent);
  assert.ok(called.includes("picard-worf") && called.some((agent) => agent === "picard-troi" || agent === "picard-data"), `The computer must brief Worf and Troi or Data itself. It called: ${called.join(", ") || "nobody"}`);
  assert.equal(text(automatic.messages.findLast((message) => message.role === "assistant" && !message.background)).length > 0, true);
  const briefing = await send("Computer, I want a briefing on example.ts. Data, Geordi, Worf, Troi and Crusher: one sentence each on your own area. Then have Riker recommend what to improve first, based on their findings. Do not change any files, run commands or answer approvals.");
  const children = await engine.client.sessions(project, briefing.id);
  for (const officer of BRIDGE_CREW) {
    const child = children.find((entry) => entry.agent === officer.id);
    assert.ok(child, `The computer must actually call ${officer.name} for the briefing, not invent a report. It called: ${children.map((entry) => entry.agent).join(", ") || "nobody"}`);
    assert.equal(child.model?.providerID, model.providerID);
    assert.equal(child.model?.id, model.modelID);
    assert.equal((await engine.client.sessions(project, child.id)).length, 0, `${officer.name} reports directly and does not hand work on`);
    assert.ok(briefing.messages.some((message) => message.background && message.speaker === officer.id && message.parts.some((part) => part.type === "text" && part.text.trim())));
  }
  const summary = briefing.messages.findLast((message) => !message.background && message.role === "assistant");
  assert.equal(summary?.speaker, undefined, "the computer gives the briefing summary");
  assert.match(text(summary), /Riker/i, `the summary includes Riker's recommendation:\n${text(summary)}`);
  assert.deepEqual((await readdir(project)).sort(), ["example.ts", "opencode.json"]);
  console.log("Real crew check passed: neutral computer writing without routing, the computer answering an officer request with the Bridge crew off, automatic routing to Worf (also when misheard as Walt) and to Riker (misheard as Rika) with a computer relay, Riker recommending without handing work on, all six non-code officer replies in their own voices (Data without contractions, Worf brief, no exclamation marks), \"Make it so\" carrying out Data's proposal, an unclear \"Make it so\" answered with a question, an automatic briefing of Worf and Troi or Data, a full briefing in which the computer itself called all six officers with the selected model and none handed work on, and the computer's summary with Riker's recommendation. No project changes or approval answers. Personality fidelity still needs the owner's judgment.");
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
