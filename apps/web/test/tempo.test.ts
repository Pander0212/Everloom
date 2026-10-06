import { describe, expect, it } from 'vitest';
import { danceRate, estimateTempo } from '../src/lib/tempo';

/** A drum-ish track: a decaying noise hit on every beat, a softer one off-beat, some hum. */
function track(bpm: number, seconds: number, rate = 22050) {
  const out = new Float32Array(seconds * rate);
  const beat = (60 / bpm) * rate;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) {
    const p = i % beat;
    const off = (i + beat / 2) % beat;
    out[i] = Math.exp(-p / (rate * 0.03)) * rnd() * 0.8 + Math.exp(-off / (rate * 0.02)) * rnd() * 0.25 + Math.sin((i / rate) * 2 * Math.PI * 110) * 0.1;
  }
  return out;
}

describe('music tempo', () => {
  it('finds the beat of steady tracks', () => {
    for (const bpm of [90, 100, 120, 128, 140]) {
      const est = estimateTempo(track(bpm, 20), 22050)!;
      // Within 2%, allowing the double or half tempo.
      const ratio = [est / bpm, (est * 2) / bpm, est / (bpm * 2)].find((r) => Math.abs(r - 1) < 0.02);
      expect(ratio, `${bpm} → ${est}`).toBeDefined();
    }
  });

  it('says nothing for audio without a beat', () => {
    const hum = new Float32Array(22050 * 10).map((_, i) => Math.sin((i / 22050) * 2 * Math.PI * 220) * 0.3);
    expect(estimateTempo(hum, 22050)).toBeNull();
  });

  it('fits a dance to the music by halving or doubling', () => {
    expect(danceRate(120, 120)).toBe(1);
    expect(danceRate(128, 64)).toBe(1);
    expect(danceRate(90, 180)).toBe(1);
    expect(danceRate(110, 128)).toBeCloseTo(1.164, 2);
  });
});
