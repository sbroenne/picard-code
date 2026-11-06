import "./style.css";
import type { AppState, BrowserEvent, ChatMessage, Conversation, FormField, FormRequest, FormValue, ModelChoice, PermissionRequest, SpeechSettings, SpeechSetupProgress } from "../src/shared/types";
import { errorMessage } from "../src/shared/messages";
import { replyFailed, spokenSummary } from "../src/shared/speech";
import { spokenParts, type SpokenPart } from "../src/shared/briefing";
import { logEntryTitle } from "../src/shared/log-title";
import { canAskAloud, matchSpokenAnswer, spokenField, spokenQuestion } from "../src/shared/questions";
import { addressed, changedSpeed, isSpeedCommand, SPEAKING_SPEEDS, type SpeedCommand, voiceCommand } from "../src/shared/wake";
import { VoiceConversation, type FollowOn } from "./voice";
import { renderMarkdown } from "./markdown";
import { markMedia, reconcile, ReplyPlayers } from "./media";
import { formatStardate, stardateGroup } from "../src/shared/stardate";
import { TRIBUTE_ENTRIES, type TributeEntry } from "../src/shared/tribute-data";
import { TributeCycle, tributeMode, declinedReply, storyOfferAllowed, storyAcceptance, explicitStorySubject, tributeQuestion, tributeSubject, randomIndex, storyInvitation, type ExecutionOutcome } from "../src/shared/tribute";
import { BRIDGE_CREW, crewMember, repeatsReport, type CrewID } from "../src/shared/crew";

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
/** How far the first-run start-up has come. Kept for this browser address, so a reload resumes it. */
type FirstRun = "started" | "listening" | "answered" | "done";
const FIRST_RUN_KEY = "picard-first-run";
let firstRun: FirstRun | undefined;
let firstRunChecked = false;
let selected: string | undefined;
let freshEntryStarted = Date.now();
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
const live = new Map<string, { sessionID: string; messageID: string; partType: "text" | "reasoning"; text: string; speaker?: CrewID; background?: boolean }>();
let voiceTurn: { session: string; known: Set<string>; answeredQuestions?: Set<string>; request: string; storyID?: string; outcome?: ExecutionOutcome; reference?: TributeEntry["source"] } | undefined;
/**
 * The voice leads: replies to a spoken request stay off screen until the voice starts saying them.
 * In a briefing, each officer's reply appears when that officer starts speaking (`shown`).
 * They appear at once when there is nothing to wait for: speech ended or failed, the work stopped
 * without a reply, a decision or question is waiting, or the log entry changed.
 */
let heldBack: {
  session: string; known: Set<string>; speaking: boolean; timer?: ReturnType<typeof setTimeout>;
  plan?: SpokenPart[]; voiced?: boolean; shown: Set<string>;
} | undefined;
// Longest wait for the voice to start before the reply is shown anyway.
const VOICE_LEAD_LIMIT = 20_000;
let tributeEnabled = true;
let bridgeEnabled = true;
let tributeCycle: TributeCycle;
let pendingStory: { session: string; storyID: string } | undefined;
let lastStoryID: string | undefined;
const tributeDisplay = new Map<string, { fact?: TributeEntry; factShownAt?: Date; invitation?: string; story?: TributeEntry; reference?: TributeEntry["source"] }>();
let spokenDecision = "";
let spokenQuestionID: string | undefined;
let spokenQuestionKey: string | undefined;
let spokenQuestionAnswers: Record<string, string> = {};
const renderedQuestionFields = new Map<string, ReturnType<typeof formField>[]>();
let answering = false;
// After "Computer" alone, the next words are taken as the request.
const GO_AHEAD = 8000;
let goAheadUntil = 0;
// "Computer" enables follow-ups without a prefix; stopping listening does not close the log entry.
let engagedWith: string | undefined;
let notSent = "";
/** The log entry waiting for the captain to confirm its deletion. */
let confirmingDelete: string | undefined;
const voice = new VoiceConversation({
  changed: voiceControls,
  error: (message) => { cancelTributeSpeech(); notice(message); },
  transcript: async (text, startedAt) => {
    try { await heard(text, startedAt); }
    catch (error) {
      const message = errorMessage(error);
      cancelTributeSpeech();
      notice(message);
      await voice.notSent();
      voice.speak(spokenSummary(message));
    }
  },
  canListen: () => !!state?.selectedModel && connected && state.speech?.setup?.state !== "running" && speechPreparation?.state !== "running",
  beforeSpeak: () => players.stop(),
  partStarted: (part) => revealSpoken(part),
});
const players = new ReplyPlayers({ paused: (value) => { if (value) cancelTributeSpeech(); voice.pauseForMedia(value); } });

function logEntryID(request: PermissionRequest | FormRequest) {
  return request.logEntryID ?? request.sessionID;
}

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
  if (isSpeedCommand(command)) {
    // "Computer" in an open log entry engages it, as a request would, so follow-ups need no "Computer".
    if (words !== undefined && selected) engagedWith = selected;
    changeSpeakingSpeed(command);
    return;
  }
  if (question) { await answerAloud(request); return; }
  if (!request) {
    goAheadUntil = Date.now() + GO_AHEAD;
    setTimeout(voiceControls, GO_AHEAD + 50);
    voice.chime();
    return;
  }
  // A finished reply is still being collected; wait briefly rather than refuse.
  for (let waited = 0; (submitting || historyLoading) && waited < 5000; waited += 100) await new Promise((done) => setTimeout(done, 100));
  const blocked = state?.permissions.some((item) => logEntryID(item) === selected) ? "A decision is needed first. Choose Allow once or Deny on screen."
    : pending() ? "Please answer the question on screen first."
    : busy() || submitting ? "Work is in progress. Say “Belay that” to cancel it." : undefined;
  // Room speech during a task is not answered aloud while the computer cannot take it; the sound marks it as not sent.
  if (blocked && words === undefined) { notSent = `Not sent: “${text}” ${blocked}`; await voice.notSent(); }
  else if (blocked) voice.speak(blocked);
  else {
    const invitation = pendingStory;
    const storyID = invitation && invitation.session === selected && storyAcceptance(request) ? invitation.storyID : undefined;
    cancelTributeSpeech();
    await sendMessage(text, storyID);
    engagedWith = selected;
  }
}

/** "Speak faster", "Speak slowest", "Normal speed" and the like change every later spoken reply, kept in this browser. */
function changeSpeakingSpeed(command: SpeedCommand) {
  const speed = changedSpeed(voice.speed, command);
  const quicker = command === "faster" || command === "fastest";
  if (speed === undefined) {
    voice.speak(quicker ? "This is already the fastest speaking speed." : "This is already the slowest speaking speed.");
    return;
  }
  voice.speed = speed;
  saveTributeValue("picard-speaking-speed", String(speed));
  voice.speak(speed === 1 ? "Normal speaking speed."
    : command === "fastest" ? "Speaking at the fastest speed." : command === "slowest" ? "Speaking at the slowest speed."
    : quicker ? "Speaking faster." : "Speaking slower.");
}

/** "Stop listening" waits for "Computer" again, keeping the log entry and any work under way. */
async function standBy() {
  cancelTributeSpeech();
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
  if (state?.permissions.some((item) => logEntryID(item) === selected)) voice.speak("A decision is needed first. Choose Allow once or Deny on screen.");
  else if (pending()) voice.speak("Please answer the question on screen first.");
  else if (busy() || submitting) voice.speak("Work is in progress. Say “Belay that” to cancel it first.");
  else { startFresh(); voice.speak("Standing by for a new log entry."); }
}

async function stopByVoice() {
  cancelTributeSpeech();
  if (!selected || !busy()) { voice.speak("No work is running."); return; }
  voiceTurn = undefined;
  await api(`conversations/${encodeURIComponent(selected)}/stop`, {});
  await refreshState();
  await loadHistory();
  voice.speak(busy() ? "Stop requested. The work is still finishing." : "Work stopped, Captain.");
}

/** The OpenCode form whose current question may be answered by voice. */
function askedQuestion() {
  if (!spokenQuestionID || answering || state?.permissions.some((item) => logEntryID(item) === selected)) return undefined;
  const waiting = state?.questions.filter((item) => logEntryID(item) === selected) ?? [];
  const request = waiting.length === 1 && waiting[0]!.id === spokenQuestionID ? waiting[0] : undefined;
  return request && canAskAloud(request) ? request : undefined;
}

async function answerAloud(text: string) {
  const request = askedQuestion();
  if (!request) throw new Error("The question is no longer waiting. Check the log entry on screen.");
  const field = request.fields.find((item) => item.key === spokenQuestionKey);
  if (field?.type !== "string") throw new Error("The question is no longer waiting. Check the log entry on screen.");
  const result = matchSpokenAnswer(field, text);
  if ("retry" in result) { voice.speak(result.retry); return; }
  renderedQuestionFields.get(request.id)?.find((item) => item.field.key === field.key)?.write?.(result.answer);
  const answer = { ...spokenQuestionAnswers, [field.key]: result.answer };
  const next = spokenField(request, answer);
  if (next) {
    spokenQuestionAnswers = answer;
    spokenQuestionKey = next.key;
    voice.speak([{ text: spokenQuestion(request, answer), speaker: request.officer }]);
    return;
  }
  await sendQuestionAnswer(request, answer);
  await refreshState();
}

async function sendQuestionAnswer(request: FormRequest, answer: Record<string, FormValue>) {
  answering = true;
  const turn = voiceTurn;
  try {
    // OpenCode can finish the question's step before resuming with the Captain's answer.
    const before = await api<ChatMessage[]>(`conversations/${encodeURIComponent(logEntryID(request))}/messages`);
    await api(`questions/${encodeURIComponent(request.id)}`, { answer });
    if (turn && voiceTurn === turn) {
      rememberQuestionReplies(turn, before);
      turn.outcome = undefined;
    }
    if (spokenQuestionID === request.id) {
      spokenQuestionID = undefined;
      voice.stopSpeaking();
    }
  } finally {
    answering = false;
    controls();
  }
}

