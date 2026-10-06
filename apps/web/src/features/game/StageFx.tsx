/**
 * Scene effects and cutscenes. Effects are cues in the game state (ops, so they roll back with
 * swipes and edits); a cue plays once when it first appears. Reduced motion swaps movement for a
 * gentle fade.
 */
import type { CampaignState, Cutscene, FxKind, Op } from '@everloom/engine';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import { Button } from '@/ui';
import { useGame } from './context';

/** Every scene effect, in quick-menu order. */
export const FX_LIST: Array<{ id: FxKind; label: string }> = [
  { id: 'shake', label: 'Shake' },
  { id: 'flash', label: 'Flash' },
  { id: 'fade', label: 'Fade' },
  { id: 'blur', label: 'Blur' },
  { id: 'vignette', label: 'Vignette' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'sparkle', label: 'Sparkle' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'fog', label: 'Fog' },
  { id: 'embers', label: 'Embers' },
  { id: 'lightning', label: 'Lightning' },
  { id: 'glitch', label: 'Glitch' },
];

type Playing = { id: string; effect: FxKind; intensity: number; seconds: number };

/** New cue ids since the last render (a cue that reappears after a rollback plays again). */
function useNewCues(s: CampaignState | null, off: readonly string[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Playing[]>([]);
  useEffect(() => {
    const cues = s?.stage?.cues ?? [];
    const ids = new Set(cues.map((c) => c.id));
    // First render: what's already there has been seen.
    if (seen.current) {
      const add = cues.filter((c) => !seen.current!.has(c.id) && !off.includes(c.effect));
      if (add.length) setFresh((f) => [...f, ...add]);
    }
    seen.current = ids;
  }, [s?.stage?.cues]);
  return { fresh, done: (id: string) => setFresh((f) => f.filter((x) => x.id !== id)) };
}

const overlay: Partial<Record<FxKind, (i: number) => string>> = {
  flash: (i) => `rgb(255 255 255 / ${0.5 + i * 0.5})`,
  fade: () => 'rgb(0 0 0 / 1)',
  vignette: (i) => `radial-gradient(ellipse at center, transparent 35%, rgb(0 0 0 / ${0.4 + i * 0.5}) 100%)`,
  heartbeat: (i) => `radial-gradient(ellipse at center, transparent 40%, rgb(150 0 20 / ${0.25 + i * 0.4}) 100%)`,
};

function Effect({ fx, onDone }: { fx: Playing; onDone: () => void }) {
  const reduce = useReducedMotion();
  const ms = fx.seconds * 1000;
  useEffect(() => {
    const t = setTimeout(onDone, ms + 50);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Shake, blur and glitch move the story itself (see useSceneMotion); here only overlays.
  if (fx.effect === 'fog') {
    // Two soft banks drifting past each other; with reduced motion they only fade in and out.
    const bank = (from: string, to: string, top: string, i: number) => (
      <motion.div
        key={i}
        className="absolute h-1/2 w-[160%] rounded-[50%]"
        style={{ top, left: '-30%', background: 'radial-gradient(ellipse at center, rgb(235 238 242 / 0.55), transparent 70%)', filter: 'blur(24px)' }}
        initial={{ x: reduce ? 0 : from, opacity: 0 }}
        animate={{ x: reduce ? 0 : to, opacity: [0, 0.35 + fx.intensity * 0.5, 0.35 + fx.intensity * 0.5, 0] }}
        transition={{ duration: fx.seconds, ease: 'linear' }}
      />
    );
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" data-fx="fog">
        {bank('-12%', '10%', '20%', 0)}
        {bank('10%', '-12%', '45%', 1)}
      </div>
    );
  }
  if (fx.effect === 'lightning') {
    // Two quick strikes; reduced motion gets one soft, slow flash (no strobing either way).
    const k = reduce ? [0, 0.3, 0] : [0, 0.85 * fx.intensity + 0.15, 0.1, 0.6 * fx.intensity + 0.1, 0];
    return <motion.div className="pointer-events-none absolute inset-0 z-40 bg-white" data-fx="lightning" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: k }} transition={{ duration: reduce ? 1.2 : Math.min(fx.seconds, 0.9), times: reduce ? undefined : [0, 0.08, 0.25, 0.33, 1] }} />;
  }
  if (fx.effect === 'sparkle' || fx.effect === 'rain' || fx.effect === 'snow' || fx.effect === 'embers') {
    const n = reduce ? 0 : Math.round(12 + fx.intensity * 30);
    const rises = fx.effect === 'sparkle' || fx.effect === 'embers';
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" data-fx={fx.effect}>
        {Array.from({ length: n }, (_, i) => {
          const x = (i * 37) % 100;
          const delay = ((i * 53) % 100) / 100;
          const glyph = fx.effect === 'sparkle' ? '✦' : fx.effect === 'snow' ? '•' : '';
          return (
            <motion.span
              key={i}
              className={fx.effect === 'rain' ? 'absolute top-0 h-6 w-px bg-white/60' : fx.effect === 'embers' ? 'absolute top-0 size-1.5 rounded-full bg-[rgb(255_150_60)] shadow-[0_0_6px_rgb(255_120_40)]' : 'absolute top-0 text-white/80'}
              style={{ left: `${x}%`, fontSize: fx.effect === 'sparkle' ? 14 : 8 }}
              initial={{ y: fx.effect === 'embers' ? '95vh' : fx.effect === 'sparkle' ? '40vh' : -30, opacity: 0 }}
              animate={{ y: fx.effect === 'embers' ? '35vh' : rises ? '10vh' : '100vh', x: fx.effect === 'embers' ? [0, (i % 2 ? 1 : -1) * 18, 0] : 0, opacity: [0, 1, 0] }}
              transition={{ duration: fx.effect === 'rain' ? 0.6 : fx.seconds, delay: delay * fx.seconds * 0.5, repeat: fx.effect === 'rain' ? Math.ceil(fx.seconds / 0.6) : 0, ease: 'linear' }}
            >
              {glyph}
            </motion.span>
          );
        })}
      </div>
    );
  }
  const bg = overlay[fx.effect]?.(fx.intensity);
  if (!bg) return null;
  const keyframes = fx.effect === 'heartbeat' && !reduce ? [0, 1, 0.3, 1, 0] : fx.effect === 'fade' ? [0, 1, 1, 0] : [0, 1, 0];
  return <motion.div className="pointer-events-none absolute inset-0 z-40" style={{ background: bg }} data-fx={fx.effect} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: keyframes }} transition={{ duration: fx.seconds, ease: 'easeInOut' }} />;
}

