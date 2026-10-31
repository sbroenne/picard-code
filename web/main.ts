import "./style.css";
import type { Event, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2";
import type { AppState, BrowserEvent, ChatMessage, Conversation, ModelChoice, SpeechSettings } from "../src/shared/types";
import { chatPart, errorMessage } from "../src/shared/messages";
import { replyFailed, spokenReply, spokenSummary } from "../src/shared/speech";
import { canAskAloud, matchSpokenAnswer, spokenQuestion } from "../src/shared/questions";
import { addressed, voiceCommand } from "../src/shared/wake";
import { VoiceConversation } from "./voice";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`The page is missing ${id}.`);
  return node as T;
}
function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text: string, className: string, action: () => Promise<void> | void) {
  const node = make("button", className, text);
  node.type = "button";
  node.addEventListener("click", () => { void perform(action); });
  return node;
}

const model = element<HTMLSelectElement>("model");
const readingArea = element("reading-area");
let state: AppState | undefined;
let selected: string | undefined;
let messages: ChatMessage[] = [];
let events: EventSource | undefined;
let connected = false;
let submitting = false;
let historyLoading = false;
let selectionRevision = 0;
let historyRevision = 0;
let historyTimer: ReturnType<typeof setTimeout> | undefined;
let approvalKey = "";
let renderScheduled = false;
const historyEvents: Event[] = [];
let voiceTurn: { session: string; known: Set<string> } | undefined;
let spokenDecision = "";
let spokenQuestionID: string | undefined;
let answering = false;
// After "Computer" alone, the next words are taken as the request.
const GO_AHEAD = 8000;
let goAheadUntil = 0;
let notSent = "";
const voice = new VoiceConversation({
  changed: voiceControls,
  error: notice,
  transcript: heard,
  canListen: () => !!state?.models.length && connected,
});

/**
 * Handles one utterance heard while listening. Like the computer on the show, only speech that starts
 * with "Computer" is acted on; the words are sent unchanged. Approvals are never given by voice.
 */
async function heard(text: string, startedAt: number) {
  if (!text) return;
  const words = addressed(text);
  const question = askedQuestion();
  if (words === undefined && !question && startedAt > goAheadUntil) {
    notSent = `Not sent: “${text}” Start with “Computer”.`;
    return;
  }
  goAheadUntil = 0;
  const request = words ?? text;
  const command = voiceCommand(request);
  if (command === "stop") { await stopByVoice(); return; }
  if (command === "new") { freshByVoice(); return; }
  if (question) { await answerAloud(request); return; }
  if (!request) {
    goAheadUntil = Date.now() + GO_AHEAD;
    setTimeout(voiceControls, GO_AHEAD + 50);
    voice.chime();
    return;
  }
  // A finished reply is still being collected; wait briefly rather than refuse.
  for (let waited = 0; (submitting || historyLoading) && waited < 5000; waited += 100) await new Promise((done) => setTimeout(done, 100));
  if (state?.permissions.some((item) => item.sessionID === selected)) {
    voice.speak("A decision is needed first. Choose Allow once or Deny on screen.");
  } else if (pending()) {
    voice.speak("Please answer the question on screen first.");
  } else if (busy() || submitting) {
    voice.speak("Work is in progress. Say Computer, stop, to cancel it.");
  } else await sendMessage(text);
}

function freshByVoice() {
  if (state?.permissions.some((item) => item.sessionID === selected)) voice.speak("A decision is needed first. Choose Allow once or Deny on screen.");
  else if (pending()) voice.speak("Please answer the question on screen first.");
  else if (busy() || submitting) voice.speak("Work is in progress. Say Computer, stop, to cancel it first.");
  else { startFresh(); voice.speak("Ready for a new task."); }
}

async function stopByVoice() {
  if (!selected || !busy()) { voice.speak("No work is running."); return; }
  voiceTurn = undefined;
  await api(`conversations/${encodeURIComponent(selected)}/stop`, {});
  await refreshState();
  await loadHistory();
  voice.speak(busy() ? "Stop requested. The work is still finishing." : "Work stopped, Captain.");
}

/** The single OpenCode question that was asked aloud and may be answered by voice. */
function askedQuestion() {
  if (!spokenQuestionID || answering || state?.permissions.some((item) => item.sessionID === selected)) return undefined;
  const waiting = state?.questions.filter((item) => item.sessionID === selected) ?? [];
  const request = waiting.length === 1 && waiting[0]!.id === spokenQuestionID ? waiting[0] : undefined;
  return request && canAskAloud(request.questions) ? request : undefined;
}

