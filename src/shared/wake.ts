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

export type VoiceCommand = "stop";

/** A spoken command handled by Picard Code itself rather than sent to Copilot. */
export function voiceCommand(words: string): VoiceCommand | undefined {
  const plain = words.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z'\s]/g, " ")
    .replace(/\bplease\b/g, " ").replace(/\s+/g, " ").trim();
  return STOP.has(plain) ? "stop" : undefined;
}
