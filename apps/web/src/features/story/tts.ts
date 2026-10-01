import type { Settings } from '@everloom/engine';
import { apiFetch } from '@/lib/api';

let current: HTMLAudioElement | null = null;

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
