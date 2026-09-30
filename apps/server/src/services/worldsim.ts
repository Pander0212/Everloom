/**
 * The optional, model-backed parts of the world: off-screen social beats and storyline seeding
 * (background role, after the reply) and the pre-read of the player's message (utility role,
 * before the reply, max-immersion only, with a hard time limit). Every choice of *who* and *when*
 * is deterministic; only prose comes from the model.
 */
import { createRng, extractJson, seedFrom, type CampaignState, type Check, type Op } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from './calls.js';
import { appendOps, getState } from './campaigns.js';
import { getChat, listMessages } from './chats.js';
import { connectionForRole } from './connections.js';
import { insertMemory, scopeOf } from './mem.js';

/** The pair most worth a scene: strong feelings, open tension, or strangers sharing a place. */
export function pickPair(s: CampaignState, turn: number): [string, string] | null {
  const here = s.currentLocationId;
  const inParty = new Set(Object.values(s.party).map((m) => m.npcId));
  const byPlace = new Map<string, string[]>();
  for (const n of Object.values(s.npcs)) {
    if (n.status !== 'alive' || n.unconscious || !n.locationId || n.locationId === here || inParty.has(n.id)) continue;
    (byPlace.get(n.locationId) ?? byPlace.set(n.locationId, []).get(n.locationId)!).push(n.id);
  }
  const rng = createRng(seedFrom(s.meta.seed, 'social', turn));
  let best: { pair: [string, string]; score: number } | null = null;
  for (const ids of byPlace.values()) {
    const sorted = ids.slice().sort();
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const ab = s.bonds[`${sorted[i]}>${sorted[j]}`];
        const ba = s.bonds[`${sorted[j]}>${sorted[i]}`];
        const pressure = Math.abs(ab?.tension ?? 0) + Math.abs(ba?.tension ?? 0) + (Math.abs(ab?.affinity ?? 0) + Math.abs(ba?.affinity ?? 0)) / 2 + (!ab && !ba ? 10 : 0);
        const score = pressure + rng.next() * 5;
        if (!best || score > best.score) best = { pair: [sorted[i], sorted[j]], score };
      }
  }
  return best?.pair ?? null;
}

function latestReply(ctx: AppContext, owner: string, chatId: string) {
  const m = listMessages(ctx, owner, chatId)
    .filter((x) => x.role === 'assistant' && !x.hidden)
    .at(-1);
  return m ? { id: m.id, swipeId: m.swipeId } : null;
}

