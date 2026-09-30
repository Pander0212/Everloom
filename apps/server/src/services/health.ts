/** World health: the deterministic check with fixes, and names the model used that matched nothing. */
import { healthCheck, type Op } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { HttpError } from '../context.js';
import { appendOps, getState } from './campaigns.js';
import { getKv, setKv } from './settings.js';

export interface UnresolvedName {
  name: string;
  kind: 'person' | 'place' | 'organization';
  count: number;
  lastAt: number;
  op: string;
}

const key = (campaignId: string) => `unresolved:${campaignId}`;
const KINDS: Record<string, UnresolvedName['kind']> = { NPC: 'person', location: 'place', destination: 'place', organization: 'organization' };

/** Remember names from rejected model ops ("Unknown NPC "Maera"") so the player can resolve them. */
export function recordUnresolved(ctx: AppContext, owner: string, campaignId: string, errors: Array<{ op: Op; error: string }>) {
  const found = errors.map((e) => ({ m: /Unknown (NPC|location|destination|organization) "(.+?)"/.exec(e.error), op: e.op.type })).filter((x) => x.m);
  if (!found.length) return;
  const list = getKv<UnresolvedName[]>(ctx, owner, key(campaignId), []);
  for (const f of found) {
    const name = f.m![2].trim();
    const kind = KINDS[f.m![1]] ?? 'person';
    const hit = list.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.kind === kind);
    if (hit) {
      hit.count++;
      hit.lastAt = Date.now();
    } else list.push({ name, kind, count: 1, lastAt: Date.now(), op: f.op });
  }
  setKv(ctx, owner, key(campaignId), list.sort((a, b) => b.lastAt - a.lastAt).slice(0, 50));
}

export function listUnresolved(ctx: AppContext, owner: string, campaignId: string): UnresolvedName[] {
  const s = getState(ctx, owner, campaignId);
  const known = new Set([...Object.values(s.npcs).flatMap((n) => [n.name, ...n.aliases]), ...Object.values(s.locations).map((l) => l.name), ...Object.values(s.orgs).map((o) => o.name)].map((n) => n.toLowerCase()));
  // A name that has since been created (or aliased) is no longer unresolved.
  return getKv<UnresolvedName[]>(ctx, owner, key(campaignId), []).filter((u) => !known.has(u.name.toLowerCase()));
}

export function dismissUnresolved(ctx: AppContext, owner: string, campaignId: string, name: string) {
  setKv(ctx, owner, key(campaignId), getKv<UnresolvedName[]>(ctx, owner, key(campaignId), []).filter((u) => u.name.toLowerCase() !== name.toLowerCase()));
}

/** Resolve a name: create it, or make it another name for someone/somewhere that exists. */
export function resolveUnresolved(ctx: AppContext, owner: string, campaignId: string, chatId: string, input: { name: string; action: 'create' | 'alias'; kind: UnresolvedName['kind']; targetId?: string }) {
  const s = getState(ctx, owner, campaignId);
  let ops: Op[];
  if (input.action === 'create') ops = [input.kind === 'place' ? ({ type: 'location.upsert', name: input.name } as Op) : input.kind === 'organization' ? ({ type: 'org.upsert', name: input.name } as Op) : ({ type: 'npc.upsert', name: input.name } as Op)];
  else {
    const npc = input.targetId ? s.npcs[input.targetId] : undefined;
    if (!npc) throw new HttpError(400, 'Choose who this name belongs to');
    ops = [{ type: 'npc.set', id: npc.id, patch: { aliases: [...new Set([...npc.aliases, input.name])] } } as Op];
  }
  const r = appendOps(ctx, owner, campaignId, { chatId, messageId: null, swipeId: null, source: 'user', ops });
  dismissUnresolved(ctx, owner, campaignId, input.name);
  return r;
}

export function checkHealth(ctx: AppContext, owner: string, campaignId: string) {
  return { issues: healthCheck(getState(ctx, owner, campaignId)), unresolved: listUnresolved(ctx, owner, campaignId) };
}

export function fixIssue(ctx: AppContext, owner: string, campaignId: string, chatId: string, issueId: string) {
  const issue = healthCheck(getState(ctx, owner, campaignId)).find((i) => i.id === issueId);
  if (!issue) throw new HttpError(404, 'That problem is already gone');
  if (!issue.fix) throw new HttpError(400, 'This one has no automatic fix');
  return appendOps(ctx, owner, campaignId, { chatId, messageId: null, swipeId: null, source: 'user', ops: issue.fix.ops });
}
