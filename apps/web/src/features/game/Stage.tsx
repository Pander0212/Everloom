import type { CampaignDTO, CharacterDTO, ChatDTO, MessageDTO, Op, StageAnim, StageLayer } from '@everloom/engine';
import { useFeatureOn } from '@/lib/features';
import { stripInlineTags } from '@everloom/engine';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, History, RefreshCw, Rotate3d, Sparkles } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get } from '@/lib/api';
import { cx } from '@/lib/format';
import { renderStory } from '@/lib/render';
import { t } from '@/lib/motion';
import { qk, useGroups, usePersonas, useSettings } from '@/lib/queries';
import { Avatar, IconButton, Popover, Sheet, useDesktop } from '@/ui';
import type { MessageActions } from '@/features/story/Message';
import { Atmosphere } from './Atmosphere';
import { useGame } from './context';
import { hasWebGL2, usePrefs3D } from '@/features/avatars/prefs';
import { normalizeName } from '@everloom/engine';
import { FX_LIST, useSceneMotion } from './StageFx';

const Live2DSprite = lazy(() => import('./Live2DSprite'));
// Only fetched when a character on stage has a 3D avatar and 3D is on for this device.
const StageLayer3D = lazy(() => import('@/features/avatar3d/StageLayer'));


/** Gentle life on the sprite: breathing while idle, a small bob while its line is being spoken. */
const IDLE = { scaleY: [1, 1.012, 1], transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } };
const SPEAKING = { y: [0, -5, 0], transition: { duration: 0.45, repeat: Infinity, ease: 'easeInOut' } };

const X: Record<string, string> = { left: '18%', center: '50%', right: '82%' };
const ANIM: Record<StageAnim, Record<string, unknown> | null> = {
  none: null,
  bounce: { y: [0, -26, 0, -10, 0], transition: { duration: 0.7 } },
  nod: { rotate: [0, 3, -2, 0], y: [0, 6, 0], transition: { duration: 0.6 } },
  shake: { x: [0, -12, 12, -8, 8, 0], transition: { duration: 0.5 } },
  'slide-in': { x: ['-40vw', '0vw'], opacity: [0, 1], transition: { duration: 0.6 } },
  'fade-in': { opacity: [0, 1], transition: { duration: 0.6 } },
};

