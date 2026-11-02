import type { CrewID } from "../shared/crew.js";
import type { SpeakingVoice } from "../shared/crew-voices.js";

export interface SpeechInput {
  // One channel of signed, little-endian 16-bit audio at 16,000 samples/second.
  write(audio: Uint8Array): void;
  commit(): void;
  close(): void;
}
export interface SpeechCallbacks {
  partial(text: string): void;
  final(text: string): void;
  error(message: string): void;
}
export interface SpeechListener {
  listen(callbacks: SpeechCallbacks, signal: AbortSignal): Promise<SpeechInput>;
}
export interface SpeechSpeaker {
  // Stream one channel of 16-bit little-endian audio at 24,000 samples/second.
  // Without a voice, the computer's configured voice speaks.
  speak(text: string, signal: AbortSignal, voice?: SpeakingVoice): AsyncIterable<Uint8Array>;
}
export interface SpeechSelection {
  listening: "mai" | "whisper" | "nemotron";
  speaking: "mai" | "kokoro";
}
export interface SpeechService extends SpeechListener, SpeechSpeaker {
  selection?: SpeechSelection;
  /** The voice an officer speaks with on this service. */
  officerVoice?(officer: CrewID): SpeakingVoice;
  close?(): Promise<void>;
}
