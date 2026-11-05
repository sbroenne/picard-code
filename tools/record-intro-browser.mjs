export function installRecording() {
  localStorage.setItem("picard-first-run", "done");
  const NativeContext = window.AudioContext;
  const nativeConnect = AudioNode.prototype.connect;
  const originalStreamSource = NativeContext.prototype.createMediaStreamSource;
  const master = new NativeContext();
  const mixed = master.createMediaStreamDestination();
  const clock = master.createOscillator();
  const silence = master.createGain();
  silence.gain.value = 0;
  nativeConnect.call(clock, silence);
  nativeConnect.call(silence, mixed);
  nativeConnect.call(silence, master.destination);
  clock.start();
  const buses = new WeakMap();
  let recorder;
  const chunks = [];
  let recordingStarted;

  function bus(context) {
    let destination = buses.get(context);
    if (!destination) {
      destination = context.createMediaStreamDestination();
      buses.set(context, destination);
      const source = originalStreamSource.call(master, destination.stream);
      nativeConnect.call(source, mixed);
    }
    return destination;
  }

  AudioNode.prototype.connect = function (destination, ...args) {
    const result = nativeConnect.call(this, destination, ...args);
    if (destination instanceof AudioDestinationNode) nativeConnect.call(this, bus(this.context));
    return result;
  };

  NativeContext.prototype.createMediaStreamSource = function () {
    const microphone = this.createMediaStreamDestination();
    window.demoSpeak = async (audio) => {
      await master.resume();
      await this.resume();
      const bytes = Uint8Array.from(atob(audio), (character) => character.charCodeAt(0));
      const samples = new DataView(bytes.buffer);
      const buffer = this.createBuffer(1, bytes.length / 2, 24000);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index++) channel[index] = samples.getInt16(index * 2, true) / 32768;
      const source = this.createBufferSource();
      source.buffer = buffer;
      source.connect(microphone);
      source.connect(bus(this));
      const ended = new Promise((done) => { source.onended = () => { source.disconnect(); done(); }; });
      const start = Date.now() / 1000;
      source.start();
      await ended;
      return { start, end: Date.now() / 1000 };
    };
    return originalStreamSource.call(this, microphone.stream);
  };

  window.startDemoRecording = async () => {
    await master.resume();
    if (master.state !== "running") throw new Error("The recording audio needs a real browser click.");
    const audioTime = master.currentTime;
    await new Promise((done) => setTimeout(done, 500));
    if (master.currentTime - audioTime < 0.1) {
      throw new Error("The browser's sound output is not running on this computer. Check the computer's sound output, then try again.");
    }
    recorder = new MediaRecorder(mixed.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192000 });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const started = new Promise((done) => {
      recorder.onstart = () => { recordingStarted = Date.now() / 1000; done(recordingStarted); };
    });
    recorder.start(1000);
    return started;
  };
  window.finishDemoRecording = async () => {
    const stopped = new Promise((done) => { recorder.onstop = done; });
    recorder.stop();
    await stopped;
    clock.stop();
    const blob = new Blob(chunks, { type: "audio/webm" });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let start = 0; start < buffer.length; start += 8192) binary += String.fromCharCode(...buffer.subarray(start, start + 8192));
    return { audio: btoa(binary), start: recordingStarted };
  };
}