/** Quoted speech and the narration around it. */
export function splitSpeech(text: string): { speech: string; narration: string } {
  const quotes = [...text.matchAll(/[“"]([^”"]{2,})[”"]/g)].map((m) => m[1]!.trim());
  // A speech tag right after a quote ("…," she says.) belongs to the bubble, not the narration.
  const tag = String.raw`(?:\s*,?\s*(?:he|she|they|I|[A-Z][\w'-]*(?: [A-Z][\w'-]*)?)\s+(?:says|said|asks|asked|whispers|whispered|murmurs|murmured|replies|replied|adds|added|calls|called)(?:\s+(?:softly|quietly|again))?[.,]?)?`;
  const narration = text.replace(new RegExp(`[“"][^”"]{2,}[”"]${tag}`, 'g'), ' ').replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  return { speech: quotes.join(' '), narration };
}

export interface StageProps {
  chat: ChatDTO;
  messages: MessageDTO[];
  campaign: CampaignDTO | null;
  busy: boolean;
  actions: MessageActions;
  streamText: string | null;
  streamingId: string | null;
  composer: ReactNode;
}

function useTypewriter(text: string, key: string, instant: boolean) {
  const [shown, setShown] = useState(instant ? text.length : 0);
  const done = useRef(instant);
  useEffect(() => {
    done.current = instant;
    setShown(instant ? text.length : 0);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (done.current) {
      setShown(text.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const add = Math.max(1, Math.floor((now - last) / 14));
      last = now;
      setShown((s) => {
        const next = Math.min(text.length, s + add);
        if (next >= text.length) done.current = true;
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return { shown: Math.min(shown, text.length), finish: () => ((done.current = true), setShown(text.length)), complete: shown >= text.length };
}

export default function Stage({ chat, messages, campaign, busy, actions, streamText, streamingId, composer }: StageProps) {
  const visible = useMemo(() => messages.filter((m) => !m.hidden), [messages]);
  const [idx, setIdx] = useState(visible.length - 1);
  const [log, setLog] = useState(false);
  const atEnd = useRef(true);
  const groups = useGroups();
  const personas = usePersonas();
  const qc = useQueryClient();
  const group = chat.groupId ? groups.data?.find((g) => g.id === chat.groupId) : null;
  const memberIds = group ? group.members.map((m) => m.characterId) : chat.characterId ? [chat.characterId] : [];
  const chars = useQueries({ queries: memberIds.map((id) => ({ queryKey: qk.character(id), queryFn: () => get<CharacterDTO>(`/api/characters/${id}`) })) }).map((q) => q.data).filter(Boolean) as CharacterDTO[];
  const persona = personas.data?.find((p) => p.id === chat.personaId) ?? personas.data?.find((p) => p.isDefault);
  const { apply } = useGame();
  const settings = useSettings();
  const weatherOn = useFeatureOn('weather');
  const live2dFeature = useFeatureOn('live2d');
  const live2dOn = settings.data?.stage?.live2d === true && live2dFeature;
  const live2d = useQuery({ queryKey: ['live2d'], queryFn: () => get<{ coreInstalled: boolean; coreUrl: string | null; models: Record<string, string> }>('/api/live2d'), enabled: live2dOn });
  const fxOff = settings.data?.stage?.fxOff ?? [];
  const sceneAnim = useSceneMotion(campaign?.state ?? null, fxOff);
  const reduceMotion = useReducedMotion();
  const layers = Object.values(campaign?.state?.stage?.layers ?? {});
  const layerFor = (c: CharacterDTO): StageLayer | undefined => layers.find((l) => l.name.toLowerCase() === c.name.toLowerCase() || l.name.toLowerCase().split(' ')[0] === c.name.toLowerCase().split(' ')[0]);
  const directed = layers.length > 0;
  // 3D characters: feature on, this device allows it, the character has an avatar and wants 3D.
  const avatarsOn = useFeatureOn('avatars3d');
  const stageWide = useDesktop();
  const [inspect3d, setInspect3d] = useState(false);
  const spritesOnly = usePrefs3D((p) => p.spritesOnly);
  const [failed3d, setFailed3d] = useState<Record<string, string>>({});
  const uses3d = (c: CharacterDTO) => avatarsOn && !spritesOnly && !!c.game?.avatar3d && (c.game.display ?? 'auto') !== 'sprite' && (c.game.display ?? 'auto') !== 'live2d' && !failed3d[c.id] && hasWebGL2();

  useEffect(() => {
    if (atEnd.current) setIdx(visible.length - 1);
  }, [visible.length]);
  useEffect(() => {
    if (streamingId) {
      const i = visible.findIndex((m) => m.id === streamingId);
      if (i >= 0) setIdx(i);
    }
  }, [streamingId, visible]);
  const m = visible[Math.max(0, Math.min(idx, visible.length - 1))];
  atEnd.current = idx >= visible.length - 1;
  const live = m && streamingId === m.id ? streamText ?? '' : null;
  const text = stripInlineTags(live ?? m?.swipes[m.swipeId]?.text ?? '');
  const tw = useTypewriter(text, `${m?.id}:${m?.swipeId}`, !!live || !atEnd.current || Date.now() - (m?.updatedAt ?? 0) > 20000);
  const html = useMemo(() => renderStory(text.slice(0, tw.shown)), [text, tw.shown]);
  const speaker = m?.role === 'assistant' ? chars.find((c) => c.id === m.characterId) ?? chars[0] : null;
  const emotion = (m?.extra?.emotion as string) || 'neutral';
  const spriteFor = (c: CharacterDTO, emo: string) => {
    const ex = c.game?.expressions ?? {};
    const id = ex[emo] ?? ex.neutral;
    return id ? `/media/${id}` : c.avatar;
  };
  const bg = chat.metadata.background ? `/media/${chat.metadata.background}` : null;
  const lastAssistant = [...visible].reverse().find((x) => x.role === 'assistant');
  const isLast = m && m.id === visible[visible.length - 1]?.id;
  // Speech bubbles: spoken lines over the speaker, narration above (only once the line is complete).
  const split = settings.data?.stage?.bubbles && m?.role === 'assistant' && !live ? splitSpeech(text) : null;
  // Tapping a bubble opens the whole line in the dialogue box (until the next line).
  const [expanded, setExpanded] = useState<string | null>(null);
  const lineKey = `${m?.id}:${m?.swipeId}`;
  const bubble = split?.speech && expanded !== lineKey ? split : null;
  const speakerLayer = speaker ? layerFor(speaker) : undefined;
  const bubbleSide = speakerLayer?.position && speakerLayer.position !== 'off' ? speakerLayer.position : 'center';
  // Whose line is being spoken right now (streaming or still typing out).
  const speakingId = speaker && (live != null || !tw.complete) ? speaker.id : null;
  void qc;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-2">
      <motion.div className="absolute inset-0" animate={(sceneAnim ?? undefined) as any}>
        {/* Scene */}
        <div className="absolute inset-0">
          {bg ? <img src={bg} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full" style={{ background: 'radial-gradient(120% 90% at 50% 20%, var(--surface-3), var(--bg))' }} />}
          {weatherOn ? <Atmosphere state={campaign?.state ?? null} /> : null}
        </div>
        {chars.some(uses3d) ? (
          <Suspense fallback={null}>
            <StageLayer3D
              className="pointer-events-none absolute inset-0"
              safeBottom={stageWide ? 0.3 : 0.36}
              inspect={inspect3d}
              speakerId={speakingId ?? speaker?.id ?? null}
              scene={campaign?.state ? { hour: ((campaign.state.time?.minutes ?? 720) / 60) % 24, weather: campaign.state.weather?.kind ?? null, locationKind: campaign.state.currentLocationId ? (campaign.state.locations[campaign.state.currentLocationId]?.kind ?? null) : null } : null}
              onFail={(id, reason) => setFailed3d((f) => (f[id] ? f : { ...f, [id]: reason }))}
              cast={chars.filter(uses3d).flatMap((c) => {
                const layer = layerFor(c);
                if (directed && (!layer || layer.position === 'off')) return [];
                const active = speaker?.id === c.id || chars.length === 1;
                const av = campaign?.state?.stage?.avatars?.[normalizeName(c.name)];
                return [{ id: c.id, avatarId: c.game!.avatar3d!, slot: layer?.position, emotion: layer?.expression ?? (active ? emotion : 'neutral'), speaking: speakingId === c.id, emote: av?.emote ?? null, pose: av?.pose ?? null }];
              })}
            />
          </Suspense>
        ) : null}
        {/* Sprites: placed by the director when it has spoken, otherwise side by side */}
        <div className={cx('pointer-events-none absolute inset-x-0 bottom-0 top-0 px-2 pb-[38%] sm:pb-[22%]', !directed && 'flex items-end justify-center gap-0')}>
          {chars.map((c) => {
            const layer = layerFor(c);
            if (directed && (!layer || layer.position === 'off')) return null;
            if (uses3d(c)) return null;
            const active = speaker?.id === c.id || chars.length === 1;
            const expr = layer?.expression ?? (active ? emotion : 'neutral');
            const src = spriteFor(c, expr);
            const img = src ? <motion.img key={src} src={src} alt={c.name} className="absolute inset-0 h-full w-full object-contain object-bottom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} /> : null;
            const model = live2dOn && live2d.data?.coreUrl ? live2d.data.models[c.id] : undefined;
            return (
              <motion.div
                key={`${c.id}:${layer?.cue ?? 0}`}
                data-testid="stage-sprite"
                data-position={layer?.position ?? 'auto'}
                className={cx('min-w-0', directed ? 'absolute bottom-[38%] h-[52%] w-[42%] max-w-[420px] -translate-x-1/2 sm:bottom-[22%]' : 'relative h-[62%] max-h-[640px] flex-1')}
                style={directed ? { left: X[layer!.position] } : { maxWidth: chars.length > 1 ? `${90 / chars.length}%` : '70%' }}
                initial={false}
                animate={{ opacity: active ? 1 : 0.55, scale: active ? 1 : 0.96, ...((layer && ANIM[layer.anim]) || {}) } as any}
                transition={t.slow}
              >
                <motion.div
                  className="absolute inset-0"
                  style={{ transformOrigin: '50% 100%' }}
                  data-motion={reduceMotion ? 'still' : speakingId === c.id ? 'speaking' : 'idle'}
                  animate={(reduceMotion ? { y: 0, scaleY: 1 } : speakingId === c.id ? SPEAKING : IDLE) as any}
                >
                  {model ? (
                    <Suspense fallback={img}>
                      <Live2DSprite coreUrl={live2d.data!.coreUrl!} modelUrl={model} expression={expr} fallback={img} lipSync={speaker?.id === c.id} />
                    </Suspense>
                  ) : (
                    <AnimatePresence initial={false}>{img}</AnimatePresence>
                  )}
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
      {/* Quick effects */}
      <div className="absolute right-3 top-3 z-20 flex flex-col gap-2">
        <Popover trigger={<IconButton icon={Sparkles} label="Scene effects" className="!bg-surface/90 shadow-1" />} side="bottom" align="end">
          <div className="grid w-56 grid-cols-2 gap-1 p-1" role="group" aria-label="Scene effects">
            {FX_LIST.filter((f) => !fxOff.includes(f.id)).map((f) => (
              <button key={f.id} className="pressable rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => void apply({ type: 'fx.play', effect: f.id } as Op, { quiet: true })}>
                {f.label}
              </button>
            ))}
          </div>
        </Popover>
        {chars.some(uses3d) ? <IconButton icon={Rotate3d} label={inspect3d ? 'Stop looking around' : 'Look around'} active={inspect3d} className="!bg-surface/90 shadow-1" onClick={() => setInspect3d((v) => !v)} /> : null}
      </div>
      <div className="relative z-10 mt-auto">
        {/* Dialogue box */}
        {m ? (
          <div className="mx-auto w-full max-w-[760px] px-3 sm:px-4">
            <div className="flex items-center gap-1 pb-1.5">
              <span className="rounded-sm bg-surface px-2.5 py-1 text-sm font-semibold text-fg shadow-1">{m.role === 'user' ? persona?.name ?? m.name : m.name}</span>
              <span className="flex-1" />
              <IconButton size="sm" icon={History} label="History" className="!bg-surface shadow-1" onClick={() => setLog(true)} />
            </div>
            {bubble ? (
              <button type="button" onClick={() => setExpanded(lineKey)} className="block w-full text-left" aria-label="Speech bubble — tap for the full line">
                {bubble.narration ? <p className="story mb-2 rounded-md bg-surface/85 px-3 py-2 text-[14px] italic text-fg-2 shadow-1">{bubble.narration}</p> : null}
                <span className="relative block rounded-2xl bg-surface px-4 py-3 shadow-3" data-testid="speech-bubble" style={{ marginLeft: bubbleSide === 'right' ? 'auto' : bubbleSide === 'center' ? 'auto' : 0, marginRight: bubbleSide === 'left' ? 'auto' : bubbleSide === 'center' ? 'auto' : 0, maxWidth: '85%' }}>
                  <span className="story block text-[17px]">{bubble.speech}</span>
                  <span aria-hidden="true" className="absolute -top-2 size-4 rotate-45 bg-surface" style={{ left: bubbleSide === 'right' ? 'auto' : bubbleSide === 'center' ? 'calc(50% - 8px)' : 28, right: bubbleSide === 'right' ? 28 : 'auto' }} />
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => (tw.complete ? (idx < visible.length - 1 ? setIdx(idx + 1) : undefined) : tw.finish())}
                className="block max-h-[34dvh] w-full overflow-y-auto rounded-lg bg-surface px-4 py-3 text-left shadow-3 [&_.story]:text-[16px] sm:max-h-[30dvh]"
                aria-label="Dialogue — tap to reveal or advance"
              >
                {text ? <div className="story" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="typing"><span /><span /><span /></span>}
              </button>
            )}
            <div className="flex items-center justify-between py-1 text-fg-2">
              <div className="flex items-center gap-0.5 rounded-md bg-surface/90 shadow-1">
                <IconButton size="sm" icon={ChevronLeft} label="Previous line" disabled={idx <= 0} onClick={() => setIdx(idx - 1)} />
                <span className="w-12 text-center text-xs tabular-nums">
                  {Math.min(idx, visible.length - 1) + 1}/{visible.length}
                </span>
                <IconButton size="sm" icon={ChevronRight} label="Next line" disabled={idx >= visible.length - 1} onClick={() => setIdx(idx + 1)} />
              </div>
              {isLast && m.role === 'assistant' && lastAssistant?.id === m.id ? (
                <div className="flex items-center gap-0.5 rounded-md bg-surface/90 shadow-1">
                  <IconButton size="sm" icon={ChevronLeft} label="Previous swipe" disabled={busy || m.swipeId === 0} onClick={() => actions.onSwipe(m, -1)} />
                  <span className="w-10 text-center text-xs tabular-nums">
                    {m.swipeId + 1}/{m.swipes.length}
                  </span>
                  <IconButton size="sm" icon={ChevronRight} label={m.swipeId === m.swipes.length - 1 ? 'New swipe' : 'Next swipe'} disabled={busy} onClick={() => actions.onSwipe(m, 1)} />
                  <IconButton size="sm" icon={RefreshCw} label="Regenerate" disabled={busy} onClick={actions.onRegenerate} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="bg-gradient-to-t from-bg from-40% to-transparent">{composer}</div>
      </div>
      <Sheet open={log} onOpenChange={setLog} title="History" size="lg">
        <div className="flex flex-col divide-y divide-line">
          {visible.map((x, i) => (
            <button
              key={x.id}
              onClick={() => {
                setIdx(i);
                setLog(false);
              }}
              className={cx('pressable flex gap-3 py-3 text-left', i === idx && 'bg-accent-soft')}
            >
              <Avatar name={x.name} src={x.role === 'user' ? persona?.avatar : chars.find((c) => c.id === x.characterId)?.avatar} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-fg-2">{x.name}</span>
                <span className="line-clamp-3 text-sm">{stripInlineTags(x.swipes[x.swipeId]?.text ?? '')}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
