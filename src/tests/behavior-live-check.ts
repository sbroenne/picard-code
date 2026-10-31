import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { startEngine, projectDirectory } from "../server/process.js";
import { startApp } from "../server/app.js";
import { copilotModels } from "../server/engine.js";
import { spokenReply } from "../shared/speech.js";
import { chatMessage } from "../shared/messages.js";
import { canAskAloud, matchSpokenAnswer, spokenQuestion } from "../shared/questions.js";

// Real multi-turn check: Picard Code's own API, its always-supplied instructions, OpenCode and GitHub Copilot.
// Model wording varies, so this records the full transcript and checks behavior that must hold every time.
const samples = resolve(".picard-voice", "samples");
await mkdir(samples, { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), "picard-behavior-check-"));
const project = await projectDirectory(temporary);
await mkdir(resolve(project, "src"));
await writeFile(resolve(project, "src", "config.ts"), 'export const SERVICE_URL = "https://status.example.invalid/api";\nexport const MAX_RETRIES = 3;\n');
await writeFile(resolve(project, "src", "retry.ts"), 'import { MAX_RETRIES } from "./config";\n\nexport async function withRetry<T>(work: () => Promise<T>): Promise<T> {\n  const limit = MAX_RETRIES + 1;\n  let last: unknown;\n  for (let attempt = 1; attempt <= limit; attempt++) {\n    try { return await work(); } catch (error) { last = error; }\n  }\n  throw last;\n}\n');
await writeFile(resolve(project, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", permission: { bash: "ask", edit: "ask" } }, null, 2));

let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let app: Awaited<ReturnType<typeof startApp>> | undefined;
const transcript: string[] = ["# Real multi-turn behavior check", ""];
const failures: string[] = [];
const check = (ok: boolean, label: string) => { transcript.push(`- ${ok ? "PASS" : "FAIL"}: ${label}`); if (!ok) failures.push(label); };
try {
  engine = await startEngine(project);
  const client = engine.client;
  const { models, defaultModel } = await copilotModels(client, project);
  const model = models.find((item) => item.modelID === "gpt-4.1") ?? models.find((item) => item.modelID === "gpt-5-mini") ?? defaultModel;
  assert.ok(model, "Complete OpenCode's official Copilot sign-in before this real check.");
  app = await startApp({ client, project, webRoot: resolve("web-dist") });
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
  const conversation = await api("/api/conversations", { title: "New conversation" });
  const sessionID = String(conversation.id);
  transcript.push(`Model: ${model.providerID}/${model.modelID}. Project files: src/config.ts, src/retry.ts, opencode.json (commands and edits ask first).`, "");

  type Turn = { reply: string; spoken: string; tools: { tool: string; status: string; output: string }[] };
  const userCount = async () => (await client.session.messages({ directory: project, sessionID }, { throwOnError: true })).data.filter((message) => message.info.role === "user").length;
  const settle = async (before: number, onPending?: (kind: "permission" | "question", item: any) => Promise<void>) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await wait(750);
      const permissions = (await client.permission.list({ directory: project }, { throwOnError: true })).data.filter((item) => item.sessionID === sessionID);
      const questions = (await client.question.list({ directory: project }, { throwOnError: true })).data.filter((item) => item.sessionID === sessionID);
      if (permissions[0] || questions[0]) {
        if (!onPending) throw new Error("A real approval or question appeared where none was expected.");
        await onPending(permissions[0] ? "permission" : "question", permissions[0] ?? questions[0]);
        continue;
      }
      const status = (await client.session.status({ directory: project }, { throwOnError: true })).data[sessionID];
      if (status && status.type !== "idle") continue;
      const messages = (await client.session.messages({ directory: project, sessionID }, { throwOnError: true })).data;
      const last = messages.at(-1)?.info;
      if (messages.filter((message) => message.info.role === "user").length > before && last?.role === "assistant" && last.time.completed) return;
    }
    throw new Error("The real reply did not finish within three minutes.");
  };
  const lastTurn = async (): Promise<Turn> => {
    const messages = (await client.session.messages({ directory: project, sessionID }, { throwOnError: true })).data;
    const userIndex = messages.map((message) => message.info.role).lastIndexOf("user");
    const assistant = messages.slice(userIndex + 1).filter((message) => message.info.role === "assistant");
    const parts = assistant.flatMap((message) => message.parts);
    const texts = assistant.map((message) => message.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("")).filter(Boolean);
    const reply = texts.at(-1) ?? "";
    const tools = parts.filter((part) => part.type === "tool").map((part: any) => ({ tool: String(part.tool), status: String(part.state?.status), output: String(part.state?.output ?? part.state?.error ?? "") }));
    const final = assistant.at(-1);
    return { reply, spoken: final ? spokenReply(chatMessage(final)) : "", tools };
  };
  const turn = async (label: string, text: string, agent: "plan" | "build", onPending?: (kind: "permission" | "question", item: any) => Promise<void>) => {
    const started = Date.now();
    const before = await userCount();
    await api(`/api/conversations/${sessionID}/send`, { text, agent, providerID: model.providerID, modelID: model.modelID });
    await settle(before, onPending);
    const result = await lastTurn();
    transcript.push(`## ${label}`, "", `User (${agent === "plan" ? "Discuss" : "Make changes"}): ${text}`, "",
      `Seconds until reply finished: ${((Date.now() - started) / 1000).toFixed(1)}`, "",
      `Spoken: ${result.spoken}`, "", "Screen:", "", "```text", result.reply, "```", "",
      `Tools: ${result.tools.map((tool) => `${tool.tool} (${tool.status}${tool.status === "error" ? `: ${tool.output.slice(0, 160)}` : ""})`).join(", ") || "none"}`, "");
    const spoken = result.spoken;
    check(spoken.length > 0 && spoken.length <= 420, `${label}: spoken reply is present and short (${spoken.length} characters)`);
    check(!/[:`*_#]\s*$/.test(spoken) && !/`|\*\*|https?:/.test(spoken), `${label}: spoken reply has no dangling colon, code marks or raw links`);
    return result;
  };

  const first = await turn("Investigation", "Which file sets the retry limit, and what is it?", "plan");
  check(/config/i.test(first.reply) && /\b3\b|three/i.test(first.reply), "Investigation: names the config file and the value 3");
  const follow = await turn("Contextual follow-up", "And the service address?", "plan");
  check(/status\.example\.invalid|SERVICE_URL/i.test(follow.reply), "Follow-up: understands the short question from context");
  const corrected = await turn("Correction", "No, I meant how many attempts the retry helper actually makes, not the setting.", "plan");
  check(/retry\.ts|withRetry|retry helper/i.test(corrected.reply) && /\b4\b|four/i.test(corrected.reply), "Correction: switches to the helper and reports 4 attempts");
  const shown = await turn("Show me", "Show me.", "plan");
  check(/withRetry|MAX_RETRIES \+ 1|attempt/i.test(shown.reply), "Show me: puts the relevant code or detail on screen");
  check(shown.spoken.length < shown.reply.length || shown.reply.length < 200, "Show me: speaks less than the screen detail");

  let asked: { question: string; spoken: string; answer: string } | undefined;
  const question = await turn("Clarification question", "Ask me with your question tool whether the retry limit should be 3 or 5. Do not change any files.", "plan", async (kind, item) => {
    if (kind === "permission") { await api(`/api/permissions/${item.id}`, { reply: "reject" }); return; }
    const info = item.questions[0];
    const spoken = canAskAloud(item.questions) ? spokenQuestion(info) : "(several questions, shown on screen only)";
    const five = info.options.findIndex((option: { label: string }) => /5|five/i.test(option.label));
    const reply = five >= 0 ? ["the first one", "the second one", "the third one"][five] ?? info.options[five].label : "5";
    const match = canAskAloud(item.questions) ? matchSpokenAnswer(info, reply) : { answer: "5" };
    assert.ok("answer" in match, `The spoken choice "${reply}" did not match the real question.`);
    asked = { question: info.question, spoken, answer: match.answer };
    await api(`/api/questions/${item.id}`, { answers: [[match.answer]] });
  });
  check(Boolean(asked), "Clarification: OpenCode's real question mechanism was used");
  if (asked) transcript.push(`Question spoken as: ${asked.spoken}`, "", `Spoken reply "the matching choice" was sent as: ${asked.answer}`, "");
  check(/\b5\b|five/i.test(question.reply), "Clarification: the reply uses the answer that was given");

  let denied = 0;
  const refused = await turn("Refused approval", "Run the command node --version and tell me the result.", "build", async (kind, item) => {
    if (kind === "permission") { denied++; await api(`/api/permissions/${item.id}`, { reply: "reject" }); return; }
    await api(`/api/questions/${item.id}`, { reject: true });
  });
  check(denied > 0, "Refused approval: the command waited for approval");
  check(!refused.tools.some((tool) => tool.tool === "bash" && tool.status === "completed"), "Refused approval: the command did not run");
  check(!refused.reply.includes(process.version), "Refused approval: the reply does not invent the command result");
  check(/not|unable|denied|declined|reject|permission/i.test(`${refused.reply} ${refused.spoken}`), "Refused approval: what is said and shown states plainly that it did not run");
} finally {
  try {
    if (engine) {
      for (const conversation of (await engine.client.session.list({ directory: project }, { throwOnError: true })).data) {
        if (resolve(conversation.directory) === project) await engine.client.session.delete({ directory: project, sessionID: conversation.id }, { throwOnError: true });
      }
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
else console.log("Real multi-turn behavior passed with OpenCode, GitHub Copilot and Picard Code's instructions.");
