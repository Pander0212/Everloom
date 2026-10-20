/**
 * Character Studio looks on the story stage. Everything comes from the message's state, so a swipe
 * or an edit puts it back: each character stands in their pose template (`studio.pose`, else the
 * first standing template that fits them), wears what they have equipped (when the template has
 * art for it) and makes the face of the story's emotion. A `studio.scene` fills the stage with its
 * template and cast, and its options appear as a choice menu that records a `studio.option`.
 */
import { expressionForEmotion, wardrobeFromItems, type TraitSheet } from '@everloom/engine/studio';
import type { Op } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { DollView } from './DollView';

interface TemplateRow { id: string; name: string; category: string; rating: string; supports: { wardrobe?: Record<string, string[]> }; options: Array<{ id: string; label: string; values: Array<{ id: string; label: string }>; default?: string }>; slots: Array<{ sex: string[] }>; tags: string[]; base: string }

export interface LooksCast {
  id: string;
  name: string;
  sheet: TraitSheet;
  slot?: string;
  pose: { template: string; expression: string | null } | null;
  emotion: string | null;
  equipped: Array<{ name: string; tags?: string[] }>;
}
export interface LooksScene { template: string; who: string[]; options: Record<string, string> }

const X: Record<string, string> = { left: '18%', center: '50%', right: '82%' };

export function useLooksTemplates(enabled = true) {
  return useQuery({ queryKey: ['paperdoll', 'templates'], queryFn: () => get<TemplateRow[]>('/api/paperdoll/templates'), enabled, staleTime: 60_000 });
}

function poseTemplate(all: TemplateRow[], c: LooksCast): TemplateRow | null {
  const fits = (t: TemplateRow) => t.slots.some((s) => s.sex.includes(c.sheet.sex)) && t.rating === 'all-ages';
  const wanted = c.pose ? all.find((t) => t.id === c.pose!.template && t.slots.some((s) => s.sex.includes(c.sheet.sex))) : null;
  return wanted ?? all.find((t) => fits(t) && t.category === 'standing' && t.tags.includes('neutral')) ?? all.find((t) => fits(t) && t.category === 'standing') ?? null;
}

export default function LooksStageLayer({ cast, scene, onOp, safeBottom = 0.3 }: { cast: LooksCast[]; scene: LooksScene | null; onOp: (op: Op) => void; safeBottom?: number }) {
  const templates = useLooksTemplates();
  const all = templates.data ?? [];
  const dress = (c: LooksCast, t: TemplateRow): TraitSheet => ({ ...c.sheet, wardrobe: wardrobeFromItems(c.sheet, c.equipped, t.supports.wardrobe ?? {}) });

  if (scene) {
    const t = all.find((x) => x.id === scene.template);
    const who = scene.who.map((n) => cast.find((c) => c.name.toLowerCase() === n.toLowerCase())).filter(Boolean) as LooksCast[];
    if (!t || !who.length) return null;
    return (
      <div className="pointer-events-none absolute inset-0" data-testid="looks-scene" data-template={t.id}>
        <DollView base={t.base} cast={who.map((c) => dress(c, t))} state={{ options: scene.options, expression: expressionForEmotion(who[0]!.emotion), explicit: t.rating === '18+' }} fit="cover" className="h-full w-full" testId="looks-scene-canvas" />
        {t.options.length ? (
          <div className="pointer-events-auto absolute left-1/2 top-4 flex w-[min(92%,36rem)] -translate-x-1/2 flex-col gap-2" role="group" aria-label="Scene choices" data-testid="looks-choices">
            {t.options.flatMap((o) => o.values.map((v) => {
              const on = (scene.options[o.id] ?? o.default ?? o.values[0]!.id) === v.id;
              return (
                <button key={`${o.id}:${v.id}`} type="button" aria-pressed={on} onClick={() => onOp({ type: 'studio.option', option: o.id, value: v.id } as Op)}
                  className="pressable flex items-center gap-3 rounded-md bg-accent/85 px-3 py-2 text-left text-sm text-white shadow aria-pressed:ring-2 aria-pressed:ring-white">
                  <span className="text-xs opacity-80">{o.label}</span><span>{v.label}</span>
                </button>
              );
            }))}
          </div>
        ) : null}
      </div>
    );
  }

  const shown = cast.filter((c) => c.slot !== 'off');
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="looks-stage">
      {shown.map((c, i) => {
        const t = poseTemplate(all, c);
        if (!t) return null;
        const left = c.slot && X[c.slot] ? X[c.slot] : `${((i + 1) / (shown.length + 1)) * 100}%`;
        return (
          <div key={c.id} className="absolute -translate-x-1/2" style={{ left, bottom: `${safeBottom * 100 - 3}%`, height: `${(1 - safeBottom) * 92}%`, width: `${Math.min(60, 100 / shown.length + 10)}%` }} data-testid="looks-character" data-template={t.id}>
            <DollView base={t.base} cast={[dress(c, t)]} state={{ expression: c.pose?.expression ?? expressionForEmotion(c.emotion) }} className="h-full w-full" testId={`looks-doll-${c.id}`} />
          </div>
        );
      })}
    </div>
  );
}
