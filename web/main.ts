import "./style.css";
import type { AppState, BrowserEvent, ChatMessage, Conversation, FormField, FormRequest, FormValue, ModelChoice, PermissionRequest, SpeechSettings } from "../src/shared/types";
import { errorMessage } from "../src/shared/messages";
import { replyFailed, spokenReply, spokenSummary } from "../src/shared/speech";
import { canAskAloud, matchSpokenAnswer, spokenField, spokenQuestion } from "../src/shared/questions";
import { addressed, voiceCommand } from "../src/shared/wake";
import { VoiceConversation } from "./voice";
import { renderMarkdown } from "./markdown";
import { formatStardate } from "../src/shared/stardate";

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
// A reload was asked for while one was running, or is waiting to start.
let historyAgain = false;
let historyDue = false;
let approvalKey = "";
let renderScheduled = false;
/** Reply text that is still being written, shown until the stored conversation catches up. */
const live = new Map<string, { sessionID: string; messageID: string; partType: "text" | "reasoning"; text: string }>();
let voiceTurn: { session: string; known: Set<string> } | undefined;
let spokenDecision = "";
let spokenQuestionID: string | undefined;
let answering = false;
// After "Computer" alone, the next words are taken as the request.
const GO_AHEAD = 8000;
let goAheadUntil = 0;
// "Computer" starts a task; after that every request in the task counts, until "new log entry" or "stop listening".
let engagedWith: string | undefined;
let notSent = "";
/** The log entry waiting for the captain to confirm its deletion. */
let confirmingDelete: string | undefined;
const voice = new VoiceConversation({
  changed: voiceControls,
  error: notice,
  transcript: heard,
  canListen: () => !!state?.models.length && connected,
});

/**
 * Handles one utterance heard while listening. Like the computer on the show, a task starts with
 * "Computer"; within the task, follow-ups need no "Computer". The words are sent unchanged.
 * Approvals are never given by voice.
 */
async function heard(text: string, startedAt: number) {
  if (!text) return;
  const words = addressed(text);
  if (voiceCommand(words ?? text) === "standby") { await standBy(); return; }
  const question = askedQuestion();
  if (words === undefined && !question && !inTask() && startedAt > goAheadUntil) {
    notSent = `Not sent: “${text}” Start with “Computer”.`;
    await voice.notSent();
    return;
  }
  goAheadUntil = 0;
  const request = words ?? text;
  const command = voiceCommand(request);
  if (command === "stop") { await stopByVoice(); return; }
  if (command === "new") { freshByVoice(); return; }
  if (command === "mute") { muteMicrophone(); voice.speak("Microphone off. Click the microphone button or press M to switch it on."); return; }
  if (question) { await answerAloud(request); return; }
  if (!request) {
    goAheadUntil = Date.now() + GO_AHEAD;
    setTimeout(voiceControls, GO_AHEAD + 50);
    voice.chime();
    return;
  }
  // A finished reply is still being collected; wait briefly rather than refuse.
  for (let waited = 0; (submitting || historyLoading) && waited < 5000; waited += 100) await new Promise((done) => setTimeout(done, 100));
  const blocked = state?.permissions.some((item) => item.sessionID === selected) ? "A decision is needed first. Choose Allow once or Deny on screen."
    : pending() ? "Please answer the question on screen first."
    : busy() || submitting ? "Work is in progress. Say stop to cancel it." : undefined;
  // Room speech during a task is not answered aloud while the computer cannot take it; the sound marks it as not sent.
  if (blocked && words === undefined) { notSent = `Not sent: “${text}” ${blocked}`; await voice.notSent(); }
  else if (blocked) voice.speak(blocked);
  else {
    await sendMessage(text);
    engagedWith = selected;
  }
}

/** "Stop listening": ends the task and waits for "Computer" again. Any work under way carries on. */
async function standBy() {
  engagedWith = undefined;
  goAheadUntil = 0;
  controls();
  await voice.chime();
  voice.speak("Standing by.");
}

/** Whether a task started with "Computer" is under way, so follow-ups need no "Computer". */
function inTask() {
  return !!selected && engagedWith === selected;
}

