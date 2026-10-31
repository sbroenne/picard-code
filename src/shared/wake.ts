// Like the computer on the show, requests start with "Computer". Speech in the room that does
// not is never sent. A short filler before it ("OK", "hey") is allowed.
const WAKE = /^\s*(?:(?:ok|okay|hey|um+|uh+|er|oh|so|and)[\s,.!?;:-]+)?computer(?![\w'’-])[\s,.!?;:—–-]*/i;

/** The words after "Computer" when the speech is addressed to the computer, otherwise undefined. */
export function addressed(text: string) {
  const match = WAKE.exec(text);
  return match ? text.slice(match[0].length).trim() : undefined;
}

// Only a whole short utterance counts, so "stop the server from crashing" stays a request.
const STOP = new Set([
  "stop", "stop it", "stop that", "stop now", "stop work", "stop working", "stop the work",
  "cancel", "cancel it", "cancel that", "cancel work", "cancel the work", "cancel the request",
  "abort", "abort that", "halt", "belay that", "never mind", "nevermind", "forget it",
]);

// Like the ship's computer, there is one ongoing conversation until the captain starts afresh.
const FRESH = new Set([
  "new task", "a new task", "start a new task", "next task", "new conversation", "start a new conversation",
  "start over", "start again", "start fresh", "fresh start", "clear", "clear the screen",
]);

// Ends the current task and goes back to standing by, waiting for "Computer". Understood even
// without "Computer", so the captain can always dismiss the computer.
const STANDBY = new Set([
  "stop listening", "stop listening now", "stop listening for now", "stand by", "standby",
  "go to sleep", "sleep", "that's all", "that will be all", "that'll be all",
]);

// Switches the microphone off; clicking the console switches it on again.
const MUTE = new Set([
  "mute", "mute yourself", "microphone off", "turn the microphone off", "turn off the microphone",
]);

export type VoiceCommand = "stop" | "new" | "standby" | "mute";

/** A spoken command handled by Picard Code itself rather than sent to Copilot. */
export function voiceCommand(words: string): VoiceCommand | undefined {
  const plain = words.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z'\s]/g, " ")
    .replace(/\bplease\b/g, " ").replace(/\s+/g, " ").trim();
  return STOP.has(plain) ? "stop" : FRESH.has(plain) ? "new" : STANDBY.has(plain) ? "standby" : MUTE.has(plain) ? "mute" : undefined;
}