function rememberQuestionReplies(turn: NonNullable<typeof voiceTurn>, list: ChatMessage[]) {
  turn.answeredQuestions ??= new Set();
  for (const message of list) {
    if (message.role === "assistant" && !message.background) turn.answeredQuestions.add(message.id);
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

/** The microphone is simply on, unless muted or changing settings. During start-up the Captain opens the channel. */
function autoListen() {
  if (voice.microphone || voice.opening || voice.failed || !state?.speech?.configured || !state.selectedModel || !connected
    || state.speech.setup?.state === "running" || speechPreparation?.state === "running" || muted() || openDrawer() === "settings"
    || !firstRunChecked || !firstRun || firstRun === "started") return;
  void perform(() => voice.activate());
}

type ConsoleActivity = "ready" | "work" | "speaking" | "attention" | "unavailable";

function channelStatus(): [string, string] {
  if (voice.opening) return ["Starting", "opening"];
  if (!voice.microphone) return ["Microphone off", "closed"];
  if (voice.mediaPaused || voice.waitingForClick) return ["Paused", "paused"];
  return ["Listening", "open"];
}

/** Activity and required decisions stay separate from the enabled microphone. */
function consoleStatus(): [string, string, ConsoleActivity] {
  if (!state) return ["Starting up", "", "unavailable"];
  if (!connected) return ["Reconnecting", "Keep Picard Code's terminal open.", "unavailable"];
  if (speechPreparation?.state === "running") return ["Preparing speech", speechPreparation.step, "work"];
  if (speechPreparation?.state === "failed" && !state.speech?.configured) return ["Speech unavailable", "Read the error above, then choose Try again.", "unavailable"];
  if (!state.models.length) return ["Setup needed", modelSetupPart() === "provider"
    ? "Connect an AI provider: open AI provider."
    : "No models are available. Open Computer intelligence to refresh the connection.", "attention"];
  if (!state.selectedModel) return ["Setup needed", "Open Computer intelligence, choose an AI model, and confirm your choice.", "attention"];
  const listening = voice.microphone && !voice.waitingForClick && !voice.mediaPaused;
  const speaking = voice.phase === "speaking" ? "The computer is speaking. " : "";
  if (state.permissions.some((item) => logEntryID(item) === selected)) return ["Decision needed", `${speaking}Choose Allow once or Deny on screen.`, "attention"];
  if (pending()) return ["Answer needed", `${speaking}${listening && !voice.speechPending && askedQuestion() ? "Say your answer, or choose it on screen." : "Answer the question on screen."}`, "attention"];
  // A browser sound pause stops the voice where it is; the replies still to come wait for it.
  if (voice.phase === "speaking" && voice.microphone && voice.waitingForClick) return ["Transmitting", "The browser paused sound. Click the microphone, or press M, to hear the rest.", "speaking"];
  if (voice.phase === "speaking") return ["Transmitting", `${speaking}${listening ? "Say “Computer” or click this panel to interrupt." : "Choose Stop speaking to interrupt."}`, "speaking"];
  const stopHint = !listening ? "Choose Belay that to cancel." : inTask() ? "Say “Belay that” to cancel." : "Say “Computer, belay that” to cancel.";
  const work = selected ? state.statuses[selected] : undefined;
  if (work?.type === "retry") return ["Accessing", `Retrying. ${work.message ? `${work.message} ` : ""}${stopHint}`, "work"];
  if (busy()) return ["Accessing", stopHint, "work"];
  if (voice.speechPending || !submitting && heldBack && heldBack.session === selected && !heldBack.voiced) return ["Accessing", "Preparing the spoken reply.", "work"];
  if (submitting) return ["Standing by", "Sending your request.", "ready"];
  if (historyLoading) return ["Loading", "", "unavailable"];
  if (voice.opening) return ["Not listening", "Starting the microphone. Allow access if your browser asks.", "unavailable"];
  if (voice.microphone && voice.waitingForClick) return ["Not listening", "The browser paused sound. Click the microphone, or press M.", "unavailable"];
  if (voice.mediaPaused && voice.microphone) return ["Not listening", "Pause the video or close its player to listen again.", "unavailable"];
  if (listening) return ["Standing by", voice.phase === "thinking" ? "Checking what you said."
    : Date.now() < goAheadUntil ? "Go ahead." : inTask() ? "Go ahead with the next request, or say “New log entry”." : "Say “Computer”, then your request.", "ready"];
  if (!state.speech?.configured) return ["Computer voice offline", "", "unavailable"];
  return ["Not listening", "The microphone is off. Click the microphone, or press M.", "unavailable"];
}

function voiceControls() {
  const ready = !!state?.speech?.configured && !!state.selectedModel && connected && speechPreparation?.state !== "running";
  const preparing = speechPreparation?.state === "running" || state?.speech?.setup?.state === "running";
  const offline = !!state && !state.speech?.configured;
  const step = wizardStep();
  // Before the channel opens, the start-up panel replaces the conversation.
  const startUp = !!step && step !== "online" && step !== "crew";
  const setupPanel = element("first-run-setup");
  setupPanel.hidden = !step;
  const problem = element("notice");
  if (startUp) {
    if (problem.parentElement !== setupPanel) setupPanel.insertBefore(problem, element("first-run-lead").nextSibling);
  } else if (problem.parentElement !== element("main")) element("main").insertBefore(problem, readingArea);
  const modelPanel = element("settings-model");
  const modelParent = step === "model" ? element("first-run-panel") : element("drawer-settings");
  if (modelPanel.parentElement !== modelParent) modelParent.append(modelPanel);
  if (step === "model") modelPanel.hidden = false;
  if (step) showWizard(step);
  element("setup").hidden = !!step || !state || !!state.models.length;
  element("voice-console").hidden = !state?.speech?.configured || preparing || startUp;
  const stop = element("stop");
  const workControls = element("setup-work-controls");
  const stopContainer = element("voice-console").hidden ? workControls : element("console-actions");
  if (stop.parentElement !== stopContainer) stopContainer.append(stop);
  workControls.hidden = !element("voice-console").hidden || !busy();
  element("speech-first-start").hidden = !!step || !state?.selectedModel || !offline || !!speechPreparation || preparing;
  element("speech-preparation").hidden = !speechPreparation || !!step;
  element("main").dataset.speechSetup = String(startUp || !step && (offline || !!speechPreparation || preparing));
  voiceBar(step);
  const skip = element<HTMLAnchorElement>("skip-to-computer");
  skip.href = startUp ? "#first-run-setup" : !step && (speechPreparation || preparing) ? "#speech-preparation" : !step && offline ? "#speech-first-start" : "#voice-console";
  skip.textContent = startUp ? "Skip to start-up" : !step && (offline || preparing) ? "Skip to speech setup" : "Skip to the computer status";
  const [status, detail, activity] = consoleStatus();
  const [channel, channelState] = channelStatus();
  if (element("status").textContent !== status) element("status").textContent = status;
  if (element("status-detail").textContent !== detail) element("status-detail").textContent = detail;
  if (element("voice-channel").textContent !== channel) element("voice-channel").textContent = channel;
  element("voice-channel").dataset.state = channelState;
  element("voice-console").dataset.activity = activity;
  const toggle = element<HTMLButtonElement>("listen-toggle");
  toggle.hidden = !state?.speech?.configured;
  const microphoneAction = voice.microphone ? voice.waitingForClick ? "Resume listening" : "Switch microphone off" : "Switch microphone on";
  toggle.setAttribute("aria-label", microphoneAction);
  toggle.title = `${microphoneAction} (M)`;
  toggle.toggleAttribute("data-on", voice.microphone);
  toggle.dataset.channel = channelState;
  toggle.disabled = voice.opening || !voice.microphone && !ready;
  // The microphone is the one control; draw the eye to it when a click lets the computer hear.
  toggle.toggleAttribute("data-act", !toggle.hidden && !toggle.disabled && (!voice.microphone || voice.waitingForClick));
  // Invite a request only when the computer can hear it; the console explains why not.
  element("welcome-title").hidden = channelState !== "open" && !!state?.speech?.configured;
  element("voice-console").dataset.phase = voice.microphone || voice.phase === "speaking" ? voice.phase : "off";
  if (voice.phase === "listening") notSent = "";
  element("voice-partial").textContent = voice.phase === "listening" || voice.phase === "thinking" ? voice.partial : notSent;
  element("voice-partial").classList.toggle("not-sent", voice.phase !== "listening" && voice.phase !== "thinking" && !!notSent);
  element<HTMLButtonElement>("prepare-computer").disabled = speechSetupWatching;
  element<HTMLButtonElement>("prepare-local-speech").disabled = speechSetupWatching;
  const cloudListening = state?.speech?.listening === "mai";
  const cloudSpeaking = state?.speech?.speaking !== "kokoro";
  element("speech-current").textContent = state?.speech?.configured
    ? `In use: ${cloudListening ? "Azure" : "this computer"} listens, ${cloudSpeaking ? "Azure" : "this computer"} speaks`
    : state?.speech?.error ?? "Speech is not set up yet";
  const azureInUse = !!state?.speech?.configured && (cloudListening || cloudSpeaking);
  element("local-speech-offer").textContent = azureInUse
    ? "Switch to this computer: Nemotron listens and Kokoro speaks, with no Azure account needed."
    : "Nemotron listens and Kokoro speaks on this computer. No Azure account is needed.";
  element("prepare-local-speech").textContent = azureInUse ? "Use this computer instead" : "Prepare the computer";
  element("stop-speaking").hidden = !voice.speechPending;
  checkHeldBack();
}

function isHeldBack(message: ChatMessage) {
  return !!heldBack && heldBack.session === selected && message.role === "assistant"
    && !heldBack.known.has(message.id) && !heldBack.shown.has(message.id);
}

/**
 * Shows each spoken reply as its voice starts. Replies that are not spoken, such as the
 * computer's "The reports are on screen.", appear with the last part.
 */
function revealSpoken(part: SpokenPart) {
  const plan = heldBack?.plan;
  const at = plan?.indexOf(part) ?? -1;
  if (!heldBack || heldBack.session !== selected || at < 0) return;
  heldBack.voiced = true;
  clearTimeout(heldBack.timer);
  heldBack.timer = undefined;
  if (at === plan!.length - 1) { releaseHeldBack(); return; }
  for (const started of plan!.slice(0, at + 1)) if (started.message) heldBack.shown.add(started.message);
  scheduleRender();
  renderWorking();
}

function releaseHeldBack() {
  if (!heldBack) return;
  clearTimeout(heldBack.timer);
  heldBack = undefined;
  scheduleRender();
  renderWorking();
}

function checkHeldBack() {
  if (!heldBack) return;
  // A reply with several parts appears part by part (`revealSpoken`), not all at once when the voice starts.
  const spoken = heldBack.speaking && (!voice.speechPending || voice.phase === "speaking" && (heldBack.plan?.length ?? 0) < 2);
  const done = heldBack.session !== selected || !voice.connected || !voice.microphone || pending()
    || (heldBack.speaking ? spoken : !voiceTurn && !submitting);
  if (done) releaseHeldBack();
  // Finished work whose reply is never spoken must still appear.
  else if (!heldBack.timer && !heldBack.voiced && !busy() && !submitting) heldBack.timer = setTimeout(releaseHeldBack, VOICE_LEAD_LIMIT);
}

/** Called just before a held-back reply is spoken; the text appears when the voice starts. */
function speakHeldBack(plan: SpokenPart[]) {
  if (!heldBack) return;
  heldBack.speaking = true;
  heldBack.plan = plan;
  clearTimeout(heldBack.timer);
  heldBack.timer = setTimeout(releaseHeldBack, VOICE_LEAD_LIMIT);
}

function completeVoiceReply() {
  if (!voiceTurn || voiceTurn.session !== selected || busy() || pending() || submitting || answering || historyLoading || historyDue) return;
  const reply = messages.findLast((message) => message.role === "assistant" && !message.background && !voiceTurn!.known.has(message.id)
    && (!voiceTurn!.answeredQuestions?.has(message.id) || failedReport(message)))
    ?? messages.findLast((message) => message.background && failedReport(message) && !voiceTurn!.known.has(message.id));
  if (!reply) return;
  const outcome = reply.outcome ?? voiceTurn.outcome;
  if (!outcome) return;
  const turn = voiceTurn;
  voiceTurn = undefined;
  const failed = failedReport(reply);
  const successful = outcome === "succeeded" && !failed && !declinedReply(reply);
  const at = messages.indexOf(reply);
  const failures = officerFailures(messages, at, turn.known);
  const failedSources = new Set(failures.map((message) => message.sourceSessionID ?? message.id));
  const reports = reply.background ? [] : reportsAround(messages, at)
    .filter((message) => !turn.known.has(message.id) && !failedSources.has(message.sourceSessionID ?? message.id));
  const repeated = repeatsOfficer(messages, at, reports);
  const reportCopy = repeated ? reports.find((report) => repeatsReport(written(reply), written(report), crewMember(report.speaker)!.name)) : undefined;
  // Keep tribute records with the visible answer when the computer's repeated report is hidden.
  const answer = !failed && reports.length === 1 && (!written(reply).trim() || repeated) ? reports[0]! : reply;
  const plan = spokenParts(reply, answer, successful ? reports : [], { failed: failures, repeated }).filter((part) => part.text.trim());
  if (failed && heldBack) { releaseHeldBack(); renderMessages(); }
  else speakHeldBack(plan);
  const key = `${turn.session}:${(reportCopy ?? answer).id}`;
  const display: { fact?: TributeEntry; factShownAt?: Date; invitation?: string; story?: TributeEntry; reference?: TributeEntry["source"] } = {};
  if (successful && turn.reference) display.reference = turn.reference;
  if (successful && turn.storyID) display.story = TRIBUTE_ENTRIES.find((entry) => entry.id === turn.storyID);
  let tail: FollowOn | undefined;
  const stillCurrent = () => tributeEnabled && selected === turn.session && !busy() && !pending()
    && !submitting && connected && !muted() && !openDrawer() && !voice.failed;
  if (successful && tributeEnabled && !turn.storyID && storyOfferAllowed(turn.request)) {
    const subject = tributeSubject(turn.request);
    const stories = TRIBUTE_ENTRIES.filter((entry) => entry.story && entry.subject === subject && entry.id !== lastStoryID);
    if (!stories.length) { notice(`No reviewed ${subject} stories are available.`); }
    else {
      const story = stories[randomIndex(stories.length, Math.random)]!;
      display.invitation = storyInvitation(story.subject);
      tail = { text: display.invitation, valid: stillCurrent, started: () => {
        pendingStory = { session: turn.session, storyID: story.id };
        lastStoryID = story.id;
      } };
    }
  }
  const fact = tributeCycle.completed({ id: key, outcome, reply, blocked: !!pending(), explicit: !!turn.storyID || tributeQuestion(turn.request) });
  if (successful && firstRun === "listening") {
    // The first order was answered: introduce the senior officers, if they are aboard.
    const crewAboard = !!state?.crew.available && bridgeEnabled;
    setFirstRun(crewAboard ? "answered" : "done");
    if (crewAboard && !tail) tail = { text: "Your senior officers are standing by.", valid: () => selected === turn.session && firstRun === "answered" && connected && !voice.failed, started: () => undefined };
  }
  if (fact) {
    display.fact = fact;
    display.factShownAt = new Date();
    saveTributeValue("picard-tribute-seen", JSON.stringify(tributeCycle.seenIDs));
  }
  if (display.fact || display.invitation || display.story || display.reference) {
    tributeDisplay.set(key, display);
    scheduleRender();
  }
  voice.speak(plan, failed, tail);
}

/** Failed assignments called for this request, after any recovery in the same assignment. */
function officerFailures(list: ChatMessage[], index: number, known: Set<string>) {
  const start = list.findLastIndex((message, at) => at < index && message.role === "user");
  const next = list.findIndex((message, at) => at > index && message.role === "user");
  const latest = new Map<string, ChatMessage>();
  for (const message of list.slice(start + 1, next < 0 ? undefined : next)) {
    if (message.background && !known.has(message.id) && crewMember(message.speaker)) latest.set(message.sourceSessionID ?? message.id, message);
  }
  return [...latest.values()].filter(failedReport);
}

function cancelTributeSpeech() {
  pendingStory = undefined;
  voice.cancelFollowOn();
}

function tributeStorageError(message: string) {
  element("tribute-storage-error").hidden = false;
  element("tribute-storage-error").textContent = message;
}
function saveTributeValue(key: string, value: string) {
  try { localStorage.setItem(key, value); }
  catch { tributeStorageError("Preferences could not be saved in this browser. They apply only until this page closes."); }
}
function readTributeValue(key: string) {
  try { return localStorage.getItem(key); }
  catch { tributeStorageError("Preferences could not be read in this browser. This page uses the default choices."); return null; }
}
function readTributeBoolean(key: string, fallback: boolean) {
  const value = readTributeValue(key);
  if (value === null) return fallback;
  if (value === "true" || value === "false") return value === "true";
  tributeStorageError("A saved preference was invalid and has been reset to its default.");
  saveTributeValue(key, String(fallback));
  return fallback;
}
function tributeControls() {
  element<HTMLInputElement>("tribute-toggle").checked = tributeEnabled;
  element("tribute-toggle-state").textContent = tributeEnabled ? "On" : "Off";
}
function bridgeControls() {
  element<HTMLInputElement>("bridge-toggle").checked = bridgeEnabled;
  element("bridge-toggle-state").textContent = bridgeEnabled ? "On" : "Off";
}
function loadTribute() {
  tributeEnabled = readTributeBoolean("picard-tribute-enabled", true);
  bridgeEnabled = readTributeBoolean("picard-bridge-enabled", true);
  const speed = Number(readTributeValue("picard-speaking-speed") ?? 1);
  voice.speed = SPEAKING_SPEEDS.includes(speed as typeof SPEAKING_SPEEDS[number]) ? speed : 1;
  bridgeControls();
  let seen: string[] = [];
  const saved = readTributeValue("picard-tribute-seen");
  if (saved !== null) {
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) throw new Error("Invalid seen facts.");
      seen = parsed;
    } catch {
      tributeStorageError("The saved list of tribute facts was invalid and has been reset.");
      saveTributeValue("picard-tribute-seen", "[]");
    }
  }
  tributeCycle = new TributeCycle(TRIBUTE_ENTRIES, seen);
  tributeCycle.setEnabled(tributeEnabled);
  tributeControls();
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
  const text = element("notice-text");
  if (!message) text.replaceChildren();
  else if (![...text.children].some((item) => item.textContent === message)) {
    text.append(make("p", undefined, message));
  }
  element("notice").hidden = !text.childElementCount;
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
  return !!selected && (state?.permissions.some((item) => logEntryID(item) === selected) || state?.questions.some((item) => logEntryID(item) === selected));
}