function freshByVoice() {
  if (state?.permissions.some((item) => item.sessionID === selected)) voice.speak("A decision is needed first. Choose Allow once or Deny on screen.");
  else if (pending()) voice.speak("Please answer the question on screen first.");
  else if (busy() || submitting) voice.speak("Work is in progress. Say stop to cancel it first.");
  else { startFresh(); voice.speak("Ready for a new log entry."); }
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
  return request && canAskAloud(request) ? request : undefined;
}

async function answerAloud(text: string) {
  const request = askedQuestion();
  if (!request) throw new Error("The question is no longer waiting. Check the log entry on screen.");
  const field = spokenField(request)!;
  const result = matchSpokenAnswer(field, text);
  if ("retry" in result) { voice.speak(result.retry); return; }
  answering = true;
  try {
    await api(`questions/${encodeURIComponent(request.id)}`, { answer: { [field.key]: result.answer } });
    spokenQuestionID = undefined;
    await refreshState();
  } finally {
    answering = false;
    controls();
  }
}

// The app always opens with the microphone on; switching it off lasts until it is switched on or the page reloads.
let microphoneSwitchedOff = false;
function muted() {
  return microphoneSwitchedOff;
}
function setMuted(value: boolean) {
  microphoneSwitchedOff = value;
}

/** The microphone is simply on, unless muted or changing settings. */
function autoListen() {
  if (voice.microphone || voice.opening || voice.failed || !state?.speech?.configured || !state.models.length || !connected
    || muted() || openDrawer() === "settings") return;
  void perform(() => voice.activate());
}

/** One status for the whole screen, with a short line saying what to do next. */
function consoleStatus(): [string, string] {
  if (!state) return ["Starting up", ""];
  if (!connected) return ["Reconnecting", "Keep Picard Code's terminal open."];
  if (!state.models.length) return ["Setup needed", "Sign in to a model provider: open Provider."];
  if (voice.phase === "speaking") return ["Speaking", "Choose Stop speaking to interrupt."];
  if (voice.speechPending) return ["Preparing reply", ""];
  if (voice.microphone && voice.waitingForClick) return ["Ready", "Click anywhere to start listening."];
  if (voice.phase === "listening") return ["Listening", ""];
  if (voice.microphone && voice.phase === "thinking") return ["Understanding", ""];
  const listening = voice.microphone && voice.phase === "standby";
  if (state.permissions.some((item) => item.sessionID === selected)) return ["Decision needed", "Choose Allow once or Deny on screen."];
  if (listening && askedQuestion()) return ["Answer needed", "Say your answer, or choose it on screen."];
  if (pending()) return ["Answer needed", "Answer the question on screen."];
  const stopHint = !listening ? "Choose Belay that to cancel." : inTask() ? "Say “Stop” to cancel." : "Say “Computer, stop” to cancel.";
  if (selected && state.statuses[selected]?.type === "retry") return ["Retrying", stopHint];
  if (busy() || submitting) return ["Working", stopHint];
  if (historyLoading) return ["Loading", ""];
  if (listening) return ["Standing by", Date.now() < goAheadUntil ? "Go ahead." : inTask() ? "Go ahead with the next request, or say “New log entry”." : "Say “Computer”, then your request."];
  if (voice.opening) return ["Starting microphone", ""];
  if (!state.speech?.configured) return ["Ready", ""];
  return ["Microphone off", "Click the microphone button or press M to switch it on."];
}

