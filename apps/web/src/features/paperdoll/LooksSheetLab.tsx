/**
 * Contact sheet for installed Character Studio templates (/lab/looks-sheet): every template with
 * seeded random characters, every body type at its smallest and largest sizes, and every hairstyle
 * and expression it has art for, drawn by the real compositor (no motion). Composite timings
 * (first build and cached) are shown for the performance check. Used for template review and the
 * acceptance evidence.
 */
import { BODY_TYPES, composeScene, randomSheet, TraitSheetSchema, type Template, type TraitSheet } from '@everloom/engine/studio';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { compositeSlot } from './compositor';
import { loadTemplate } from './DollView';

interface TemplateRow { id: string; name: string; base: string }

function Tile({ t, base, sheet, expression, label, onTime }: { t: Template; base: string; sheet: TraitSheet; expression?: string; label: string; onTime: (ms: number, cached: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      const plan = composeScene(t, [sheet], { expression }).slots[0]!;
      const t0 = performance.now();
      const c = await compositeSlot(t, base, plan);
      const t1 = performance.now();
      await compositeSlot(t, base, plan);
      onTime(t1 - t0, performance.now() - t1);
      if (!live || !ref.current) return;
      const g = ref.current.getContext('2d')!;
      g.clearRect(0, 0, ref.current.width, ref.current.height);
      const s = Math.min(ref.current.width / t.width, ref.current.height / t.height);
      g.drawImage(c, (ref.current.width - t.width * s) / 2, ref.current.height - t.height * s, t.width * s, t.height * s);
      setReady(true);
    })().catch(() => {});
    return () => { live = false; };
  }, [t, base, sheet, expression, onTime]);
  return (
    <figure className="m-0 flex flex-col items-center gap-1 rounded-md border border-line bg-surface p-1">
      <canvas ref={ref} width={160} height={260} data-ready={ready ? 'true' : 'false'} className="h-[195px] w-[120px]" />
      <figcaption className="max-w-[120px] truncate text-center text-[11px] text-muted">{label}</figcaption>
    </figure>
  );
}

function TemplateSheet({ row }: { row: TemplateRow }) {
  const [t, setT] = useState<Template | null>(null);
  const times = useRef<{ first: number[]; cached: number[] }>({ first: [], cached: [] });
  const [stats, setStats] = useState('');
  useEffect(() => { loadTemplate(row.base).then(setT).catch(() => {}); }, [row.base]);
  const onTime = useRef((first: number, cached: number) => {
    times.current.first.push(first); times.current.cached.push(cached);
    const avg = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
    setStats(`${times.current.first.length} composites · first build ${avg(times.current.first)} ms · cached ${avg(times.current.cached)} ms`);
  }).current;
  if (!t) return null;
  const sex = t.slots[0]!.sex[0]!;
  const wardrobe = Object.fromEntries(Object.entries(t.supports.wardrobe).map(([slot, items]) => [slot, items?.[0] ?? null]));
  const sheet = (o: object) => TraitSheetSchema.parse({ name: 'Sample', sex, age: 30, wardrobe, ...o });
  const tiles: Array<{ label: string; sheet: TraitSheet; expression?: string }> = [];
  for (let i = 1; i <= 8; i++) {
    const s = randomSheet({ seed: i * 7919, sex });
    // Random outfits from the template's own items (the server does this from every template).
    const w = Object.fromEntries(Object.entries(t.supports.wardrobe).map(([slot, items]) => [slot, items?.length ? items[i % (items.length + 1)] ?? null : null]));
    tiles.push({ label: `random ${i} · ${s.body.type}`, sheet: { ...s, wardrobe: { ...s.wardrobe, ...w } } });
  }
  for (const type of BODY_TYPES) for (const size of ['small', 'large'] as const) tiles.push({ label: `${type} / ${size}`, sheet: sheet({ body: { type, breast: size, hips: size } }) });
  for (const back of t.supports.hairBack) tiles.push({ label: `hair ${back}`, sheet: sheet({ hair: { back, color: '#6b4426' } }) });
  for (const e of t.supports.expressions) tiles.push({ label: `expression ${e}`, sheet: sheet({}), expression: e });
  return (
    <section className="flex flex-col gap-2" data-testid={`sheet-${t.id}`}>
      <h2 className="text-base font-semibold">{t.name} <span className="text-muted">({t.id}, {t.rating})</span></h2>
      <p className="text-xs text-muted" data-testid={`sheet-stats-${t.id}`}>{stats}</p>
      <div className="flex flex-wrap gap-2">{tiles.map((x, i) => <Tile key={i} t={t} base={row.base} sheet={x.sheet} expression={x.expression} label={x.label} onTime={onTime} />)}</div>
    </section>
  );
}

export default function LooksSheetLab() {
  const templates = useQuery({ queryKey: ['paperdoll', 'templates'], queryFn: () => get<TemplateRow[]>('/api/paperdoll/templates') });
  return (
    <main className="min-h-screen bg-bg p-4 text-fg">
      <h1 className="mb-3 text-lg font-semibold">Character Studio contact sheet</h1>
      {templates.data?.length === 0 && <p>No templates installed. Install a pack on the Looks page.</p>}
      <div className="flex flex-col gap-6">{templates.data?.map((r) => <TemplateSheet key={r.id} row={r} />)}</div>
    </main>
  );
}
