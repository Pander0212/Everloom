/**
 * World health check: deterministic diagnostics over a campaign state, each with a one-click fix
 * expressed as ops (so a fix is logged, undoable and swipe-safe like any other change).
 */
import type { Op } from './ops.js';
import type { CampaignState } from './state.js';
import { normalizeName } from '../util/text.js';

export interface HealthIssue {
  id: string;
  severity: 'error' | 'warning';
  title: string;
  detail: string;
  fix?: { label: string; ops: Op[] };
}

export function healthCheck(s: CampaignState): HealthIssue[] {
  const out: HealthIssue[] = [];
  const locName = (id: string | null) => (id && s.locations[id]?.name) || null;
  const firstLoc = Object.values(s.locations)[0];

  if (s.currentLocationId && !s.locations[s.currentLocationId]) {
    out.push({
      id: 'player-nowhere',
      severity: 'error',
      title: 'You are in a place that no longer exists',
      detail: 'The current location was removed.',
      fix: firstLoc ? { label: `Move to ${firstLoc.name}`, ops: [{ type: 'location.move', to: firstLoc.name } as Op] } : undefined,
    });
  }

  for (const l of Object.values(s.locations)) {
    if (l.parentId && !s.locations[l.parentId]) {
      out.push({ id: `orphan-${l.id}`, severity: 'warning', title: `${l.name} sits inside a place that's gone`, detail: 'Its parent location was removed.', fix: { label: 'Make it top-level', ops: [{ type: 'location.set', id: l.id, patch: { parentId: null } } as Op] } });
    }
    if (l.parentId === l.id) out.push({ id: `self-parent-${l.id}`, severity: 'error', title: `${l.name} is inside itself`, detail: 'A location cannot be its own parent.', fix: { label: 'Make it top-level', ops: [{ type: 'location.set', id: l.id, patch: { parentId: null } } as Op] } });
  }

  for (const n of Object.values(s.npcs)) {
    if (n.locationId && !s.locations[n.locationId]) {
      out.push({ id: `npc-nowhere-${n.id}`, severity: 'warning', title: `${n.name} is in a place that no longer exists`, detail: 'Their location was removed.', fix: { label: 'Clear their location', ops: [{ type: 'npc.set', id: n.id, patch: { locationId: null } } as Op] } });
    }
    const badSlots = n.schedule.filter((slot) => slot.locationId && !s.locations[slot.locationId]);
    if (badSlots.length) {
      out.push({
        id: `schedule-${n.id}`,
        severity: 'warning',
        title: `${n.name}'s schedule points to missing places`,
        detail: badSlots.map((x) => x.activity).join(', '),
        fix: { label: 'Drop those slots', ops: [{ type: 'npc.set', id: n.id, patch: { schedule: n.schedule.filter((x) => !badSlots.includes(x)) } } as Op] },
      });
    }
  }

  // Same person twice (same normalized name, both alive).
  const byName = new Map<string, typeof s.npcs[string][]>();
  for (const n of Object.values(s.npcs)) if (n.status !== 'dead') (byName.get(normalizeName(n.name)) ?? byName.set(normalizeName(n.name), []).get(normalizeName(n.name))!).push(n);
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    const [keep, ...dupes] = list.slice().sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id));
    out.push({
      id: `dupe-${keep.id}`,
      severity: 'warning',
      title: `${keep.name} exists ${list.length} times`,
      detail: 'Probably the same person recorded twice.',
      fix: { label: 'Merge them', ops: dupes.map((d) => ({ type: 'npc.merge', into: keep.id, from: d.id }) as Op) },
    });
  }

  for (const m of Object.values(s.party)) {
    const npc = m.npcId ? s.npcs[m.npcId] : undefined;
    if (m.npcId && !npc) out.push({ id: `party-ghost-${m.id}`, severity: 'error', title: `${m.name} is in your party but no longer exists`, detail: 'Their person was removed.', fix: { label: 'Remove from party', ops: [{ type: 'party.remove', name: m.name } as Op] } });
    else if (npc && npc.status === 'dead') out.push({ id: `party-dead-${m.id}`, severity: 'warning', title: `${m.name} is dead but still in your party`, detail: '', fix: { label: 'Remove from party', ops: [{ type: 'party.remove', name: m.name } as Op] } });
    else if (npc && s.currentLocationId && npc.locationId && npc.locationId !== s.currentLocationId) {
      out.push({ id: `party-away-${m.id}`, severity: 'warning', title: `${m.name} travels with you but is listed at ${locName(npc.locationId) ?? 'another place'}`, detail: 'Party members go where you go.', fix: { label: 'Bring them here', ops: [{ type: 'npc.set', id: npc.id, patch: { locationId: s.currentLocationId } } as Op] } });
    }
  }

  for (const q of Object.values(s.quests)) {
    if (q.status === 'active' && q.objectives.length && q.objectives.every((o) => o.done)) out.push({ id: `quest-${q.id}`, severity: 'warning', title: `“${q.title}” is finished but still open`, detail: 'Every objective is done.', fix: { label: 'Mark it done', ops: [{ type: 'quest.update', title: q.title, status: 'done' } as Op] } });
  }

  for (const o of Object.values(s.orgs)) {
    if (o.mainLocationId && !s.locations[o.mainLocationId]) out.push({ id: `org-${o.id}`, severity: 'warning', title: `${o.name}'s home is a place that's gone`, detail: '', fix: { label: 'Clear it', ops: [{ type: 'org.set', id: o.id, patch: { mainLocationId: null } } as Op] } });
    if (o.leaderNpcId && !s.npcs[o.leaderNpcId]) out.push({ id: `org-leader-${o.id}`, severity: 'warning', title: `${o.name}'s leader no longer exists`, detail: '', fix: { label: 'Mark leader unknown', ops: [{ type: 'org.set', id: o.id, patch: { leaderNpcId: null } } as Op] } });
  }

  for (const r of Object.values(s.routes)) {
    if (!s.locations[r.from] || !s.locations[r.to]) out.push({ id: `route-${r.id}`, severity: 'warning', title: 'A route leads to a place that no longer exists', detail: `${locName(r.from) ?? '?'} → ${locName(r.to) ?? '?'}` });
  }

  for (const rel of Object.values(s.relationships)) {
    if (rel.npcId && !s.npcs[rel.npcId]) out.push({ id: `rel-${rel.id}`, severity: 'warning', title: `Your relationship with ${rel.name} points to someone removed`, detail: 'It is kept, but no longer tied to a person.' });
  }

  return out;
}
