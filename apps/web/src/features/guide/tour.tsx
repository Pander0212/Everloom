/**
 * The first-run guide: five or six things that matter, matched to how Everloom is used (Classic chat,
 * Story, Full RPG). It opens once after first-run setup and any time from the palette ("Take the
 * tour"); Skip ends it. Modules that are off are never mentioned.
 */
import type { FeatureSet } from '@everloom/engine';
import type { LucideIcon } from 'lucide-react';
import { Activity, Brain, ChevronRight, LayoutGrid, MessageSquare, Palette, Plug, RefreshCw, ToggleRight, Undo2, Map, Clapperboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { patch } from '@/lib/api';
import { cx } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import { Button, Dialog, Icon } from '@/ui';

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
}

type Kind = 'classic' | 'story' | 'full';

const START: Step = { icon: MessageSquare, title: 'Chats', body: 'Every story is a chat. Tap New chat, pick a character, and say something. An empty message box with Send asks the AI for the next part of the story.' };
const VERSIONS: Step = { icon: RefreshCw, title: 'Not happy with a reply?', body: 'Tap › under the newest reply for a new version (or swipe it sideways); the old ones stay. Tap any message for Edit, Copy, Delete and More.' };
const TOOLS: Step = { icon: LayoutGrid, title: 'Everything else: Tools', body: 'The Tools button next to the message box (or Ctrl K) finds every tool, setting, place, item and person by name, with one line on what each does. Pin the ones you use.' };
const MODEL: Step = { icon: Plug, title: 'Which AI writes', body: 'Settings › Models & connections: add your AI service and pick the Main model. A chat can use its own model (This chat).' };
const FEATURES: Step = { icon: ToggleRight, title: 'Turn things on or off', body: 'Settings › Features: Classic chat, Story or Full RPG, or single parts. Off means gone: no buttons, no extra AI calls.' };
const LOOKS: Step = { icon: Palette, title: 'Make it yours', body: 'Settings › Appearance & themes: pick a theme from the gallery, the text size and spacing. Each world can have its own theme.' };

export function tourSteps(kind: Kind, f?: FeatureSet): Step[] {
  if (kind === 'classic') return [START, VERSIONS, TOOLS, MODEL, FEATURES, LOOKS];
  const memory: Step = { icon: Brain, title: 'The story remembers', body: 'Memory keeps a summary the AI reads every turn, and Note to the AI holds a standing instruction such as "short replies". Both are in Tools › Story tools.' };
  const stage: Step = { icon: Clapperboard, title: 'Stage view', body: 'The book button at the top shows the scene like a visual novel: characters, backgrounds, one line at a time. Tap it again for the chat.' };
  if (kind === 'story') return [START, VERSIONS, memory, ...(f?.on.stage === false ? [] : [stage]), TOOLS, FEATURES];
  const status: Step = { icon: Activity, title: 'The status bar', body: 'Time, weather, place and your bars at the top. Tap the place to open the map, the money to see your wallet, anything else for your status.' };
  const world: Step = { icon: Map, title: 'Your things and the world', body: 'Inventory, Map and Journal are pinned in Tools. The story adds items, places, people and quests as you play.' };
  const undo: Step = { icon: Undo2, title: 'The story got it wrong?', body: 'Tools › Story changes lists everything the story changed, with Undo for each. Swiping to another version undoes that version’s changes by itself.' };
  return [START, status, world, VERSIONS, undo, TOOLS];
}

const kindOf = (f: FeatureSet): Kind => (f.on.inventory || f.on.map ? 'full' : f.on.game || f.memory !== 'off' ? 'story' : 'classic');

/** Opens the tour for the switches in force. */
export function openTour(f: FeatureSet) {
  document.dispatchEvent(new CustomEvent('everloom:tour', { detail: kindOf(f) }));
}

/** Set by first-run setup, so the tour opens once the app is there. */
export function queueTour(kind: Kind) {
  try {
    sessionStorage.setItem('everloom.tour', kind);
  } catch {
    /* private mode: no tour */
  }
}

export function TourHost() {
  const settings = useSettings();
  const [kind, setKind] = useState<Kind | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      setI(0);
      setKind((e as CustomEvent).detail as Kind);
    };
    document.addEventListener('everloom:tour', on);
    try {
      const q = sessionStorage.getItem('everloom.tour') as Kind | null;
      if (q) {
        sessionStorage.removeItem('everloom.tour');
        setKind(q);
      }
    } catch {
      /* private mode */
    }
    return () => document.removeEventListener('everloom:tour', on);
  }, []);
  if (!kind) return null;
  const steps = tourSteps(kind);
  const step = steps[Math.min(i, steps.length - 1)]!;
  const last = i >= steps.length - 1;
  const close = () => {
    const seen = settings.data?.ui?.tours ?? [];
    if (!seen.includes(kind)) void patch('/api/settings', { ui: { tours: [...seen, kind] } }).catch(() => {});
    setKind(null);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={step.title}
      description={`${i + 1} of ${steps.length}`}
      footer={
        <div className="flex w-full items-center gap-2">
          <Button variant="ghost" onClick={close}>
            {last ? 'Close' : 'Skip'}
          </Button>
          <span className="flex-1" />
          {i > 0 ? (
            <Button variant="secondary" onClick={() => setI(i - 1)}>
              Back
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? 'Start' : (
              <span className="flex items-center gap-1">
                Next <Icon icon={ChevronRight} size={16} />
              </span>
            )}
          </Button>
        </div>
      }
    >
      <div className="ev-tour flex flex-col items-center gap-4 py-2 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <Icon icon={step.icon} size={26} />
        </span>
        <p className="text-sm leading-6 text-fg-2">{step.body}</p>
        <div className="flex gap-1.5" aria-hidden="true">
          {steps.map((_, k) => (
            <span key={k} className={cx('h-1.5 rounded-full transition-all', k === i ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong')} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
