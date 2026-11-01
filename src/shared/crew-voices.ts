import type { CrewID } from "./crew.js";

export interface KokoroChoice { voice: string; speed?: number }
export interface MaiChoice { voice: string; style?: string }
/** A first and second choice per speaking service; the second is used when the computer already speaks with the first. */
export type CrewVoices = Record<CrewID, { kokoro: [KokoroChoice, KokoroChoice]; mai: [MaiChoice, MaiChoice] }>;

/**
 * Ready-made voices chosen to sound closer to each actor; nothing is cloned or built from their recordings.
 * See docs/research/bridge-crew-voices.md for how they were measured and chosen.
 */
export const CREW_VOICES: CrewVoices = {
  "picard-riker": { kokoro: [{ voice: "am_michael" }, { voice: "am_onyx" }], mai: [{ voice: "en-US-Ethan" }, { voice: "en-GB-Harry" }] },
  "picard-data": { kokoro: [{ voice: "am_liam" }, { voice: "am_eric" }], mai: [{ voice: "en-US-Sage" }, { voice: "en-US-Grant" }] },
  "picard-geordi": { kokoro: [{ voice: "am_echo" }, { voice: "am_fenrir" }], mai: [{ voice: "en-US-Jasper" }, { voice: "en-US-Grant" }] },
  "picard-worf": { kokoro: [{ voice: "bm_lewis" }, { voice: "im_nicola" }], mai: [{ voice: "en-IN-Dhruv" }, { voice: "en-GB-Harry" }] },
  "picard-troi": { kokoro: [{ voice: "bf_alice" }, { voice: "if_sara" }], mai: [{ voice: "en-GB-Emily" }, { voice: "en-US-Iris" }] },
  "picard-crusher": { kokoro: [{ voice: "ff_siwis" }, { voice: "hf_beta" }], mai: [{ voice: "en-IN-Priya" }, { voice: "en-AU-Isla" }] },
};

export const DEFAULT_MAI_MODEL = "MAI-Voice-2.1-Flash";

export interface SpeakingVoice { name: string; style?: string; speed?: number }

/** A MAI voice without its model, such as en-GB-Emily from en-GB-Emily:MAI-Voice-2.1-Flash. */
const maiName = (voice: string) => voice.split(":")[0]!;

/**
 * The voice an officer speaks with on the chosen service. The officer never shares the computer's voice:
 * when the computer uses the officer's first choice, the second choice is used. MAI officers use the
 * same model as the computer's voice, so its cost and quality follow the owner's choice.
 */
export function crewVoice(officer: CrewID, speaking: "mai" | "kokoro", computer: { voice: string; kokoroVoice: string }): SpeakingVoice {
  const choices = CREW_VOICES[officer];
  if (speaking === "kokoro") {
    const choice = choices.kokoro[0].voice === computer.kokoroVoice ? choices.kokoro[1] : choices.kokoro[0];
    return { name: choice.voice, ...choice.speed === undefined ? {} : { speed: choice.speed } };
  }
  const choice = choices.mai[0].voice === maiName(computer.voice) ? choices.mai[1] : choices.mai[0];
  const model = computer.voice.split(":")[1] || DEFAULT_MAI_MODEL;
  return { name: `${choice.voice}:${model}`, style: choice.style ?? "neutral" };
}