function voiceControls() {
  const ready = !!state?.speech?.configured && !!state.models.length && connected;
  const [status, detail] = consoleStatus();
  element("status").textContent = status;
  element("status-detail").textContent = detail;
  const toggle = element<HTMLButtonElement>("listen-toggle");
  toggle.hidden = !state?.speech?.configured;
  toggle.setAttribute("aria-label", voice.microphone ? "Switch microphone off" : "Switch microphone on");
  toggle.title = `${voice.microphone ? "Switch microphone off" : "Switch microphone on"} (M)`;
  toggle.toggleAttribute("data-on", voice.microphone);
  toggle.disabled = voice.opening || !voice.microphone && !ready;
  element("voice-console").dataset.phase = voice.microphone || voice.phase === "speaking" ? voice.phase : "off";
  if (voice.phase === "listening") notSent = "";
  element("voice-partial").textContent = voice.phase === "listening" || voice.phase === "thinking" ? voice.partial : notSent;
  element("voice-partial").classList.toggle("not-sent", voice.phase !== "listening" && voice.phase !== "thinking" && !!notSent);
  element("voice-setup-hint").hidden = !state || !!state.speech?.configured;
  element("voice-setup-text").textContent = state?.speech?.error ? "Speech did not start." : "Speech is not set up.";
  const cloudListening = state?.speech?.listening !== "whisper";
  const cloudSpeaking = state?.speech?.speaking !== "kokoro";
  element("speech-current").textContent = state?.speech?.configured
    ? `In use: ${cloudListening ? "Azure" : "this computer"} listens, ${cloudSpeaking ? "Azure" : "this computer"} speaks`
    : state?.speech?.error ?? "Speech is not set up yet";
  element("stop-speaking").hidden = !voice.speechPending;
}

function completeVoiceReply() {
  if (!voiceTurn || voiceTurn.session !== selected || busy() || pending() || submitting || historyLoading || historyDue) return;
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
  return !!selected && !!state?.statuses[selected];
}
function pending() {
  return !!selected && (state?.permissions.some((item) => item.sessionID === selected) || state?.questions.some((item) => item.sessionID === selected));
}

function readout(name: string, value: string) {
  const node = element(`readout-${name}`);
  node.textContent = value;
  node.title = value;
}

/** The side panel's readouts show what the computer is connected to right now. */
function readouts() {
  readout("provider", !state ? "Checking" : !connected ? "Reconnecting" : state.models.length ? "Connected" : "Not connected");
  readout("project", state ? state.project.split(/[\\/]/).filter(Boolean).at(-1) ?? state.project : "—");
  readout("model", state?.models.length ? model.selectedOptions[0]?.textContent ?? "—" : "None");
  const speech = state?.speech;
  readout("speech", !speech?.configured ? "Not set up"
    : `${speech.listening === "whisper" ? "Whisper" : "Azure MAI"} · ${speech.speaking === "kokoro" ? "Kokoro" : "Azure MAI"}`);
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
  element("provider-status").textContent = !state ? "Checking" : state.models.length
    ? `Connected: ${[...new Set(state.models.map((choice) => choice.provider))].join(", ")}. ${state.models.length} model${state.models.length === 1 ? "" : "s"} available.` : "Not connected";
  readouts();
  voice.sync();
  autoListen();
  voiceControls();
}

