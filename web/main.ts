import "./style.css";
import type { Event, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2";
import type { AppState, BrowserEvent, ChatMessage, Conversation, ModelChoice } from "../src/shared/types";
import { chatPart, errorMessage } from "../src/shared/messages";
import { spokenSummary } from "../src/shared/speech";
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

const prompt = element<HTMLTextAreaElement>("prompt");
const model = element<HTMLSelectElement>("model");
const agent = element<HTMLSelectElement>("agent");
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
const drafts = new Map<string, string>();
const historyEvents: Event[] = [];
let voiceTurn: { session: string; known: Set<string> } | undefined;
let spokenDecision = "";
const voice = new VoiceConversation({
  changed: voiceControls,
  error: notice,
  transcript: (text) => sendMessage(text),
  canListen: () => !!state?.models.length && connected && !busy() && !submitting && !pending() && !historyLoading && !voiceTurn,
});

function voiceControls() {
  const ready = !!state?.speech?.configured && !!state.models.length && connected;
  const microphone = element<HTMLButtonElement>("microphone");
  microphone.textContent = voice.microphone ? "Microphone off" : "Turn microphone on";
  microphone.disabled = !voice.microphone && (!ready || busy() || submitting);
  microphone.setAttribute("aria-pressed", String(voice.microphone));
  element("voice-console").dataset.phase = voice.phase;
  element("voice-status").textContent = voice.phase === "speaking" ? voice.microphone ? "Computer speaking" : "Microphone off / computer speaking"
    : voice.speechPending ? voice.microphone ? "Preparing the spoken reply" : "Microphone off / preparing the spoken reply"
    : voice.microphone && voice.phase === "listening" ? "Listening"
    : voice.microphone ? pending() ? "Waiting for your decision" : "Understanding / working"
    : "Microphone off";
  element("voice-partial").textContent = voice.partial;
  element("voice-setup-hint").hidden = !!state?.speech?.configured;
  const cloudListening = state?.speech?.listening !== "whisper";
  const cloudSpeaking = state?.speech?.speaking !== "kokoro";
  element("speech-services").textContent = `${cloudListening ? "MAI" : "Whisper"} listening / ${cloudSpeaking ? "MAI" : "Kokoro"} voice`;
  element("voice-disclosure").textContent = `${cloudListening
    ? "When on, microphone audio goes to Azure, which may process it outside Europe."
    : "Whisper understands microphone audio on this computer."} ${cloudSpeaking
    ? "Reply text goes to Azure for speaking." : "Kokoro speaks locally."} Understood requests are sent to Copilot automatically. Listening pauses during work and playback. Stop speaking interrupts playback, not work.`;
  element("stop-speaking").hidden = !voice.speechPending;
}

function completeVoiceReply() {
  if (!voiceTurn || voiceTurn.session !== selected || busy() || pending() || submitting || historyLoading) return;
  const reply = messages.findLast((message) => message.role === "assistant" && !voiceTurn!.known.has(message.id));
  if (!reply) return;
  const text = reply.error ?? reply.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (!text.trim()) return;
  voiceTurn = undefined;
  voice.speak(spokenSummary(text));
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
  prompt.disabled = !ready;
  model.disabled = !ready || working;
  agent.disabled = !ready || working;
  element<HTMLButtonElement>("send").disabled = !ready || working || !prompt.value.trim();
  element("send").hidden = !!working;
  element("stop").hidden = !busy();
  element<HTMLButtonElement>("stop").disabled = submitting;
  element<HTMLButtonElement>("new-conversation").disabled = !state || submitting;
  element("setup").hidden = !state || !!state.models.length;
  element("welcome").hidden = !!messages.length || !!selected && historyLoading || !!state && !state.models.length;
  const retrying = !!selected && state?.statuses[selected]?.type === "retry";
  const status = !state ? "Starting up" : !connected ? "Reconnecting" : !state.models.length ? "Setup needed" : pending() ? "Needs your reply" : retrying ? "Retrying" : working ? "Working" : historyLoading ? "Loading" : "Ready";
  element("work-status").textContent = status;
  element("connection-label").textContent = connected ? "Local connection" : "Connecting";
  element("connection-light").classList.toggle("ready", connected);
  element("mode-hint").textContent = agent.value === "plan"
    ? "Discuss uses OpenCode's planning mode. Review its suggestions before asking for changes."
    : "OpenCode may change files or run commands. Its permission settings decide which actions ask first.";
  if (voice.microphone && voice.phase === "listening" && (!ready || working || pending())) voice.resume();
  if (voice.microphone && voice.phase === "off" && ready && !working && !pending() && !voiceTurn && !voice.speechPending && !historyLoading) voice.resume();
  voiceControls();
}

function renderState() {
  if (!state) { controls(); return; }
  const projectName = state.project.split(/[\\/]/).filter(Boolean).at(-1) ?? state.project;
  element("project-name").textContent = projectName;
  element("project-name").title = state.project;
  if (document.activeElement !== element("project-path")) element<HTMLInputElement>("project-path").value = state.project;
  element("workspace-caption").textContent = `OpenCode ${state.version} · ${projectName}`;
  element("conversation-title").textContent = state.conversations.find((item) => item.id === selected)?.title ?? "New conversation";
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
  if (!state.conversations.length) list.append(make("p", "empty-list", "Your conversations will appear here."));
  renderApprovals();
  const decision = state.permissions.find((item) => item.sessionID === selected)?.id
    ?? state.questions.find((item) => item.sessionID === selected)?.id;
  if (voiceTurn && decision && decision !== spokenDecision) {
    spokenDecision = decision;
    voice.speak(state.permissions.some((item) => item.id === decision)
      ? "Approval required. Review the requested action on screen, then choose Allow once or Deny."
      : "Additional information is required. Please answer the question on screen.");
  }
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
  for (const message of messages) {
    const article = make("article", "message");
    article.dataset.role = message.role;
    const header = make("div", "message-header");
    header.append(make("strong", undefined, message.role === "user" ? "You" : "Computer"));
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
  }
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
    state.statuses[event.properties.sessionID] = event.properties.status;
    if (event.properties.sessionID === selected && event.properties.status.type === "retry") {
      notice(`OpenCode is retrying. ${event.properties.status.message}`);
    }
    controls();
    if (event.properties.sessionID === selected && event.properties.status.type === "idle") void perform(loadHistory);
  } else if (event.type === "session.idle") {
    state.statuses[event.properties.sessionID] = { type: "idle" };
    controls();
    if (event.properties.sessionID === selected) void perform(loadHistory);
  } else if (event.type === "session.error") {
    if (!event.properties.sessionID || event.properties.sessionID === selected) {
      const message = errorMessage(event.properties.error);
      notice(message);
      if (voiceTurn) { voiceTurn = undefined; voice.speak(spokenSummary(message)); }
    }
  } else if (event.type.startsWith("permission.") || event.type.startsWith("question.") || ["session.created", "session.updated", "session.deleted"].includes(event.type)) {
    void perform(refreshState);
  }
}

