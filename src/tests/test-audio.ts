/**
 * Original synthetic test audio at 16 kHz: a buzzing vowel-like voice and steady background noise.
 * Nothing here is recorded speech; the voice is a pulse train shaped by moving vowel resonances.
 */
const RATE = 16000;

function scaled(samples: Float32Array, level: number) {
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) || 1;
  return samples.map((value) => value * level / rms);
}

/** A voice-like sound with changing pitch, vowels and syllables, at the given loudness (RMS). */
export function syntheticVoice(seconds: number, level: number, rate = RATE) {
  const vowels = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410]];
  const memory = vowels[0]!.map(() => [0, 0] as [number, number]);
  const out = new Float32Array(Math.round(seconds * rate));
  let phase = 0;
  for (let index = 0; index < out.length; index++) {
    const time = index / rate;
    phase += (120 + 20 * Math.sin(2 * Math.PI * 0.7 * time)) / rate;
    const pulse = phase >= 1 ? 1 : 0;
    if (pulse) phase -= 1;
    const vowel = vowels[Math.floor(time * 4) % vowels.length]!;
    let value = 0;
    vowel.forEach((frequency, formant) => {
      const radius = Math.exp(-Math.PI * (80 + 40 * formant) / rate);
      const state = memory[formant]!;
      const next = pulse + 2 * radius * Math.cos(2 * Math.PI * frequency / rate) * state[0] - radius * radius * state[1];
      state[1] = state[0];
      state[0] = next;
      value += next / (formant + 1);
    });
    out[index] = value * (0.2 + 0.8 * Math.max(0, Math.sin(Math.PI * time * 4)) ** 0.5);
  }
  return scaled(out, level);
}

/** Steady noise like a fan, air conditioning or a computer: white, pink (softer hiss) or brown (rumble). */
export function steadyNoise(kind: "white" | "pink" | "brown", seconds: number, level: number, seed = 1) {
  let random = seed;
  const next = () => (random = (random * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const out = new Float32Array(Math.round(seconds * RATE));
  let b0 = 0, b1 = 0, b2 = 0, brown = 0;
  for (let index = 0; index < out.length; index++) {
    const white = Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
    if (kind === "white") out[index] = white;
    else if (kind === "pink") {
      b0 = 0.99765 * b0 + white * 0.099046; b1 = 0.963 * b1 + white * 0.2965164; b2 = 0.57 * b2 + white * 1.0526913;
      out[index] = b0 + b1 + b2 + white * 0.1848;
    } else out[index] = brown = (brown + 0.02 * white) * 0.998;
  }
  return scaled(out, level);
}

/** Splits audio into the microphone's 20 ms packets of 16-bit samples. */
export function packets(samples: Float32Array) {
  const list: ArrayBuffer[] = [];
  for (let start = 0; start + 320 <= samples.length; start += 320) {
    const view = new DataView(new ArrayBuffer(640));
    for (let index = 0; index < 320; index++) view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, samples[start + index]!)) * 32767), true);
    list.push(view.buffer);
  }
  return list;
}