function renderState() {
  if (!state) { controls(); return; }
  if (document.activeElement !== element("project-path")) element<HTMLInputElement>("project-path").value = state.project;
  element("workspace-caption").textContent = `OpenCode ${state.version} · ${state.project}`;
  const currentModel = model.value;
  model.replaceChildren();
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const choice of state.models) {
    let group = groups.get(choice.provider);
    if (!group) {
      group = make("optgroup");
      group.label = choice.provider;
      groups.set(choice.provider, group);
      model.append(group);
    }
    const option = make("option", undefined, choice.name);
    option.value = modelValue(choice);
    group.append(option);
  }
  if (!state.models.length) model.append(make("option", undefined, "Sign in to a model provider"));
  else if (state.models.some((choice) => modelValue(choice) === currentModel)) model.value = currentModel;
  else if (state.defaultModel) model.value = modelValue(state.defaultModel);
  const list = element("conversations");
  list.replaceChildren();
  if (confirmingDelete && !state.conversations.some((item) => item.id === confirmingDelete)) confirmingDelete = undefined;
  for (const item of state.conversations) {
    const row = make("div", "conversation-row");
    if (confirmingDelete === item.id) {
      row.classList.add("confirming");
      const question = make("p", "delete-question", `Delete “${item.title}” permanently? This cannot be undone.`);
      const yes = button("Delete", "delete-confirm", () => deleteConversation(item.id));
      const no = button("Keep", "delete-cancel", () => { confirmingDelete = undefined; renderState(); });
      row.append(question, yes, no);
      list.append(row);
      continue;
    }
    const node = button("", "conversation-button", () => selectConversation(item.id));
    // Like a captain's log, each entry carries the stardate it was started.
    const started = new Date(item.created);
    const known = Number.isFinite(started.getTime());
    const when = known ? `, stardate ${formatStardate(started)}` : "";
    if (known) node.append(make("span", "log-stardate", `Stardate ${formatStardate(started)}`));
    node.append(make("span", "log-title", item.title));
    node.setAttribute("aria-label", `${item.title}${when}`);
    if (item.id === selected) node.setAttribute("aria-current", "page");
    if (state.permissions.some((request) => request.sessionID === item.id) || state.questions.some((request) => request.sessionID === item.id)) {
      const dot = make("span", "pending-dot");
      dot.setAttribute("aria-hidden", "true");
      node.prepend(dot);
      node.setAttribute("aria-label", `${item.title}${when}, needs your reply`);
    }
    const remove = button("✕", "delete-button", () => { confirmingDelete = item.id; renderState(); });
    const working = !!state.statuses[item.id];
    remove.disabled = working;
    remove.setAttribute("aria-label", `Delete ${item.title}`);
    remove.title = working ? "Still working. Stop it before deleting." : "Delete this log entry";
    row.append(node, remove);
    list.append(row);
  }
  if (!state.conversations.length) list.append(make("p", "muted", "Your log entries will appear here."));
  renderApprovals();
  const decision = state.permissions.find((item) => item.sessionID === selected)?.id
    ?? state.questions.find((item) => item.sessionID === selected)?.id;
  if (voiceTurn && decision && decision !== spokenDecision) {
    spokenDecision = decision;
    const question = state.questions.find((item) => item.id === decision);
    const waiting = state.questions.filter((item) => item.sessionID === selected).length;
    if (!question) {
      voice.speak("Captain, approval is required. Review the requested action on screen, then choose Allow once or Deny.");
    } else if (waiting === 1 && canAskAloud(question)) {
      spokenQuestionID = question.id;
      voice.speak(spokenQuestion(question));
    } else {
      voice.speak("Additional information is required. Please answer the questions on screen.");
    }
  }
  if (spokenQuestionID && !state.questions.some((item) => item.id === spokenQuestionID)) spokenQuestionID = undefined;
  controls();
}

function renderText(container: HTMLElement, text: string, role: ChatMessage["role"]) {
  // The captain's own words stay exactly as heard; replies are Markdown, rendered safely.
  if (role === "user") { container.append(make("p", "message-text", text)); return; }
  const node = make("div", "message-text markdown");
  node.append(renderMarkdown(text));
  container.append(node);
}

