import type { SpeechEvent } from "../src/shared/speech";
import { Utterance } from "../src/shared/utterance";
import { SPEECH_FRAME, SpeechFrames, type SpeechDetector } from "../src/shared/speech-detector";
import { loadSpeechDetector } from "./speech-detector";
import { interruptsSpeech } from "../src/shared/wake";
import type { SpokenPart } from "../src/shared/briefing";

/** One stretch of a spoken reply; an officer's part is spoken in that officer's own voice. */
export type { SpokenPart };

type Cue = "startup" | "request-accepted" | "input-failed" | "request-failed";
// The downloaded recordings differ in loudness; these keep each one quiet.
const CUE_VOLUME: Record<Cue, number> = { startup: 0.15, "request-accepted": 1, "input-failed": 0.5, "request-failed": 0.08 };

/** "standby" listens on this computer only; "listening" sends one utterance to the listening service. */
export type ConsolePhase = "off" | "standby" | "listening" | "thinking" | "speaking";
export interface FollowOn { text: string; valid(): boolean; started?(): void }

async function microphoneFailure(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const constraint = error instanceof Error && "constraint" in error && typeof error.constraint === "string" && error.constraint
    ? ` Requested setting: ${error.constraint}.` : "";
  let help = "Check that a microphone is connected and allowed in your browser and computer settings, then try again.";
  if (name === "NotFoundError") {
    help = "No microphone is available to this browser. Connect a microphone or headset, check your computer's input settings, then try again.";
  } else if (name === "NotAllowedError" || name === "SecurityError") {
    help = "Microphone access was denied. Allow it in the site settings next to the address bar and in your computer's privacy settings, then try again.";
  } else if (name === "NotReadableError") {
    help = "The browser could not open the microphone. Check your input device and close other apps that may be using it, then try again.";
  } else if (name === "OverconstrainedError") {
    help = "The browser could not use the requested microphone settings. Check the input device in your browser and computer settings, then try again.";
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Some browsers hide devices before permission; this is not proof that no hardware is connected.
      if (!devices.some((device) => device.kind === "audioinput")) {
        help = "The browser cannot see a microphone. Connect a microphone or headset and allow microphone access in your browser and computer settings, then try again.";
      }
    } catch (deviceError) {
      help += ` The microphone device list could not be read: ${deviceError instanceof Error ? deviceError.message : String(deviceError)}`;
    }
  }
  return `${help} Browser error: ${detail}${constraint}`;
}

export class VoiceConversation {
  microphone = false;
  phase: ConsolePhase = "off";
  partial = "";
  speechPending = false;
  /** True while the browser waits for a click or key press before it may use sound. */
  waitingForClick = false;
  opening = false;
  /** True after listening stopped because of an error; it then starts again only when asked. */
  failed = false;
  listeningError = "";
  mediaPaused = false;
  private speechRevision = 0;
  private followOn?: FollowOn;
  private optionalSpeech = false;
  private socket?: WebSocket;
  private media?: MediaStream;
  private context?: AudioContext;
  private capture?: AudioWorkletNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextAudio = 0;
  private receivingAudio = false;
  private audioStarted = false;
  // The parts of the reply being spoken, and the one whose audio arrives next.
  private parts: SpokenPart[] = [];
  private nextPart?: SpokenPart;
  // Waits that follow the audio clock: part starts and the end of playback.
  private audioTimers = new Set<ReturnType<typeof setTimeout>>();
  private utterance = new Utterance();
  private detector?: SpeechDetector;
  private frames = new SpeechFrames();
  // Detector results arrive a moment later; this keeps them in order and drops them after a reset.
  private detection = Promise.resolve();
  private detectionRevision = 0;
  private turnCheckID = 0;
  private turnCheck?: { id: number; revision: number; sent: boolean };
  // The last half second before speech starts, so the first word is not cut off.
  private preRoll: ArrayBuffer[] = [];
  // Audio held while the listening service opens; undefined once it is open.
  private queue?: ArrayBuffer[];
  private listenID = 0;
  private endedEarly = false;
  private startedAt = 0;
  // From the end of an utterance until its words have been handled.
  private handling = false;
  private recording = false;
  private interruption = false;
  private spoken = "";
  private revision = 0;
  private cues = new Map<Cue, Promise<AudioBuffer | undefined>>();
  private cueSource?: AudioBufferSourceNode;
  private cueEnded = 0;
  private startupPending = true;
  private startupReady = false;
  /** How fast replies are spoken, as a multiple of normal. */
  speed = 1;

