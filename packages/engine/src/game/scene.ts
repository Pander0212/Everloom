/**
 * The scene block: what the narrator is told every turn. Pure.
 *
 * It is authoritative: only the people under PRESENT and PARTY are in the scene, places are named
 * exactly as listed, and movement goes only to EXITS. It is fitted to a token budget by dropping
 * items in a fixed order (see DROP_ORDER); the core of the scene is never dropped.
 */
import { estimateTokens, truncate } from '../util/text.js';
import { formatClock, formatDate, formatDuration, partOfDay } from './calendar.js';
import { exitsFrom } from './injection.js';
import { relationshipLabel, standingLabel, trackerState } from './labels.js';
import { currentSlot } from './simulate.js';
import type { CampaignState, Location, Npc } from './state.js';

/** Section titles, exactly as emitted. The narrator contract must name every one of them. */
export const SCENE_SECTIONS = ['NOW', 'YOU', 'LOCATION', 'PRESENT', 'PARTY', 'STORY SO FAR', 'QUESTS', 'COMING UP', 'THE WORLD RIGHT NOW', 'SOMETHING HAPPENS', 'THE DICE', 'EXITS'] as const;
export type SceneSection = (typeof SCENE_SECTIONS)[number];

/** Per-character line labels, exactly as emitted. */
export const SCENE_LINE_LABELS = ['NOW:', 'WEARING:', 'LAST SEEN WEARING:', 'FEELS:', 'FACTS:', 'WANTS:', 'KNOWS (was there):', 'HEARD SECONDHAND:', 'HEARD AS RUMOUR (may be garbled):', 'DOES NOT KNOW:', 'WARNING:'] as const;

/**
 * What goes first when the block is over budget (earliest first). Anything not listed — the time,
 * where you are, who is referenced, the party, the dice, what happens, the exits — is never dropped.
 */
export const DROP_ORDER = ['does-not-know', 'inventory', 'background-person', 'world', 'orgs', 'breadcrumb', 'recap-old', 'quests', 'person-detail'] as const;
export type DropKind = (typeof DROP_ORDER)[number] | 'keep';

export const SCENE_HEADER =
  '[WORLD STATE — authoritative. Only the people under PRESENT and PARTY are in this scene. Refer to places and people only by the names listed here. Movement is possible only to places under EXITS. Do not invent numbers the state already tracks.]';

export interface PersonMemoryView {
  knows: string[];
  heard: Array<{ text: string; distortion: number }>;
  doesNotKnow: string[];
}

export interface SceneView {
  /** Recap lines (chapter/day summaries and milestones), oldest first. */
  storySoFar?: string[];
  /** What the player remembers that bears on this scene, best first. */
  recalled?: Array<{ text: string; gameTime: number; heard?: boolean; /** A secret: the only people (besides the player) who know it. */ secretWith?: string[] }>;
  /** Databank facts that match the conversation (the player's own notes). */
  known?: string[];
  /** Per-person memory lines, keyed by person id. */
  people?: Record<string, PersonMemoryView>;
  /** Current facts by entity id ('player', NPC ids, 'world'). */
  facts?: Record<string, string[]>;
  /** Characters in the conversation that have no NPC in the state (chat cards). */
  extraPresent?: Array<{ id: string; name: string; description?: string }>;
  /** People named in the recent conversation (never dropped). */
  referenced?: Set<string>;
  dice?: string[];
  happens?: string[];
}

export interface SceneOptions {
  budgetTokens: number;
  countTokens?: (t: string) => number;
}

interface Item {
  section: SceneSection;
  text: string;
  drop: DropKind;
  /** Within a drop kind, lower goes first. */
  rank: number;
}

export interface SceneBlock {
  text: string;
  tokens: number;
  dropped: Array<{ section: SceneSection; drop: DropKind; text: string }>;
}

function ancestors(s: CampaignState, loc: Location | undefined): Location[] {
  const out: Location[] = [];
  const seen = new Set<string>();
  let cur = loc?.parentId ? s.locations[loc.parentId] : undefined;
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentId ? s.locations[cur.parentId] : undefined;
  }
  return out;
}