function renderMessages() {
  const nearBottom = readingArea.scrollHeight - readingArea.scrollTop - readingArea.clientHeight < 100;
  const container = element("messages");
  container.replaceChildren();
  // The latest request and its reply fill the screen; earlier ones stay small above.
  const list = shown();
  const latest = list.findLastIndex((message) => message.role === "user");
  list.forEach((message, index) => {
    // Only the written answer is shown. A reply without one still shows why an action failed or was refused.
    const texts = message.parts.filter((part) => part.type === "text" && part.text.trim());
    const failures = texts.length ? [] : message.parts.filter((part) => part.type === "tool" && part.status === "error");
    if (message.role === "assistant" && !texts.length && !failures.length && !message.error) return;
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
    for (const part of texts) renderText(article, part.text, message.role);
    for (const part of failures) article.append(make("p", "message-error", part.text));
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
    shell: "run a command",
    edit: "change a file",
    read: "read a file",
    glob: "find files",
    grep: "search file contents",
    external_directory: "use files outside this project",
    webfetch: "open a web page",
    websearch: "search the web",
    subagent: "start a helper",
    skill: "use a skill",
    question: "ask a question",
  };
  const action = actions[request.action] ?? `use the "${request.action}" tool`;
  panel.append(make("p", undefined, `OpenCode wants to ${action}. Review the requested action before allowing it.`));
  if (request.message) panel.append(make("p", undefined, request.message));
  const metadata = request.metadata && Object.keys(request.metadata).length ? `\n\n${JSON.stringify(request.metadata, null, 2)}` : "";
  panel.append(make("pre", undefined, `${request.resources.join("\n")}${metadata}`.trim()));
  const buttons = make("div", "approval-actions");
  buttons.append(
    button("Allow once", "peach-button", () => answerRequest(panel, `permissions/${encodeURIComponent(request.id)}`, { reply: "once" })),
    button("Deny", "deny-button", () => answerRequest(panel, `permissions/${encodeURIComponent(request.id)}`, { reply: "reject" })),
  );
  panel.append(buttons);
  return panel;
}

/** One question in an OpenCode form, with a way to read its current answer. */
function formField(request: FormRequest, field: FormField, index: number) {
  const box = make("fieldset", "question-field");
  box.append(make("legend", undefined, field.description?.trim() || field.title?.trim() || request.title));
  if (field.description && field.title) box.prepend(make("p", "question-title", field.title));
  const name = `question-${request.id}-${index}`;
  const choice = (type: "radio" | "checkbox", value: string, label: string, detail?: string, checked = false) => {
    const node = make("label", "question-option");
    const input = make("input");
    input.type = type;
    input.name = name;
    input.value = value;
    input.checked = checked;
    node.append(input, document.createTextNode(label));
    if (detail) node.append(make("small", undefined, detail));
    box.append(node);
    return input;
  };
  const writeIn = (label: string) => {
    const node = make("label", "question-option", label);
    const input = make("input", "custom-answer");
    input.type = "text";
    input.maxLength = 4096;
    node.append(input);
    box.append(node);
    return input;
  };
  let read: () => FormValue | undefined = () => undefined;
  if (field.type === "string") {
    const options = field.options ?? [];
    const inputs = options.map((option) => choice("radio", option.value, option.label, option.description, option.value === field.default));
    const custom = !options.length || field.custom === true ? writeIn(options.length ? "Or write your answer" : "Your answer") : undefined;
    if (custom && !options.length && field.default) custom.value = field.default;
    if (custom && field.maxLength) custom.maxLength = Math.min(field.maxLength, 4096);
    read = () => custom?.value.trim() || inputs.find((input) => input.checked)?.value;
  } else if (field.type === "multiselect") {
    const inputs = field.options.map((option) => choice("checkbox", option.value, option.label, option.description, field.default?.includes(option.value)));
    const custom = field.custom === true ? writeIn("Or add your own answer") : undefined;
    read = () => {
      const values = inputs.filter((input) => input.checked).map((input) => input.value);
      if (custom?.value.trim()) values.push(custom.value.trim());
      return values.length ? values : undefined;
    };
  } else if (field.type === "boolean") {
    const yes = choice("radio", "yes", "Yes", undefined, field.default === true);
    const no = choice("radio", "no", "No", undefined, field.default === false);
    read = () => yes.checked ? true : no.checked ? false : undefined;
  } else if (field.type === "number" || field.type === "integer") {
    const node = make("label", "question-option", "Your answer");
    const input = make("input", "custom-answer");
    input.type = "number";
    input.step = field.type === "integer" ? "1" : "any";
    if (field.minimum !== undefined) input.min = String(field.minimum);
    if (field.maximum !== undefined) input.max = String(field.maximum);
    if (field.default !== undefined) input.value = String(field.default);
    node.append(input);
    box.append(node);
    read = () => input.value.trim() === "" ? undefined : Number(input.value);
  } else if (field.type === "external") {
    // A page OpenCode wants opened, such as a sign-in. Only web addresses are linked.
    const safe = /^https?:\/\//i.test(field.url);
    const link = make(safe ? "a" : "span", "question-link", safe ? "Open the page" : field.url);
    if (link instanceof HTMLAnchorElement) { link.href = field.url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
    box.append(link, make("small", undefined, field.url));
  }
  return { field, box, read };
}

function questionPanel(request: FormRequest) {
  const form = make("form", "approval");
  form.append(make("h3", undefined, "Additional information required."));
  const fields = request.fields.filter((field) => !field.hidden).map((field, index) => formField(request, field, index));
  const value = (key: string) => fields.find((item) => item.field.key === key)?.read();
  const visible = (field: FormField) => (field.when ?? []).every((rule) => rule.op === "eq" ? value(rule.key) === rule.value : value(rule.key) !== rule.value);
  const update = () => { for (const item of fields) item.box.hidden = !visible(item.field); };
  for (const item of fields) form.append(item.box);
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  update();
  const actions = make("div", "approval-actions");
  const submit = make("button", "peach-button", "Send answer");
  submit.type = "submit";
  actions.append(submit, button("Skip question", "deny-button", () => answerRequest(form, `questions/${encodeURIComponent(request.id)}`, { skip: true })));
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void perform(async () => {
      const answer: Record<string, FormValue> = {};
      for (const item of fields) {
        if (item.field.type === "external" || !visible(item.field)) continue;
        const given = item.read();
        if (given !== undefined) answer[item.field.key] = given;
        else if (item.field.required || fields.length === 1) throw new Error("Choose or write an answer to each question.");
      }
      await answerRequest(form, `questions/${encodeURIComponent(request.id)}`, { answer });
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

/** The stored conversation with any reply text that is still being written. */
function shown(): ChatMessage[] {
  const pieces = [...live].filter(([, piece]) => piece.sessionID === selected);
  if (!pieces.length) return messages;
  const result = structuredClone(messages);
  for (const [id, piece] of pieces) {
    let message = result.find((item) => item.id === piece.messageID);
    if (!message) { message = { id: piece.messageID, role: "assistant", parts: [] }; result.push(message); }
    const part = message.parts.find((item) => item.id === id);
    if (!part) message.parts.push({ id, type: piece.partType, text: piece.text });
    else if (part.text.length < piece.text.length) part.text = piece.text;
  }
  return result;
}

/** Drops live text once the stored conversation holds all of it. */
function pruneLive() {
  for (const [id, piece] of live) {
    const stored = messages.find((item) => item.id === piece.messageID)?.parts.find((item) => item.id === id);
    if (piece.sessionID !== selected || stored && stored.text.length >= piece.text.length) live.delete(id);
  }
}

function scheduleHistory() {
  historyDue = true;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => { void perform(loadHistory); }, 200);
}

function handleEvent(event: BrowserEvent) {
  if (!state || event.type === "connection") return;
  if (event.type === "delta") {
    if (event.sessionID !== selected) return;
    const piece = live.get(event.partID) ?? { sessionID: event.sessionID, messageID: event.messageID, partType: event.partType, text: "" };
    piece.text += event.delta;
    live.set(event.partID, piece);
    scheduleRender();
  } else if (event.type === "changed") {
    if (event.sessionID === selected) scheduleHistory();
  } else if (event.type === "state") {
    statusEvents++;
    void perform(refreshState);
  } else if (event.type === "retry") {
    statusEvents++;
    state.statuses[event.sessionID] = { type: "retry", message: event.message };
    if (event.sessionID === selected) notice(`OpenCode is retrying. ${event.message}`);
    controls();
  } else if (event.type === "error" && event.sessionID === selected) {
    notice(event.message);
    if (voiceTurn) { voiceTurn = undefined; voice.speak(spokenSummary(event.message), true); }
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
  completeVoiceReply();
}

async function loadHistory() {
  if (!selected) return;
  if (historyLoading) { historyAgain = true; return; }
  historyDue = false;
  clearTimeout(historyTimer);
  const id = selected;
  const revision = ++historyRevision;
  historyLoading = true;
  controls();
  try {
    const loaded = await api<ChatMessage[]>(`conversations/${encodeURIComponent(id)}/messages`);
    if (selected !== id || revision !== historyRevision) return;
    messages = loaded;
    pruneLive();
    renderMessages();
  } finally {
    if (selected === id && revision === historyRevision) {
      historyLoading = false;
      controls();
      if (historyAgain) { historyAgain = false; void perform(loadHistory); }
      else completeVoiceReply();
    }
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
      } else handleEvent(data);
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
  historyAgain = false;
  historyDue = false;
  clearTimeout(historyTimer);
  live.clear();
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
  historyAgain = false;
  historyDue = false;
  clearTimeout(historyTimer);
  live.clear();
  messages = [];
  notice();
  renderState();
  renderMessages();
}

/** Permanently deletes a log entry after the captain confirmed it. */
async function deleteConversation(id: string) {
  confirmingDelete = undefined;
  await api(`conversations/${encodeURIComponent(id)}/delete`, {});
  if (engagedWith === id) engagedWith = undefined;
  if (state) state.conversations = state.conversations.filter((item) => item.id !== id);
  if (selected === id) startFresh();
  else renderState();
}

async function newConversation(title = "New log entry") {
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
  if (!choice) throw new Error("Sign in to a model provider and choose a model first.");
  submitting = true;
  controls();
  notice();
  try {
    // A request that starts a task begins its own log entry; only follow-ups within the task join it.
    if (selected && engagedWith !== selected) startFresh();
    if (!selected) await newConversation((addressed(text) || text).slice(0, 60));
    const id = selected!;
    voiceTurn = { session: id, known: new Set(messages.map((message) => message.id)) };
    await api(`conversations/${encodeURIComponent(id)}/send`, { text, ...choice });
    voice.acknowledge();
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
  // First run: without a model there is nothing to do on the main screen yet.
  if (state && !state.models.length && !location.hash) location.hash = "settings/provider";
  if (!selected && state?.conversations[0]) await selectConversation(state.conversations[0].id);
  openEvents();
}

const speechFields = ["listening", "speaking", "subscription", "resourceGroup", "resourceName", "region", "deployment", "voice", "voiceStyle", "kokoroVoice"] as const;
function speechInput(name: typeof speechFields[number]) { return element<HTMLInputElement | HTMLSelectElement>(`setting-${name}`); }
/** Whether the local Whisper and Kokoro files are already on this computer. */
let localSpeechReady = false;
function speechFieldVisibility() {
  const azureListening = speechInput("listening").value === "mai";
  const azureSpeaking = speechInput("speaking").value === "mai";
  element("azure-fields").hidden = !azureListening && !azureSpeaking;
  element("local-note").hidden = (azureListening && azureSpeaking) || localSpeechReady;
  const show = (selector: string, visible: boolean) => document.querySelectorAll<HTMLElement>(selector).forEach((node) => { node.hidden = !visible; });
  show(".kokoro-field", !azureSpeaking);
  show(".azure-listening", azureListening);
  show(".azure-speaking", azureSpeaking);
}
type SavedSpeech = { settings: SpeechSettings; file: string; localReady: boolean; speech: AppState["speech"] };
type SpeechSetup = { state: "running" | "done" | "failed"; step: string; error?: string; result?: SavedSpeech };
function showSpeechSettings(result: { settings: SpeechSettings; file: string; localReady: boolean }) {
  localSpeechReady = result.localReady;
  for (const name of speechFields) speechInput(name).value = result.settings[name];
  element("settings-file").textContent = `Saved in ${result.file}`;
  speechFieldVisibility();
}

const drawers = ["records", "settings"] as const;
type Drawer = typeof drawers[number];
function openDrawer(): Drawer | undefined {
  const name = location.hash.slice(1).split("/")[0] ?? "";
  return (drawers as readonly string[]).includes(name) ? name as Drawer : undefined;
}
function closeDrawer() {
  if (openDrawer()) location.hash = "";
}

const settingsParts = { provider: ["Provider sign-in", "orange"], model: ["Model", "blue"], project: ["Project folder", "tan"], voice: ["Speech", "lilac"], about: ["About", "red"] } as const;
type SettingsPart = keyof typeof settingsParts;
/** Each side panel tile opens its own part, for example #settings/voice. Without one, open what still needs doing. */
function showSettingsPart(requested?: string) {
  const part = requested && requested in settingsParts ? requested as SettingsPart
    : state && !state.models.length ? "provider" : "voice";
  for (const name of Object.keys(settingsParts) as SettingsPart[]) element(`settings-${name}`).hidden = name !== part;
  const [title, colour] = settingsParts[part];
  element("settings-title").textContent = title;
  element("settings-bar").className = `drawer-bar ${colour}`;
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
  // The Conversation tile is lit while the conversation is in front, and brings it back from any panel.
  if (open) element("nav-conversation").removeAttribute("aria-current");
  else element("nav-conversation").setAttribute("aria-current", "page");
  // A tile shows its part; choosing it again closes the panel.
  document.querySelectorAll<HTMLAnchorElement>("a.readout, #tribute").forEach((tile) => {
    tile.dataset.part ??= tile.getAttribute("href") ?? "";
    const current = open === "settings" && tile.dataset.part === location.hash;
    tile.setAttribute("href", current ? "#" : tile.dataset.part);
    if (current) tile.setAttribute("aria-current", "true");
    else tile.removeAttribute("aria-current");
  });
  if (open) element(`drawer-${open}`).focus();
  // Listening pauses while settings change, and starts again when Settings closes.
  if (open === "settings" && voice.microphone) voice.microphoneOff();
  controls();
  if (open !== "settings") return;
  showSettingsPart(location.hash.split("/")[1]);
  if (!settingsLoaded) {
    settingsLoaded = true;
    try { showSpeechSettings(await api("settings")); }
    catch (error) { settingsLoaded = false; throw error; }
  }
}

model.addEventListener("change", readouts);
element("new-conversation").addEventListener("click", () => { void perform(async () => {
  closeDrawer();
  startFresh();
}); });
window.addEventListener("hashchange", () => { void perform(route); });
// Clicking the conversation behind an open panel closes the panel.
document.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  // A button that redrew its own panel is no longer on the page; that click was still inside the panel.
  if (openDrawer() && target?.isConnected && !target.closest(".drawer, #sidebar, .header")) closeDrawer();
});
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
      let saved = await api<SavedSpeech | SpeechSetup>("settings", data);
      // The first local choice downloads its files in the background; follow it until it is in use.
      while ("state" in saved) {
        if (saved.state === "failed") throw new Error(saved.error ?? "The local speech setup stopped.");
        if (saved.state === "done" && saved.result) { saved = saved.result; break; }
        result.textContent = `${saved.step}. This can take a few minutes`;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        saved = await api<SpeechSetup>("speech-setup");
      }
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
    live.clear();
    messages = [];
    state = next;
    location.hash = "";
    renderState();
    renderMessages();
    if (next.conversations[0]) await selectConversation(next.conversations[0].id);
    openEvents();
  });
});
function muteMicrophone() {
  engagedWith = undefined;
  setMuted(true);
  voice.microphoneOff();
  controls();
}
async function startListening() {
  if (!state?.speech?.configured || !state.models.length || !connected) return;
  setMuted(false);
  await voice.activate();
  controls();
}
/** The last side panel tile shows the current stardate. Dates are only ever shown as stardates. */
function showStardate() {
  const now = new Date();
  element("readout-stardate").textContent = formatStardate(now);
  element("rail-end").title = `Stardate ${formatStardate(now)}`;
}
showStardate();
setInterval(showStardate, 60_000);
// Only the microphone button (or the M key) switches the microphone, so a stray click never starts listening.
function toggleMicrophone() {
  const toggle = element<HTMLButtonElement>("listen-toggle");
  if (toggle.hidden || toggle.disabled) return;
  if (voice.microphone) muteMicrophone();
  else if (!voice.opening) void perform(startListening);
}
element("listen-toggle").addEventListener("click", toggleMicrophone);
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "m" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (openDrawer() || target?.closest("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  toggleMicrophone();
});
element("stop-speaking").addEventListener("click", () => voice.stopSpeaking());
for (const name of ["pointerdown", "keydown"] as const) document.addEventListener(name, () => voice.unlock(), true);
window.addEventListener("beforeunload", () => { events?.close(); voice.close(); });
void perform(async () => { await route(); await boot(); await route(); });
