import type { Settings } from '@everloom/engine';
import { apiFetch } from '@/lib/api';

let current: HTMLAudioElement | null = null;

// ---------------------------------------------------------------- how loud the voice is (lip-sync)
// The analyser taps a copy of the playing audio (captureStream), so the voice itself always plays
// as before. Where that isn't available, and for the browser's own voices, a gentle made-up
// movement stands in while speech is playing.
let meter: { ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; el: HTMLAudioElement } | null = null;

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
      meter = { ctx, analyser, data: new Uint8Array(analyser.fftSize), el: audio };
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
