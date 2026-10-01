/**
 * Music and ambience. Music follows the stage's playlist or mood (a playlist tagged with that mood),
 * crossfading between two decks. Ambience follows the stage (or, on "auto", the weather, the place
 * and the hour), using the owner's own loop when they set one and a synthesized one otherwise, so
 * no sound files ship with Everloom. Nothing plays until the owner turns it on and touches the page.
 */
import type { AmbientKind, CampaignState } from '@everloom/engine';
import { useEffect, useRef } from 'react';
import { useSettings } from '@/lib/queries';
import { useGame } from './context';

export function autoAmbient(s: CampaignState): Exclude<AmbientKind, 'auto'> {
  const w = s.weather.kind;
  if (w === 'storm') return 'storm';
  if (w === 'rain') return 'rain';
  if (w === 'wind' || w === 'snow') return 'wind';
  const loc = s.currentLocationId ? s.locations[s.currentLocationId] : null;
  const k = loc?.kind;
  const hour = Math.floor((((s.time.minutes % 1440) + 1440) % 1440) / 60);
  if (k === 'dock' || loc?.tags.includes('sea')) return 'sea';
  if (k === 'wilds' || k === 'danger') return hour >= 21 || hour < 5 ? 'night' : 'forest';
  if (k === 'city' || k === 'district' || k === 'station' || k === 'shop' || k === 'airport') return 'city';
  if (k === 'building' || k === 'interior') return 'crowd';
  if (hour >= 21 || hour < 5) return 'night';
  return 'none';
}

let unlocked = false;
const onUnlock = new Set<() => void>();
if (typeof window !== 'undefined') {
  const unlock = () => {
    unlocked = true;
    onUnlock.forEach((f) => f());
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function ramp(el: HTMLAudioElement, to: number, ms: number) {
  const from = el.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else if (to === 0) el.pause();
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ synthesized ambience

class Synth {
  ctx: AudioContext;
  out: GainNode;
  nodes: AudioNode[] = [];
  timers: number[] = [];
  constructor(ctx: AudioContext, volume: number) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    this.out.gain.linearRampToValueAtTime(volume, ctx.currentTime + 2);
  }
  noise(color: 'white' | 'brown' = 'white') {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      d[i] = color === 'brown' ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    this.nodes.push(src);
    return src;
  }
  filter(type: BiquadFilterType, f: number, q = 0.7) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    this.nodes.push(n);
    return n;
  }
  gain(v: number) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }
  lfo(target: AudioParam, rate: number, depth: number) {
    const o = this.ctx.createOscillator();
    const g = this.gain(depth);
    o.frequency.value = rate;
    o.connect(g).connect(target);
    o.start();
    this.nodes.push(o);
  }
  chirps(freq: number, every: number, len: number, level: number) {
    const t = window.setInterval(() => {
      if (Math.random() < 0.5) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = freq * (0.9 + Math.random() * 0.2);
      g.gain.value = 0;
      const now = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        g.gain.setValueAtTime(level, now + i * len * 1.6);
        g.gain.setValueAtTime(0, now + i * len * 1.6 + len);
      }
      o.connect(g).connect(this.out);
      o.start(now);
      o.stop(now + len * 6);
    }, every);
    this.timers.push(t);
  }
  build(kind: Exclude<AmbientKind, 'auto' | 'none'>) {
    const n = (c: 'white' | 'brown', f: BiquadFilterNode, v: number) => this.noise(c).connect(f).connect(this.gain(v)).connect(this.out);
    switch (kind) {
      case 'rain':
        n('white', this.filter('highpass', 900), 0.35);
        n('brown', this.filter('lowpass', 500), 0.3);
        break;
      case 'storm': {
        n('white', this.filter('highpass', 700), 0.4);
        const rumble = this.filter('lowpass', 120);
        const g = this.gain(0.5);
        this.noise('brown').connect(rumble).connect(g).connect(this.out);
        this.lfo(g.gain, 0.07, 0.4);
        break;
      }
      case 'wind': {
        const f = this.filter('bandpass', 400, 0.6);
        n('brown', f, 0.7);
        this.lfo(f.frequency, 0.12, 250);
        break;
      }
      case 'sea': {
        const g = this.gain(0.45);
        this.noise('brown').connect(this.filter('lowpass', 700)).connect(g).connect(this.out);
        this.lfo(g.gain, 0.09, 0.35);
        break;
      }
      case 'city':
        n('brown', this.filter('lowpass', 300), 0.5);
        n('white', this.filter('bandpass', 1200, 0.4), 0.04);
        break;
      case 'crowd':
        n('white', this.filter('bandpass', 700, 0.8), 0.12);
        n('brown', this.filter('lowpass', 400), 0.25);
        break;
      case 'forest':
        n('white', this.filter('highpass', 3000), 0.03);
        this.chirps(3200, 1400, 0.05, 0.05);
        break;
      case 'night':
        n('brown', this.filter('lowpass', 200), 0.15);
        this.chirps(4200, 700, 0.03, 0.03);
        break;
      case 'fire': {
        n('brown', this.filter('lowpass', 250), 0.4);
        const t = window.setInterval(() => {
          const s = this.ctx.createBufferSource();
          const b = this.ctx.createBuffer(1, 400, this.ctx.sampleRate);
          const d = b.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
          s.buffer = b;
          const g = this.ctx.createGain();
          g.gain.value = 0.1 + Math.random() * 0.2;
          s.connect(g).connect(this.out);
          s.start();
        }, 90);
        this.timers.push(t);
        break;
      }
    }
  }
  stop() {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 2);
    this.timers.forEach(clearInterval);
    window.setTimeout(() => {
      for (const n of this.nodes) {
        try {
          (n as AudioScheduledSourceNode).stop?.();
        } catch {
          /* already stopped */
        }
        n.disconnect();
      }
      this.out.disconnect();
    }, 2200);
  }
}

