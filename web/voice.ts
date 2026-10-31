import { EndOfSpeech, type SpeechEvent, type VoicePhase } from "../src/shared/speech";

export class VoiceConversation {
  microphone = false;
  phase: VoicePhase = "off";
  partial = "";
  speechPending = false;
  private speechRevision = 0;
  private socket?: WebSocket;
  private media?: MediaStream;
  private context?: AudioContext;
  private capture?: AudioWorkletNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextAudio = 0;
  private receivingAudio = false;
  private playbackTimer?: ReturnType<typeof setTimeout>;
  private detector = new EndOfSpeech();
  private revision = 0;
  private opening = false;

  constructor(private hooks: {
    changed(): void;
    error(message: string): void;
    transcript(text: string): Promise<void>;
    canListen(): boolean;
  }) {}

  private command(data: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("The voice connection stopped. Turn the microphone on again.");
    this.socket.send(JSON.stringify(data));
  }
  private state(phase: VoicePhase) {
    this.phase = phase;
    const enabled = phase === "listening" && this.microphone;
    this.capture?.port.postMessage(enabled);
    if (!enabled) this.detector.reset();
    this.hooks.changed();
  }
  private clearAudio() {
    clearTimeout(this.playbackTimer);
    this.receivingAudio = false;
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.nextAudio = this.context?.currentTime ?? 0;
  }

  async activate() {
    if (this.opening || this.microphone) return;
    this.opening = true;
    const revision = ++this.revision;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("This browser cannot capture live speech. Use a current Chrome, Edge, Firefox or Safari, or type instead.");
      this.context ??= new AudioContext();
      await this.context.resume();
      const media = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (revision !== this.revision) { media.getTracks().forEach((track) => track.stop()); return; }
      this.media = media;
      media.getTracks().forEach((track) => { track.onended = () => {
        if (this.microphone) { this.microphoneOff(); this.hooks.error("The microphone disconnected. Check your device, then turn it on again."); }
      }; });
      await this.context.audioWorklet.addModule("/microphone-worklet.js");
      if (revision !== this.revision) return;
      this.capture = new AudioWorkletNode(this.context, "picard-microphone");
      const source = this.context.createMediaStreamSource(media);
      const silent = this.context.createGain();
      silent.gain.value = 0;
      source.connect(this.capture).connect(silent).connect(this.context.destination);
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.microphone || this.phase !== "listening" || this.socket?.readyState !== WebSocket.OPEN) return;
        if (this.socket.bufferedAmount > 128_000) {
          this.microphoneOff();
          this.hooks.error("The microphone connection fell behind. Check your connection, then turn it on again.");
          return;
        }
        const view = new DataView(event.data);
        let energy = 0;
        for (let index = 0; index < view.byteLength; index += 2) energy += (view.getInt16(index, true) / 32768) ** 2;
        this.socket.send(event.data);
        if (this.detector.update(Math.sqrt(energy / (view.byteLength / 2)), view.byteLength / 32)) {
          this.state("thinking");
          this.command({ type: "commit" });
        }
      };
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        await this.connect();
      }
      if (revision !== this.revision) return;
      this.microphone = true;
      this.partial = "";
      if (!this.speechPending) this.resume();
    } catch (error) {
      this.microphoneOff();
      throw new Error(`Could not start spoken conversation. ${error instanceof Error ? error.message : "Check microphone permissions and the selected speech setup."}`);
    } finally {
      this.opening = false;
      this.hooks.changed();
    }
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
        this.speechPending = false;
        this.microphoneOff();
        this.clearAudio();
        this.state("off");
        this.hooks.error("The voice connection stopped. The written conversation is preserved. Turn the microphone on again or type instead.");
      };
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        try {
          if (typeof event.data !== "string") { this.audio(event.data); return; }
          const data = JSON.parse(event.data) as SpeechEvent;
          if (data.type === "state") {
            if (data.phase !== "speaking" || this.speechPending) this.state(data.phase);
          }
          else if (data.type === "partial") { this.partial = data.text; this.hooks.changed(); }
          else if (data.type === "transcript") {
            this.partial = data.text;
            this.hooks.changed();
            if (data.text.trim()) void this.hooks.transcript(data.text).catch((error) => {
              this.hooks.error(error instanceof Error ? error.message : "The spoken request could not be sent.");
              this.resume();
            });
            else { this.hooks.error("No words were understood. Please try again."); this.resume(); }
          } else if (data.type === "audio-start") {
            if (!this.speechPending || data.id !== this.speechRevision) return;
            if (data.rate !== 24000) throw new Error("The speaking service returned an unsupported audio format.");
            this.clearAudio();
            this.receivingAudio = true;
            this.state("speaking");
          } else if (data.type === "audio-end") {
            if (!this.speechPending || data.id !== this.speechRevision) return;
            this.playbackTimer = setTimeout(() => {
              this.receivingAudio = false;
              this.speechPending = false;
              this.resume();
            }, Math.max(0, this.nextAudio - (this.context?.currentTime ?? 0)) * 1000 + 250);
          } else if (data.type === "error") {
            this.speechPending = false;
            this.microphoneOff();
            this.clearAudio();
            this.hooks.error(data.message);
          }
        } catch (error) {
          this.speechPending = false;
          this.microphoneOff();
          this.clearAudio();
          this.hooks.error(error instanceof Error ? error.message : "The voice response could not be read.");
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
    this.nextAudio += audio.duration;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
  }

  resume() {
    if (this.speechPending) return;
    if (this.socket?.readyState !== WebSocket.OPEN) { this.state("off"); return; }
    this.clearAudio();
    if (this.microphone && this.hooks.canListen()) {
      this.detector.reset();
      this.partial = "";
      this.command({ type: "listen" });
      this.state("thinking");
    } else {
      this.command({ type: "pause" });
      this.state(this.microphone ? "thinking" : "off");
    }
  }
  microphoneOff() {
    ++this.revision;
    this.microphone = false;
    this.capture?.port.postMessage(false);
    this.capture?.disconnect();
    this.capture = undefined;
    this.media?.getTracks().forEach((track) => track.stop());
    this.media = undefined;
    this.detector.reset();
    if (this.socket?.readyState === WebSocket.OPEN) this.command({ type: "pause" });
    if (this.phase !== "speaking") this.state("off");
    this.hooks.changed();
  }
  speak(text: string) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.clearAudio();
    this.speechPending = true;
    const id = ++this.speechRevision;
    this.state("thinking");
    this.command({ type: "speak", text, id });
  }
  stopSpeaking() {
    this.speechPending = false;
    ++this.speechRevision;
    this.clearAudio();
    if (this.socket?.readyState === WebSocket.OPEN) this.command({ type: "stop-speaking" });
    this.resume();
  }
  close() {
    this.speechPending = false;
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
