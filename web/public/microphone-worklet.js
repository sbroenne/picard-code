class PicardMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.packet = new DataView(new ArrayBuffer(640));
    this.count = 0;
    this.sum = 0;
    this.duration = 0;
    this.port.onmessage = (event) => {
      this.enabled = event.data === true;
      this.count = 0;
      this.sum = 0;
      this.duration = 0;
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || !this.enabled) return true;
    for (const value of input) {
      let remaining = 1 / sampleRate;
      while (remaining > 1e-12) {
        const used = Math.min(remaining, 1 / 16000 - this.duration);
        this.sum += value * used;
        this.duration += used;
        remaining -= used;
        if (this.duration >= 1 / 16000 - 1e-12) {
          const sample = Math.max(-1, Math.min(1, this.sum * 16000));
          this.packet.setInt16(this.count++ * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
          this.sum = 0;
          this.duration = 0;
          if (this.count === 320) {
            this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
            this.packet = new DataView(new ArrayBuffer(640));
            this.count = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("picard-microphone", PicardMicrophone);