async function answerAloud(text: string) {
  const request = askedQuestion();
  if (!request) throw new Error("The question is no longer waiting. Check the conversation on screen.");
  const result = matchSpokenAnswer(request.questions[0]!, text);
  if ("retry" in result) { voice.speak(result.retry); return; }
  answering = true;
  try {
    await api(`questions/${encodeURIComponent(request.id)}`, { answers: [[result.answer]] });
    spokenQuestionID = undefined;
    await refreshState();
  } finally {
    answering = false;
    controls();
  }
}

function muted() {
  try { return localStorage.getItem("picard-muted") === "yes"; } catch { return false; }
}
function setMuted(value: boolean) {
  try { if (value) localStorage.setItem("picard-muted", "yes"); else localStorage.removeItem("picard-muted"); }
  catch { /* Muting still applies until the page reloads. */ }
}

/** The microphone is simply on, once the user has agreed to it, unless muted or changing settings. */
function autoListen() {
  if (voice.microphone || voice.opening || voice.failed || !state?.speech?.configured || !state.models.length || !connected
    || !disclosed() || muted() || openDrawer() === "settings") return;
  void perform(() => voice.activate());
}

/** One status for the whole screen, with a short line saying what to do next. */
function consoleStatus(): [string, string] {
  if (!state) return ["Starting up", ""];
  if (!connected) return ["Reconnecting", "Keep Picard Code's terminal open."];
  if (!state.models.length) return ["Setup needed", "Connect GitHub Copilot in Settings."];
  if (voice.phase === "speaking") return ["Speaking", "Choose Stop speaking to interrupt."];
  if (voice.speechPending) return ["Preparing reply", ""];
  if (voice.microphone && voice.waitingForClick) return ["Ready", "Click anywhere to start listening."];
  if (voice.phase === "listening") return ["Listening", ""];
  if (voice.microphone && voice.phase === "thinking") return ["Understanding", ""];
  const listening = voice.microphone && voice.phase === "standby";
  if (state.permissions.some((item) => item.sessionID === selected)) return ["Decision needed", "Choose Allow once or Deny on screen."];
  if (listening && askedQuestion()) return ["Answer needed", "Say your answer, or choose it on screen."];
  if (pending()) return ["Answer needed", "Answer the question on screen."];
  const stopHint = listening ? "Say “Computer, stop” to cancel." : "Choose Stop work to cancel.";
  if (selected && state.statuses[selected]?.type === "retry") return ["Retrying", stopHint];
  if (busy() || submitting) return ["Working", stopHint];
  if (historyLoading) return ["Loading", ""];
  if (listening) return ["Standing by", Date.now() < goAheadUntil ? "Go ahead." : "Say “Computer”, then your request."];
  if (voice.opening) return ["Starting microphone", ""];
  if (!state.speech?.configured) return ["Ready", ""];
  if (muted()) return ["Muted", "Unmute to talk."];
  if (!disclosed()) return ["Ready", "Start listening to talk to the computer."];
  return ["Ready", "Not listening. Choose Start listening."];
}