/** Movement effects applied to the scene container: shake, blur, glitch. */
export function useSceneMotion(s: CampaignState | null, off: readonly string[] = []) {
  const reduce = useReducedMotion();
  const [anim, setAnim] = useState<Record<string, unknown> | null>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const cues = s?.stage?.cues ?? [];
    if (seen.current) {
      const c = cues.find((x) => !seen.current!.has(x.id) && ['shake', 'blur', 'glitch'].includes(x.effect) && !off.includes(x.effect));
      if (c) {
        const a = c.intensity * 14;
        const d = c.seconds;
        setAnim(
          reduce
            ? { opacity: [1, 0.85, 1], transition: { duration: Math.min(d, 0.6) } }
            : c.effect === 'shake'
              ? { x: [0, -a, a, -a * 0.6, a * 0.6, 0], transition: { duration: Math.min(d, 0.8) } }
              : c.effect === 'blur'
                ? { filter: ['blur(0px)', `blur(${2 + c.intensity * 6}px)`, 'blur(0px)'], transition: { duration: d } }
                : { x: [0, 4, -3, 2, 0], filter: ['hue-rotate(0deg)', 'hue-rotate(90deg)', 'hue-rotate(-60deg)', 'hue-rotate(0deg)'], transition: { duration: Math.min(d, 0.7) } },
        );
      }
    }
    seen.current = new Set(cues.map((x) => x.id));
  }, [s?.stage?.cues, reduce]);
  return anim;
}