export async function runSocial(ctx: AppContext, owner: string, chatId: string, turn: number): Promise<boolean> {
  const chat = getChat(ctx, owner, chatId);
  if (!chat.campaignId) return false;
  const s = getState(ctx, owner, chat.campaignId);
  const pair = pickPair(s, turn);
  const anchor = latestReply(ctx, owner, chatId);
  const conn = connectionForRole(ctx, owner, 'background');
  if (!pair || !anchor || !conn) return false;
  const [a, b] = pair.map((id) => s.npcs[id]);
  const place = s.locations[a.locationId!]?.name ?? 'somewhere';
  const bond = (x: typeof a, y: typeof a) => {
    const k = s.bonds[`${x.id}>${y.id}`];
    return k ? `affinity ${k.affinity}, trust ${k.trust}, tension ${k.tension}${k.kind ? `, ${k.kind}` : ''}` : 'no history';
  };
  const messages = [
    { role: 'system' as const, content: 'You write what happens off-screen between two characters in a roleplay world. Output JSON only.' },
    {
      role: 'user' as const,
      content: `At ${place}, away from the player:
- ${a.name} (${a.role}${a.personality ? `; ${a.personality.slice(0, 160)}` : ''}) toward ${b.name}: ${bond(a, b)}
- ${b.name} (${b.role}${b.personality ? `; ${b.personality.slice(0, 160)}` : ''}) toward ${a.name}: ${bond(b, a)}
Write one past-tense sentence of a small, concrete thing that happened between them, and how it changed their feelings (small steps, -5..5).
{"text": "...", "aToB": {"affinity": 0, "trust": 0, "tension": 0}, "bToA": {"affinity": 0, "trust": 0, "tension": 0}}`,
    },
  ];
  const r = await logged(ctx, owner, conn, { chatId, messageId: anchor.id, purpose: 'off-screen life', role: 'background' }, promptTokens(messages), () =>
    completeChat(conn, { messages, overrides: { temperature: 0.8, max_tokens: 300, reasoning: false, stop: [] }, signal: AbortSignal.timeout(60_000) }),
  );
  const out = extractJson<{ text?: string; aToB?: Record<string, number>; bToA?: Record<string, number> }>(r.text);
  const text = out.ok && typeof out.value?.text === 'string' ? out.value.text.trim().slice(0, 400) : '';
  if (text.length < 8) return false;
  // Still the same take? Otherwise this belongs to nothing.
  const now = latestReply(ctx, owner, chatId);
  if (!now || now.id !== anchor.id || now.swipeId !== anchor.swipeId) return false;
  const delta = (v?: Record<string, number>) => Object.fromEntries(['affinity', 'trust', 'tension'].filter((k) => Number.isFinite(v?.[k])).map((k) => [k, Math.max(-5, Math.min(5, Math.round(v![k])))]));
  appendOps(ctx, owner, chat.campaignId, {
    chatId,
    messageId: anchor.id,
    swipeId: anchor.swipeId,
    source: 'sim',
    replace: true,
    ops: [
      { type: 'bond.delta', from: a.name, to: b.name, ...delta(out.value?.aToB) } as Op,
      { type: 'bond.delta', from: b.name, to: a.name, ...delta(out.value?.bToA) } as Op,
      { type: 'world.log', kind: 'event', text } as Op,
    ],
  });
  insertMemory(ctx, owner, scopeOf(chat), { chatId, messageId: anchor.id, swipeId: anchor.swipeId }, 'sim', { text, participants: [a.id, b.id], witnesses: [a.id, b.id], locationId: a.locationId, gameTime: s.time.minutes, importance: 1, secret: false });
  ctx.bus.publish(owner, 'memory.changed', { chatId, campaignId: chat.campaignId });
  return true;
}

/** Start a new off-screen storyline when fewer than two are running. */
export async function runThreadSeeding(ctx: AppContext, owner: string, chatId: string, turn: number): Promise<boolean> {
  const chat = getChat(ctx, owner, chatId);
  if (!chat.campaignId) return false;
  const s = getState(ctx, owner, chat.campaignId);
  if (Object.values(s.threads).filter((t) => t.status !== 'done').length >= 2) return false;
  const anchor = latestReply(ctx, owner, chatId);
  const conn = connectionForRole(ctx, owner, 'background');
  if (!anchor || !conn) return false;
  const places = Object.values(s.locations).map((l) => l.name).slice(0, 20);
  const people = Object.values(s.npcs).filter((n) => n.status === 'alive').map((n) => `${n.name} (${n.role})`).slice(0, 20);
  const orgs = Object.values(s.orgs).map((o) => o.name).slice(0, 10);
  const messages = [
    { role: 'system' as const, content: 'You invent slow-burning background storylines for a roleplay world. Output JSON only.' },
    {
      role: 'user' as const,
      content: `World: ${s.meta.title} (${s.meta.style}). Places: ${places.join(', ') || 'none yet'}. People: ${people.join(', ') || 'none yet'}. Groups: ${orgs.join(', ') || 'none'}.
Running storylines: ${Object.values(s.threads).filter((t) => t.status !== 'done').map((t) => t.text).join('; ') || 'none'}.
Propose ONE new storyline brewing off-screen that could reach the player later, using the existing places and people. Four stages from rumour to climax.
{"text": "short title-like line", "stages": ["a rumour ...", "signs ...", "impossible to ignore ...", "it comes to a head ..."], "place": "one existing place or null"}`,
    },
  ];
  const r = await logged(ctx, owner, conn, { chatId, messageId: anchor.id, purpose: 'storyline seeding', role: 'background' }, promptTokens(messages), () =>
    completeChat(conn, { messages, overrides: { temperature: 0.9, max_tokens: 350, reasoning: false, stop: [] }, signal: AbortSignal.timeout(60_000) }),
  );
  const out = extractJson<{ text?: string; stages?: string[]; place?: string | null }>(r.text);
  if (!out.ok || typeof out.value?.text !== 'string' || !out.value.text.trim()) return false;
  const stages = Array.isArray(out.value.stages) ? out.value.stages.filter((x) => typeof x === 'string' && x.trim()).slice(0, 6).map((x) => x.trim().slice(0, 160)) : undefined;
  const place = typeof out.value.place === 'string' && places.includes(out.value.place) ? out.value.place : null;
  appendOps(ctx, owner, chat.campaignId, { chatId, messageId: anchor.id, swipeId: anchor.swipeId, source: 'sim', ops: [{ type: 'thread.add', text: out.value.text.trim().slice(0, 160), stages: stages && stages.length >= 2 ? stages : undefined, place, turn } as Op] });
  return true;
}

