// Like the computer on the show, requests start with "Computer". Speech in the room that does
// not is never sent. A short filler before it ("OK", "hey") is allowed.
const WAKE = /^\s*(?:(?:ok|okay|hey|um+|uh+|er|oh|so|and)[\s,.!?;:-]+)?computer(?![\w'’-])[\s,.!?;:—–-]*/i;

/** The words after "Computer" when the speech is addressed to the computer, otherwise undefined. */
export function addressed(text: string) {
  const match = WAKE.exec(text);
  return match ? text.slice(match[0].length).trim() : undefined;
}

/** Ignore room speech and words that may be echo from the answer still playing. */
export function interruptsSpeech(text: string, spoken: string) {
  const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const heard = plain(text);
  return addressed(text) !== undefined && !!heard && !(` ${plain(spoken)} `).includes(` ${heard} `);
}

// Only a whole short utterance counts, so "stop the server from crashing" stays a request.
const STOP = new Set([
  "stop", "stop it", "stop that", "stop now", "stop work", "stop working", "stop the work",
  "cancel", "cancel it", "cancel that", "cancel work", "cancel the work", "cancel the request",
  "abort", "abort that", "halt", "belay that", "belay", "belay it", "never mind", "nevermind", "forget it",
  // Speech recognition often hears the unusual word "belay" as "delay".
  "delay that",
]);

// Like the ship's computer, there is one ongoing conversation until the captain starts afresh.
const FRESH = new Set([
  "new log entry", "a new log entry", "begin a new log entry", "begin new log entry", "start a new log entry", "new log", "begin log entry",
  "new starlog entry", "start a new starlog entry", "new star log entry", "start a new star log entry",
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

// Changes how fast the computer and officers speak, in small steps.
const FASTER = new Set(["speak faster", "talk faster", "faster", "speak more quickly", "speak quicker", "talk quicker", "speed up"]);
const SLOWER = new Set(["speak slower", "talk slower", "slower", "slow down", "speak more slowly", "talk more slowly"]);
const FASTEST = new Set(["speak fastest", "talk fastest", "fastest", "fastest speed", "speak as fast as you can", "maximum speed"]);
const SLOWEST = new Set(["speak slowest", "talk slowest", "slowest", "slowest speed", "speak as slowly as you can", "minimum speed"]);
const NORMAL_SPEED = new Set(["normal speed", "speak normally", "talk normally", "normal speaking speed", "speak at normal speed", "speak at your normal speed"]);

export type VoiceCommand = "stop" | "new" | "standby" | "mute" | "faster" | "slower" | "fastest" | "slowest" | "normal-speed";
export type SpeedCommand = Extract<VoiceCommand, "faster" | "slower" | "fastest" | "slowest" | "normal-speed">;

/** A spoken command handled by Picard Code itself rather than sent to Copilot. */
export function voiceCommand(words: string): VoiceCommand | undefined {
  const plain = words.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z'\s]/g, " ")
    .replace(/\bplease\b/g, " ").replace(/\s+/g, " ").trim();
  return STOP.has(plain) ? "stop" : FRESH.has(plain) ? "new" : STANDBY.has(plain) ? "standby" : MUTE.has(plain) ? "mute"
    : FASTER.has(plain) ? "faster" : SLOWER.has(plain) ? "slower"
    : FASTEST.has(plain) ? "fastest" : SLOWEST.has(plain) ? "slowest" : NORMAL_SPEED.has(plain) ? "normal-speed" : undefined;
}

export function isSpeedCommand(command: VoiceCommand | undefined): command is SpeedCommand {
  return command === "faster" || command === "slower" || command === "fastest" || command === "slowest" || command === "normal-speed";
}

/** Speaking speeds, as a multiple of normal; both Kokoro and Azure accept this range. */
export const SPEAKING_SPEEDS = [0.8, 0.9, 1, 1.1, 1.2] as const;

/** The next speaking speed, or undefined when it is already the fastest or slowest. */
export function changedSpeed(current: number, command: SpeedCommand) {
  if (command === "normal-speed") return 1;
  if (command === "fastest" || command === "slowest") {
    const end = command === "fastest" ? SPEAKING_SPEEDS.at(-1)! : SPEAKING_SPEEDS[0];
    return current === end ? undefined : end;
  }
  const index = SPEAKING_SPEEDS.indexOf(current as typeof SPEAKING_SPEEDS[number]);
  const at = index < 0 ? SPEAKING_SPEEDS.indexOf(1) : index;
  return SPEAKING_SPEEDS[command === "faster" ? at + 1 : at - 1];
}
