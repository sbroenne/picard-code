// Speech detector chances: a request starts above the first and continues above the second.
const SPEECH_STARTS = 0.5;
const SPEECH_CONTINUES = 0.35;
const CHECK_PAUSE = 200;
const THINKING_PAUSE = 3000;

/**
 * Tracks speech locally, asks for a completion check at a short pause, and gives
 * unfinished thoughts a longer pause. A click or cough is dropped. The original
 * one-minute limit still bounds the complete recording, including thinking pauses.
 */
export class Utterance {
  active = false;
  revision = 0;
  private run = 0;
  private voiced = 0;
  private silence = 0;
  private length = 0;
  private checked = false;
  private incomplete = false;
  reset() { this.revision++; this.active = false; this.run = 0; this.voiced = 0; this.silence = 0; this.length = 0; this.checked = false; this.incomplete = false; }
  /** A prediction belongs only to the uninterrupted pause that requested it. */
  finishCheck(revision: number, complete: boolean) {
    if (!this.active || !this.checked || revision !== this.revision || this.silence < CHECK_PAUSE) return false;
    if (!complete) {
      this.incomplete = true;
      if (this.silence < THINKING_PAUSE) return false;
    }
    this.reset();
    return true;
  }
  update(speech: number, milliseconds: number): "start" | "check" | "end" | "drop" | undefined {
    if (!this.active) {
      this.run = speech >= SPEECH_STARTS ? this.run + milliseconds : 0;
      if (this.run < 60) return undefined;
      this.active = true;
      this.voiced = this.length = this.run;
      this.silence = 0;
      return "start";
    }
    this.length += milliseconds;
    if (speech >= SPEECH_CONTINUES) {
      if (this.silence) this.revision++;
      this.voiced += milliseconds;
      this.silence = 0;
      this.checked = this.incomplete = false;
    }
    else this.silence += milliseconds;
    if (this.voiced >= 150 && this.length < 60_000) {
      if (this.silence >= THINKING_PAUSE && this.incomplete) { this.reset(); return "end"; }
      if (this.silence >= CHECK_PAUSE && !this.checked) { this.checked = true; return "check"; }
      return undefined;
    }
    if (this.silence < 900 && this.length < 60_000) return undefined;
    const result = this.voiced >= 150 ? "end" : "drop";
    this.reset();
    return result;
  }
}
