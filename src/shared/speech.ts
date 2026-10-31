export type VoicePhase = "off" | "listening" | "thinking" | "speaking";

export type SpeechEvent =
  | { type: "state"; phase: VoicePhase }
  | { type: "partial"; text: string }
  | { type: "transcript"; text: string }
  | { type: "audio-start"; rate: number; id: number }
  | { type: "audio-end"; id: number }
  | { type: "error"; message: string };

export class EndOfSpeech {
  private voiced = 0;
  private silence = 0;
  reset() { this.voiced = 0; this.silence = 0; }
  update(level: number, milliseconds: number) {
    if (level >= 0.012) { this.voiced += milliseconds; this.silence = 0; }
    else if (this.voiced) this.silence += milliseconds;
    if (this.voiced >= 120 && this.silence >= 900) {
      this.reset();
      return true;
    }
    return false;
  }
}

export function spokenSummary(text: string) {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#]/g, "").trim();
  if (!prose) return "The result is on screen.";
  const paragraph = prose.split(/\n\s*\n/)[0]!.replace(/\s+/g, " ").trim();
  if (paragraph.length <= 700) return paragraph;
  const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  let result = "";
  for (const sentence of sentences) {
    if ((result + sentence).length > 600) break;
    result += sentence;
  }
  return result.trim()
    ? `${result.trim()} The full result is on screen.`
    : "The reply needs a detailed explanation. Please read the result on screen.";
}