function voiceControls() {
  const ready = !!state?.speech?.configured && !!state.models.length && connected;
  const [status, detail] = consoleStatus();
  element("status").textContent = status;
  element("status-detail").textContent = detail;
  const microphone = element<HTMLButtonElement>("microphone");
  microphone.hidden = !state?.speech?.configured;
  microphone.textContent = voice.microphone ? "Mute" : muted() ? "Unmute" : "Start listening";
  microphone.dataset.kind = voice.microphone ? "mute" : "start";
  microphone.disabled = voice.opening || !voice.microphone && !ready;
  element("voice-console").dataset.phase = voice.microphone || voice.phase === "speaking" ? voice.phase : "off";
  if (voice.phase === "listening") notSent = "";
  element("voice-partial").textContent = voice.phase === "listening" || voice.phase === "thinking" ? voice.partial : notSent;
  element("voice-partial").classList.toggle("not-sent", voice.phase !== "listening" && voice.phase !== "thinking" && !!notSent);
  element("voice-setup-hint").hidden = !state || !!state.speech?.configured;
  element("voice-setup-text").textContent = state?.speech?.error ? "Speech did not start." : "Speech is not set up.";
  const cloudListening = state?.speech?.listening !== "whisper";
  const cloudSpeaking = state?.speech?.speaking !== "kokoro";
  // Say where audio goes before listening first starts with these services.
  // Afterwards the full explanation stays in Settings, keeping the main screen clear.
  const disclosure = element("voice-disclosure");
  disclosure.textContent = `${cloudListening
    ? "While listening, speech near the microphone goes to Azure to be understood, possibly outside Europe."
    : "Your voice is understood on this computer."}${cloudSpeaking ? " Reply text goes to Azure for speaking." : ""} Only requests that start with “Computer” are sent to Copilot. Details are in Settings.`;
  disclosure.hidden = !state?.speech?.configured || voice.microphone || disclosed();
  element("speech-current").textContent = state?.speech?.configured
    ? `Active: ${cloudListening ? "Azure MAI" : "Whisper"} listening / ${cloudSpeaking ? "Azure MAI" : "Kokoro"} speaking`
    : state?.speech?.error ?? "Speech is not set up yet";
  element("privacy-detail").textContent = `The microphone stays on while Picard Code is open, unless you mute it. It listens on this computer for speech; ${cloudListening
    ? "when it hears some, that speech goes to Azure, which may process it outside Europe, to be understood."
    : "Whisper understands it on this computer."} ${cloudSpeaking
    ? "Reply text goes to Azure for speaking." : "Kokoro speaks locally."} Only requests that start with “Computer” are sent to Copilot; other speech is shown as not sent and dropped. While work runs, only “Computer, stop” is acted on. Listening pauses while the computer speaks. Every file change or command asks first, and approvals always need a button. Stop speaking interrupts playback, not work.`;
  element("stop-speaking").hidden = !voice.speechPending;
}

function disclosureKey() {
  return `picard-disclosure:${state?.speech?.listening ?? "mai"}/${state?.speech?.speaking ?? "mai"}`;
}
function disclosed() {
  try { return localStorage.getItem(disclosureKey()) === "seen"; } catch { return false; }
}
function markDisclosed() {
  try { localStorage.setItem(disclosureKey(), "seen"); } catch { /* The note simply keeps showing. */ }
}

function completeVoiceReply() {
  if (!voiceTurn || voiceTurn.session !== selected || busy() || pending() || submitting || historyLoading) return;
  const reply = messages.findLast((message) => message.role === "assistant" && !voiceTurn!.known.has(message.id));
  if (!reply) return;
  voiceTurn = undefined;
  voice.speak(spokenReply(reply), replyFailed(reply));
}