function wearing(o: { text: string; at: number } | null | undefined, now: number): string | null {
  if (!o?.text) return null;
  return now - o.at > 12 * 60 ? `LAST SEEN WEARING: ${o.text} (may have changed)` : `WEARING: ${o.text}`;
}

function relationPhrase(s: CampaignState, n: Npc): string | null {
  const rel = Object.values(s.relationships).find((r) => r.npcId === n.id);
  if (!rel) return null;
  const bits = [relationshipLabel(rel).toLowerCase()];
  if (rel.trust <= -25) bits.push('does not trust you');
  else if (rel.trust >= 50) bits.push('trusts you');
  if ((rel.desire ?? 0) >= 40) bits.push('is drawn to you');
  if ((rel.tension ?? 0) >= 40) bits.push('there is tension between you');
  return `FEELS: ${bits.join(' — ')}`;
}

function warning(n: Pick<Npc, 'unconscious' | 'status'>): string | null {
  if (n.status === 'dead') return 'WARNING: dead';
  if (n.unconscious) return 'WARNING: UNCONSCIOUS — cannot act or speak';
  return null;
}

function dayTag(s: CampaignState, t: number): string {
  const day = Math.floor(t / 1440) - Math.floor(s.time.minutes / 1440);
  if (day === 0) return 'today';
  if (day === -1) return 'yesterday';
  return formatDate(t, s.meta.calendar, '{mon} {day}');
}