  constructor(private hooks: {
    changed(): void;
    error(message: string): void;
    /** Words heard in one utterance, with the time it started. Resolves when they have been handled. */
    transcript(text: string, startedAt: number): Promise<void>;
    canListen(): boolean;
    beforeSpeak?(): void;
    /** A part of the reply passed to `speak` is now audible. */
    partStarted?(part: SpokenPart): void;
  }) {}

  /** True while the voice connection is open, so replies can be spoken. */
  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private command(data: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("The voice connection stopped. Click the microphone button to listen again.");
    this.socket.send(JSON.stringify(data));
  }
  private state(phase: ConsolePhase) {
    this.phase = phase;
    const enabled = !this.mediaPaused && this.microphone && !this.handling && (phase === "standby" || phase === "listening" || this.speechPending);
    this.capture?.port.postMessage(enabled);
    if (!enabled) { this.resetDetection(); this.queue = undefined; }
    this.hooks.changed();
  }
  private resetDetection() {
    this.detectionRevision++;
    this.utterance.reset();
    this.turnCheck = undefined;
    this.frames.reset();
    this.detector?.reset();
    this.preRoll = [];
  }
  private clearAudio() {
    for (const timer of this.audioTimers) clearTimeout(timer);
    this.audioTimers.clear();
    this.nextPart = undefined;
    this.receivingAudio = false;
    this.audioStarted = false;
    this.stopCue();
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.nextAudio = this.context?.currentTime ?? 0;
  }
  private stopCue() {
    this.cueSource?.stop();
    this.cueSource = undefined;
  }
  private loadCue(context: AudioContext, name: Cue) {
    let cue = this.cues.get(name);
    if (!cue) {
      cue = (async () => {
        const response = await fetch(`/api/sounds/${name}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await context.decodeAudioData(await response.arrayBuffer());
      })().catch((error: unknown) => {
        this.hooks.error(`The ${name} sound could not be loaded: ${error instanceof Error ? error.message : String(error)}. Restart Picard Code to check and download its sounds.`);
        return undefined;
      });
      this.cues.set(name, cue);
    }
    return cue;
  }
  /** The arrival call also works before speech is set up; no sound interrupts a request or spoken answer. */
  private canSound(context: AudioContext, revision: number, name: Cue) {
    if (this.mediaPaused) return false;
    if (this.context !== context || revision !== this.revision || this.recording) return false;
    if (name === "startup") return context.state === "running" && !this.cueSource && !this.speechPending && !this.handling
      && (this.phase === "off" || this.phase === "standby");
    // The failure sound plays just before its spoken explanation, so it is allowed while that speech waits.
    return this.microphone && this.phase !== "listening" && (!this.speechPending || name === "request-failed");
  }
  /** Plays one short sound. Resolves when it ends or is stopped. Listening or computer speech stops it. */
  private async sound(name: Cue) {
    const context = this.context;
    const revision = this.revision;
    if (!context || !this.canSound(context, revision, name)) return;
    const buffer = await this.loadCue(context, name);
    if (!buffer || !this.canSound(context, revision, name)) return;
    this.stopCue();
    const source = context.createBufferSource();
    const volume = context.createGain();
    volume.gain.value = CUE_VOLUME[name];
    source.buffer = buffer;
    source.connect(volume).connect(context.destination);
    this.cueSource = source;
    await new Promise<void>((done) => {
      source.onended = () => {
        if (this.cueSource === source) { this.cueSource = undefined; this.cueEnded = performance.now(); }
        source.disconnect(); volume.disconnect(); done();
      };
      try { source.start(); }
      catch {
        this.cueSource = undefined;
        this.hooks.error("A computer sound could not be played. Speaking and listening continue without it.");
        done();
      }
    });
  }

  private startup() {
    if (!this.startupReady || !this.startupPending || !this.context || this.context.state !== "running") return;
    this.startupPending = false;
    void this.sound("startup");
  }

  private audioContext() {
    if (!this.context) {
      const context = new AudioContext();
      this.context = context;
      context.onstatechange = () => {
        if (this.context !== context) return;
        this.waitingForClick = context.state === "suspended";
        if (context.state === "running") this.startup();
        this.hooks.changed();
      };
    }
    return this.context;
  }

  /** Welcomes the Captain once after the app opens, waiting for browser permission to play audio. */
  arrive() {
    if (this.startupReady) return;
    this.startupReady = true;
    const context = this.audioContext();
    void this.loadCue(context, "startup");
    void context.resume().catch(() => undefined);
    this.startup();
  }

  /** Called once when a spoken request has been accepted. */
  acknowledge() {
    void this.sound("request-accepted");
  }
  /** The short acknowledgement when the computer is addressed by name alone. */
  chime() {
    return this.sound("request-accepted");
  }
  /** Plays the input-failed sound, then listens again once it has finished. */
  private inputFailed() {
    void this.sound("input-failed").then(() => { this.handling = false; this.resume(); });
  }
  /** Heard speech that was not sent. Resolves when the input-failed sound has ended. */
  notSent() {
    return this.sound("input-failed");
  }
  private fail(message: string) {
    this.failed = true;
    this.speechPending = false;
    this.microphoneOff();
    this.clearAudio();
    this.hooks.error(message);
  }
  /** Retry browser audio after a user action or microphone access. */
  unlock() {
    if (this.context?.state === "suspended") void this.context.resume().catch(() => undefined);
  }
  async activate() {
    if (this.opening || this.microphone) return;
    this.opening = true;
    this.failed = false;
    this.listeningError = "";
    this.hooks.changed();
    const revision = this.revision;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("This browser cannot capture live speech. Use a current Chrome, Edge, Firefox or Safari.");
      const context = this.audioContext();
      // Without a recent click the browser keeps sound suspended until the next one; do not wait for it here.
      void context.resume().catch(() => undefined);
      for (const name of Object.keys(CUE_VOLUME) as Cue[]) void this.loadCue(context, name);
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: {
          channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        } });
      } catch (error) {
        throw new Error(await microphoneFailure(error));
      }
      if (revision !== this.revision) { media.getTracks().forEach((track) => track.stop()); return; }
      this.media = media;
      // Microphone access can unblock audio that the browser paused before capture began.
      this.unlock();
      media.getTracks().forEach((track) => { track.onended = () => {
        if (this.microphone) { this.failed = true; this.microphoneOff(); this.hooks.error("The microphone disconnected. Check your device, then click the microphone button to listen again."); }
      }; });
      const detecting = loadSpeechDetector();
      detecting.catch(() => undefined);
      await context.audioWorklet.addModule("/microphone-worklet.js");
      this.detector = await detecting;
      if (revision !== this.revision) return;
      this.resetDetection();
      this.capture = new AudioWorkletNode(context, "picard-microphone");
      const source = context.createMediaStreamSource(media);
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(this.capture).connect(silent).connect(context.destination);
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.heard(event.data);
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        await this.connect();
      }
      if (revision !== this.revision) return;
      this.microphone = true;
      this.partial = "";
      this.waitingForClick = context.state === "suspended";
      this.resume();
    } catch (error) {
      if (revision !== this.revision) return;
      this.failed = true;
      this.listeningError = `Could not start listening. ${error instanceof Error ? error.message : "Check microphone permissions and the selected speech setup."}`;
      this.microphoneOff();
      throw new Error(this.listeningError);
    } finally {
      this.opening = false;
      this.startup();
      this.hooks.changed();
    }
  }

  /** One 20 ms packet of microphone audio. Nothing leaves this computer until speech starts. */
  private heard(packet: ArrayBuffer) {
    if (this.mediaPaused || !this.microphone || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.handling || !this.recording && this.phase !== "standby" && !this.speechPending) return;
    if (!this.recording && (this.cueSource || performance.now() - this.cueEnded < 200)) {
      // The computer's own sound is not a request.
      this.resetDetection();
      return;
    }
    const detector = this.detector;
    if (!detector) return;
    const revision = this.detectionRevision;
    // A 20 ms packet completes at most one 32 ms detector frame.
    const [frame] = this.frames.push(packet);
    this.detection = this.detection.then(async () => {
      const speech = frame && await detector.speech(frame);
      if (revision !== this.detectionRevision) return;
      this.listened(packet, speech === undefined ? undefined : this.utterance.update(speech, SPEECH_FRAME / 16));
    }).catch((error: unknown) => {
      if (revision === this.detectionRevision) this.fail(`The voice detector stopped working.${error instanceof Error ? ` ${error.message}` : ""} Click the microphone button to listen again.`);
    });
  }
  private listened(packet: ArrayBuffer, change: ReturnType<Utterance["update"]>) {
    if (this.mediaPaused || !this.microphone || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.handling || !this.recording && this.phase !== "standby" && !this.speechPending) return;
    if (this.turnCheck && this.turnCheck.revision !== this.utterance.revision) this.turnCheck = undefined;
    if (!this.recording) {
      if (change !== "start") {
        this.preRoll.push(packet);
        if (this.preRoll.length > 25) this.preRoll.shift();
        return;
      }
      this.startedAt = Date.now();
      this.recording = true;
      this.interruption = this.speechPending;
      this.stopCue();
      this.queue = [...this.preRoll, packet];
      this.preRoll = [];
      this.endedEarly = false;
      this.partial = "";
      this.command({ type: "listen", id: ++this.listenID });
      if (!this.speechPending) this.phase = "listening";
      this.hooks.changed();
      return;
    }
    if (this.socket.bufferedAmount > 128_000) {
      this.fail("The microphone connection fell behind. Check your connection, then click the microphone button to listen again.");
      return;
    }
    if (this.queue) {
      this.queue.push(packet);
      if (this.queue.length > 1500) { this.fail("The listening service did not start within 30 seconds. Check the speech setup, then click the microphone button to listen again."); return; }
    } else this.socket.send(packet);
    if (change === "check") {
      this.turnCheck = { id: ++this.turnCheckID, revision: this.utterance.revision, sent: false };
      this.checkTurn();
    } else if (change === "end") {
      if (this.queue) this.endedEarly = true;
      else this.commit();
    } else if (change === "drop") {
      this.recording = false;
      this.command({ type: "pause" });
      this.resume();
    }
  }
  private checkTurn() {
    const check = this.turnCheck;
    if (!check || check.sent || this.queue || !this.recording || check.revision !== this.utterance.revision) return;
    check.sent = true;
    this.command({ type: "check-turn", id: check.id });
  }
  private commit() {
    this.handling = true;
    this.recording = false;
    this.state(this.speechPending ? this.phase : "thinking");
    this.command({ type: "commit" });
  }

  private connect() {
    return new Promise<void>((accept, reject) => {
      const socket = new WebSocket(`${location.origin.replace("http:", "ws:")}/api/speech`);
      this.socket = socket;
      socket.binaryType = "arraybuffer";
      const timer = setTimeout(() => { socket.close(); reject(new Error("The local voice connection did not open.")); }, 15_000);
      socket.onopen = () => { clearTimeout(timer); accept(); };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("The local voice connection failed. Check Picard Code's terminal and the selected speech setup."));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.failed = true;
        this.speechPending = false;
        this.microphoneOff();
        this.clearAudio();
        this.state("off");
        this.hooks.error("The voice connection stopped. The log entry on screen is kept. Click the microphone button to listen again.");
      };
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        try {
          if (typeof event.data !== "string") { this.audio(event.data); return; }
          const data = JSON.parse(event.data) as SpeechEvent;
          if (data.type === "state") {
            // Listening uses the current request; speaking begins only after audio arrives.
            if (data.phase === "listening" && this.recording && this.queue && data.id === this.listenID) {
              for (const packet of this.queue) socket.send(packet);
              this.queue = undefined;
              if (this.endedEarly) this.commit();
              else this.checkTurn();
            }
          }
          else if (data.type === "turn-result") {
            const check = this.turnCheck;
            const revision = this.detectionRevision;
            if (!check || check.id !== data.id || typeof data.complete !== "boolean") return;
            // Apply after already captured frames, so resumed speech invalidates a late prediction.
            this.detection = this.detection.then(() => {
              if (revision !== this.detectionRevision || this.turnCheck !== check || !this.recording) return;
              this.turnCheck = undefined;
              if (this.utterance.finishCheck(check.revision, data.complete)) this.commit();
            }).catch((error: unknown) => this.fail(`Pause detection stopped. ${error instanceof Error ? error.message : "The spoken request was not sent."}`));
          }
          else if (data.type === "partial") {
            if (this.recording || this.handling) {
              this.partial = data.text;
              if (this.interruption && this.speechPending && interruptsSpeech(data.text, this.spoken)) this.stopSpeaking();
              this.hooks.changed();
            }
          }
          else if (data.type === "transcript") {
            if (!this.handling) return;
            const text = data.text.trim();
            if (this.interruption) {
              this.interruption = false;
              if (!interruptsSpeech(text, this.spoken)) {
                this.handling = false;
                this.partial = "";
                this.resume();
                return;
              }
              this.stopSpeaking();
            }
            this.partial = text;
            this.hooks.changed();
            void this.hooks.transcript(text, this.startedAt).then(() => {
              this.handling = false;
              this.resume();
            }, (error) => {
              this.hooks.error(error instanceof Error ? error.message : "The spoken request could not be sent.");
              this.inputFailed();
            });
          } else if (data.type === "audio-start") {
            if (!this.speechPending || data.id !== this.speechRevision) return;
            if (data.rate !== 24000) throw new Error("The speaking service returned an unsupported audio format.");
            this.clearAudio();
            this.receivingAudio = true;
          } else if (data.type === "part-start") {
            if (!this.speechPending || data.id !== this.speechRevision || !this.receivingAudio) return;
            this.nextPart = this.parts[data.index];
          } else if (data.type === "audio-end") {
            if (!this.speechPending || data.id !== this.speechRevision) return;
            this.atAudioTime(Math.max(this.nextAudio, this.context?.currentTime ?? 0) + 0.25, () => {
              if (!this.speechPending || data.id !== this.speechRevision) return;
              const next = this.followOn;
              this.followOn = undefined;
              if (!this.recording && !this.handling && next?.valid()) {
                this.speak(next.text);
                this.optionalSpeech = true;
                next.started?.();
                return;
              }
              this.receivingAudio = false;
              this.speechPending = false;
              this.optionalSpeech = false;
              this.resume();
            });
          } else if (data.type === "error") this.fail(data.message);
        } catch (error) {
          this.fail(error instanceof Error ? error.message : "The voice response could not be read.");
        }
      };
    });
  }

  private audio(bytes: ArrayBuffer) {
    if (!this.receivingAudio || !this.context) return;
    if (bytes.byteLength % 2 || bytes.byteLength > 1_000_000) throw new Error("The spoken audio was incomplete.");
    if (!bytes.byteLength) return;
    const view = new DataView(bytes);
    const audio = this.context.createBuffer(1, bytes.byteLength / 2, 24000);
    const values = audio.getChannelData(0);
    for (let index = 0; index < values.length; index++) values[index] = view.getInt16(index * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = audio;
    source.connect(this.context.destination);
    this.nextAudio = Math.max(this.nextAudio, this.context.currentTime + 0.05);
    source.start(this.nextAudio);
    const part = this.nextPart;
    if (part) {
      this.nextPart = undefined;
      this.atAudioTime(this.nextAudio, () => this.hooks.partStarted?.(part));
    }
    this.nextAudio += audio.duration;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    if (!this.audioStarted) { this.audioStarted = true; this.state("speaking"); }
  }

  /**
   * Runs `then` once the audio clock reaches `at` (in seconds). When the browser pauses sound
   * the clock stops, so this keeps waiting rather than running before the audio is heard.
   */
  private atAudioTime(at: number, then: () => void) {
    const left = at - (this.context?.currentTime ?? at);
    if (left <= 0.005) { then(); return; }
    const timer = setTimeout(() => {
      this.audioTimers.delete(timer);
      this.atAudioTime(at, then);
    }, Math.max(20, left * 1000));
    this.audioTimers.add(timer);
  }

  /** Returns to standby: listening on this computer for the next utterance, if listening is possible now. */
  resume() {
    if (this.speechPending) { this.state(this.phase); return; }
    if (this.recording || this.handling) { this.state(this.recording ? "listening" : "thinking"); return; }
    if (this.socket?.readyState !== WebSocket.OPEN) { this.state("off"); return; }
    const listen = !this.mediaPaused && this.microphone && this.hooks.canListen();
    if (listen && this.phase === "standby") return;
    this.command({ type: "pause" });
    this.partial = "";
    this.state(listen ? "standby" : this.microphone ? "thinking" : "off");
  }
  /** Starts or pauses listening when the app becomes ready or stops being ready. */
  sync() {
    if (!this.microphone || this.speechPending || this.handling || this.opening) return;
    const can = !this.mediaPaused && this.hooks.canListen();
    if (can ? this.phase === "thinking" || this.phase === "off" : this.phase === "standby" || this.phase === "listening") this.resume();
  }
  /** Media must never be treated as an order, including late recognition from a cancelled utterance. */
  pauseForMedia(paused: boolean) {
    if (this.mediaPaused === paused) return;
    this.mediaPaused = paused;
    if (paused) {
      this.handling = false;
      this.recording = false;
      this.interruption = false;
      this.partial = "";
      this.stopSpeaking();
    } else this.resume();
    this.hooks.changed();
  }
  microphoneOff() {
    this.startupPending = false;
    this.cancelFollowOn();
    ++this.revision;
    this.microphone = false;
    this.resetDetection();
    this.capture?.port.postMessage(false);
    this.capture?.disconnect();
    this.capture = undefined;
    this.media?.getTracks().forEach((track) => track.stop());
    this.media = undefined;
    this.handling = false;
    this.recording = false;
    this.interruption = false;
    this.waitingForClick = false;
    this.stopCue();
    if (this.socket?.readyState === WebSocket.OPEN) this.command({ type: "pause" });
    if (this.phase !== "speaking") this.state("off");
    this.hooks.changed();
  }
  /** Speaks a reply. A final failure or denial is preceded by the failure sound, never overlapping the speech. */
  speak(reply: string | SpokenPart[], failed = false, followOn?: FollowOn) {
    this.hooks.beforeSpeak?.();
    const parts = typeof reply === "string" ? [{ text: reply }] : reply.filter((part) => part.text.trim());
    const text = parts.map((part) => part.text).join(" ");
    this.followOn = undefined;
    this.optionalSpeech = false;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.clearAudio();
    this.followOn = followOn;
    this.speechPending = true;
    this.parts = parts;
    this.spoken = text;
    // Speaking replaces any utterance still being understood; the service drops it.
    this.handling = false;
    this.recording = false;
    this.interruption = false;
    this.resetDetection();
    this.queue = undefined;
    this.command({ type: "pause" });
    const id = ++this.speechRevision;
    this.state("thinking");
    const say = () => {
      if (this.speechPending && id === this.speechRevision && this.socket?.readyState === WebSocket.OPEN) {
        const speed = this.speed === 1 ? {} : { speed: this.speed };
        this.command(parts.length === 1 && !parts[0]!.speaker ? { type: "speak", text, id, ...speed }
          : { type: "speak", parts: parts.map((part) => ({ text: part.text, ...part.speaker ? { speaker: part.speaker } : {} })), id, ...speed });
      }
    };
    if (failed) void this.sound("request-failed").then(say);
    else say();
  }
  stopSpeaking() {
    this.followOn = undefined;
    this.optionalSpeech = false;
    this.speechPending = false;
    ++this.speechRevision;
    this.clearAudio();
    if (this.socket?.readyState === WebSocket.OPEN) this.command({ type: "stop-speaking" });
    this.resume();
  }
  /** Discards tribute audio without cutting off the useful answer. */
  cancelFollowOn() {
    this.followOn = undefined;
    if (this.optionalSpeech) this.stopSpeaking();
  }
  close() {
    this.followOn = undefined;
    this.optionalSpeech = false;
    this.speechPending = false;
    this.handling = false;
    ++this.speechRevision;
    this.microphoneOff();
    this.clearAudio();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    void this.context?.close();
    this.context = undefined;
    this.state("off");
  }
}