function readout(name: string, value: string) {
  const node = element(`readout-${name}`);
  node.textContent = value;
  node.title = value;
}

/** The side panel's readouts show what the computer is connected to right now. */
function readouts() {
  readout("provider", !state ? "Checking" : !connected ? "Reconnecting" : state.hasConnectedProvider ? "Connected"
    : state.models.length ? "OpenCode models" : "Offline");
  readout("project", state ? state.project.split(/[\\/]/).filter(Boolean).at(-1) ?? state.project : "—");
  readout("model", !state ? "—" : state.selectedModel?.name ?? (state.savedModel ? "Unavailable" : "Offline"));
  const speech = state?.speech;
  const setup = speechPreparation ?? speech?.setup;
  readout("speech", !state ? "—" : setup?.state === "running" ? "Preparing" : !speech?.configured ? setup?.state === "failed" ? "Failed" : "Offline"
    : `${speech.listening === "mai" ? "Azure MAI" : "Nemotron"} · ${speech.speaking === "kokoro" ? "Kokoro" : "Azure MAI"}`);
}

let savingModel = false;
let refreshingProvider = false;
function modelSetupPart(current = state): "model" | "provider" {
  return current && !current.savedModel && !current.modelError && !current.hasConnectedProvider ? "provider" : "model";
}
function controls() {
  const working = busy() || submitting;
  const ready = !!state?.models.length && connected && !historyLoading;
  const activeWork = working || Object.keys(state?.statuses ?? {}).length > 0;
  model.disabled = !ready || activeWork || savingModel || refreshingProvider;
  const selectedModel = state?.selectedModel;
  const savedModel = state?.savedModel;
  const unchanged = !!selectedModel && model.value === modelValue(selectedModel);
  const confirm = element<HTMLButtonElement>("confirm-model");
  confirm.disabled = model.disabled || !model.value || unchanged;
  confirm.textContent = savingModel ? "Saving model" : wizardStep() === "model" ? "Confirm this model" : "Use this model";
  const unavailable = !!savedModel && !selectedModel;
  let guidance = "Choose the most capable AI model available for the best answers. It may cost more or take longer.";
  if (state?.modelError || unavailable) guidance = "Your saved choice is kept until you confirm a replacement.";
  else if (state && !state.models.length) guidance = "Check model availability in OpenCode before choosing an AI model.";
  else if (selectedModel) guidance = unchanged
    ? "This AI model is used for your requests and bridge crew reports."
    : "Use this model to save your new choice. Your saved model stays in use until then.";
  element("model-guidance").textContent = guidance;
  const problem = state?.modelError ?? (unavailable
    ? `The saved model ${savedModel.providerID} / ${savedModel.modelID} is unavailable. Refresh the connection or choose a replacement.`
    : state && !state.models.length ? state.hasConnectedProvider
      ? "No models are available. Check your models in OpenCode, then refresh the connection."
      : "No models are available. Connect an AI provider in OpenCode, then refresh the connection." : "");
  element("model-problem").textContent = problem;
  element("model-problem").hidden = !problem;
  element("refresh-model").hidden = !unavailable && !state?.modelError && !!state?.models.length;
  for (const id of ["refresh-provider", "refresh-model"]) {
    const refresh = element<HTMLButtonElement>(id);
    refresh.disabled = !state || !connected || activeWork || savingModel || refreshingProvider;
    refresh.textContent = refreshingProvider ? "Refreshing connection" : "Refresh connection";
  }
  const modelStatus = element("model-status");
  modelStatus.dataset.state = unavailable || state?.modelError ? "unavailable" : unchanged ? "saved" : "pending";
  modelStatus.textContent = savingModel ? "Saving your choice"
    : refreshingProvider ? "Refreshing connection"
    : state?.modelError ? "Model choice needs attention"
    : unavailable ? "Model unavailable"
    : state && !state.models.length ? "No models available"
    : unchanged ? `Model saved · ${selectedModel.provider}`
    : selectedModel ? `New choice not saved. ${selectedModel.name} is still in use.`
    : model.value ? "Awaiting confirmation" : "Awaiting your selection";
  if (!state?.selectedModel && (voice.microphone || voice.opening)) voice.microphoneOff();
  element("stop").hidden = !busy();
  element<HTMLButtonElement>("stop").disabled = submitting;
  element<HTMLButtonElement>("new-conversation").disabled = !state || submitting;
  element("setup").hidden = !state || !!state.models.length;
  element<HTMLAnchorElement>("open-model-setup").href = `#settings/${modelSetupPart()}`;
  element("welcome").hidden = !!wizardStep() || !!speechPreparation || !!messages.length || !!selected && historyLoading || !!state && (!state.models.length || !state.speech?.configured);
  const entryStarted = state?.conversations.find((entry) => entry.id === selected)?.created ?? freshEntryStarted;
  // Each log entry opens like a captain's log, with the stardate it was started.
  element("entry-stardate").textContent = `Captain’s log, stardate ${formatStardate(new Date(entryStarted))}`;
  element("entry-stardate").hidden = element("welcome").hidden && !element("messages").childElementCount;
  element("provider-status").textContent = refreshingProvider ? "Refreshing connection"
    : !state ? "Checking"
    : `${state.hasConnectedProvider ? "AI provider connection found" : "No connected AI providers found"}. ${state.models.length} model${state.models.length === 1 ? "" : "s"} available.`;
  element("provider-guidance").textContent = state?.hasConnectedProvider
    ? "Connect another AI provider in OpenCode, or refresh after changing a connection."
    : "Connect your preferred AI provider in OpenCode for the best Picard Code experience. Then choose its most capable model.";
  element("use-opencode-models").hidden = !state || state.hasConnectedProvider || !state.models.some((choice) => choice.providerID === "opencode");
  readouts();
  renderWorking();
  element("voice-console").dataset.working = String(working);
  voice.sync();
  autoListen();
  voiceControls();
  const setup = state?.speech?.setup;
  if (setup && !speechSetupWatching) {
    if (setup.state === "running") void followSpeechSetup(setup);
    else if (setup.state === "failed") showSpeechPreparation(setup);
  }
  startVoiceSystems();
}

