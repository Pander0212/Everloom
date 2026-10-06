import type { Settings } from '@everloom/engine';
import { apiFetch } from '@/lib/api';

let current: HTMLAudioElement | null = null;

// ---------------------------------------------------------------- how loud the voice is (lip-sync)
// The analyser taps a copy of the playing audio (captureStream), so the voice itself always plays
// as before. Where that isn't available, and for the browser's own voices, a gentle made-up
// movement stands in while speech is playing.
let meter: { ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; freq: Uint8Array<ArrayBuffer>; el: HTMLAudioElement } | null = null;

function tapLevel(audio: HTMLAudioElement) {
  meter = null;
  const capture = (audio as HTMLAudioElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }).captureStream ?? (audio as any).mozCaptureStream;
  if (!capture || typeof AudioContext === 'undefined') return;
  const start = () => {
    try {
      const stream: MediaStream = capture.call(audio);
      if (!stream.getAudioTracks().length) return;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      meter = { ctx, analyser, data: new Uint8Array(analyser.fftSize), freq: new Uint8Array(analyser.frequencyBinCount), el: audio };
      audio.addEventListener('ended', () => void ctx.close(), { once: true });
    } catch {
      meter = null;
    }
  };
  // The stream has tracks only once playback has started.
  audio.addEventListener('playing', start, { once: true });
}

/** How open a speaking mouth should be right now, 0..1. */
export function speechLevel(): number {
  if (meter && meter.el === current && !meter.el.paused) {
    meter.analyser.getByteTimeDomainData(meter.data);
    let sum = 0;
    for (const v of meter.data) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / meter.data.length) * 4);
  }
  const playing = (current && !current.paused) || ('speechSynthesis' in window && speechSynthesis.speaking);
  if (!playing) return 0;
  const t = performance.now() / 1000;
  return 0.25 + 0.35 * Math.abs(Math.sin(t * 9)) * (0.6 + 0.4 * Math.sin(t * 2.3));
}

/**
 * Mouth shapes for 3D lip-sync: the loudness split into vowel-like shapes from where the energy sits
 * in the spectrum (low formants open the jaw, high ones spread the lips, the middle rounds them).
 * Without an analyser (browser voices), vowels cycle at a speaking rhythm.
 */
export function speechVisemes(): { aa: number; ih: number; ou: number; ee: number; oh: number } {
  const level = speechLevel();
  if (level <= 0.02) return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  if (meter && meter.el === current && !meter.el.paused) {
    meter.analyser.getByteFrequencyData(meter.freq);
    const hz = meter.ctx.sampleRate / 2 / meter.freq.length;
    const band = (a: number, b: number) => {
      let sum = 0;
      for (let i = Math.floor(a / hz); i <= Math.min(meter!.freq.length - 1, Math.ceil(b / hz)); i++) sum += meter!.freq[i]!;
      return sum;
    };
    const low = band(250, 900);
    const mid = band(900, 1600);
    const high = band(1600, 3400);
    const total = low + mid + high || 1;
    const back = low / total;
    const front = high / total;
    const round = mid / total;
    return { aa: level * Math.min(1, back * 1.4), ee: level * front * 0.8, ih: level * front * 0.5, oh: level * round * 0.9, ou: level * round * 0.4 };
  }
  const t = performance.now() / 1000;
  const k = (phase: number) => Math.max(0, Math.sin(t * 7.3 + phase));
  return { aa: level * k(0), ee: level * k(2.1) * 0.6, oh: level * k(4.2) * 0.7, ih: level * k(1.1) * 0.3, ou: level * k(3.3) * 0.3 };
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  current?.pause();
  current = null;
}

export function cleanForSpeech(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function speak(text: string, opts: { settings: Settings; voice?: string; speed?: number; reference?: string }) {
  stopSpeaking();
  const clean = cleanForSpeech(text);
  if (!clean) return;
  if (opts.settings.tts.provider === 'connection') {
    const res = await apiFetch('/api/tts', { method: 'POST', body: { text: clean.slice(0, 4000), voice: opts.voice || opts.settings.tts.narratorVoice || undefined, speed: opts.speed ?? opts.settings.tts.rate, reference: opts.reference || undefined } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    tapLevel(audio);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    return;
  }
  if (!('speechSynthesis' in window)) throw new Error('This browser has no speech synthesis');
  const u = new SpeechSynthesisUtterance(clean);
  const voices = speechSynthesis.getVoices();
  const want = opts.voice || opts.settings.tts.narratorVoice;
  const v = voices.find((x) => x.voiceURI === want || x.name === want);
  if (v) u.voice = v;
  u.rate = opts.speed ?? opts.settings.tts.rate;
  u.pitch = opts.settings.tts.pitch;
  speechSynthesis.speak(u);
}