// ------------------------------------------------------------------ the director

export function AudioDirector() {
  const { state: s } = useGame();
  const settings = useSettings();
  const a = settings.data?.audio;
  const decks = useRef<[HTMLAudioElement, HTMLAudioElement] | null>(null);
  const live = useRef(0);
  const current = useRef<{ key: string; tracks: string[]; i: number } | null>(null);
  const amb = useRef<{ kind: string; synth?: Synth; el?: HTMLAudioElement } | null>(null);
  const actx = useRef<AudioContext | null>(null);

  // Music: which playlist, then play its tracks in turn with a crossfade.
  const playlist = (() => {
    if (!a?.music || !s?.stage) return null;
    const lists = a.playlists ?? [];
    const byName = s.stage.music.playlist ? lists.find((p) => p.name.toLowerCase() === s.stage!.music.playlist!.toLowerCase()) : null;
    const byMood = s.stage.music.mood ? lists.find((p) => p.mood.toLowerCase() === s.stage!.music.mood) : null;
    const pick = byName ?? byMood ?? null;
    return pick && pick.tracks.length ? pick : null;
  })();
  useEffect(() => {
    if (!decks.current) {
      const mk = () => {
        const el = new Audio();
        el.preload = 'auto';
        el.volume = 0;
        return el;
      };
      decks.current = [mk(), mk()];
    }
    const [d0, d1] = decks.current;
    const fade = a?.crossfadeMs ?? 2500;
    const vol = a?.musicVolume ?? 0.5;
    const start = () => {
      if (!playlist) {
        current.current = null;
        ramp(d0, 0, fade);
        ramp(d1, 0, fade);
        return;
      }
      const key = playlist.id + ':' + playlist.tracks.join(',');
      if (current.current?.key === key) return;
      current.current = { key, tracks: playlist.tracks, i: 0 };
      playTrack();
    };
    const playTrack = () => {
      const c = current.current;
      if (!c) return;
      const out = decks.current![live.current]!;
      live.current = 1 - live.current;
      const inn = decks.current![live.current]!;
      inn.src = `/media/${c.tracks[c.i % c.tracks.length]}`;
      inn.currentTime = 0;
      inn.volume = 0;
      inn.onended = () => {
        if (current.current !== c) return;
        c.i++;
        playTrack();
      };
      void inn.play().catch(() => undefined);
      ramp(inn, vol, fade);
      ramp(out, 0, fade);
    };
    if (unlocked) start();
    else onUnlock.add(start);
    return () => void onUnlock.delete(start);
  }, [playlist?.id, playlist?.tracks.join(','), a?.music, a?.musicVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ambience: explicit, or derived from the scene.
  const kind: string = !a?.ambient || !s ? 'none' : s.stage?.ambient && s.stage.ambient !== 'auto' ? s.stage.ambient : autoAmbient(s);
  useEffect(() => {
    const vol = a?.ambientVolume ?? 0.35;
    const start = () => {
      if (amb.current?.kind === kind) return;
      const old = amb.current;
      old?.synth?.stop();
      if (old?.el) ramp(old.el, 0, 2000);
      amb.current = { kind };
      if (kind === 'none') return;
      const file = a?.ambientFiles?.[kind];
      if (file) {
        const el = new Audio(`/media/${file}`);
        el.loop = true;
        el.volume = 0;
        void el.play().catch(() => undefined);
        ramp(el, vol, 2000);
        amb.current.el = el;
      } else {
        actx.current ??= new AudioContext();
        void actx.current.resume();
        const synth = new Synth(actx.current, vol * 0.6);
        synth.build(kind as Exclude<AmbientKind, 'auto' | 'none'>);
        amb.current.synth = synth;
      }
    };
    if (unlocked) start();
    else onUnlock.add(start);
    return () => void onUnlock.delete(start);
  }, [kind, a?.ambient, a?.ambientVolume, a?.ambientFiles?.[kind]]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop everything when leaving the story.
  useEffect(
    () => () => {
      decks.current?.forEach((d) => d.pause());
      amb.current?.synth?.stop();
      amb.current?.el?.pause();
      void actx.current?.close();
    },
    [],
  );
  return <span hidden data-testid="audio-director" data-ambient={kind} data-playlist={playlist?.name ?? ''} />;
}