let displayedModel: string | undefined;
function renderState() {
  if (!state) { controls(); return; }
  if (document.activeElement !== element("project-path")) element<HTMLInputElement>("project-path").value = state.project;
  element("workspace-caption").textContent = `OpenCode ${state.version} · ${state.project}`;
  const savedValue = state.selectedModel ? modelValue(state.selectedModel) : "";
  const currentModel = displayedModel === savedValue ? model.value : savedValue;
  displayedModel = savedValue;
  model.replaceChildren();
  const prompt = make("option", undefined, state.models.length ? "Choose an AI model" : "No models available");
  prompt.value = "";
  model.append(prompt);
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
  model.value = state.models.some((choice) => modelValue(choice) === currentModel) ? currentModel : "";
  const list = element("conversations");
  list.replaceChildren();
  if (confirmingDelete && !state.conversations.some((item) => item.id === confirmingDelete)) confirmingDelete = undefined;
  // The Captain's log is grouped by whole stardate, the latest first. Entries without a known start come last.
  const startedAt = (item: Conversation) => Number.isFinite(new Date(item.created).getTime()) ? new Date(item.created).getTime() : -Infinity;
  let logGroup: string | undefined;
  for (const item of [...state.conversations].sort((a, b) => startedAt(b) - startedAt(a) || 0)) {
    const heading = Number.isFinite(startedAt(item)) ? stardateGroup(new Date(item.created)) : "Stardate unknown";
    if (heading !== logGroup) { logGroup = heading; list.append(make("h3", "log-group", heading)); }
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
    if (state.permissions.some((request) => logEntryID(request) === item.id) || state.questions.some((request) => logEntryID(request) === item.id)) {
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
  const decision = state.permissions.find((item) => logEntryID(item) === selected)?.id
    ?? state.questions.find((item) => logEntryID(item) === selected)?.id;
  if (decision) cancelTributeSpeech();
  if (voiceTurn && decision && decision !== spokenDecision) {
    cancelTributeSpeech();
    spokenDecision = decision;
    const question = state.questions.find((item) => item.id === decision);
    const waiting = state.questions.filter((item) => logEntryID(item) === selected).length;
    if (!question) {
      voice.speak("Captain, approval is required. Review the requested action on screen, then choose Allow once or Deny.");
    } else if (!state.permissions.some((item) => logEntryID(item) === selected) && waiting === 1 && canAskAloud(question)) {
      spokenQuestionID = question.id;
      spokenQuestionAnswers = {};
      spokenQuestionKey = spokenField(question)?.key;
      voice.speak([{ text: spokenQuestion(question), speaker: question.officer }]);
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
  markMedia(node);
  container.append(node);
}

function renderMessages() {
  const nearBottom = readingArea.scrollHeight - readingArea.scrollTop - readingArea.clientHeight < 100;
  const container = element("messages");
  const wanted = document.createDocumentFragment();
  // The list is rebuilt on every update, so keyboard focus on a link or button inside it is put back afterwards.
  const focusable = () => [...container.querySelectorAll<HTMLElement>("a[href], button, summary")];
  const focused = focusable().indexOf(document.activeElement as HTMLElement);
  queueMicrotask(() => { if (focused >= 0 && document.activeElement === document.body) focusable()[focused]?.focus({ preventScroll: true }); });
  // The latest request and its reply fill the screen; earlier ones stay small above.
  const list = shown();
  const latest = list.findLastIndex((message) => message.role === "user");
  list.forEach((message, index) => {
    // A failed final action stays visible even when the officer wrote part of a report.
    const texts = message.parts.filter((part) => part.type === "text" && part.text.trim());
    const media = message.parts.filter((part) => part.type === "media");
    const failures = texts.length && !failedReport(message) ? [] : message.parts.filter((part) => part.type === "tool" && part.status === "error");
    if (message.role === "assistant" && !texts.length && !media.length && !failures.length && !message.error) return;
    if (isHeldBack(message)) return;
    if (!media.length && repeatsOfficer(list, index)) return;
    if (!texts.length && !media.length && !message.error && message.role === "assistant" && recovered(list, index)) {
      // A step that failed before the answer arrived stays readable, folded away, without looking like the answer failed.
      const previous = wanted.lastElementChild;
      const note = previous?.classList.contains("step-failures") ? previous as HTMLDetailsElement : make("details", "step-failures");
      if (note !== previous) { note.append(make("summary")); wanted.append(note); }
      for (const part of failures) note.append(make("p", "step-failure", part.text));
      const count = note.querySelectorAll(".step-failure").length;
      note.querySelector("summary")!.textContent = `${count} step${count === 1 ? "" : "s"} did not work`;
      return;
    }
    const article = make("article", `message ${message.background ? "crew-report " : ""}${index >= latest ? "current" : "earlier"}`);
    article.dataset.keep = message.id;
    article.dataset.messageId = message.id;
    article.dataset.sessionId = message.sourceSessionID ?? selected;
    article.dataset.role = message.role;
    const header = make("div", "message-header");
    const officer = message.role === "assistant" ? crewMember(message.speaker) : undefined;
    header.append(make("strong", undefined, message.role === "user" ? "Picard" : officer?.name ?? "Computer"));
    if (officer) {
      // Rank pips and the uniform colour of the officer's division.
      article.dataset.division = officer.division;
      header.append(rankPips(officer.rank));
    }
    if (message.background && !message.speaker) header.append(make("small", undefined, "Supporting report"));
    const copy = button("Copy", "copy-button", async () => {
      const current = shown().find((item) => item.id === message.id) ?? message;
      await navigator.clipboard.writeText(current.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
      copy.textContent = "Copied";
    });
    header.append(copy);
    article.append(header);
    for (const part of texts) {
      renderText(article, part.text, message.role);
      const textNode = article.lastElementChild as HTMLElement;
      textNode.dataset.keep = part.id;
      textNode.dataset.mediaReady = String(messages.find((item) => item.id === message.id)?.parts.some((item) => item.id === part.id && item.text === part.text) ?? false);
    }
    for (const part of media) {
      const item = make("span", "reply-media", part.text);
      item.dataset.mediaHref = part.href;
      item.dataset.mediaImage = String(part.mime?.startsWith("image/") ?? false);
      item.dataset.keep = part.id;
      item.dataset.mediaReady = "true";
      article.append(item);
    }
    for (const part of failures) article.append(make("p", "message-error", part.text));
    if (message.error) article.append(make("p", "message-error", message.error));
    // A real failure in the reply shows in a red alert frame; the exact error text stays as it is.
    // Work the Captain stopped is not a failure, so it stays unframed.
    if (failures.length || message.error && message.outcome !== "interrupted") {
      article.dataset.alert = "red";
      const label = make("span", "alert-label", "Red alert");
      label.setAttribute("aria-hidden", "true");
      header.insertBefore(label, copy);
    }
    const extra = tributeDisplay.get(`${selected}:${message.id}`);
    if (extra?.invitation && tributeEnabled) article.append(make("p", "tribute-invitation", extra.invitation));
    if (extra?.story) {
      const source = make("p", "tribute-source");
      source.append(tributeSource(extra.story));
      article.append(source);
    }
    if (extra?.reference) {
      const source = make("p", "wikipedia-source");
      source.append(sourceLink(extra.reference));
      article.append(source);
    }
    wanted.append(article);
    if (extra?.fact) {
      const fact = make("aside", "tribute-fact");
      const picard = extra.fact.subject === "Picard";
      fact.dataset.subject = picard ? "picard" : "stewart";
      const heading = make("div", "tribute-record-header");
      const title = make("div", "tribute-record-title");
      title.append(make("small", undefined, picard ? "Personnel file" : "All the world’s a stage"));
      const name = picard ? "Jean-Luc Picard" : "Sir Patrick Stewart";
      title.append(make("h3", undefined, name));
      fact.setAttribute("aria-label", name);
      heading.append(title);
      if (extra.factShownAt) heading.append(make("small", "tribute-stardate", `Stardate ${formatStardate(extra.factShownAt)}`));
      const bars = make("div", "tribute-record-bars");
      bars.setAttribute("aria-hidden", "true");
      bars.append(make("span"), make("span"), make("span"));
      const body = make("div", "tribute-record-body");
      body.append(make("p", undefined, extra.fact.text), tributeSource(extra.fact));
      fact.append(heading, bars, body);
      wanted.append(fact);
    }
  });
  reconcile(container, wanted);
  players.mount(container, state?.project ?? "");
  controls();
  if (nearBottom && element("main").dataset.speechSetup !== "true" && window.matchMedia("(min-width: 701px)").matches) readingArea.scrollTop = readingArea.scrollHeight;
}

const RANK_PIPS = { "Commander": "●●●", "Lieutenant Commander": "●●○", "Lieutenant": "●●" } as const;
function rankPips(rank: keyof typeof RANK_PIPS) {
  const pips = make("span", "rank");
  const marks = make("span", "rank-pips", RANK_PIPS[rank]);
  marks.setAttribute("aria-hidden", "true");
  pips.append(marks, make("span", "visually-hidden", rank));
  pips.title = rank;
  return pips;
}

function tributeSource(entry: TributeEntry) {
  return sourceLink(entry.source);
}

function sourceLink(source: TributeEntry["source"]) {
  const link = make("a", undefined, source.title);
  link.href = source.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => { renderScheduled = false; renderMessages(); });
}

async function answerRequest(container: HTMLElement, send: () => Promise<unknown>) {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  buttons.forEach((node) => { node.disabled = true; });
  try {
    await send();
    await refreshState();
  } finally {
    buttons.forEach((node) => { node.disabled = false; });
  }
}

/** A decision waiting for the Captain shows in a yellow alert frame. The label is decoration only. */
function yellowAlert() {
  const label = make("p", "alert-label", "Yellow alert");
  label.setAttribute("aria-hidden", "true");
  return label;
}

function permissionPanel(request: PermissionRequest) {
  const panel = make("section", "approval");
  panel.dataset.alert = "yellow";
  panel.append(yellowAlert(), make("h3", undefined, "Approval required."));
  if (request.officer) panel.append(make("p", "crew-request", `${crewMember(request.officer)!.name} needs your decision.`));
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
    button("Allow once", "peach-button", () => answerRequest(panel, () => api(`permissions/${encodeURIComponent(request.id)}`, { reply: "once" }))),
    button("Deny", "deny-button", () => answerRequest(panel, () => api(`permissions/${encodeURIComponent(request.id)}`, { reply: "reject" }))),
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
  let write: ((value: string) => void) | undefined;
  if (field.type === "string") {
    const options = field.options ?? [];
    const inputs = options.map((option) => choice("radio", option.value, option.label, option.description, option.value === field.default));
    const custom = !options.length || field.custom === true ? writeIn(options.length ? "Or write your answer" : "Your answer") : undefined;
    if (custom && !options.length && field.default) custom.value = field.default;
    if (custom && field.maxLength) custom.maxLength = Math.min(field.maxLength, 4096);
    read = () => custom?.value.trim() || inputs.find((input) => input.checked)?.value;
    write = (value) => {
      for (const input of inputs) input.checked = input.value === value;
      if (custom) custom.value = inputs.some((input) => input.checked) ? "" : value;
    };
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
  return { field, box, read, write };
}

function questionPanel(request: FormRequest) {
  const form = make("form", "approval");
  form.dataset.alert = "yellow";
  form.append(yellowAlert());
  form.append(make("h3", undefined, "Additional information required."));
  if (request.officer) form.append(make("p", "crew-request", `${crewMember(request.officer)!.name} asks:`));
  const fields = request.fields.filter((field) => !field.hidden).map((field, index) => formField(request, field, index));
  renderedQuestionFields.set(request.id, fields);
  if (spokenQuestionID === request.id) {
    for (const item of fields) {
      const answer = spokenQuestionAnswers[item.field.key];
      if (answer !== undefined) item.write?.(answer);
    }
  }
  const value = (key: string) => fields.find((item) => item.field.key === key)?.read();
  const visible = (field: FormField) => (field.when ?? []).every((rule) => rule.op === "eq" ? value(rule.key) === rule.value : value(rule.key) !== rule.value);
  const update = () => {
    for (const item of fields) {
      item.box.hidden = !visible(item.field);
      if (spokenQuestionID === request.id && Object.hasOwn(spokenQuestionAnswers, item.field.key)) {
        const given = item.read();
        if (typeof given === "string") spokenQuestionAnswers[item.field.key] = given;
        else spokenQuestionAnswers[item.field.key] = "";
      }
    }
  };
  for (const item of fields) form.append(item.box);
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  update();
  const actions = make("div", "approval-actions");
  const submit = make("button", "peach-button", "Send answer");
  submit.type = "submit";
  actions.append(submit, button("Skip question", "deny-button", () => answerRequest(form, () => api(`questions/${encodeURIComponent(request.id)}`, { skip: true }))));
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
      await answerRequest(form, () => sendQuestionAnswer(request, answer));
    });
  });
  return form;
}

function renderApprovals() {
  const permissions = state?.permissions.filter((request) => logEntryID(request) === selected) ?? [];
  const questions = state?.questions.filter((request) => logEntryID(request) === selected) ?? [];
  const key = `${selected}:${permissions.map((request) => request.id).join(",")}:${questions.map((request) => request.id).join(",")}`;
  if (key === approvalKey) return;
  approvalKey = key;
  renderedQuestionFields.clear();
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

function written(message: ChatMessage) {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function failedReport(message: ChatMessage) {
  return message.outcome === "failed" || message.outcome === "interrupted" || replyFailed(message);
}

/** The officers' reports made for the same request as the message at this position. */
function reportsAround(list: ChatMessage[], index: number) {
  const start = list.findLastIndex((message, at) => at < index && message.role === "user");
  const next = list.findIndex((message, at) => at > index && message.role === "user");
  return list.slice(start + 1, next < 0 ? undefined : next)
    .filter((message) => message.background && crewMember(message.speaker) && written(message).trim() && !failedReport(message));
}

/** A computer reply that only repeats an officer's report adds nothing; the report itself is the answer. */
function repeatsOfficer(list: ChatMessage[], index: number, reports?: ChatMessage[]) {
  const message = list[index]!;
  if (message.role !== "assistant" || message.background || message.speaker || failedReport(message) || !written(message).trim()) return false;
  return (reports ?? reportsAround(list, index)).some((report) => repeatsReport(written(message), written(report), crewMember(report.speaker)!.name));
}

/** A step failed, but the same request went on: a later reply has written text, or the work is still running. */
function recovered(list: ChatMessage[], index: number) {
  const next = list.findIndex((message, at) => at > index && message.role === "user");
  const rest = list.slice(index + 1, next < 0 ? undefined : next);
  return rest.some((message) => message.role === "assistant" && written(message).trim()) || next < 0 && busy();
}

const STEPS: Record<string, string> = {
  websearch: "Searching the web.",
  webfetch: "Reading a web page.",
  read: "Reading files.",
  grep: "Searching the project.",
  glob: "Searching the project.",
  list: "Searching the project.",
  edit: "Changing files.",
  write: "Changing files.",
  patch: "Changing files.",
  apply_patch: "Changing files.",
  shell: "Running a command.",
  bash: "Running a command.",
};

/** What the latest request is doing right now, when a running step says so. */
function currentStep() {
  const list = shown();
  const latest = list.findLastIndex((message) => message.role === "user");
  for (const message of list.slice(latest + 1).reverse()) {
    const step = message.parts.filter((item) => item.type === "tool" && (item.status === "running" || item.status === "pending"))
      .map((item) => STEPS[item.text.split("\n", 1)[0]!]).findLast(Boolean);
    if (step) return step;
  }
  return "";
}

function spokenList(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
}

/** A line at the end of the conversation while the server reports the request as running. */
function renderWorking() {
  checkHeldBack();
  const node = element("working");
  const status = selected ? state?.statuses[selected] : undefined;
  const preparing = !!heldBack && heldBack.session === selected && !heldBack.voiced;
  const show = !!state && (!!status || submitting || preparing) && !pending();
  node.hidden = !show;
  if (!show) return;
  // The scanning bar shows only while the server reports work running, not while sending or preparing speech.
  node.querySelector<HTMLElement>(".scan-bar")!.hidden = !status;
  const officers = [...new Set(state!.crew.activity
    .filter((item) => item.logEntryID === selected && item.officer)
    .map((item) => crewMember(item.officer)!.name))];
  const text = !status && !submitting ? "Preparing the reply."
    : !status ? "Sending your request."
    : status.type === "retry" ? `Retrying. ${status.message ?? ""}`.trim()
    : officers.length ? `${spokenList(officers)} ${officers.length === 1 ? "is" : "are"} working on it.`
    : "Working on it.";
  const step = status ? currentStep() : "";
  if (element("working-text").textContent !== text) element("working-text").textContent = text;
  if (element("working-step").textContent !== step) element("working-step").textContent = step;
}

/** The stored conversation with any reply text that is still being written. */
function shown(): ChatMessage[] {
  const pieces = [...live].filter(([, piece]) => piece.sessionID === selected);
  if (!pieces.length) return messages;
  const result = structuredClone(messages);
  for (const [id, piece] of pieces) {
    let message = result.find((item) => item.id === piece.messageID);
    if (!message) { message = { id: piece.messageID, role: "assistant", parts: [], speaker: piece.speaker, background: piece.background }; result.push(message); }
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
    const piece = live.get(event.partID) ?? { sessionID: event.sessionID, messageID: event.messageID, partType: event.partType, text: "", speaker: event.speaker, background: event.background };
    piece.text += event.delta;
    live.set(event.partID, piece);
    scheduleRender();
  } else if (event.type === "finished") {
    if (voiceTurn?.session === event.sessionID) {
      voiceTurn.outcome = event.outcome;
      if (event.outcome !== "succeeded") cancelTributeSpeech();
      scheduleHistory();
    }
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
    cancelTributeSpeech();
    notice(event.message);
    scheduleHistory();
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
  const lostModel = !!state?.selectedModel && !next.selectedModel;
  const finishedModelSetup = !!wizardStep() && !state?.selectedModel && !!next.selectedModel;
  const speechBecameReady = !state?.speech?.configured && !!next.speech?.configured;
  state = next;
  if (speechBecameReady && !speechSetupWatching) showSpeechPreparation();
  renderState();
  if (lostModel) location.hash = "settings/model";
  else if (finishedModelSetup) location.hash = "";
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
    if (voiceTurn?.session === id && state?.questions.some((request) => logEntryID(request) === id)) {
      const questionAt = loaded.findLastIndex((message) => !message.background
        && message.parts.some((part) => part.type === "tool" && part.text.startsWith("question\n")));
      if (questionAt >= 0) rememberQuestionReplies(voiceTurn, loaded.slice(0, questionAt + 1));
    }
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

/** A quiet reopen keeps the current connection readout until the server reports it. */
function openEvents(quiet = false) {
  const firstConnection = !events;
  events?.close();
  if (!quiet) connected = false;
  // Keep start-up errors on the first connection, and existing errors on a quiet reconnect.
  let keepNotice = quiet || firstConnection;
  events = new EventSource("/api/events");
  events.addEventListener("message", (message: MessageEvent<string>) => {
    void perform(async () => {
      const data = JSON.parse(message.data) as BrowserEvent;
      if (data.type === "connection") {
        connected = data.connected;
        if (!connected) cancelTributeSpeech();
        if (data.message) notice(data.message);
        if (connected) {
          if (!keepNotice) notice();
          keepNotice = false;
          await refreshState();
          await loadHistory();
        }
        controls();
      } else handleEvent(data);
    });
  });
  events.addEventListener("error", () => {
    keepNotice = false;
    cancelTributeSpeech();
    connected = false;
    controls();
    notice("The live connection stopped. Keep Picard Code's terminal open; the browser will reconnect.");
  });
}

async function selectConversation(id: string, keepNotice = false) {
  players.stop();
  cancelTributeSpeech();
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
  if (!keepNotice) notice();
  if (openDrawer() === "records") closeDrawer();
  renderState();
  renderMessages();
  await loadHistory();
}

/** Clears the screen for a new task. The next request starts a new log, named after that request. */
function startFresh() {
  players.stop();
  freshEntryStarted = Date.now();
  cancelTributeSpeech();
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

async function sendMessage(spoken: string, requestedStoryID?: string) {
  if (submitting || busy() || !state || !connected || historyLoading) throw new Error("The spoken request was not sent. Wait for the current work or connection to finish.");
  const text = spoken.trim();
  if (!text) return;
  const choice = state.selectedModel;
  if (!choice) throw new Error("Open Computer intelligence and confirm a model before sending a request.");
  if (firstRun === "answered") setFirstRun("done");
  submitting = true;
  controls();
  notice();
  try {
    if (!selected) await newConversation(logEntryTitle(text));
    const id = selected!;
    const subject = explicitStorySubject(text);
    const stories = TRIBUTE_ENTRIES.filter((entry) => entry.story && entry.subject === subject);
    if (!requestedStoryID && subject && !stories.length) throw new Error(`No reviewed ${subject} stories are available.`);
    const storyID = requestedStoryID ?? (subject ? stories[randomIndex(stories.length, Math.random)]!.id : undefined);
    voiceTurn = { session: id, known: new Set(messages.map((message) => message.id)), request: text, storyID };
    releaseHeldBack();
    if (voice.connected) heldBack = { session: id, known: voiceTurn.known, speaking: false, shown: new Set() };
    const accepted = await api<{ accepted: boolean; reference?: TributeEntry["source"] }>(`conversations/${encodeURIComponent(id)}/send`, { text, ...choice, bridge: bridgeEnabled, speed: voice.speed, tribute: { mode: tributeMode(tributeEnabled), ...(storyID ? { storyID } : {}) } });
    if (voiceTurn) voiceTurn.reference = accepted.reference;
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
  voice.arrive();
  await refreshState();
  // Anyone who already chose a model has been aboard before; the start-up is only for a first run.
  if (state && !firstRun && (state.savedModel || state.modelError)) setFirstRun("done");
  firstRunChecked = !!state;
  if (state && !state.selectedModel && !wizardStep()) location.hash = `settings/${modelSetupPart()}`;
  controls();
  if (!selected && state?.conversations[0]) await selectConversation(state.conversations[0].id, true);
  openEvents();
}

const speechFields = ["listening", "speaking", "subscription", "resourceGroup", "resourceName", "region", "deployment"] as const;
function speechInput(name: typeof speechFields[number]) { return element<HTMLInputElement | HTMLSelectElement>(`setting-${name}`); }
let localFiles = { nemotron: false, kokoro: false };
function speechFieldVisibility() {
  const listening = speechInput("listening").value;
  const azureListening = listening === "mai";
  const azureSpeaking = speechInput("speaking").value === "mai";
  element("azure-fields").hidden = !azureListening && !azureSpeaking;
  const missingListener = !azureListening && !localFiles.nemotron;
  const missingSpeaker = !azureSpeaking && !localFiles.kokoro;
  const megabytes = (missingListener ? 710 : 0) + (missingSpeaker ? 354 : 0);
  element("local-note").hidden = !megabytes;
  element("local-note").textContent = `The selected speech services need a one-time model and runtime download of about ${megabytes >= 1000 ? `${(megabytes / 1000).toFixed(2)} GB` : `${megabytes} MB`}, plus Python packages if needed. Save and apply starts it. Nothing changes until the new services work.`;
  const show = (selector: string, visible: boolean) => document.querySelectorAll<HTMLElement>(selector).forEach((node) => { node.hidden = !visible; });
  show(".azure-listening", azureListening);
}
type SavedSpeech = { settings: SpeechSettings; file: string; localReady: boolean; localFiles: typeof localFiles; speech: AppState["speech"] };
type SpeechSetup = SpeechSetupProgress & { result?: SavedSpeech };
function showSpeechSettings(result: { settings: SpeechSettings; file: string; localFiles: typeof localFiles }) {
  localFiles = result.localFiles;
  for (const name of speechFields) speechInput(name).value = result.settings[name];
  element("settings-file").textContent = `Saved in ${result.file}`;
  element<HTMLDetailsElement>("advanced-speech").open = location.hash.endsWith("/advanced") || result.settings.listening === "mai" || result.settings.speaking === "mai";
  speechFieldVisibility();
}

let speechPreparation: SpeechSetupProgress | undefined;
let speechSetupWatching = false;
let lastSpeechChoice: SpeechSettings | Record<string, string> | undefined;

function showSpeechPreparation(progress?: SpeechSetupProgress) {
  speechPreparation = progress;
  if (state?.speech) state.speech.setup = progress;
  const panel = element("speech-preparation");
  panel.hidden = !progress;
  if (!progress) return;
  element("welcome").hidden = true;
  const failed = progress.state === "failed";
  panel.dataset.state = progress.state;
  element("speech-preparation-title").textContent = failed ? "Speech preparation stopped" : "Preparing the computer";
  element("speech-preparation-step").textContent = progress.step;
  const indicator = element("speech-preparation-progress");
  indicator.hidden = failed;
  indicator.setAttribute("aria-valuetext", progress.step);
  element("speech-preparation-error").hidden = !failed;
  element("speech-preparation-error").textContent = progress.error ?? "";
  element("retry-speech-setup").hidden = !failed;
  readouts();
  voiceControls();
}

async function followSpeechSetup(pending: SpeechSetup | Promise<SavedSpeech | SpeechSetup>) {
  speechSetupWatching = true;
  const save = element<HTMLButtonElement>("save-speech");
  save.disabled = true;
  const result = element("speech-result");
  try {
    showSpeechPreparation({ state: "running", step: "Starting the selected speech services" });
    let saved = await pending;
    while ("state" in saved) {
      showSpeechPreparation(saved);
      if (saved.state === "failed") throw new Error(saved.error ?? "The local speech setup stopped.");
      if (saved.state === "done" && saved.result) { saved = saved.result; break; }
      if (saved.state !== "running") throw new Error("The local speech setup did not return its result. Try again.");
      result.textContent = saved.step;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      saved = await api<SpeechSetup>("speech-setup");
    }
    showSpeechSettings(saved);
    if (state) state.speech = saved.speech;
    showSpeechPreparation();
    result.textContent = "Speech settings saved and in use";
    notice();
  } catch (error) {
    showSpeechPreparation({ state: "failed", step: speechPreparation?.step ?? "Preparing local speech", error: errorMessage(error) });
    result.textContent = "Speech preparation stopped. See the error on screen.";
  } finally {
    speechSetupWatching = false;
    save.disabled = false;
    controls();
  }
}

function prepareSelectedSpeech(data: SpeechSettings | Record<string, string>) {
  lastSpeechChoice = data;
  voice.close();
  closeDrawer();
  return followSpeechSetup(api<SavedSpeech | SpeechSetup>("settings", data));
}

for (const id of ["prepare-computer", "prepare-local-speech"]) {
  element(id).addEventListener("click", () => {
    void perform(async () => {
      if (speechSetupWatching) return;
      speechSetupWatching = true;
      voiceControls();
      try {
        const saved = await api<SavedSpeech>("settings");
        await prepareSelectedSpeech({ ...saved.settings, listening: "nemotron", speaking: "kokoro" });
      } finally {
        speechSetupWatching = false;
        voiceControls();
      }
    });
  });
}

const drawers = ["records", "settings"] as const;
type Drawer = typeof drawers[number];
type WizardStep = "welcome" | "provider" | "model" | "comms" | "online" | "crew";
function setFirstRun(value: FirstRun) {
  firstRun = value;
  saveTributeValue(FIRST_RUN_KEY, value);
}
function loadFirstRun() {
  const saved = readTributeValue(FIRST_RUN_KEY);
  firstRun = saved === "started" || saved === "listening" || saved === "answered" || saved === "done" ? saved : undefined;
}
/** The first-run step on screen, or nothing once the ship is fully online. */
function wizardStep(): WizardStep | undefined {
  if (!state || !firstRunChecked || firstRun === "done" || state.modelError) return;
  if (!firstRun) return "welcome";
  if (!state.selectedModel) {
    // A saved model that has gone missing is recovered in the side panel.
    if (state.savedModel) return;
    const [view, part] = location.hash.slice(1).split("/");
    if (view === "settings") return part === "provider" || part === "model" ? part : undefined;
    return modelSetupPart();
  }
  return firstRun === "started" ? "comms" : firstRun === "listening" ? "online" : "crew";
}
function openDrawer(): Drawer | undefined {
  const name = location.hash.slice(1).split("/")[0] ?? "";
  const step = wizardStep();
  if (name === "settings" && (step === "provider" || step === "model")) return;
  return (drawers as readonly string[]).includes(name) ? name as Drawer : undefined;
}
function closeDrawer() {
  if (openDrawer()) location.hash = "";
}

const CREW_ROSTER: Record<string, [colour: string, order: string]> = {
  Riker: ["orange", "Number One, what are our options?"],
  Data: ["peach", "Mr. Data, look into this error."],
  Geordi: ["tan", "Geordi, fix the failing test."],
  Worf: ["red", "Mr. Worf, is this safe?"],
  Troi: ["lilac", "Counselor, reword this message."],
  Crusher: ["blue", "Doctor, check the error handling."],
};
function crewRoster() {
  const roster = element("crew-roster");
  for (const officer of BRIDGE_CREW) {
    const [colour, order] = CREW_ROSTER[officer.name] ?? ["peach", ""];
    const card = make("li");
    card.style.setProperty("--officer", `var(--${colour})`);
    card.append(make("b", undefined, officer.name), make("span", undefined, `${officer.duty}.`));
    if (order) card.append(make("q", undefined, `“${order}”`));
    roster.append(card);
  }
}

function shipSystem(name: "core" | "intelligence" | "comms", online: boolean, current: boolean, detail = "") {
  const tile = document.querySelector<HTMLElement>(`#ship-systems [data-system="${name}"]`)!;
  tile.dataset.state = online ? "online" : "offline";
  if (current) tile.setAttribute("aria-current", "step");
  else tile.removeAttribute("aria-current");
  element(`system-${name}`).textContent = `${online ? "Online" : "Offline"}${detail}`;
}

let shownStep: WizardStep | undefined;
function showWizard(step: WizardStep) {
  if (!state) return;
  const panel = element("first-run-setup");
  panel.dataset.step = step;
  // The crew roster follows the first answer; every other step leads the screen.
  if (step === "crew") { if (panel.nextElementSibling !== element("working")) readingArea.insertBefore(panel, element("working")); }
  else if (panel.nextElementSibling !== element("voice-bar")) readingArea.insertBefore(panel, element("voice-bar"));
  const signedIn = state.hasConnectedProvider;
  const openCodeDefault = signedIn && !state.selectedModel ? state.defaultModel : undefined;
  const core = signedIn || !!state.selectedModel;
  const intelligence = !!state.selectedModel || step === "welcome" && !!openCodeDefault;
  const comms = firstRun === "listening" || firstRun === "answered";
  shipSystem("core", core, step === "provider", step === "welcome" && signedIn ? " · your OpenCode sign-in" : "");
  shipSystem("intelligence", intelligence, step === "model", step === "welcome" && openCodeDefault ? ` · ${openCodeDefault.name}, your OpenCode default` : "");
  shipSystem("comms", comms, step === "comms");
  const remaining = [core, intelligence, comms].filter((online) => !online).length;
  const listensHere = state.speech?.listening !== "mai";
  const [title, lead] = ({
    welcome: ["Welcome aboard, Captain.", `The ship is on standby. ${signedIn ? openCodeDefault ? "Your OpenCode sign-in and default AI model are already in use. " : "Your OpenCode sign-in is already in use. " : ""}${["", "One system remains", "Two systems remain", "Three systems must come online"][remaining]} before the computer can take your orders.`],
    provider: ["Computer core offline", "The computer core draws its power from your own AI account, such as GitHub Copilot, Anthropic or OpenAI. Report to Main Engineering (your computer's terminal) and give this order to grant OpenCode access to it."],
    model: ["Computer intelligence", !signedIn
      ? "Select one of OpenCode's free models to power the computer. Sign in under AI provider at any time for more capable models."
      : state.defaultModel ? `Select the AI model that powers the computer. Your OpenCode default is ${state.defaultModel.name}. The most capable model gives the best answers.`
      : "OpenCode has no default AI model set, so select the one that powers the computer. The most capable model gives the best answers."],
    comms: ["Open a channel", "The computer must be able to hear you. Your browser may ask to use the microphone; choose Allow."],
    online: ["All systems online", "Say “Computer”, then give your order."],
    crew: ["Senior officers reporting", "The computer answers by default. Address an officer by name for their judgment, or ask for “Options” to hold a briefing."],
  } satisfies Record<WizardStep, [string, string]>)[step];
  element("first-run-title").textContent = title;
  element("first-run-lead").textContent = lead;
  element("welcome-note").hidden = step !== "welcome" || remaining !== 1;
  element("use-free-models").hidden = signedIn || !state.models.some((choice) => choice.providerID === "opencode");
  element("channel-note").textContent = `${listensHere ? "All listening happens on this computer." : "Listening uses your Azure speech resource."} Close the channel at any time with the microphone button or the M key.`;
  const channel = element<HTMLButtonElement>("open-channel");
  channel.disabled = !state.speech?.configured || !connected || voice.opening;
  element("open-channel-hint").textContent = voice.opening ? "Opening the channel"
    : !state.speech?.configured ? "Available once voice systems are online."
    : voice.failed ? "To allow the microphone, use the site settings next to the address bar, then choose Open a channel again." : "";
  element<HTMLButtonElement>("begin-startup").disabled = savingModel;
  if (step !== shownStep) {
    shownStep = step;
    if (!openDrawer()) panel.focus();
  }
}

/** When the Captain returns from signing in at the terminal, look for the new sign-in without being asked.
 * Only on return: each check reloads OpenCode and reconnects every open page. */
let checkingSignIn = false;
async function checkSignIn() {
  if (checkingSignIn || refreshingProvider || document.hidden || !connected || wizardStep() !== "provider") return;
  checkingSignIn = true;
  // Closing the live connection first keeps the planned reconnect from looking like a failure.
  events?.close();
  try {
    await api("refresh", {});
    await refreshState();
    notice();
    // Opened from the AI provider tile: once signed in, move on to the model choice.
    if (state?.hasConnectedProvider && location.hash === "#settings/provider") location.hash = "settings/model";
  } finally {
    checkingSignIn = false;
    openEvents(true);
  }
}
for (const name of ["focus", "visibilitychange"] as const) {
  (name === "focus" ? window : document).addEventListener(name, () => { void perform(checkSignIn); });
}

/** Voice systems start on their own during start-up; the bar below the panel reports each real step. */
let voiceBarState = "";
function voiceBar(step: WizardStep | undefined) {
  const bar = element("voice-bar");
  const speech = state?.speech;
  const setup = speechPreparation ?? speech?.setup;
  // A replacement being prepared, or its failure, stays in view even while the previous services still work.
  const changing = setup?.state === "running" || setup?.state === "failed";
  bar.hidden = !step || !speech || (step === "online" || step === "crew") && !!speech.configured && !changing;
  if (bar.hidden || !speech) return;
  const [barState, text] = setup?.state === "running" ? ["running", `Initializing voice systems · ${setup.step}`]
    : setup?.state === "failed" ? ["failed", `Voice systems offline: ${setup.error ?? setup.step}`]
    : speech.configured ? ["online", "Voice systems online"]
    : speechSetupWatching ? ["running", "Initializing voice systems"]
    : ["offline", `Voice systems offline${speech.error ? `: ${speech.error}` : "."}`];
  bar.dataset.state = barState;
  element("voice-bar-text").textContent = text;
  element("voice-bar-retry").hidden = barState !== "failed";
  element("voice-bar-settings").hidden = barState !== "offline";
  if (barState !== voiceBarState) {
    voiceBarState = barState;
    element("voice-bar-announce").textContent = barState === "running" ? "Initializing voice systems" : text;
  }
}

let voiceStartTried = false;
function startVoiceSystems() {
  const speech = state?.speech;
  if (voiceStartTried || !wizardStep() || !speech || speech.configured || speech.error || speech.setup || speechPreparation || speechSetupWatching
    || speech.listening !== "nemotron" || speech.speaking !== "kokoro") return;
  voiceStartTried = true;
  speechSetupWatching = true;
  voiceControls();
  void perform(async () => {
    try {
      const current = await api<SpeechSetup | { state: "none" }>("speech-setup");
      if (current.state !== "none") { await followSpeechSetup(current); return; }
      const saved = await api<SavedSpeech>("settings");
      lastSpeechChoice = { ...saved.settings, listening: "nemotron", speaking: "kokoro" };
      await followSpeechSetup(api<SavedSpeech | SpeechSetup>("settings", lastSpeechChoice));
    } finally { speechSetupWatching = false; voiceControls(); }
  });
}

// Each part of Ship's systems carries a short panel code, as on an LCARS console. The codes are decoration only.
const settingsParts = { provider: ["Connect your AI provider", "orange", "SYS 01"], model: ["Computer intelligence", "blue", "SYS 02"], project: ["Project folder", "tan", "SYS 03"], voice: ["Speech", "lilac", "SYS 04"], about: ["About", "red", "SYS 05"] } as const;
type SettingsPart = keyof typeof settingsParts;
/** Each side panel tile opens its own part, for example #settings/voice. Without one, open what still needs doing. */
function showSettingsPart(requested?: string) {
  const part = requested && requested in settingsParts ? requested as SettingsPart
    : !state?.selectedModel ? modelSetupPart() : "voice";
  for (const name of Object.keys(settingsParts) as SettingsPart[]) element(`settings-${name}`).hidden = name !== part;
  const [title, colour, code] = settingsParts[part];
  element("settings-title").textContent = title;
  element("settings-code").textContent = code;
  element("settings-bar").className = `drawer-bar ${colour}`;
}

let settingsLoaded = false;
async function route() {
  cancelTributeSpeech();
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
  if (open === "settings" && (voice.microphone || voice.opening)) voice.microphoneOff();
  controls();
  if (open !== "settings") {
    if (!open && wizardStep()) element("first-run-setup").focus();
    return;
  }
  showSettingsPart(location.hash.split("/")[1]);
  if (location.hash.endsWith("/advanced")) element<HTMLDetailsElement>("advanced-speech").open = true;
  if (!settingsLoaded) {
    settingsLoaded = true;
    try { showSpeechSettings(await api("settings")); }
    catch (error) { settingsLoaded = false; throw error; }
  }
}

model.addEventListener("change", controls);
element("model-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    if (savingModel || state?.selectedModel && model.value === modelValue(state.selectedModel)) return;
    const choice = state?.models.find((choice) => modelValue(choice) === model.value);
    if (!choice) throw new Error("Choose an available model before confirming.");
    savingModel = true;
    const startUp = !!wizardStep();
    controls();
    try {
      state = await api<AppState>("model", choice);
      renderState();
      notice();
      location.hash = startUp || state.speech?.configured ? "" : "settings/voice";
    } finally { savingModel = false; controls(); }
  });
});
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
  void perform(() => prepareSelectedSpeech(Object.fromEntries(speechFields.map((name) => [name, speechInput(name).value.trim()]))));
});
element("retry-speech-setup").addEventListener("click", retrySpeechSetup);
element("voice-bar-retry").addEventListener("click", retrySpeechSetup);
function retrySpeechSetup() {
  void perform(async () => {
    if (speechSetupWatching) return;
    speechSetupWatching = true;
    try {
      const setup = await api<SpeechSetup | { state: "none" }>("speech-setup");
      if (setup.state === "running") await followSpeechSetup(setup);
      else if (setup.state === "failed" && !lastSpeechChoice) {
        voice.close();
        closeDrawer();
        await followSpeechSetup(api<SpeechSetup>("speech-setup", {}));
      }
      else await prepareSelectedSpeech(lastSpeechChoice ?? (await api<SavedSpeech>("settings")).settings);
    } finally { speechSetupWatching = false; voiceControls(); }
  });
}
element("begin-startup").addEventListener("click", () => { void perform(async () => {
  if (!state || savingModel) return;
  // With an OpenCode sign-in and default model, choosing Begin start-up confirms that model.
  const openCodeDefault = state.hasConnectedProvider && !state.selectedModel ? state.defaultModel : undefined;
  if (openCodeDefault) {
    savingModel = true;
    controls();
    try { state = await api<AppState>("model", openCodeDefault); }
    finally { savingModel = false; controls(); }
  }
  setFirstRun("started");
  notice();
  if (location.hash) location.hash = "";
  renderState();
}); });
element("open-channel").addEventListener("click", () => { void perform(startListening); });
element("dismiss-crew").addEventListener("click", () => {
  setFirstRun("done");
  controls();
  element("voice-console").focus();
});
element("stop").addEventListener("click", () => {
  void perform(async () => {
    if (!selected) return;
    cancelTributeSpeech();
    voiceTurn = undefined;
    voice.stopSpeaking();
    await api(`conversations/${encodeURIComponent(selected)}/stop`, {});
    await refreshState();
    await loadHistory();
    voice.resume();
  });
});
element("retry").addEventListener("click", () => { void perform(async () => { await route(); await boot(); await route(); }); });
async function refreshProvider() {
  if (refreshingProvider) return;
  refreshingProvider = true;
  controls();
  try {
    await api("refresh", {});
    await refreshState();
    notice();
    if (!state?.selectedModel) location.hash = `settings/${modelSetupPart()}`;
    openEvents();
  } finally { refreshingProvider = false; controls(); }
}
for (const id of ["refresh-provider", "refresh-model"]) {
  element(id).addEventListener("click", () => { void perform(refreshProvider); });
}
for (const [buttonID, commandID, resultID] of [["copy-provider-command", "provider-command", "provider-copy-result"], ["copy-wizard-command", "wizard-command", "wizard-copy-result"]]) {
  element(buttonID!).addEventListener("click", () => { void perform(async () => {
    const copy = element<HTMLButtonElement>(buttonID!);
    if (copy.disabled) return;
    copy.disabled = true;
    element(resultID!).textContent = "";
    try {
      if (!navigator.clipboard) throw new Error("The browser cannot copy the command. Select and copy it from the screen.");
      await navigator.clipboard.writeText(element(commandID!).innerText);
      element(resultID!).textContent = buttonID === "copy-wizard-command" ? "Order copied" : "Command copied";
      notice();
    } finally { copy.disabled = false; }
  }); });
}
element("project-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    cancelTributeSpeech();
    const next = await api<AppState>("project", { path: element<HTMLInputElement>("project-path").value });
    players.stop();
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
    location.hash = !next.selectedModel ? `settings/${modelSetupPart(next)}` : "";
    renderState();
    renderMessages();
    if (next.conversations[0]) await selectConversation(next.conversations[0].id);
    openEvents();
  });
});
function muteMicrophone() {
  cancelTributeSpeech();
  setMuted(true);
  voice.microphoneOff();
  controls();
}
async function startListening() {
  if (!state?.speech?.configured || !state.selectedModel || !connected || openDrawer() === "settings") return;
  setMuted(false);
  await voice.activate();
  if (firstRun === "started" && voice.microphone) {
    setFirstRun("listening");
    voice.speak("All systems online. Say “Computer”, then give your order.");
  }
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
  if (voice.microphone && voice.waitingForClick) voice.unlock();
  else if (voice.microphone) muteMicrophone();
  else if (!voice.opening) void perform(startListening);
}
function microphoneShortcut(event: KeyboardEvent) {
  const target = event.target;
  return event.key.toLowerCase() === "m" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
    && !openDrawer() && !(target instanceof Element && target.closest("input, textarea, select, [contenteditable]"));
}
element("listen-toggle").addEventListener("click", toggleMicrophone);
document.addEventListener("keydown", (event) => {
  if (!microphoneShortcut(event)) return;
  event.preventDefault();
  toggleMicrophone();
});
element("stop-speaking").addEventListener("click", () => { cancelTributeSpeech(); voice.stopSpeaking(); });
element("voice-console").addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("button, a") || !voice.speechPending) return;
  cancelTributeSpeech();
  voice.stopSpeaking();
});
element("tribute-toggle").addEventListener("change", () => {
  tributeEnabled = element<HTMLInputElement>("tribute-toggle").checked;
  saveTributeValue("picard-tribute-enabled", String(tributeEnabled));
  tributeCycle.setEnabled(tributeEnabled);
  if (!tributeEnabled) cancelTributeSpeech();
  tributeControls();
  element("tribute-status").textContent = tributeEnabled ? "Tribute is on." : "Tribute is off.";
  scheduleRender();
});
element("bridge-toggle").addEventListener("change", () => {
  bridgeEnabled = element<HTMLInputElement>("bridge-toggle").checked;
  saveTributeValue("picard-bridge-enabled", String(bridgeEnabled));
  bridgeControls();
  element("bridge-status").textContent = bridgeEnabled ? "The Bridge crew is on." : "The Bridge crew is off. The computer answers every request.";
});
for (const name of ["pointerdown", "keydown"] as const) document.addEventListener(name, (event) => {
  // Let the microphone control see the paused state before resuming audio, or the same gesture can switch it off.
  if (event.target instanceof Element && event.target.closest("#listen-toggle")
    || event instanceof KeyboardEvent && microphoneShortcut(event)) return;
  voice.unlock();
}, true);
window.addEventListener("beforeunload", () => { players.stop(); events?.close(); voice.close(); });
// Another open page may move the start-up on; follow it rather than repeating a step.
window.addEventListener("storage", (event) => { if (event.key === FIRST_RUN_KEY) { loadFirstRun(); controls(); } });
loadTribute();
loadFirstRun();
crewRoster();
void perform(async () => { await route(); await boot(); await route(); });