async function api<T>(path: string, data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: data === undefined ? {} : { "Content-Type": "application/json", "X-Picard-Request": "1" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new Error(`Could not reach Picard Code. Keep its terminal open, then try again. ${errorMessage(error)}`);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The local request failed. Try again.");
  return result as T;
}

function notice(message?: string) {
  element("notice").hidden = !message;
  element("notice-text").textContent = message ?? "";
}

async function perform(action: () => Promise<void> | void) {
  try { await action(); }
  catch (error) { notice(errorMessage(error)); }
}

function modelValue(choice: ModelChoice) { return JSON.stringify([choice.providerID, choice.modelID]); }
function busy() {
  return !!selected && !!state?.statuses[selected] && state.statuses[selected]?.type !== "idle";
}
function pending() {
  return !!selected && (state?.permissions.some((item) => item.sessionID === selected) || state?.questions.some((item) => item.sessionID === selected));
}

function controls() {
  const working = busy() || submitting;
  const ready = !!state?.models.length && connected && !historyLoading;
  model.disabled = !ready || working;
  element("stop").hidden = !busy();
  element<HTMLButtonElement>("stop").disabled = submitting;
  element<HTMLButtonElement>("new-conversation").disabled = !state || submitting;
  element("setup").hidden = !state || !!state.models.length;
  element("welcome").hidden = !!messages.length || !!selected && historyLoading || !!state && !state.models.length;
  element("copilot-status").textContent = !state ? "Checking" : state.models.length
    ? `Connected: ${state.models.length} Copilot model${state.models.length === 1 ? "" : "s"} available` : "Not connected";
  voice.sync();
  autoListen();
  voiceControls();
}

function renderState() {
  if (!state) { controls(); return; }
  const projectName = state.project.split(/[\\/]/).filter(Boolean).at(-1) ?? state.project;
  element("project-name").textContent = projectName;
  element("project-name").title = state.project;
  if (document.activeElement !== element("project-path")) element<HTMLInputElement>("project-path").value = state.project;
  element("workspace-caption").textContent = `OpenCode ${state.version} · ${state.project}`;
  const currentModel = model.value;
  model.replaceChildren();
  for (const choice of state.models) {
    const option = make("option", undefined, choice.name);
    option.value = modelValue(choice);
    model.append(option);
  }
  if (!state.models.length) model.append(make("option", undefined, "Connect GitHub Copilot"));
  else if (state.models.some((choice) => modelValue(choice) === currentModel)) model.value = currentModel;
  else if (state.defaultModel) model.value = modelValue(state.defaultModel);
  const list = element("conversations");
  list.replaceChildren();
  for (const item of state.conversations) {
    const node = button(item.title, "conversation-button", () => selectConversation(item.id));
    if (item.id === selected) node.setAttribute("aria-current", "page");
    if (state.permissions.some((request) => request.sessionID === item.id) || state.questions.some((request) => request.sessionID === item.id)) {
      const dot = make("span", "pending-dot");
      dot.setAttribute("aria-hidden", "true");
      node.prepend(dot);
      node.setAttribute("aria-label", `${item.title}, needs your reply`);
    }
    list.append(node);
  }
  if (!state.conversations.length) list.append(make("p", "muted", "Your conversations will appear here."));
  renderApprovals();
  const decision = state.permissions.find((item) => item.sessionID === selected)?.id
    ?? state.questions.find((item) => item.sessionID === selected)?.id;
  if (voiceTurn && decision && decision !== spokenDecision) {
    spokenDecision = decision;
    const question = state.questions.find((item) => item.id === decision);
    const waiting = state.questions.filter((item) => item.sessionID === selected).length;
    if (!question) {
      voice.speak("Captain, approval is required. Review the requested action on screen, then choose Allow once or Deny.");
    } else if (waiting === 1 && canAskAloud(question.questions)) {
      spokenQuestionID = question.id;
      voice.speak(spokenQuestion(question.questions[0]!));
    } else {
      voice.speak("Additional information is required. Please answer the questions on screen.");
    }
  }
  if (spokenQuestionID && !state.questions.some((item) => item.id === spokenQuestionID)) spokenQuestionID = undefined;
  controls();
}

function renderText(container: HTMLElement, text: string) {
  // Treat model output as text, never as trusted HTML. Keep fenced code readable.
  const pieces = text.split(/```(?:[^\n`]*)\n([\s\S]*?)(?:```|$)/g);
  pieces.forEach((piece, index) => {
    if (!piece) return;
    const node = make(index % 2 ? "pre" : "p", index % 2 ? undefined : "message-text", piece);
    container.append(node);
  });
}

function renderMessages() {
  const nearBottom = readingArea.scrollHeight - readingArea.scrollTop - readingArea.clientHeight < 100;
  const openDetails = new Set(Array.from(element("messages").querySelectorAll<HTMLDetailsElement>("details[open]")).map((node) => node.dataset.part));
  const container = element("messages");
  container.replaceChildren();
  // The latest request and its reply fill the screen; earlier ones stay small above.
  const latest = messages.findLastIndex((message) => message.role === "user");
  messages.forEach((message, index) => {
    const article = make("article", `message ${index >= latest ? "current" : "earlier"}`);
    article.dataset.role = message.role;
    const header = make("div", "message-header");
    header.append(make("strong", undefined, message.role === "user" ? "Picard" : "Computer"));
    const copy = button("Copy", "copy-button", async () => {
      await navigator.clipboard.writeText(message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
      copy.textContent = "Copied";
    });
    header.append(copy);
    article.append(header);
    for (const part of message.parts) {
      if (part.type === "text") renderText(article, part.text);
      else {
        const detail = make("details", part.type === "tool" ? "tool" : "reasoning");
        detail.dataset.part = part.id;
        detail.open = openDetails.has(part.id);
        detail.append(make("summary", undefined, part.type === "tool" ? `Tool activity · ${part.status ?? "working"}` : "Thinking"));
        if (part.type === "tool") detail.append(make("pre", undefined, part.text));
        else detail.append(make("p", undefined, part.text));
        article.append(detail);
      }
    }
    if (message.error) article.append(make("p", "message-error", message.error));
    container.append(article);
  });
  controls();
  if (nearBottom && window.matchMedia("(min-width: 701px)").matches) readingArea.scrollTop = readingArea.scrollHeight;
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => { renderScheduled = false; renderMessages(); });
}

async function answerRequest(container: HTMLElement, path: string, data: unknown) {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  buttons.forEach((node) => { node.disabled = true; });
  try {
    await api(path, data);
    await refreshState();
  } finally {
    buttons.forEach((node) => { node.disabled = false; });
  }
}

function permissionPanel(request: PermissionRequest) {
  const panel = make("section", "approval");
  panel.append(make("h3", undefined, "Approval required."));
  const actions: Record<string, string> = {
    bash: "run a command",
    edit: "change a file",
    read: "read files",
    glob: "find files",
    grep: "search file contents",
    external_directory: "access files outside this project",
    webfetch: "open a web page",
    websearch: "search the web",
    task: "start a helper",
  };
  const action = actions[request.permission] ?? `use the "${request.permission}" tool`;
  panel.append(make("p", undefined, `OpenCode wants to ${action}. Review the requested action before allowing it.`));
  // OpenCode's helpers do not inherit the ask-first rules, only the deny rules.
  if (request.permission === "task") panel.append(make("p", "approval-warning", "If you allow it, the helper can change files and run commands without asking again. Rules that block an action still apply."));
  panel.append(make("pre", undefined, `${request.patterns.join("\n")}\n\n${JSON.stringify(request.metadata, null, 2)}`));
  const buttons = make("div", "approval-actions");
  buttons.append(
    button("Allow once", "peach-button", () => answerRequest(panel, `permissions/${encodeURIComponent(request.id)}`, { reply: "once" })),
    button("Deny", "deny-button", () => answerRequest(panel, `permissions/${encodeURIComponent(request.id)}`, { reply: "reject" })),
  );
  panel.append(buttons);
  return panel;
}

function questionPanel(request: QuestionRequest) {
  const form = make("form", "approval");
  form.append(make("h3", undefined, "Additional information required."));
  const answers: (() => string[])[] = [];
  request.questions.forEach((question, index) => {
    const field = make("fieldset", "question-field");
    field.append(make("legend", undefined, question.question));
    const inputs: HTMLInputElement[] = [];
    question.options.forEach((option) => {
      const label = make("label", "question-option");
      const input = make("input");
      input.type = question.multiple ? "checkbox" : "radio";
      input.name = `question-${request.id}-${index}`;
      input.value = option.label;
      inputs.push(input);
      label.append(input, document.createTextNode(option.label), make("small", undefined, option.description));
      field.append(label);
    });
    let custom: HTMLInputElement | undefined;
    if (question.custom !== false) {
      const label = make("label", "question-option", "Or write your answer");
      custom = make("input", "custom-answer");
      custom.type = "text";
      custom.maxLength = 4096;
      label.append(custom);
      field.append(label);
    }
    answers.push(() => {
      const choices = inputs.filter((input) => input.checked).map((input) => input.value);
      if (custom?.value.trim()) return question.multiple ? [...choices, custom.value.trim()] : [custom.value.trim()];
      return choices;
    });
    form.append(field);
  });
  const actions = make("div", "approval-actions");
  const submit = make("button", "peach-button", "Send answer");
  submit.type = "submit";
  actions.append(submit, button("Skip question", "deny-button", () => answerRequest(form, `questions/${encodeURIComponent(request.id)}`, { reject: true })));
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void perform(async () => {
      const values = answers.map((answer) => answer());
      if (values.some((value) => !value.length)) throw new Error("Choose or write an answer to each question.");
      await answerRequest(form, `questions/${encodeURIComponent(request.id)}`, { answers: values });
    });
  });
  return form;
}

function renderApprovals() {
  const permissions = state?.permissions.filter((request) => request.sessionID === selected) ?? [];
  const questions = state?.questions.filter((request) => request.sessionID === selected) ?? [];
  const key = `${selected}:${permissions.map((request) => request.id).join(",")}:${questions.map((request) => request.id).join(",")}`;
  if (key === approvalKey) return;
  approvalKey = key;
  const container = element("approvals");
  const nearBottom = readingArea.scrollHeight - readingArea.scrollTop - readingArea.clientHeight < 100;
  container.replaceChildren(...permissions.map(permissionPanel), ...questions.map(questionPanel));
  if (container.children.length && nearBottom) {
    requestAnimationFrame(() => {
      if (window.matchMedia("(min-width: 701px)").matches) readingArea.scrollTop = readingArea.scrollHeight;
      else container.lastElementChild?.scrollIntoView({ block: "end" });
    });
  }
}

function applyMessageEvent(event: Event) {
  if (event.type === "message.updated" && event.properties.info.sessionID === selected) {
    const info = event.properties.info;
    let message = messages.find((item) => item.id === info.id);
    if (!message) { message = { id: info.id, role: info.role, parts: [] }; messages.push(message); }
    message.role = info.role;
    if (info.role === "assistant" && info.error) message.error = errorMessage(info.error);
    scheduleRender();
  } else if (event.type === "message.part.updated" && event.properties.part.sessionID === selected) {
    const part = event.properties.part;
    const converted = chatPart(part);
    if (!converted) return;
    let message = messages.find((item) => item.id === part.messageID);
    if (!message) { message = { id: part.messageID, role: "assistant", parts: [] }; messages.push(message); }
    const index = message.parts.findIndex((item) => item.id === part.id);
    if (index < 0) message.parts.push(converted);
    else message.parts[index] = converted;
    scheduleRender();
  } else if (event.type === "message.part.delta" && event.properties.sessionID === selected) {
    const { messageID, partID, field, delta } = event.properties;
    const part = messages.find((item) => item.id === messageID)?.parts.find((item) => item.id === partID);
    if (part && field === "text") { part.text += delta; scheduleRender(); }
    else {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => { void perform(loadHistory); }, 200);
    }
  } else if (event.type === "message.removed" && event.properties.sessionID === selected) {
    messages = messages.filter((message) => message.id !== event.properties.messageID);
    scheduleRender();
  } else if (event.type === "message.part.removed" && event.properties.sessionID === selected) {
    const message = messages.find((item) => item.id === event.properties.messageID);
    if (message) message.parts = message.parts.filter((part) => part.id !== event.properties.partID);
    scheduleRender();
  }
}

function handleEvent(event: Event) {
  if (!state) return;
  if (event.type.startsWith("message.")) {
    if (historyLoading) historyEvents.push(event);
    else applyMessageEvent(event);
  }
  if (event.type === "session.status") {
    statusEvents++;
    state.statuses[event.properties.sessionID] = event.properties.status;
    if (event.properties.sessionID === selected && event.properties.status.type === "retry") {
      notice(`OpenCode is retrying. ${event.properties.status.message}`);
    }
    controls();
    if (event.properties.sessionID === selected && event.properties.status.type === "idle") void perform(loadHistory);
  } else if (event.type === "session.idle") {
    statusEvents++;
    state.statuses[event.properties.sessionID] = { type: "idle" };
    controls();
    if (event.properties.sessionID === selected) void perform(loadHistory);
  } else if (event.type === "session.error") {
    if (!event.properties.sessionID || event.properties.sessionID === selected) {
      const message = errorMessage(event.properties.error);
      notice(message);
      if (voiceTurn) { voiceTurn = undefined; voice.speak(spokenSummary(message), event.properties.error?.name !== "MessageAbortedError"); }
    }
  } else if (event.type.startsWith("permission.") || event.type.startsWith("question.") || ["session.created", "session.updated", "session.deleted"].includes(event.type)) {
    void perform(refreshState);
  }
}

let statusEvents = 0;
async function refreshState() {
  const revision = selectionRevision;
  let next: AppState;
  // A status change that arrives while the copy is on its way is newer than the copy, so fetch again.
  for (let attempt = 0; ; attempt++) {
    const seen = statusEvents;
    next = await api<AppState>("state");
    if (seen === statusEvents || attempt === 2) break;
  }
  if (revision !== selectionRevision && state?.project !== next.project) return;
  state = next;
  renderState();
}

async function loadHistory() {
  if (!selected || historyLoading) return;
  const id = selected;
  const revision = ++historyRevision;
  const baseline = structuredClone(messages);
  historyLoading = true;
  historyEvents.length = 0;
  controls();
  try {
    const loaded = await api<ChatMessage[]>(`conversations/${encodeURIComponent(id)}/messages`);
    if (selected !== id || revision !== historyRevision) return;
    const buffered = historyEvents.splice(0);
    // Replay against the pre-request state, not the snapshot: the snapshot can
    // already contain some of these deltas. Appending them again duplicates words.
    messages = baseline;
    for (const event of buffered) applyMessageEvent(event);
    const replayed = messages;
    messages = loaded;
    for (const candidate of replayed) {
      const snapshot = messages.find((item) => item.id === candidate.id);
      if (!snapshot) {
        if (buffered.some((event) => event.type === "message.updated" && event.properties.info.id === candidate.id)) messages.push(candidate);
        continue;
      }
      for (const part of candidate.parts) {
        const current = snapshot.parts.find((item) => item.id === part.id);
        if (!current) snapshot.parts.push(part);
        else if ((part.type === "text" || part.type === "reasoning") && part.text.startsWith(current.text)) current.text = part.text;
      }
    }
    for (const event of buffered) {
      if (event.type === "message.removed" || event.type === "message.part.removed") applyMessageEvent(event);
    }
    renderMessages();
  } finally {
    if (selected === id && revision === historyRevision) { historyLoading = false; controls(); completeVoiceReply(); }
  }
}

function openEvents() {
  events?.close();
  connected = false;
  events = new EventSource("/api/events");
  events.addEventListener("message", (message: MessageEvent<string>) => {
    void perform(async () => {
      const data = JSON.parse(message.data) as BrowserEvent;
      if (data.type === "connection") {
        connected = data.connected;
        if (data.message) notice(data.message);
        if (connected) {
          notice();
          await refreshState();
          await loadHistory();
        }
        controls();
      } else handleEvent(data.event);
    });
  });
  events.addEventListener("error", () => {
    connected = false;
    controls();
    notice("The live connection stopped. Keep Picard Code's terminal open; the browser will reconnect.");
  });
}

async function selectConversation(id: string) {
  if (selected && id !== selected) { voiceTurn = undefined; spokenQuestionID = undefined; voice.close(); }
  selected = id;
  selectionRevision++;
  historyRevision++;
  historyLoading = false;
  clearTimeout(historyTimer);
  messages = [];
  notice();
  if (openDrawer() === "records") closeDrawer();
  renderState();
  renderMessages();
  await loadHistory();
}

/** Clears the screen for a new task. The next request starts a new log, named after that request. */
function startFresh() {
  voiceTurn = undefined;
  spokenQuestionID = undefined;
  voice.stopSpeaking();
  selected = undefined;
  selectionRevision++;
  historyRevision++;
  historyLoading = false;
  clearTimeout(historyTimer);
  messages = [];
  notice();
  renderState();
  renderMessages();
}

async function newConversation(title = "New conversation") {
  const conversation = await api<Conversation>("conversations", { title });
  if (state) state.conversations.unshift(conversation);
  await selectConversation(conversation.id);
  return conversation;
}

async function sendMessage(spoken: string) {
  if (submitting || busy() || !state || !connected || historyLoading) throw new Error("The spoken request was not sent. Wait for the current work or connection to finish.");
  const text = spoken.trim();
  if (!text) return;
  const choice = state.models.find((choice) => modelValue(choice) === model.value);
  if (!choice) throw new Error("Connect GitHub Copilot and choose a model first.");
  submitting = true;
  controls();
  notice();
  try {
    if (!selected) await newConversation((addressed(text) || text).slice(0, 60));
    const id = selected!;
    voiceTurn = { session: id, known: new Set(messages.map((message) => message.id)) };
    await api(`conversations/${encodeURIComponent(id)}/send`, { text, ...choice });
    voice.acknowledge(() => !!voiceTurn && busy() && !pending());
    await refreshState();
    await loadHistory();
  } catch (error) {
    voiceTurn = undefined;
    throw error;
  } finally {
    submitting = false;
    controls();
    completeVoiceReply();
  }
}

async function boot() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token) {
    await api("connect", { token });
    history.replaceState(null, "", location.pathname);
  }
  await refreshState();
  // First run: without Copilot there is nothing to do on the main screen yet.
  if (state && !state.models.length && !location.hash) location.hash = "settings";
  if (!selected && state?.conversations[0]) await selectConversation(state.conversations[0].id);
  openEvents();
}

const speechFields = ["listening", "speaking", "subscription", "resourceGroup", "resourceName", "region", "deployment", "voice", "voiceStyle", "kokoroVoice"] as const;
function speechInput(name: typeof speechFields[number]) { return element<HTMLInputElement | HTMLSelectElement>(`setting-${name}`); }
function speechFieldVisibility() {
  const azure = speechInput("listening").value === "mai" || speechInput("speaking").value === "mai";
  element("azure-fields").hidden = !azure;
  document.querySelectorAll<HTMLElement>(".kokoro-field").forEach((node) => { node.hidden = speechInput("speaking").value !== "kokoro"; });
}
function showSpeechSettings(result: { settings: SpeechSettings; file: string }) {
  for (const name of speechFields) speechInput(name).value = result.settings[name];
  element("settings-file").textContent = `Saved in ${result.file}`;
  speechFieldVisibility();
}

const drawers = ["records", "options", "settings"] as const;
type Drawer = typeof drawers[number];
function openDrawer(): Drawer | undefined {
  const name = location.hash.slice(1);
  return (drawers as readonly string[]).includes(name) ? name as Drawer : undefined;
}
function closeDrawer() {
  if (openDrawer()) location.hash = "";
}

let settingsLoaded = false;
async function route() {
  const open = openDrawer();
  for (const name of drawers) element(`drawer-${name}`).hidden = name !== open;
  element("shell").dataset.drawer = open ?? "";
  // The conversation stays visible behind a slide-out but cannot be used until it closes.
  element("main").inert = !!open;
  document.querySelectorAll<HTMLAnchorElement>("[data-drawer-link]").forEach((link) => {
    const current = link.dataset.drawerLink === open;
    link.href = current ? "#" : `#${link.dataset.drawerLink}`;
    if (current) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
  if (open) element(`drawer-${open}`).focus();
  // Listening pauses while settings change, and starts again when Settings closes.
  if (open === "settings" && voice.microphone) voice.microphoneOff();
  controls();
  if (open !== "settings") return;
  if (!settingsLoaded) {
    settingsLoaded = true;
    try { showSpeechSettings(await api("settings")); }
    catch (error) { settingsLoaded = false; throw error; }
  }
}

element("new-conversation").addEventListener("click", () => { void perform(async () => {
  closeDrawer();
  startFresh();
}); });
window.addEventListener("hashchange", () => { void perform(route); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openDrawer()) { event.preventDefault(); closeDrawer(); }
});
speechInput("listening").addEventListener("change", speechFieldVisibility);
speechInput("speaking").addEventListener("change", speechFieldVisibility);
element("speech-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const result = element("speech-result");
  const save = element<HTMLButtonElement>("save-speech");
  void perform(async () => {
    const data = Object.fromEntries(speechFields.map((name) => [name, speechInput(name).value.trim()]));
    result.textContent = "Starting the selected speech services";
    save.disabled = true;
    // Open voice connections use the old services; close them before switching.
    voice.close();
    try {
      const saved = await api<{ settings: SpeechSettings; file: string; speech: AppState["speech"] }>("settings", data);
      showSpeechSettings(saved);
      if (state) state.speech = saved.speech;
      result.textContent = "Speech settings saved and in use";
      notice();
      controls();
    } catch (error) {
      result.textContent = "Not changed. See the message above";
      throw error;
    } finally { save.disabled = false; }
  });
});
element("stop").addEventListener("click", () => {
  void perform(async () => {
    if (!selected) return;
    voiceTurn = undefined;
    voice.stopSpeaking();
    await api(`conversations/${encodeURIComponent(selected)}/stop`, {});
    await refreshState();
    await loadHistory();
    voice.resume();
  });
});
element("retry").addEventListener("click", () => { void perform(async () => { await route(); await boot(); await route(); }); });
element("refresh-provider").addEventListener("click", () => {
  void perform(async () => {
    await api("refresh", {});
    await refreshState();
    openEvents();
  });
});
element("project-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const next = await api<AppState>("project", { path: element<HTMLInputElement>("project-path").value });
    voiceTurn = undefined;
    spokenQuestionID = undefined;
    voice.close();
    events?.close();
    selected = undefined;
    selectionRevision++;
    historyRevision++;
    messages = [];
    state = next;
    location.hash = "";
    renderState();
    renderMessages();
    if (next.conversations[0]) await selectConversation(next.conversations[0].id);
    openEvents();
  });
});
element("microphone").addEventListener("click", () => { void perform(async () => {
  if (voice.microphone) { setMuted(true); voice.microphoneOff(); controls(); return; }
  setMuted(false);
  await voice.activate();
  if (voice.microphone) markDisclosed();
  controls();
}); });
element("stop-speaking").addEventListener("click", () => voice.stopSpeaking());
for (const name of ["pointerdown", "keydown"] as const) document.addEventListener(name, () => voice.unlock(), true);
window.addEventListener("beforeunload", () => { events?.close(); voice.close(); });
void perform(async () => { await route(); await boot(); await route(); });