export interface PreRead {
  ops: Op[];
  check: Pick<Check, 'skill' | 'difficulty'> | null;
}

/**
 * Max immersion only: a quick utility-model read of the player's message before the reply, for
 * moves, time skips and checks the rules missed. Hard time limit; on any failure, nothing.
 */
export async function preRead(ctx: AppContext, owner: string, chatId: string, messageId: string, text: string, s: CampaignState, timeoutMs = 2500): Promise<PreRead | null> {
  const conn = connectionForRole(ctx, owner, 'utility');
  if (!conn) return null;
  const places = Object.values(s.locations).map((l) => l.name).slice(0, 40);
  const messages = [
    { role: 'system' as const, content: 'You read a roleplay player message and report its concrete intent. Output JSON only.' },
    {
      role: 'user' as const,
      content: `Known places: ${places.join(', ') || 'none'}. The player is at ${s.currentLocationId ? s.locations[s.currentLocationId]?.name : 'an unknown place'}.
Player: "${text.slice(0, 1200)}"
{"move": "exact known place the player clearly goes to now, or null", "minutes": minutes the action clearly takes (0 if unclear), "check": {"skill": "agility|strength|presence|magic|endurance", "difficulty": "easy|normal|hard|very hard"} or null (only for a risky attempt)}`,
    },
  ];
  try {
    const r = await Promise.race([
      logged(ctx, owner, conn, { chatId, messageId, purpose: 'pre-read', role: 'utility' }, promptTokens(messages), () =>
        completeChat(conn, { messages, overrides: { temperature: 0, max_tokens: 120, reasoning: false, stop: [] }, signal: AbortSignal.timeout(timeoutMs) }),
      ),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('pre-read timeout')), timeoutMs)),
    ]);
    const out = extractJson<{ move?: string | null; minutes?: number; check?: { skill?: string; difficulty?: string } | null }>(r.text);
    if (!out.ok || !out.value) return null;
    const ops: Op[] = [];
    const to = typeof out.value.move === 'string' ? Object.values(s.locations).find((l) => l.name.toLowerCase() === out.value!.move!.toLowerCase()) : undefined;
    if (to && to.id !== s.currentLocationId) ops.push({ type: 'location.move', to: to.name } as Op);
    const minutes = Math.round(Number(out.value.minutes) || 0);
    if (minutes > 0) ops.push({ type: 'time.advance', minutes: Math.min(240, minutes) } as Op);
    const c = out.value.check;
    const skills = ['agility', 'strength', 'presence', 'magic', 'endurance'];
    const diffs = ['easy', 'normal', 'hard', 'very hard'];
    const check = c && typeof c.skill === 'string' && skills.includes(c.skill) ? { skill: c.skill, difficulty: (diffs.includes(String(c.difficulty)) ? c.difficulty : 'normal') as Check['difficulty'] } : null;
    return { ops, check };
  } catch {
    return null;
  }
}

