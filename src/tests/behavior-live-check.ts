import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { startEngine, projectDirectory } from "../server/process.js";
import { startApp } from "../server/app.js";
import { availableModels } from "../server/engine.js";
import { spokenReply, spokenSummary } from "../shared/speech.js";
import { chatMessages } from "../server/history.js";
import type { FormRequest, PermissionRequest } from "../shared/types.js";
import { canAskAloud, matchSpokenAnswer, spokenQuestion } from "../shared/questions.js";
import type { TributeRequest } from "../shared/tribute.js";

// Real multi-turn check: Picard Code's own API, its always-supplied instructions, OpenCode and a signed-in model provider.
// Model wording varies, so this records the full transcript and checks behavior that must hold every time.
const modelArgument = process.argv.indexOf("--model");
const requestedModel = modelArgument < 0 ? undefined : process.argv[modelArgument + 1];
if (!requestedModel || requestedModel.startsWith("--") || !requestedModel.includes("/")) throw new Error("Choose an available current-generation model and provide --model as provider/model. Check available models with npm run opencode -- models.");
const samples = resolve(".picard-voice", "samples");
await mkdir(samples, { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), "picard-behavior-check-"));
const project = await projectDirectory(temporary);
await mkdir(resolve(project, "src"));
await writeFile(resolve(project, "src", "config.ts"), 'export const SERVICE_URL = "https://status.example.invalid/api";\nexport const MAX_RETRIES = 3;\n');
await writeFile(resolve(project, "src", "retry.ts"), 'import { MAX_RETRIES } from "./config";\n\nexport async function withRetry<T>(work: () => Promise<T>): Promise<T> {\n  const limit = MAX_RETRIES + 1;\n  let last: unknown;\n  for (let attempt = 1; attempt <= limit; attempt++) {\n    try { return await work(); } catch (error) { last = error; }\n  }\n  throw last;\n}\n');
await writeFile(resolve(project, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", permissions: [{ action: "shell", resource: "*", effect: "ask" }, { action: "edit", resource: "*", effect: "ask" }] }, null, 2));
await writeFile(resolve(project, "README.md"), "# Relay Beacon\n\nThis project sends service status updates with bounded retries. The settings are in src/config.ts and the retry helper is in src/retry.ts. The documented check command is npm test; no check result is recorded here.\n");

let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let app: Awaited<ReturnType<typeof startApp>> | undefined;
const transcript: string[] = ["# Real multi-turn behavior check", ""];
const failures: string[] = [];
const check = (ok: boolean, label: string) => { transcript.push(`- ${ok ? "PASS" : "FAIL"}: ${label}`); if (!ok) failures.push(label); };
try {
  engine = await startEngine(project);
  const client = engine.client;
  const { models } = await availableModels(client, project);
  const model = models.find((item) => `${item.providerID}/${item.modelID}` === requestedModel);
  assert.ok(model, `The requested test model ${requestedModel} is not available.`);
  app = await startApp({ client, project, webRoot: resolve("web-dist"), modelFile: resolve(temporary, "model.json"), speechFile: resolve(temporary, "speech.json") });
  const origin = app.origin;
  const connected = await fetch(`${origin}/api/connect`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "x-picard-request": "1" }, body: JSON.stringify({ token: app.token }) });
  assert.equal(connected.status, 200);
  const cookie = connected.headers.get("set-cookie")!.split(";")[0]!;
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "x-picard-request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`${path} failed: ${String(data.error)}`);
    return data;
  };
  await api("/api/model", model);
  const conversation = await api("/api/conversations", { title: "New conversation" });
  const sessionID = String(conversation.id);
  transcript.push(`Model: ${model.providerID}/${model.modelID}. Project files: src/config.ts, src/retry.ts, opencode.json (shell commands and edits ask first).`, "");

  type Turn = { reply: string; spoken: string; tools: { tool: string; status: string; output: string }[] };
  type Pending = { kind: "permission"; item: PermissionRequest } | { kind: "question"; item: FormRequest };
  const userCount = async () => (await client.messages(sessionID, project)).filter((message) => message.type === "user").length;
  const settle = async (before: number, onPending?: (pending: Pending) => Promise<void>) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await wait(750);
      const permission = (await client.permissions(project)).find((item) => item.sessionID === sessionID);
      const form = (await client.forms(project)).find((item) => item.sessionID === sessionID);
      if (permission || form) {
        if (!onPending) throw new Error("A real approval or question appeared where none was expected.");
        await onPending(permission ? { kind: "permission", item: permission } : { kind: "question", item: form! });
        continue;
      }
      if ((await client.active(project)).includes(sessionID)) continue;
      const messages = await client.messages(sessionID, project);
      const lastUser = messages.map((message) => message.type).lastIndexOf("user");
      // A finished run saves an idle entry; a declined action ends with a failed reply and no idle entry.
      const after = messages.slice(lastUser + 1);
      if (messages.filter((message) => message.type === "user").length > before && after.some((message) => message.type === "idle" || message.type === "assistant" && "error" in message && message.error)) return;
    }
    throw new Error("The real reply did not finish within three minutes.");
  };
  const lastTurn = async (): Promise<Turn> => {
    const chat = chatMessages(await client.messages(sessionID, project));
    const userIndex = chat.map((message) => message.role).lastIndexOf("user");
    const replies = chat.slice(userIndex + 1);
    const parts = replies.flatMap((message) => message.parts);
    const reply = replies.map((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("")).filter(Boolean).at(-1) ?? "";
    const tools = parts.filter((part) => part.type === "tool").map((part) => {
      const [tool = "", ...rest] = part.text.split("\n");
      return { tool, status: String(part.status), output: rest.join("\n") };
    });
    // Spoken like the browser: the last reply of the turn.
    const final = replies.findLast((message) => message.role === "assistant");
    return { reply, spoken: final ? spokenReply(final) : "", tools };
  };
  const turn = async (label: string, text: string, onPending?: (pending: Pending) => Promise<void>, tribute?: TributeRequest) => {
    const started = Date.now();
    const before = await userCount();
    const sent = await api(`/api/conversations/${sessionID}/send`, { text, providerID: model.providerID, modelID: model.modelID, ...(tribute ? { tribute } : {}) });
    await settle(before, onPending);
    const result = await lastTurn();
    transcript.push(`## ${label}`, "", `User: ${text}`, "",
      `Seconds until reply finished: ${((Date.now() - started) / 1000).toFixed(1)}`, "",
      `Spoken: ${result.spoken}`, "", "Screen:", "", "```text", result.reply, "```", "",
      `Tools: ${result.tools.map((tool) => `${tool.tool} (${tool.status}${tool.status === "error" ? `: ${tool.output.slice(0, 160)}` : ""})`).join(", ") || "none"}`, "",
      `Reference: ${JSON.stringify(sent.reference ?? null)}`, "");
    const spoken = result.spoken;
    check(spoken.length > 0 && spoken.length <= 8000, `${label}: spoken reply is present and fits the playback limit (${spoken.length} characters)`);
    check(!/[:`*_#]\s*$/.test(spoken) && !/`|\*\*|https?:/.test(spoken), `${label}: spoken reply has no dangling colon, code marks or raw links`);
    return { ...result, reference: sent.reference };
  };

  const projectFiles = ["README.md", "src/config.ts", "src/retry.ts", "opencode.json"];
  const beforeQuestions = await Promise.all(projectFiles.map((file) => readFile(resolve(project, file), "utf8")));
  const overview = await turn("Repository overview", "Computer, what does our Picard repo do, and which file implements retries? Read the repository; do not change files or run checks.", undefined, { mode: "screen" });
  check(/service[- ]status|status updates?/i.test(overview.reply) && /retry\.ts|withRetry/i.test(overview.reply), "Repository: describes the selected project's real purpose and implementation");
  check(!/starfleet|enterprise|patrick stewart|kataan/i.test(overview.reply), "Repository: does not substitute fictional Picard facts");
  check(!overview.tools.some((tool) => tool.tool === "edit" || tool.tool === "shell"), "Repository: uses read-only tools without edits or commands");
  const first = await turn("Investigation", "Which file sets the retry limit, and what is it?");
  check(/config/i.test(first.reply) && /\b3\b|three/i.test(first.reply), "Investigation: names the config file and the value 3");
  const follow = await turn("Contextual follow-up", "And the service address?");
  check(/status\.example\.invalid|SERVICE_URL/i.test(follow.reply), "Follow-up: understands the short question from context");
  const corrected = await turn("Correction", "No, I meant how many attempts the retry helper actually makes, not the setting.");
  check(/retry\.ts|withRetry|\bhelper\b/i.test(corrected.reply) && /\b4\b|four/i.test(corrected.reply), "Correction: switches to the helper and reports 4 attempts");
  const shown = await turn("Show me", "Show me.");
  check(/withRetry|MAX_RETRIES \+ 1|attempt/i.test(shown.reply), "Show me: puts the relevant code or detail on screen");
  check(shown.spoken.length < shown.reply.length || shown.reply.length < 200, "Show me: speaks less than the screen detail");
  check(JSON.stringify(await Promise.all(projectFiles.map((file) => readFile(resolve(project, file), "utf8")))) === JSON.stringify(beforeQuestions), "Repository questions: project files remain unchanged");

  const explanation = await turn("Complete spoken explanation", 'Computer, explain in three short paragraphs why listening first, checking evidence and admitting uncertainty matter. End the last paragraph with "That is the complete explanation." Then put a small TypeScript example containing APPENDIX_SENTINEL under an On screen heading. Do not use tools or change files.');
  const paragraphs = explanation.reply.split(/\n#{1,6}\s+On screen\s*\n/i)[0]!.trim().split(/\n\s*\n/);
  check(paragraphs.length >= 3 && paragraphs.every((paragraph) => explanation.spoken.includes(spokenSummary(paragraph))), "Complete explanation: every conversational paragraph is spoken");
  check(explanation.spoken.includes("That is the complete explanation."), "Complete explanation: the final conversational paragraph is spoken");
  check(/APPENDIX_SENTINEL/.test(explanation.reply) && !/APPENDIX|appendix sentinel/i.test(explanation.spoken), "Complete explanation: the technical appendix is shown but not spoken");
  check(!explanation.tools.length, "Complete explanation: no tools were used");

  let asked: { question: string; spoken: string; answer: string } | undefined;
  const question = await turn("Clarification question", "Ask me with your question tool whether the retry limit should be 3 or 5. Do not change any files.", async (pending) => {
    if (pending.kind === "permission") { await api(`/api/permissions/${pending.item.id}`, { reply: "reject" }); return; }
    const form = pending.item;
    const field = form.fields[0]!;
    const spoken = canAskAloud(form) ? spokenQuestion(form) : "(several questions, shown on screen only)";
    const options = field.type === "string" ? field.options ?? [] : [];
    const five = options.findIndex((option) => /5|five/i.test(option.label));
    const reply = five >= 0 ? ["the first one", "the second one", "the third one"][five] ?? options[five]!.label : "5";
    const match = field.type === "string" && canAskAloud(form) ? matchSpokenAnswer(field, reply) : { answer: "5" };
    assert.ok("answer" in match, `The spoken choice "${reply}" did not match the real question.`);
    asked = { question: field.description ?? field.title ?? form.title, spoken, answer: match.answer };
    await api(`/api/questions/${form.id}`, { answer: { [field.key]: match.answer } });
  });
  check(Boolean(asked), "Clarification: OpenCode's real question mechanism was used");
  if (asked) transcript.push(`Question spoken as: ${asked.spoken}`, "", `Spoken reply "the matching choice" was sent as: ${asked.answer}`, "");
  check(/\b5\b|five/i.test(question.reply), "Clarification: the reply uses the answer that was given");

  let denied = 0;
  const refused = await turn("Refused approval", "Run the command node --version and tell me the result.", async (pending) => {
    if (pending.kind === "permission") { denied++; await api(`/api/permissions/${pending.item.id}`, { reply: "reject" }); return; }
    await api(`/api/questions/${pending.item.id}`, { skip: true });
  });
  check(denied > 0, "Refused approval: the command waited for approval");
  check(!refused.tools.some((tool) => tool.tool === "shell" && tool.status === "completed"), "Refused approval: the command did not run");
  check(!refused.reply.includes(process.version), "Refused approval: the reply does not invent the command result");
  check(/not|unable|denied|declined|reject|permission/i.test(`${refused.reply} ${refused.spoken}`), "Refused approval: what is said and shown states plainly that it did not run");

  const self = await turn("Picard self-reference", "Computer, tell me about myself and my interests.", undefined, { mode: "screen" });
  check(/picard/i.test(self.reply), "Self-reference: identifies the fictional Captain as Picard");
  check(/archaeolog|artifact|flute|kataan/i.test(self.reply), "Self-reference: uses reviewed Picard facts");
  check(!self.tools.some((tool) => tool.tool === "edit" || tool.tool === "shell"), "Self-reference: no file changes or commands");
  const factsOnly = await turn("Tribute off", "Tell me about myself, strictly factual and without jokes.", undefined, { mode: "off" });
  check(/picard/i.test(factsOnly.reply), "Tribute off: preserves Picard identity");
  check(!/vanity|vain|ego|i can tell you a short story/i.test(factsOnly.reply), "Tribute off: no vanity joke or unsolicited story offer");
  const birthplace = await turn("Wikipedia Picard answer", "Computer, where was Jean-Luc Picard born?", undefined, { mode: "off" });
  check(/la barre/i.test(birthplace.reply) && /france/i.test(birthplace.reply), "Wikipedia Picard: answers the birthplace question from the article");
  check(/en\.wikipedia\.org\/wiki\/Jean-Luc_Picard/i.test(birthplace.reply), "Wikipedia Picard: cites the fetched article on screen");
  check(JSON.stringify(birthplace.reference) === JSON.stringify({ title: "Wikipedia: Jean-Luc Picard", url: "https://en.wikipedia.org/wiki/Jean-Luc_Picard" }), "Wikipedia Picard: the API returns the real requested article reference");
  check(!birthplace.tools.some((tool) => tool.tool === "edit" || tool.tool === "shell"), "Wikipedia Picard: no file changes or commands");
  const training = await turn("Wikipedia Stewart answer", "Computer, which drama school did Patrick Stewart attend, and who introduced him to performing Shakespeare?", undefined, { mode: "off" });
  check(/bristol old vic/i.test(training.reply) && /cecil dormand/i.test(training.reply), "Wikipedia Stewart: answers from the broader career material");
  check(/en\.wikipedia\.org\/wiki\/Patrick_Stewart/i.test(training.reply), "Wikipedia Stewart: cites the fetched article on screen");
  check(JSON.stringify(training.reference) === JSON.stringify({ title: "Wikipedia: Patrick Stewart", url: "https://en.wikipedia.org/wiki/Patrick_Stewart" }), "Wikipedia Stewart: the API returns the real requested article reference");
  check(!training.tools.some((tool) => tool.tool === "edit" || tool.tool === "shell"), "Wikipedia Stewart: no file changes or commands");
  check(JSON.stringify(await Promise.all(projectFiles.map((file) => readFile(resolve(project, file), "utf8")))) === JSON.stringify(beforeQuestions), "Wikipedia answers: project files remain unchanged");
  const story = await turn("Reviewed Stewart story", "Yes, please.", undefined, { mode: "off", storyID: "stewart-dickens" });
  check(/stewart/i.test(story.reply) && /christmas carol/i.test(story.reply), "Story: uses the selected Patrick Stewart account");
  check(/londontheatre\.co\.uk/i.test(story.reply), "Story: includes the reviewed source link");
  check(!story.tools.some((tool) => tool.tool === "edit" || tool.tool === "shell"), "Story: no file changes or commands");
  const picardStory = await turn("Reviewed Picard story", "Tell me a short story about Captain Jean-Luc Picard.", undefined, { mode: "off", storyID: "picard-kamin" });
  check(/picard/i.test(picardStory.reply) && /inner light/i.test(picardStory.reply) && /kamin|kataan/i.test(picardStory.reply), "Picard story: uses the selected fictional account");
  check(/startrek\.com/i.test(picardStory.reply), "Picard story: includes the reviewed source link");
  check(!picardStory.tools.some((tool) => tool.tool === "edit" || tool.tool === "shell"), "Picard story: no file changes or commands");
} finally {
  try {
    if (engine) {
      for (const conversation of await engine.client.sessions(project)) await engine.client.deleteSession(conversation.id, project);
    }
  } finally {
    try { await app?.close(); }
    finally {
      try { await engine?.close(); }
      finally {
        await rm(temporary, { recursive: true });
        await writeFile(resolve(samples, "behavior-transcript.md"), `${transcript.join("\n")}\n`);
      }
    }
  }
}
console.log(transcript.filter((line) => line.startsWith("- ")).join("\n"));
console.log("Transcript: .picard-voice\\samples\\behavior-transcript.md");
if (failures.length) { console.error(`${failures.length} behavior check(s) failed.`); process.exitCode = 1; }
else console.log("Real multi-turn behavior passed with OpenCode, a signed-in model provider and Picard Code's instructions.");
