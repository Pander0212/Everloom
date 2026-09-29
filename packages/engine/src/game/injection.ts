/** Compact, relevance-ranked "Game state" prompt block within a token budget. */
import { estimateTokens, truncate } from '../util/text.js';
import { formatClock, formatDate, partOfDay } from './calendar.js';
import { relationshipLabel, standingLabel, trackerState } from './labels.js';
import { currentSlot } from './simulate.js';
import type { CampaignState, Location } from './state.js';

export interface InjectionOptions {
  budgetTokens: number;
  /** Databank facts found by search for the current scene (already ranked). */
  relevantFacts?: string[];
  countTokens?: (t: string) => number;
  /** Names mentioned recently, used to boost NPC relevance. */
  recentText?: string;
}

function locPath(s: CampaignState, loc: Location | undefined): string {
  if (!loc) return 'Unknown';
  const parts: string[] = [loc.name];
  let cur = loc;
  const seen = new Set([loc.id]);
  while (cur.parentId && s.locations[cur.parentId] && !seen.has(cur.parentId) && parts.length < 4) {
    cur = s.locations[cur.parentId];
    seen.add(cur.id);
    parts.push(cur.name);
  }
  return parts.join(', ');
}

export function exitsFrom(s: CampaignState, locId: string | null): Location[] {
  if (!locId) return [];
  const loc = s.locations[locId];
  if (!loc) return [];
  const ids = new Set<string>();
  for (const r of Object.values(s.routes)) {
    if (r.from === locId) ids.add(r.to);
    if (r.to === locId) ids.add(r.from);
  }
  for (const l of Object.values(s.locations)) {
    if (l.id === locId || !l.discovered) continue;
    if (l.parentId === loc.id) ids.add(l.id);
    if (l.parentId === loc.parentId) ids.add(l.id);
  }
  if (loc.parentId) ids.add(loc.parentId);
  return [...ids].map((id) => s.locations[id]).filter(Boolean).slice(0, 10);
}

