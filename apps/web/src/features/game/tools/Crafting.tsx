import { allRecipes, craftCheck, DISCIPLINES, disciplineLevel, xpForCraftLevel, type CampaignState, type Discipline, type Op, type Recipe } from '@everloom/engine';
import { Anvil, ChefHat, FlaskConical, Gem, Sparkles, Wrench } from 'lucide-react';
import { useState } from 'react';
import { post } from '@/lib/api';
import { cx } from '@/lib/format';
import { toastError } from '@/lib/store';
import { Badge, Button, EmptyState, Input, Select, Sheet, TabPanel, Tabs } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

const ICON = { cooking: ChefHat, alchemy: FlaskConical, forge: Anvil, enchantment: Gem, general: Wrench } as const;

export default function Crafting({ arg }: { arg?: string }) {
  const { state: s } = useGame();
  const [tab, setTab] = useState<Discipline>((DISCIPLINES.find((d) => d.id === arg)?.id as Discipline) ?? 'cooking');
  if (!s) return <NoCampaign />;
  return (
    <ToolSheet title="Crafting">
      <Tabs value={tab} onChange={(v) => setTab(v as Discipline)} tabs={DISCIPLINES.map((d) => ({ value: d.id, label: d.label }))}>
        {DISCIPLINES.map((d) => (
          <TabPanel key={d.id} value={d.id} className="pt-4">
            <DisciplineView s={s} d={d.id} />
          </TabPanel>
        ))}
      </Tabs>
    </ToolSheet>
  );
}

function DisciplineView({ s, d }: { s: CampaignState; d: Discipline }) {
  const recipes = allRecipes(s).filter((r) => r.discipline === d);
  const level = disciplineLevel(s, d);
  const xp = s.player.crafting?.[d]?.xp ?? 0;
  const [suggest, setSuggest] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Level {level}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (xp / xpForCraftLevel(level)) * 100)}%` }} />
        </span>
        <span className="text-xs tabular-nums text-fg-2">
          {xp}/{xpForCraftLevel(level)} XP
        </span>
      </div>
      {recipes.length ? (
        <ul className="flex flex-col gap-2" aria-label="Recipes">
          {recipes.map((r) => (
            <RecipeRow key={r.id} s={s} r={r} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={ICON[d]} title="No recipes yet" />
      )}
      <Button variant="quiet" icon={Sparkles} className="self-start" onClick={() => setSuggest(true)}>
        Suggest a recipe
      </Button>
      <SuggestSheet open={suggest} onOpenChange={setSuggest} discipline={d} />
    </div>
  );
}

function RecipeRow({ s, r }: { s: CampaignState; r: Recipe }) {
  const { apply } = useGame();
  const gear = Object.values(s.inventory).filter((i) => !i.holder && ['weapon', 'armor', 'clothing', 'accessory'].includes(i.category));
  const [target, setTarget] = useState('');
  const check = craftCheck(s, r, r.enchant ? (s.inventory[target] ?? null) : null);
  const time = r.minutes >= 60 ? `${Math.round((r.minutes / 60) * 10) / 10} h` : `${r.minutes} min`;
  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{r.name}</span>
            {r.source !== 'builtin' ? <Badge>{r.source === 'ai' ? 'suggested' : 'yours'}</Badge> : null}
          </span>
          <span className="block text-xs text-fg-2">
            {r.ingredients.map((i) => `${i.qty}× ${i.name}`).join(', ')} · {time} · {r.difficulty}
            {r.level ? ` · level ${r.level}` : ''}
          </span>
        </span>
        <span className={cx('text-xs tabular-nums', check.ok ? 'text-fg-2' : 'text-fg-3')}>{Math.round(check.odds * 100)}%</span>
      </div>
      {r.enchant ? (
        <Select aria-label={`Item to enchant with ${r.name}`} value={target} onChange={(e) => setTarget(e.target.value)} className="mt-2">
          <option value="">Choose gear to enchant…</option>
          {gear.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.quality ? ` (${g.quality})` : ''} · {(g.enchantments?.length ?? 0)}/{g.enchantSlots ?? 1} slots
            </option>
          ))}
        </Select>
      ) : null}
      {check.problems.length ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-fg-2">
          {check.problems.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        {check.station ? <span className="min-w-0 flex-1 truncate text-xs text-fg-2">At {check.station}</span> : <span className="flex-1" />}
        <Button size="sm" variant={check.ok ? 'primary' : 'secondary'} disabled={!check.ok} onClick={() => apply({ type: 'craft', recipe: r.id, target: r.enchant ? target : undefined } as Op)}>
          {r.enchant ? 'Enchant' : 'Make'}
        </Button>
      </div>
    </li>
  );
}

function SuggestSheet({ open, onOpenChange, discipline }: { open: boolean; onOpenChange: (o: boolean) => void; discipline: Discipline }) {
  const { chat, apply } = useGame();
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState<Record<string, any> | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post<{ recipe: Record<string, any> }>(`/api/campaigns/${chat.campaignId}/recipes/suggest`, { discipline, idea });
      setRecipe(r.recipe);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const label = DISCIPLINES.find((d) => d.id === discipline)!.label;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (onOpenChange(o), o || setRecipe(null))}
      title={`Suggest a ${label.toLowerCase()} recipe`}
      description="The utility model proposes one that fits the world. Nothing is added until you say so."
      size="md"
      footer={
        recipe ? (
          <Button variant="primary" block onClick={() => apply(recipe as Op).then(() => (onOpenChange(false), setRecipe(null), setIdea('')))}>
            Add “{recipe.name}”
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input aria-label="Recipe idea" placeholder="Idea (optional): something warming for the road…" value={idea} onChange={(e) => setIdea(e.target.value)} />
          <Button loading={busy} icon={Sparkles} onClick={go}>
            {recipe ? 'Again' : 'Suggest'}
          </Button>
        </div>
        {recipe ? (
          <div className="rounded-md bg-surface-2 p-3 text-sm">
            <p className="font-medium">{recipe.name}</p>
            <p className="mt-1 text-fg-2">Needs {recipe.ingredients.map((i: any) => `${i.qty}× ${i.name}`).join(', ')}; level {recipe.level}, {recipe.minutes} min, {recipe.difficulty}.</p>
            <p className="mt-1 text-fg-2">
              Makes {recipe.result.qty}× {recipe.result.name}
              {recipe.enchant ? ` (enchantment: ${recipe.enchant.effect})` : ''}
            </p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
