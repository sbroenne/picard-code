import type { CrewID } from "./crew.js";

export type CrewVoices = Record<CrewID, { kokoro: string; mai: string }>;

export const COMPUTER_VOICES = { kokoro: "af_alloy", mai: "en-US-Iris:MAI-Voice-2.1-Flash" } as const;

/**
 * Ready-made voices chosen to sound closer to each actor; nothing is cloned or built from their recordings.
 * See docs/research/bridge-crew-voices.md for how they were measured and chosen.
 */
export const CREW_VOICES: CrewVoices = {
  "picard-riker": { kokoro: "am_michael", mai: "en-US-Ethan" },
  "picard-data": { kokoro: "am_liam", mai: "en-US-Sage" },
  "picard-geordi": { kokoro: "am_echo", mai: "en-US-Jasper" },
  "picard-worf": { kokoro: "bm_lewis", mai: "en-GB-Harry" },
  "picard-troi": { kokoro: "bf_alice", mai: "en-GB-Emily" },
  "picard-crusher": { kokoro: "af_nova", mai: "en-AU-Isla" },
};

export const DEFAULT_MAI_MODEL = "MAI-Voice-2.1-Flash";

export interface SpeakingVoice { name: string; style?: string }

export function crewVoice(officer: CrewID, speaking: "mai" | "kokoro"): SpeakingVoice {
  const voice = CREW_VOICES[officer][speaking];
  return speaking === "kokoro" ? { name: voice } : { name: `${voice}:${DEFAULT_MAI_MODEL}`, style: "neutral" };
}