export function buildSceneBlock(s: CampaignState, view: SceneView = {}, opts: SceneOptions = { budgetTokens: 1200 }): SceneBlock {
  const count = opts.countTokens ?? estimateTokens;
  const cal = s.meta.calendar;
  const items: Item[] = [];
  const add = (section: SceneSection, text: string, drop: DropKind = 'keep', rank = 0) => text && items.push({ section, text, drop, rank });
  const now = s.time.minutes;
  const loc = s.currentLocationId ? s.locations[s.currentLocationId] : undefined;
  const referenced = view.referenced ?? new Set<string>();

  // NOW
  add('NOW', `${formatDate(now, cal)} · ${formatClock(now, cal)} (${partOfDay(now)})`);
  add('NOW', `WEATHER (outside): ${s.weather.kind}, ${s.weather.tempC}°C`);

  // YOU
  const p = s.player;
  const bars = Object.values(p.bars).filter((b) => b.id !== 'xp').map((b) => `${b.label} ${Math.round(b.cur)}/${b.max}`);
  add('YOU', `${p.name}${p.className ? `, ${p.className}` : ''}, level ${p.level}${p.age ? `, ${p.age}` : ''}${p.appearance ? ` — ${truncate(p.appearance, 160)}` : ''}`);
  add('YOU', [...bars, `${s.meta.currency.name} ${p.currency}`].join(' · '));
  const needs = Object.values(s.trackers).map((t) => `${t.label} ${Math.round(t.value)}/${t.max} (${trackerState(t).label})`);
  if (needs.length) add('YOU', needs.join(' · '));
  const statuses = Object.values(p.status).map((st) => st.name);
  if (statuses.length) add('YOU', `Status: ${statuses.join(', ')}`);
  const hpBar = p.bars.hp;
  if (hpBar && hpBar.cur / Math.max(1, hpBar.max) <= 0.25) add('YOU', `WARNING: badly hurt (HP ${Math.round(hpBar.cur)}/${hpBar.max})`);
  const w = wearing(p.outfit, now);
  if (w) add('YOU', w);
  for (const f of view.facts?.player ?? []) add('YOU', `FACT: ${truncate(f, 180)}`, 'person-detail', 1);
  const equipped = Object.values(s.inventory).filter((i) => i.equipped).map((i) => i.name);
  const carried = Object.values(s.inventory)
    .filter((i) => !i.equipped)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 10)
    .map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name));
  if (equipped.length) add('YOU', `Equipped: ${equipped.join(', ')}`, 'inventory', 2);
  if (carried.length) add('YOU', `Carrying: ${carried.join(', ')}`, 'inventory', 1);

  // LOCATION
  const trail = ancestors(s, loc);
  if (trail.length) add('LOCATION', `${trail.map((l) => l.name).join(' › ')} › ${loc?.name ?? ''}`, 'breadcrumb', 1);
  add('LOCATION', loc ? `${loc.name}${loc.description ? ` — ${truncate(loc.description, 220)}` : ''}` : 'Somewhere not yet on the map');
  if (loc?.customs) add('LOCATION', `Customs: ${truncate(loc.customs, 160)}`, 'breadcrumb', 2);
  if (loc?.locked) add('LOCATION', 'LOCKED: this place is fixed; do not change it.');
  const orgs = Object.values(s.orgs)
    .filter((o) => o.mainLocationId === loc?.id || o.influence.some((i) => i.locationId === loc?.id || trail.some((t) => t.id === i.locationId)))
    .slice(0, 3);
  for (const o of orgs) add('LOCATION', `${o.name} (${o.type}) holds sway here — your standing: ${standingLabel(o.standing)}`, 'orgs', 1);

  // PRESENT
  const present = Object.values(s.npcs)
    .filter((n) => n.status === 'alive' && n.locationId && n.locationId === s.currentLocationId)
    .filter((n) => !Object.values(s.party).some((m) => m.npcId === n.id))
    .map((n) => ({ n, score: (referenced.has(n.id) ? 100 : 0) + (view.people?.[n.id] ? 10 : 0) + n.lastSeenAt / 1e9 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  present.forEach(({ n }, idx) => {
    const isRef = referenced.has(n.id) || idx === 0;
    const drop: DropKind = isRef ? 'keep' : 'background-person';
    const rank = present.length - idx; // least relevant dropped first
    const tag = [n.title || (n.role !== 'NPC' ? n.role : ''), n.age ? `${n.age}` : ''].filter(Boolean).join(', ');
    add('PRESENT', `- ${n.name}${tag ? ` (${tag})` : ''}${n.appearance ? `: ${truncate(n.appearance, 160)}` : ''}`, drop, rank);
    const detail = (text: string, kind: DropKind = isRef ? 'person-detail' : 'background-person') => add('PRESENT', `  ${text}`, kind, rank);
    const warn = warning(n);
    if (warn) add('PRESENT', `  ${warn}`, drop, rank);
    const slot = currentSlot(n, now, s);
    if (slot) detail(`NOW: ${slot.activity}`);
    const wr = wearing(n.outfit, now);
    if (wr) detail(wr);
    const rel = relationPhrase(s, n);
    if (rel) detail(rel);
    const facts = view.facts?.[n.id] ?? [];
    if (facts.length) detail(`FACTS: ${facts.slice(0, 4).map((f) => truncate(f, 120)).join('; ')}`);
    const goal = (n.goals ?? []).filter((g) => g.state === 'acting').sort((a, b) => b.urgency - a.urgency)[0];
    if (goal) detail(`WANTS: ${truncate(goal.text, 140)}`);
    const pm = view.people?.[n.id];
    if (pm) {
      for (const k of pm.knows) detail(`KNOWS (was there): ${truncate(k, 200)}`);
      for (const h of pm.heard) detail(`${h.distortion >= 2 ? 'HEARD AS RUMOUR (may be garbled)' : 'HEARD SECONDHAND'}: ${truncate(h.text, 200)}`);
      for (const d of pm.doesNotKnow) add('PRESENT', `  DOES NOT KNOW: ${truncate(d, 200)}`, 'does-not-know', rank);
    }
  });
  for (const x of view.extraPresent ?? []) {
    add('PRESENT', `- ${x.name}${x.description ? `: ${truncate(x.description, 160)}` : ''}`);
    const pm = view.people?.[x.id];
    if (pm) {
      for (const k of pm.knows) add('PRESENT', `  KNOWS (was there): ${truncate(k, 200)}`, 'person-detail', 1);
      for (const h of pm.heard) add('PRESENT', `  ${h.distortion >= 2 ? 'HEARD AS RUMOUR (may be garbled)' : 'HEARD SECONDHAND'}: ${truncate(h.text, 200)}`, 'person-detail', 1);
      for (const d of pm.doesNotKnow) add('PRESENT', `  DOES NOT KNOW: ${truncate(d, 200)}`, 'does-not-know', 1);
    }
  }

  // PARTY (never dropped; sovereign members are described, never voiced)
  const party = Object.values(s.party);
  if (party.some((m) => m.sovereign)) add('PARTY', '[Sovereign party members: describe what happens to them, but never write their words, thoughts, decisions or voluntary actions.]');
  for (const m of party) {
    const npc = m.npcId ? s.npcs[m.npcId] : undefined;
    const bits = [m.role, `HP ${m.hp}/${m.maxHp}`, m.sovereign ? 'sovereign' : ''].filter(Boolean).join(', ');
    add('PARTY', `- ${m.name} (${bits})${!m.sovereign && npc?.appearance ? `: ${truncate(npc.appearance, 120)}` : ''}`);
    const wr = npc ? wearing(npc.outfit, now) : null;
    if (wr) add('PARTY', `  ${wr}`);
    const warn = npc ? warning(npc) : null;
    if (warn) add('PARTY', `  ${warn}`);
  }

  // STORY SO FAR: recap (oldest first, oldest dropped first) then what you remember here.
  const recap = view.storySoFar ?? [];
  recap.forEach((line, i) => add('STORY SO FAR', truncate(line, 700), 'recap-old', i));
  const secretTag = (w: string[]) => `(secret — only you${w.length ? ` and ${w.join(', ')}` : ''} know) `;
  (view.recalled ?? []).forEach((r, i) => add('STORY SO FAR', `- [${dayTag(s, r.gameTime)}] ${r.heard ? '(heard) ' : ''}${r.secretWith ? secretTag(r.secretWith) : ''}${truncate(r.text, 240)}`, 'recap-old', 100 - i));
  (view.known ?? []).slice(0, 4).forEach((k, i) => add('STORY SO FAR', `- (known) ${truncate(k, 200)}`, 'recap-old', 50 - i));
  // People talked about who aren't here: what is currently true about them.
  const here = new Set([...present.map((x) => x.n.id), ...party.map((m) => m.npcId).filter(Boolean)]);
  [...referenced]
    .filter((id) => !here.has(id) && s.npcs[id] && view.facts?.[id]?.length)
    .slice(0, 3)
    .forEach((id, i) => {
      const n = s.npcs[id];
      const at = n.locationId ? s.locations[n.locationId]?.name : undefined;
      add('STORY SO FAR', `- ${n.name} (not here${at ? `; last known at ${at}` : ''}) — FACTS: ${view.facts![id].slice(0, 4).map((f) => truncate(f, 120)).join('; ')}`, 'person-detail', 3 - i);
    });

  // QUESTS
  Object.values(s.quests)
    .filter((q) => q.status === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4)
    .forEach((q, i) => {
      const next = q.objectives.find((o) => !o.done);
      add('QUESTS', `- ${q.title}${next ? ` — next: ${next.text}` : ''}`, 'quests', 10 - i);
    });

  // COMING UP (the distance is computed here, not by the model)
  Object.values(s.events)
    .filter((e) => e.at >= now && e.at - now <= 14 * 1440)
    .sort((a, b) => a.at - b.at)
    .slice(0, 4)
    .forEach((e) => add('COMING UP', `- ${e.title} — in ${formatDuration(e.at - now)} (${formatDate(e.at, cal, '{mon} {day}')}, ${formatClock(e.at, cal)})`, 'world', 5));

  // THE WORLD RIGHT NOW (private continuity for the narrator)
  const worldLines: string[] = [];
  for (const f of Object.values(s.databank)) if (f.kind === 'development' && f.status === 'active') worldLines.push(`[${f.trend ?? 'developing'}] ${truncate(f.text, 180)}`);
  for (const t of Object.values(s.threads ?? {})) if (t.status === 'active' && t.rung >= 1) worldLines.push(`[${t.stages[Math.min(t.rung, t.stages.length - 1)] ?? 'stirring'}] ${truncate(t.text, 160)}`);
  for (const f of view.facts?.world ?? []) worldLines.push(truncate(f, 180));
  for (const e of s.worldLog.filter((x) => !x.seen && x.kind !== 'weather').slice(-4)) worldLines.push(truncate(e.text, 160));
  if (worldLines.length) add('THE WORLD RIGHT NOW', '(private continuity for you, the narrator — not automatically known to anyone present)', 'world', 0);
  worldLines.slice(0, 8).forEach((l, i) => add('THE WORLD RIGHT NOW', `- ${l}`, 'world', 8 - i));

  // SOMETHING HAPPENS / THE DICE (never dropped)
  for (const h of view.happens ?? []) add('SOMETHING HAPPENS', `- ${h}`);
  for (const d of view.dice ?? []) add('THE DICE', `- ${d}`);

  // EXITS (never dropped)
  const exits = exitsFrom(s, s.currentLocationId).map((l) => l.name);
  if (exits.length) add('EXITS', exits.join(', '));

  // Fit the budget.
  const render = (list: Item[]) => {
    let out = SCENE_HEADER;
    for (const sec of SCENE_SECTIONS) {
      const lines = list.filter((i) => i.section === sec).map((i) => i.text);
      if (lines.length) out += `\n\n## ${sec}\n${lines.join('\n')}`;
    }
    return out;
  };
  let kept = items.slice();
  const dropped: SceneBlock['dropped'] = [];
  let text = render(kept);
  let tokens = count(text);
  for (const kind of DROP_ORDER) {
    if (tokens <= opts.budgetTokens) break;
    const candidates = kept.filter((i) => i.drop === kind).sort((a, b) => a.rank - b.rank);
    for (const c of candidates) {
      if (tokens <= opts.budgetTokens) break;
      kept = kept.filter((i) => i !== c);
      dropped.push({ section: c.section, drop: c.drop, text: c.text });
      text = render(kept);
      tokens = count(text);
    }
  }
  return { text, tokens, dropped };
}

/**
 * The narrator contract: how to read the scene block. Goes in the system prompt of the default
 * preset. A test checks it names every section and line label exactly as the engine emits them.
 */
export const NARRATOR_CONTRACT = `How to use the WORLD STATE block:
- It is ground truth and input only. Never quote it, echo it or mention it.
- NOW is the time and weather. YOU is the player's own character: their body, needs, gear and standing facts.
- LOCATION is where the scene is. Only people under PRESENT and PARTY are here; anyone else is elsewhere and cannot appear unless they arrive in the story.
- Under each person: NOW: is what their day has them doing, WEARING: or LAST SEEN WEARING: is their clothing, FEELS: is how they feel about the player, FACTS: are standing truths, WANTS: is what drives them.
- KNOWS (was there): they witnessed it. HEARD SECONDHAND: they were told. HEARD AS RUMOUR (may be garbled): they heard a distorted version. DOES NOT KNOW: they must not know or act on it unless someone tells them in the story.
- WARNING: lines bind (an UNCONSCIOUS person cannot act or speak).
- PARTY members travel with the player. A sovereign party member may be described, but never write their words, thoughts, decisions or voluntary actions.
- STORY SO FAR is background the player remembers. Don't re-narrate it. A line marked (secret — only you and …) is known to no one else.
- QUESTS are open goals. COMING UP lists what is due, with the time until it.
- THE WORLD RIGHT NOW is private continuity for you, not news anyone present has heard.
- SOMETHING HAPPENS is an event for this turn: weave it in naturally and never announce that it was rolled.
- THE DICE is the decided outcome of the player's action. It is final: narrate that outcome.
- Movement goes only to places under EXITS.`;