export function buildGameStateBlock(s: CampaignState, opts: InjectionOptions): string {
  const count = opts.countTokens ?? estimateTokens;
  const cal = s.meta.calendar;
  const loc = s.currentLocationId ? s.locations[s.currentLocationId] : undefined;
  const sections: Array<{ title: string; lines: string[] }> = [];

  const exits = exitsFrom(s, s.currentLocationId).map((l) => l.name);
  sections.push({
    title: 'Scene',
    lines: [
      `Time: ${formatClock(s.time.minutes, cal)}, ${formatDate(s.time.minutes, cal)} (${partOfDay(s.time.minutes)})`,
      `Weather: ${s.weather.kind}, ${s.weather.tempC}°C`,
      `Location: ${locPath(s, loc)}${loc?.description ? ` — ${truncate(loc.description, 140)}` : ''}`,
      ...(loc?.customs ? [`Local customs: ${truncate(loc.customs, 120)}`] : []),
      ...(exits.length ? [`Nearby: ${exits.join(', ')}`] : []),
    ],
  });

  const p = s.player;
  const bars = Object.values(p.bars)
    .filter((b) => b.id !== 'xp')
    .map((b) => `${b.label} ${Math.round(b.cur)}/${b.max}`);
  const trackers = Object.values(s.trackers).map((t) => `${t.label} ${Math.round(t.value)}/${t.max} (${trackerState(t).label})`);
  const statuses = Object.values(p.status).map((st) => st.name);
  sections.push({
    title: `${p.name}${p.className ? `, ${p.className}` : ''} (level ${p.level})`,
    lines: [
      [...bars, `${s.meta.currency.name} ${p.currency}`].join(' · '),
      trackers.join(' · '),
      ...(statuses.length ? [`Status: ${statuses.join(', ')}`] : []),
    ].filter(Boolean),
  });

  const recent = (opts.recentText ?? '').toLowerCase();
  const present = Object.values(s.npcs)
    .filter((n) => n.status === 'alive' && n.locationId && n.locationId === s.currentLocationId)
    .map((n) => {
      const rel = Object.values(s.relationships).find((r) => r.npcId === n.id);
      const slot = currentSlot(n, s.time.minutes, s);
      const mentioned = recent.includes(n.name.toLowerCase().split(' ')[0]);
      return { n, rel, slot, score: (mentioned ? 2 : 0) + (rel ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (present.length) {
    sections.push({
      title: 'Present',
      lines: present.map(({ n, rel, slot }) => {
        const bits = [n.role && n.role !== 'NPC' ? n.role : '', slot ? slot.activity : '', rel ? relationshipLabel(rel) : ''].filter(Boolean);
        return `${n.name}${bits.length ? ` — ${bits.join('; ')}` : ''}`;
      }),
    });
  }
  const party = Object.values(s.party);
  if (party.length) sections.push({ title: 'Party', lines: [party.map((m) => `${m.name} (${m.role}, HP ${m.hp}/${m.maxHp})`).join(' · ')] });

  const quests = Object.values(s.quests)
    .filter((q) => q.status === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);
  if (quests.length) {
    sections.push({
      title: 'Active quests',
      lines: quests.map((q) => {
        const next = q.objectives.find((o) => !o.done);
        return `${q.title}${next ? ` — next: ${next.text}` : ''}`;
      }),
    });
  }

  const locIds = new Set<string>();
  let cur = loc;
  while (cur) {
    locIds.add(cur.id);
    cur = cur.parentId ? s.locations[cur.parentId] : undefined;
    if (cur && locIds.has(cur.id)) break;
  }
  const presentIds = new Set(present.map((x) => x.n.id));
  const orgs = Object.values(s.orgs)
    .map((o) => ({
      o,
      score:
        (o.influence.some((i) => locIds.has(i.locationId)) ? 2 : 0) +
        (o.mainLocationId && locIds.has(o.mainLocationId) ? 2 : 0) +
        (o.members.some((m) => m.npcId && presentIds.has(m.npcId)) ? 3 : 0) +
        (recent.includes(o.name.toLowerCase()) ? 2 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  if (orgs.length) {
    sections.push({ title: 'Organizations here', lines: orgs.map(({ o }) => `${o.name} (${o.type}) — standing ${o.standing}/100, ${standingLabel(o.standing)}`) });
  }

  const unseen = s.worldLog.filter((e) => !e.seen && e.kind !== 'weather').slice(-4);
  if (unseen.length) sections.push({ title: 'Meanwhile', lines: unseen.map((e) => e.text) });

  const equipped = Object.values(s.inventory).filter((i) => i.equipped).map((i) => i.name);
  const carried = Object.values(s.inventory)
    .filter((i) => !i.equipped)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 10)
    .map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name));
  const invLines: string[] = [];
  if (equipped.length) invLines.push(`Equipped: ${equipped.join(', ')}`);
  if (carried.length) invLines.push(`Carrying: ${carried.join(', ')}`);
  if (invLines.length) sections.push({ title: 'Inventory', lines: invLines });

  if (opts.relevantFacts?.length) sections.push({ title: 'Known facts', lines: opts.relevantFacts.slice(0, 6).map((f) => truncate(f, 200)) });

  const header = '[Game state — tracked by the game. Keep narration consistent with it; do not invent numbers.]';
  let out = header;
  let used = count(out);
  for (const sec of sections) {
    const block = `\n${sec.title}:\n${sec.lines.map((l) => `- ${l}`).join('\n')}`;
    const cost = count(block);
    if (used + cost > opts.budgetTokens) {
      // Try a trimmed version of the section.
      const partial: string[] = [];
      let partialCost = count(`\n${sec.title}:`);
      for (const l of sec.lines) {
        const c = count(`\n- ${l}`);
        if (used + partialCost + c > opts.budgetTokens) break;
        partial.push(l);
        partialCost += c;
      }
      if (partial.length) {
        out += `\n${sec.title}:\n${partial.map((l) => `- ${l}`).join('\n')}`;
        used += partialCost;
      }
      continue;
    }
    out += block;
    used += cost;
  }
  return out;
}
