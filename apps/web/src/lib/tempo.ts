/**
 * Music tempo, estimated from the audio itself (tracks carry no tempo): an onset envelope (rises in
 * loudness), autocorrelated over 60–180 BPM, with a gentle preference for common dance tempos.
 * Used to time 3D dances to whatever is playing.
 */

/** BPM of the given mono samples, or null when there's no clear beat. */
export function estimateTempo(samples: Float32Array, sampleRate: number): number | null {
  const hop = Math.round(sampleRate / 100); // 100 envelope frames per second
  const n = Math.floor(samples.length / hop);
  if (n < 400) return null; // under 4 s
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * hop, end = j + hop; j < end; j++) e += samples[j]! * samples[j]!;
    const l = Math.log1p(1000 * Math.sqrt(e / hop));
    env[i] = Math.max(0, l - prev);
    prev = l;
  }
  // Remove the mean so silence and sustained notes don't count.
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  for (let i = 0; i < n; i++) env[i] = env[i]! - mean;
  let r0 = 0;
  for (const v of env) r0 += v * v;
  r0 /= n;
  if (r0 < 1e-9) return null;
  let best = 0;
  let bestLag = 0;
  let bestRaw = 0;
  const scores: number[] = [];
  const minLag = Math.round(6000 / 180);
  const maxLag = Math.round(6000 / 60);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i]! * env[i - lag]!;
    s /= n - lag;
    // Prefer 90–140 BPM a little (a double or half tempo scores almost the same).
    const bpm = 6000 / lag;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 118) / 0.6) ** 2);
    const score = s * (0.6 + 0.4 * w);
    scores.push(score);
    if (score > best) {
      best = score;
      bestLag = lag;
      bestRaw = s;
    }
  }
  // A real beat repeats strongly: the envelope correlates with itself a beat later.
  if (!bestLag || best <= 0 || bestRaw / r0 < 0.15) return null;
  // A clear beat stands well above the typical lag.
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  if (best < Math.max(1e-6, median * 2.2)) return null;
  // Refine between neighbouring lags (parabolic peak).
  const i = bestLag - minLag;
  const a = scores[i - 1] ?? scores[i]!;
  const c = scores[i + 1] ?? scores[i]!;
  const d = a - 2 * scores[i]! + c;
  const lag = d < 0 ? bestLag + (0.5 * (a - c)) / d : bestLag;
  return Math.round((6000 / lag) * 10) / 10;
}

/** The playback rate that fits a dance made at `danceBpm` to music at `musicBpm` (halving or doubling as needed). */
export function danceRate(danceBpm: number, musicBpm: number): number {
  let r = musicBpm / danceBpm;
  while (r > 1.45) r /= 2;
  while (r < 0.7) r *= 2;
  return r;
}

const cache = new Map<string, Promise<number | null>>();
/** Decodes a track once (its first minute) and estimates its tempo; cached by URL. */
export function trackTempo(url: string, ctx: BaseAudioContext): Promise<number | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('fetch'))))
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => {
        const len = Math.min(audio.length, audio.sampleRate * 60);
        const mono = new Float32Array(len);
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const ch = audio.getChannelData(c);
          for (let i = 0; i < len; i++) mono[i] = mono[i]! + ch[i]! / audio.numberOfChannels;
        }
        return estimateTempo(mono, audio.sampleRate);
      })
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

// ---------------------------------------------------------------- what's playing now
type Beat = { bpm: number; url: string } | null;
let beat: Beat = null;
const listeners = new Set<(b: Beat) => void>();
/** The tempo of the music playing now (null: none, or no clear beat). */
export function setMusicBeat(b: Beat) {
  beat = b;
  for (const l of listeners) l(b);
}
export function musicBeat(): Beat {
  return beat;
}
export function onMusicBeat(fn: (b: Beat) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