async function refreshState() {
  const revision = selectionRevision;
  const next = await api<AppState>("state");
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

function closeMenu() {
  element("sidebar").classList.remove("open");
  element("menu").setAttribute("aria-expanded", "false");
}

async function selectConversation(id: string) {
  if (selected && id !== selected) { voiceTurn = undefined; voice.close(); }
  drafts.set(selected ?? "new", prompt.value);
  selected = id;
  selectionRevision++;
  historyRevision++;
  historyLoading = false;
  clearTimeout(historyTimer);
  messages = [];
  prompt.value = drafts.get(id) ?? "";
  notice();
  closeMenu();
  renderState();
  renderMessages();
  await loadHistory();
}

async function newConversation(title = "New conversation") {
  const conversation = await api<Conversation>("conversations", { title });
  if (state) state.conversations.unshift(conversation);
  await selectConversation(conversation.id);
  return conversation;
}

async function sendMessage(spokenText?: string) {
  if (submitting || busy() || !state || !connected || historyLoading) {
    if (spokenText) throw new Error("The spoken request was not sent. Wait for the current work or connection to finish.");
    return;
  }
  const text = (spokenText ?? prompt.value).trim();
  if (!text) return;
  const choice = state.models.find((choice) => modelValue(choice) === model.value);
  if (!choice) throw new Error("Connect GitHub Copilot and choose a model first.");
  const mode = agent.value;
  submitting = true;
  controls();
  notice();
  try {
    if (!selected) {
      await newConversation(text.slice(0, 60));
      prompt.value = text;
    }
    const id = selected!;
    if (spokenText) voiceTurn = { session: id, known: new Set(messages.map((message) => message.id)) };
    // Keep the draft until OpenCode confirms it accepted the message.
    drafts.set(id, text);
    await api(`conversations/${encodeURIComponent(id)}/send`, { text, ...choice, agent: mode });
    drafts.delete(id);
    prompt.value = "";
    await refreshState();
    await loadHistory();
  } catch (error) {
    if (spokenText) { voiceTurn = undefined; prompt.value = text; }
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
  if (!selected && state?.conversations[0]) await selectConversation(state.conversations[0].id);
  openEvents();
}

element("composer").addEventListener("submit", (event) => { event.preventDefault(); void perform(() => sendMessage()); });
prompt.addEventListener("input", () => { drafts.set(selected ?? "new", prompt.value); controls(); });
prompt.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void perform(() => sendMessage()); }
});
agent.addEventListener("change", controls);
element("new-conversation").addEventListener("click", () => { void perform(async () => { await newConversation(); prompt.focus(); }); });
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
element("retry").addEventListener("click", () => { void perform(boot); });
element("refresh-provider").addEventListener("click", () => {
  void perform(async () => {
    await api("refresh", {});
    await refreshState();
    openEvents();
  });
});
element("menu").addEventListener("click", () => {
  const open = element("sidebar").classList.toggle("open");
  element("menu").setAttribute("aria-expanded", String(open));
});
document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    element<HTMLDetailsElement>("typing").open = true;
    prompt.value = button.dataset.prompt ?? "";
    drafts.set(selected ?? "new", prompt.value);
    controls();
    prompt.focus();
  });
});
element("project-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const next = await api<AppState>("project", { path: element<HTMLInputElement>("project-path").value });
    voiceTurn = undefined;
    voice.close();
    events?.close();
    selected = undefined;
    selectionRevision++;
    historyRevision++;
    messages = [];
    prompt.value = "";
    state = next;
    element<HTMLDetailsElement>("project-details").open = false;
    renderState();
    renderMessages();
    if (next.conversations[0]) await selectConversation(next.conversations[0].id);
    openEvents();
  });
});
element("microphone").addEventListener("click", () => { void perform(async () => {
  if (voice.microphone) voice.microphoneOff();
  else await voice.activate();
}); });
element("stop-speaking").addEventListener("click", () => voice.stopSpeaking());
element("typing").addEventListener("toggle", () => {
  if (element<HTMLDetailsElement>("typing").open) voice.microphoneOff();
});
window.addEventListener("beforeunload", () => { events?.close(); voice.close(); });
void perform(boot);