const NO_FX: string[] = [];

export function StageFxLayer() {
  const { state } = useGame();
  const off = useSettings().data?.stage?.fxOff ?? NO_FX;
  const { fresh, done } = useNewCues(state, off);
  return (
    <div className="pointer-events-none fixed inset-0 z-[35]" data-testid="fx-layer">
      <AnimatePresence>
        {fresh.map((f) => (
          <Effect key={f.id} fx={f} onDone={() => done(f.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ cutscenes

export function CutscenePlayer() {
  const { state, apply, close } = useGame();
  const playing = state?.stage?.playing ?? null;
  const cs: Cutscene | null = playing ? (state?.stage?.cutscenes[playing.id] ?? null) : null;
  const [step, setStep] = useState(0);
  const seen = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    // Only a new play starts the player; reopening the chat doesn't replay an old one.
    if (playing && seen.current !== null && seen.current !== playing.cue) {
      // A cutscene takes the whole screen: an open tool would sit on top of it (and keep focus).
      close();
      setStep(0);
      setOpen(true);
    }
    seen.current = playing?.cue ?? '';
  }, [playing?.cue]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = () => {
    setOpen(false);
    void apply({ type: 'cutscene.stop' } as Op, { quiet: true });
  };
  const cur = cs?.steps[step];
  useEffect(() => {
    if (!open || !cur) return;
    if (cur.fx) void apply({ type: 'fx.play', effect: cur.fx } as Op, { quiet: true });
    if (cur.mood) void apply({ type: 'music.set', mood: cur.mood } as Op, { quiet: true });
    if (cur.speaker && cur.emote) void apply({ type: 'avatar.emote', who: cur.speaker, emote: cur.emote } as Op, { quiet: true });
    if (cur.speaker && cur.outfit !== undefined) void apply({ type: 'avatar.outfit', who: cur.speaker, outfit: cur.outfit } as Op, { quiet: true });
    if (!cur.seconds) return;
    const t = setTimeout(() => (step < cs!.steps.length - 1 ? setStep(step + 1) : finish()), cur.seconds * 1000);
    return () => clearTimeout(t);
  }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const next = () => (cs && step < cs.steps.length - 1 ? setStep(step + 1) : finish());
  return (
    <AnimatePresence>
      {open && cs && cur ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Cutscene: ${cs.name}`}
          // A step where someone acts on the stage lets the stage show through above the text.
          className={cx('fixed inset-0 z-[60] flex flex-col text-white', !cur.background && (cur.emote || cur.outfit !== undefined) ? 'bg-gradient-to-b from-black/10 via-black/30 to-black/90' : 'bg-black')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.5 }}
        >
          {cur.background ? <img src={`/media/${cur.background}`} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" /> : null}
          <div className="relative flex items-center justify-between px-4 pt-[calc(var(--safe-top)+12px)]">
            <span className="text-xs uppercase tracking-[0.2em] text-white/60">{cs.name}</span>
            <Button size="sm" variant="ghost" className="!text-white hover:!bg-white/10" onClick={finish}>
              Skip
            </Button>
          </div>
          <button type="button" className="relative mt-auto w-full px-6 pb-[calc(var(--safe-bottom)+32px)] text-left" onClick={next} aria-label="Next">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} className="mx-auto max-w-[720px]">
                {cur.speaker ? <p className="mb-1 text-sm font-semibold text-white/80">{cur.speaker}</p> : null}
                <p className="story text-[20px] leading-relaxed">{cur.text}</p>
              </motion.div>
            </AnimatePresence>
            <p className="mx-auto mt-4 max-w-[720px] text-xs text-white/50">
              {step + 1}/{cs.steps.length} · tap to continue
            </p>
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
