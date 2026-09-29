/**
 * Memory v2: memories, hearsay, versioned facts and summaries, stored beside the campaign state.
 *
 * Every row is anchored to a message (chat, message, swipe) exactly like op_log entries, and a row
 * is LIVE only while its message exists with the same swipe. So a swipe, an edit (the model's rows
 * for the old text are deleted) or a delete takes memory back with the story — nothing to rebuild.
 * Rows with no message anchor (the player's own notes) are always live.
 */
import {
  contentWords,
  currentFacts,
  factKey,
  findNpc,
  HeardIndex,
  normalizeName,
  PLAYER,
  recall,
  resolveFact,
  spreadHearsay,
  type CampaignState,
  type ChatDTO,
  type FactItem,
  type HeardItem,
  type Importance,
  type MemoryItem,
  type MemoryKind,
  type RecallResult,
  type SummaryItem,
} from '@everloom/engine';
import type { AppContext } from '../context.js';
import { HttpError } from '../context.js';
import { json } from '../db/index.js';
import { embed } from '../llm/providers.js';
import { newId, sha256 } from '../security/crypto.js';
import { logged } from './calls.js';
import { connectionForRole } from './connections.js';
import { ftsQuery } from './search.js';

// ------------------------------------------------------------------ scope and liveness

export interface MemScope {
  campaignId: string | null;
  chatId: string;
}

export interface Anchor {
  chatId: string;
  messageId: string | null;
  swipeId: number | null;
}

export function scopeOf(chat: Pick<ChatDTO, 'id' | 'campaignId'>): MemScope {
  return { campaignId: chat.campaignId ?? null, chatId: chat.id };
}

function scopeSql(scope: MemScope, alias = ''): { sql: string; args: unknown[] } {
  const a = alias ? `${alias}.` : '';
  return scope.campaignId ? { sql: `${a}campaign_id = ?`, args: [scope.campaignId] } : { sql: `${a}chat_id = ? AND ${a}campaign_id IS NULL`, args: [scope.chatId] };
}

/** SQL: the row's anchor message still exists in its chat with the same swipe. */
function liveSql(alias: string): string {
  return `(${alias}.message_id IS NULL OR EXISTS (SELECT 1 FROM messages mm WHERE mm.id = ${alias}.message_id AND mm.chat_id = ${alias}.chat_id AND (${alias}.swipe_id IS NULL OR mm.swipe_id = ${alias}.swipe_id)))`;
}

function nextSeq(ctx: AppContext, table: 'mem_items' | 'mem_facts' | 'mem_summaries', scope: MemScope): number {
  const w = scopeSql(scope);
  return ((ctx.db.prepare(`SELECT MAX(seq) AS s FROM ${table} WHERE ${w.sql}`).get(...w.args) as { s: number | null }).s ?? 0) + 1;
}

function index(ctx: AppContext, owner: string, scope: MemScope, id: string, kind: string, text: string) {
  ctx.db.prepare('DELETE FROM mem_fts WHERE item_id = ?').run(id);
  ctx.db.prepare('INSERT INTO mem_fts (item_id, owner_id, campaign_id, chat_id, kind, text) VALUES (?, ?, ?, ?, ?, ?)').run(id, owner, scope.campaignId ?? '', scope.chatId, kind, text);
}

// ------------------------------------------------------------------ rows

export interface MemoryRow extends MemoryItem {
  chatId: string | null;
  messageId: string | null;
  swipeId: number | null;
  source: string;
  edited: boolean;
  forgotten: boolean;
  foldedInto: string | null;
  createdAt: number;
}

function toMemory(r: any): MemoryRow {
  return {
    id: r.id,
    text: r.text,
    kind: r.kind as MemoryKind,
    participants: json<string[]>(r.participants, []),
    witnesses: json<string[]>(r.witnesses, []),
    locationId: r.location_id,
    gameTime: r.game_time,
    importance: Math.min(3, Math.max(1, r.importance)) as Importance,
    secret: !!r.secret,
    pinned: !!r.pinned,
    seq: r.seq,
    chatId: r.chat_id,
    messageId: r.message_id,
    swipeId: r.swipe_id,
    source: r.source,
    edited: !!r.edited,
    forgotten: !!r.forgotten,
    foldedInto: r.folded_into,
    createdAt: r.created_at,
  };
}

export interface FactRow extends FactItem {
  source: string;
  cite: string | null;
  messageId: string | null;
  swipeId: number | null;
  createdAt: number;
}

function toFact(r: any): FactRow {
  return {
    id: r.id,
    entityId: r.entity_id,
    entityName: r.entity_name,
    key: r.key,
    value: r.value,
    text: r.text,
    status: r.status,
    supersedes: r.supersedes,
    conflictsWith: r.conflicts_with,
    gameTime: r.game_time,
    seq: r.seq,
    source: r.source,
    cite: r.cite,
    messageId: r.message_id,
    swipeId: r.swipe_id,
    createdAt: r.created_at,
  };
}

export interface SummaryRow extends SummaryItem {
  edited: boolean;
}

function toSummary(r: any): SummaryRow {
  return {
    id: r.id,
    level: r.level,
    title: r.title,
    text: r.text,
    fromTime: r.from_time,
    toTime: r.to_time,
    covers: json<string[]>(r.covers, []),
    importance: Math.min(3, Math.max(1, r.importance)) as Importance,
    seq: r.seq,
    edited: !!r.edited,
  };
}

export interface MemoryState {
  /** Live memories usable for recall (not forgotten, not folded into a live scene memory). */
  items: MemoryRow[];
  /** Every live memory including folded and forgotten ones (for the timeline). */
  all: MemoryRow[];
  heard: HeardItem[];
  /** Facts with their EFFECTIVE status (superseded/conflict computed from live rows). */
  facts: FactRow[];
  summaries: SummaryRow[];
}

/** Load everything live for a scope, resolving folding, supersession and summary validity. */
export function loadMemoryState(ctx: AppContext, owner: string, scope: MemScope): MemoryState {
  const w = scopeSql(scope, 'i');
  const rows = (ctx.db.prepare(`SELECT i.* FROM mem_items i WHERE i.owner_id = ? AND ${w.sql} AND ${liveSql('i')} ORDER BY i.seq`).all(owner, ...w.args) as any[]).map(toMemory);
  const liveIds = new Set(rows.map((r) => r.id));
  // A scene memory is only valid while EVERY beat folded into it is still live.
  const foldedAll = new Map<string, string[]>();
  const fw = scopeSql(scope);
  for (const r of ctx.db.prepare(`SELECT id, folded_into FROM mem_items WHERE owner_id = ? AND ${fw.sql} AND folded_into IS NOT NULL`).all(owner, ...fw.args) as Array<{ id: string; folded_into: string }>) {
    const arr = foldedAll.get(r.folded_into) ?? [];
    arr.push(r.id);
    foldedAll.set(r.folded_into, arr);
  }
  const validScene = (id: string) => (foldedAll.get(id) ?? []).every((b) => liveIds.has(b));
  const all = rows.filter((r) => r.kind !== 'scene' || validScene(r.id));
  const allIds = new Set(all.map((r) => r.id));
  const items = all.filter((r) => !r.forgotten && !(r.foldedInto && allIds.has(r.foldedInto)));

  const heardRows = ctx.db.prepare(`SELECT h.* FROM mem_heard h WHERE h.owner_id = ? AND ${scopeSql(scope, 'h').sql} AND ${liveSql('h')}`).all(owner, ...scopeSql(scope, 'h').args) as any[];
  const heard = heardRows.filter((h) => allIds.has(h.memory_id)).map((h) => ({ memoryId: h.memory_id, viewer: h.viewer, distortion: h.distortion, from: h.from_id }));

  const factRows = (ctx.db.prepare(`SELECT f.* FROM mem_facts f WHERE f.owner_id = ? AND ${scopeSql(scope, 'f').sql} AND ${liveSql('f')} ORDER BY f.seq`).all(owner, ...scopeSql(scope, 'f').args) as any[]).map(toFact);
  const supersededBy = new Map<string, string>();
  for (const f of factRows) if (f.supersedes && f.status !== 'retracted') supersededBy.set(f.supersedes, f.id);
  const byId = new Map(factRows.map((f) => [f.id, f]));
  const facts = factRows.map((f) => {
    if (f.status === 'retracted') return f;
    if (supersededBy.has(f.id)) return { ...f, status: 'superseded' as const };
    if (f.status === 'conflict') {
      const against = f.conflictsWith ? byId.get(f.conflictsWith) : undefined;
      // The claim it contradicted is gone (swiped away, retracted): it's simply true now.
      if (!against || against.status === 'retracted' || supersededBy.has(against.id)) return { ...f, status: 'active' as const };
    }
    return f;
  });

  const summaryRows = (ctx.db.prepare(`SELECT s.* FROM mem_summaries s WHERE s.owner_id = ? AND ${scopeSql(scope, 's').sql} AND ${liveSql('s')} ORDER BY s.seq`).all(owner, ...scopeSql(scope, 's').args) as any[]).map(toSummary);
  // A summary is valid while everything it was built from still exists.
  const summaryIds = new Set(summaryRows.map((s) => s.id));
  const summaries = summaryRows.filter((s) => s.edited || s.covers.every((id) => allIds.has(id) || summaryIds.has(id)));
  return { items, all, heard, facts, summaries };
}

// ------------------------------------------------------------------ writing

export interface MemoryInput {
  text: string;
  participants: string[];
  witnesses: string[];
  locationId: string | null;
  gameTime: number;
  importance: Importance;
  secret: boolean;
  kind?: MemoryKind;
  pinned?: boolean;
  foldedFrom?: string[];
}

export function insertMemory(ctx: AppContext, owner: string, scope: MemScope, anchor: Anchor, source: string, input: MemoryInput): MemoryRow {
  const id = newId('mi_');
  const now = Date.now();
  const seq = nextSeq(ctx, 'mem_items', scope);
  const text = input.text.trim().slice(0, 1200);
  ctx.db
    .prepare(
      `INSERT INTO mem_items (id, owner_id, campaign_id, chat_id, message_id, swipe_id, source, kind, text, participants, witnesses, location_id, game_time, importance, secret, pinned, forgotten, edited, folded_into, seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?)`,
    )
    .run(id, owner, scope.campaignId, anchor.chatId, anchor.messageId, anchor.swipeId, source, input.kind ?? 'beat', text, JSON.stringify([...new Set(input.participants)]), JSON.stringify([...new Set(input.witnesses)]), input.locationId, input.gameTime, input.importance, input.secret ? 1 : 0, input.pinned ? 1 : 0, seq, now, now);
  if (input.foldedFrom?.length) {
    const up = ctx.db.prepare('UPDATE mem_items SET folded_into = ? WHERE id = ? AND owner_id = ?');
    for (const b of input.foldedFrom) up.run(id, b, owner);
  }
  index(ctx, owner, scope, id, 'memory', text);
  return toMemory(ctx.db.prepare('SELECT * FROM mem_items WHERE id = ?').get(id));
}

/** Remove the rows a source wrote for one message+swipe (re-tracking must be idempotent). */
export function deleteAnchored(ctx: AppContext, messageId: string, swipeId: number | null, sources: string[]) {
  const marks = sources.map(() => '?').join(',');
  const swipe = swipeId === null ? 'swipe_id IS NULL' : 'swipe_id = ?';
  const args = swipeId === null ? [messageId, ...sources] : [messageId, swipeId, ...sources];
  const ids = (ctx.db.prepare(`SELECT id FROM mem_items WHERE message_id = ? AND ${swipe} AND source IN (${marks})`).all(...args) as Array<{ id: string }>).map((r) => r.id);
  ctx.db.transaction(() => {
    for (const id of ids) {
      ctx.db.prepare('UPDATE mem_items SET folded_into = NULL WHERE folded_into = ?').run(id);
      ctx.db.prepare('DELETE FROM mem_fts WHERE item_id = ?').run(id);
      ctx.db.prepare('DELETE FROM mem_vectors WHERE item_id = ?').run(id);
      ctx.db.prepare('DELETE FROM mem_heard WHERE memory_id = ?').run(id);
    }
    ctx.db.prepare(`DELETE FROM mem_items WHERE message_id = ? AND ${swipe} AND source IN (${marks})`).run(...args);
    const factIds = (ctx.db.prepare(`SELECT id FROM mem_facts WHERE message_id = ? AND ${swipe} AND source IN (${marks})`).all(...args) as Array<{ id: string }>).map((r) => r.id);
    for (const id of factIds) ctx.db.prepare('DELETE FROM mem_fts WHERE item_id = ?').run(id);
    ctx.db.prepare(`DELETE FROM mem_facts WHERE message_id = ? AND ${swipe} AND source IN (${marks})`).run(...args);
    if (sources.includes('sim')) ctx.db.prepare(`DELETE FROM mem_heard WHERE message_id = ? AND ${swipe}`).run(...(swipeId === null ? [messageId] : [messageId, swipeId]));
  })();
}

export interface FactInput {
  entityId: string;
  entityName: string;
  key: string;
  value: string;
  text: string;
  changed?: boolean;
  cite?: string;
}

export interface FactWrite {
  row: FactRow;
  action: 'insert' | 'refresh' | 'supersede' | 'conflict';
}

/** Store a fact through the versioning rules. Returns what happened. */
export function writeFact(ctx: AppContext, owner: string, scope: MemScope, anchor: Anchor, source: string, input: FactInput, gameTime: number, existing?: FactItem[]): FactWrite | null {
  const live = existing ?? loadMemoryState(ctx, owner, scope).facts;
  const effective = live.filter((f) => f.status === 'active' || f.status === 'conflict');
  const decision = resolveFact(effective, { entityId: input.entityId, entityName: input.entityName, key: input.key, value: input.value, text: input.text, changed: input.changed });
  if (decision.action === 'refresh') return { row: decision.target as FactRow, action: 'refresh' };
  const id = newId('mf_');
  const now = Date.now();
  const status = decision.action === 'conflict' ? 'conflict' : 'active';
  ctx.db
    .prepare(
      `INSERT INTO mem_facts (id, owner_id, campaign_id, chat_id, message_id, swipe_id, source, entity_id, entity_name, key, value, text, status, supersedes, conflicts_with, cite, game_time, seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      owner,
      scope.campaignId,
      anchor.chatId,
      anchor.messageId,
      anchor.swipeId,
      source,
      input.entityId,
      input.entityName.slice(0, 120),
      factKey(input.key),
      input.value.trim().slice(0, 200),
      input.text.trim().slice(0, 600) || `${input.entityName} ${input.key}: ${input.value}`,
      status,
      decision.action === 'supersede' ? decision.target.id : null,
      decision.action === 'conflict' ? decision.target.id : null,
      input.cite?.slice(0, 300) ?? null,
      gameTime,
      nextSeq(ctx, 'mem_facts', scope),
      now,
      now,
    );
  const row = toFact(ctx.db.prepare('SELECT * FROM mem_facts WHERE id = ?').get(id));
  index(ctx, owner, scope, id, 'fact', row.text);
  return { row, action: decision.action };
}

// ------------------------------------------------------------------ people in the scene

/** Map a name from the model to a person id: 'player', an NPC id, or 'char:<cardId>'. */
export function personId(state: CampaignState | null, name: string, ctxNames: { player: string; characters: Array<{ id: string; name: string }> }): string | null {
  const n = normalizeName(name);
  if (!n) return null;
  if (['you', 'player', 'me', 'i', normalizeName(ctxNames.player)].includes(n)) return PLAYER;
  if (state) {
    const hit = findNpc(state, name);
    if (hit) return hit.npc.id;
  }
  const card = ctxNames.characters.find((c) => normalizeName(c.name) === n || normalizeName(c.name).split(' ')[0] === n);
  if (card) {
    const linked = state ? Object.values(state.npcs).find((x) => x.characterId === card.id) : undefined;
    return linked ? linked.id : `char:${card.id}`;
  }
  return null;
}

/**
 * Who is in the scene with the player: NPCs at the player's location, party members, and the
 * chat's character cards (a card with no NPC, or whose NPC stands here, is in the conversation).
 */
export function presentIds(state: CampaignState | null, chatCharacters: string[]): string[] {
  const out = new Set<string>([PLAYER]);
  if (state) {
    for (const n of Object.values(state.npcs)) if (n.status === 'alive' && n.locationId && n.locationId === state.currentLocationId) out.add(n.id);
    for (const p of Object.values(state.party)) if (p.npcId && state.npcs[p.npcId]?.status === 'alive') out.add(p.npcId);
  }
  for (const cid of chatCharacters) {
    const npc = state ? Object.values(state.npcs).find((x) => x.characterId === cid) : undefined;
    if (!npc) out.add(`char:${cid}`);
    else if (npc.status === 'alive' && (!npc.locationId || npc.locationId === state?.currentLocationId)) out.add(npc.id);
  }
  return [...out];
}

export function nameOfPerson(state: CampaignState | null, id: string, names: { player: string; characters: Array<{ id: string; name: string }> }): string {
  if (id === PLAYER) return names.player;
  if (id.startsWith('char:')) return names.characters.find((c) => c.id === id.slice(5))?.name ?? 'Someone';
  return state?.npcs[id]?.name ?? 'Someone';
}

// ------------------------------------------------------------------ the turn writer

export interface TurnMemoryInput {
  text: string;
  about?: string[];
  importance?: number;
  private?: boolean;
  to?: string[];
}

export interface TurnFactInput {
  about: string;
  key: string;
  value: string;
  text?: string;
  changed?: boolean;
}

export interface TurnWriteResult {
  memories: number;
  facts: { inserted: number; superseded: number; conflicts: number; refreshed: number; rejected: number };
}

/**
 * Evidence firewall: a model-written fact must be grounded in this turn's text — the subject's
 * name, or at least two content words shared with the turn — or it's rejected.
 */
export function factHasEvidence(fact: { about: string; value: string; text?: string }, turnText: string): boolean {
  const turn = turnText.toLowerCase();
  const first = normalizeName(fact.about).split(' ')[0];
  if (first && first.length >= 3 && !['world', 'player', 'you'].includes(first) && turn.includes(first)) return true;
  const words = contentWords(`${fact.value} ${fact.text ?? ''}`);
  const turnWords = contentWords(turnText);
  let shared = 0;
  for (const w of words) if (turnWords.has(w)) shared++;
  return shared >= 2;
}

/** Write what the tracker pass read from one turn: beats (the scene event) and standing facts. */
export function writeTurnMemory(
  ctx: AppContext,
  owner: string,
  chat: ChatDTO,
  state: CampaignState | null,
  anchor: Anchor,
  input: { memories: TurnMemoryInput[]; facts: TurnFactInput[] },
  names: { player: string; characters: Array<{ id: string; name: string }> },
  turnText: string,
  chatCharacters: string[],
): TurnWriteResult {
  const scope = scopeOf(chat);
  const res: TurnWriteResult = { memories: 0, facts: { inserted: 0, superseded: 0, conflicts: 0, refreshed: 0, rejected: 0 } };
  if (anchor.messageId) deleteAnchored(ctx, anchor.messageId, anchor.swipeId, ['turn']);
  const present = presentIds(state, chatCharacters);
  const now = state?.time.minutes ?? 0;
  const loc = state?.currentLocationId ?? null;
  const resolve = (n: string) => personId(state, n, names);
  ctx.db.transaction(() => {
    for (const m of input.memories.slice(0, 6)) {
      const text = String(m.text ?? '').trim();
      if (text.length < 8) continue;
      const about = (m.about ?? []).map(resolve).filter((x): x is string => !!x);
      let witnesses = present;
      if (m.private) {
        const to = (m.to ?? []).map(resolve).filter((x): x is string => !!x);
        witnesses = [...new Set([PLAYER, ...to, ...about.filter((a) => present.includes(a))])];
      }
      const importance = Math.min(3, Math.max(1, Math.round(Number(m.importance) || 1))) as Importance;
      insertMemory(ctx, owner, scope, anchor, 'turn', { text, participants: about.length ? about : present.filter((p) => p !== PLAYER), witnesses, locationId: loc, gameTime: now, importance, secret: !!m.private });
      res.memories++;
    }
    const existing = loadMemoryState(ctx, owner, scope).facts;
    for (const f of input.facts.slice(0, 6)) {
      if (!f?.about || !f.key || !f.value) continue;
      if (!factHasEvidence(f, turnText)) {
        res.facts.rejected++;
        continue;
      }
      const id = normalizeName(f.about) === 'world' ? 'world' : resolve(f.about);
      if (!id) {
        res.facts.rejected++;
        continue;
      }
      const name = id === 'world' ? 'World' : nameOfPerson(state, id, names);
      const w = writeFact(ctx, owner, scope, anchor, 'turn', { entityId: id, entityName: name, key: f.key, value: f.value, text: f.text || `${name}: ${f.key} is ${f.value}`, changed: !!f.changed, cite: turnText.slice(0, 200) }, now, existing);
      if (!w) continue;
      if (w.action === 'insert') res.facts.inserted++;
      else if (w.action === 'supersede') res.facts.superseded++;
      else if (w.action === 'conflict') res.facts.conflicts++;
      else res.facts.refreshed++;
      if (w.action !== 'refresh') existing.push(w.row);
    }
  })();
  return res;
}

// ------------------------------------------------------------------ hearsay

/** Off-screen gossip among people standing together. Deterministic; anchored so swipes undo it. */
export function runHearsay(ctx: AppContext, owner: string, chat: ChatDTO, state: CampaignState, anchor: Anchor, opts: { maxDistortion: number; perListener: number }): number {
  const scope = scopeOf(chat);
  const mem = loadMemoryState(ctx, owner, scope);
  const groups = new Map<string, string[]>();
  for (const n of Object.values(state.npcs)) {
    if (n.status !== 'alive' || !n.locationId) continue;
    const arr = groups.get(n.locationId) ?? [];
    arr.push(n.id);
    groups.set(n.locationId, arr);
  }
  const fresh = spreadHearsay([...groups.values()], mem.items, new HeardIndex(mem.heard), opts);
  const ins = ctx.db.prepare('INSERT INTO mem_heard (id, owner_id, campaign_id, chat_id, message_id, swipe_id, memory_id, viewer, distortion, from_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ctx.db.transaction(() => {
    if (anchor.messageId) ctx.db.prepare(`DELETE FROM mem_heard WHERE message_id = ? AND ${anchor.swipeId === null ? 'swipe_id IS NULL' : 'swipe_id = ?'}`).run(...(anchor.swipeId === null ? [anchor.messageId] : [anchor.messageId, anchor.swipeId]));
    for (const h of fresh) ins.run(newId('mh_'), owner, scope.campaignId, anchor.chatId, anchor.messageId, anchor.swipeId, h.memoryId, h.viewer, h.distortion, h.from ?? null, Date.now());
  })();
  return fresh.length;
}

// ------------------------------------------------------------------ embeddings (optional)

function toBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}
function fromBlob(b: Buffer): Float32Array {
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Embed memories that have no vector yet. Background work; skipped cleanly without a connection. */
export async function embedPending(ctx: AppContext, owner: string, scope: MemScope, chatId: string | null): Promise<number> {
  const conn = connectionForRole(ctx, owner, 'embeddings');
  if (!conn) return 0;
  const model = conn.params.embeddings_model || conn.model;
  const w = scopeSql(scope, 'i');
  const rows = ctx.db
    .prepare(`SELECT i.id, i.text FROM mem_items i LEFT JOIN mem_vectors v ON v.item_id = i.id WHERE i.owner_id = ? AND ${w.sql} AND (v.item_id IS NULL OR v.model <> ?) LIMIT 256`)
    .all(owner, ...w.args, model) as Array<{ id: string; text: string }>;
  if (!rows.length) return 0;
  const up = ctx.db.prepare('INSERT INTO mem_vectors (item_id, owner_id, model, hash, vector) VALUES (?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET model = excluded.model, hash = excluded.hash, vector = excluded.vector');
  for (let i = 0; i < rows.length; i += 64) {
    const batch = rows.slice(i, i + 64);
    const vectors = await logged(ctx, owner, conn, { chatId, purpose: 'memory embeddings', role: 'embeddings' }, batch.reduce((n, r) => n + Math.ceil(r.text.length / 4), 0), () => embed(conn, batch.map((r) => r.text)), () => '');
    ctx.db.transaction(() => batch.forEach((r, j) => vectors[j] && up.run(r.id, owner, model, sha256(model + r.text), toBlob(vectors[j]))))();
  }
  return rows.length;
}

async function semanticScores(ctx: AppContext, owner: string, chatId: string, ids: string[], query: string, timeoutMs: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const conn = connectionForRole(ctx, owner, 'embeddings');
  if (!conn || !query.trim() || !ids.length) return out;
  const model = conn.params.embeddings_model || conn.model;
  const rows = ctx.db.prepare(`SELECT item_id, vector FROM mem_vectors WHERE model = ? AND item_id IN (${ids.map(() => '?').join(',')})`).all(model, ...ids) as Array<{ item_id: string; vector: Buffer }>;
  if (!rows.length) return out;
  try {
    const [q] = await Promise.race([
      logged(ctx, owner, conn, { chatId, purpose: 'recall query embedding', role: 'embeddings' }, Math.ceil(query.length / 4), () => embed(conn, [query.slice(0, 4000)]), () => ''),
      new Promise<number[][]>((_, rej) => setTimeout(() => rej(new Error('embedding timeout')), timeoutMs)),
    ]);
    if (!q) return out;
    for (const r of rows) out.set(r.item_id, cosine(q, fromBlob(r.vector)));
  } catch {
    /* no semantic signal this turn */
  }
  return out;
}

// ------------------------------------------------------------------ recall for a scene

export interface SceneRecall {
  result: RecallResult;
  facts: FactRow[];
  summaries: SummaryRow[];
  milestones: MemoryRow[];
  present: string[];
  /** Every scored candidate for "why was this recalled?". */
  explain: Array<{ id: string; viewer: string; total: number }>;
}

/** Full-text scores for live memory ids: best match 1.0, falling with rank. */
export function lexicalScores(ctx: AppContext, owner: string, scope: MemScope, query: string, liveIds: Set<string>, limit = 40): Map<string, number> {
  const out = new Map<string, number>();
  const q = ftsQuery(query, 24);
  if (!q) return out;
  const w = scope.campaignId ? { sql: 'campaign_id = ?', args: [scope.campaignId] } : { sql: "chat_id = ? AND campaign_id = ''", args: [scope.chatId] };
  try {
    const rows = ctx.db.prepare(`SELECT item_id FROM mem_fts WHERE mem_fts MATCH ? AND owner_id = ? AND ${w.sql} AND kind = 'memory' ORDER BY bm25(mem_fts) LIMIT ?`).all(q, owner, ...w.args, limit * 3) as Array<{ item_id: string }>;
    let rank = 0;
    for (const r of rows) {
      if (!liveIds.has(r.item_id)) continue;
      out.set(r.item_id, Math.max(0.2, 1 - rank / limit));
      if (++rank >= limit) break;
    }
  } catch {
    /* bad query: no lexical signal */
  }
  return out;
}

export async function recallForScene(
  ctx: AppContext,
  owner: string,
  chat: ChatDTO,
  state: CampaignState | null,
  recentText: string,
  opts: { chatCharacters: string[]; semantic: boolean; playerLimit?: number; semanticTimeoutMs?: number },
): Promise<SceneRecall> {
  const scope = scopeOf(chat);
  const mem = loadMemoryState(ctx, owner, scope);
  const present = presentIds(state, opts.chatCharacters);
  const liveIds = new Set(mem.items.map((m) => m.id));
  const lexical = lexicalScores(ctx, owner, scope, recentText, liveIds);
  const semantic = opts.semantic ? await semanticScores(ctx, owner, chat.id, [...liveIds], recentText, opts.semanticTimeoutMs ?? 2500) : new Map<string, number>();
  const named = new Set<string>();
  const low = recentText.toLowerCase();
  if (state) for (const n of Object.values(state.npcs)) if (low.includes(n.name.toLowerCase().split(' ')[0])) named.add(n.id);
  const result = recall(mem.items, new HeardIndex(mem.heard), { now: state?.time.minutes ?? 0, present, locationId: state?.currentLocationId ?? null, lexical, semantic, named }, { playerLimit: opts.playerLimit ?? 6 });
  const facts = currentFacts(mem.facts) as FactRow[];
  const explain = [
    ...result.player.map((r) => ({ id: r.m.id, viewer: PLAYER, total: r.score.total })),
    ...result.people.flatMap((p) => [...p.knows, ...p.heard].map((r) => ({ id: r.m.id, viewer: p.id, total: r.score.total }))),
  ];
  lastRecall.set(chat.id, { at: Date.now(), result, present });
  return { result, facts, summaries: mem.summaries, milestones: mem.items.filter((m) => m.importance >= 3), present, explain };
}

/** The most recent recall per chat, for "why was this recalled?". */
export const lastRecall = new Map<string, { at: number; result: RecallResult; present: string[] }>();

// ------------------------------------------------------------------ player controls

export function getMemory(ctx: AppContext, owner: string, id: string): MemoryRow {
  const r = ctx.db.prepare('SELECT * FROM mem_items WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Memory not found');
  return toMemory(r);
}

export function updateMemory(ctx: AppContext, owner: string, id: string, patch: { text?: string; pinned?: boolean; forgotten?: boolean; importance?: number; secret?: boolean; witnesses?: string[]; participants?: string[] }): MemoryRow {
  const m = getMemory(ctx, owner, id);
  const text = patch.text !== undefined ? patch.text.trim().slice(0, 1200) : m.text;
  if (!text) throw new HttpError(400, 'A memory needs some text');
  ctx.db
    .prepare('UPDATE mem_items SET text = ?, pinned = ?, forgotten = ?, importance = ?, secret = ?, witnesses = ?, participants = ?, edited = ?, updated_at = ? WHERE id = ?')
    .run(
      text,
      (patch.pinned ?? m.pinned) ? 1 : 0,
      (patch.forgotten ?? m.forgotten) ? 1 : 0,
      Math.min(3, Math.max(1, patch.importance ?? m.importance)),
      (patch.secret ?? m.secret) ? 1 : 0,
      JSON.stringify(patch.witnesses ?? m.witnesses),
      JSON.stringify(patch.participants ?? m.participants),
      m.edited || patch.text !== undefined ? 1 : 0,
      Date.now(),
      id,
    );
  // Corrected by the player: re-tracking the message must not overwrite it.
  if (patch.text !== undefined || patch.witnesses || patch.participants) ctx.db.prepare("UPDATE mem_items SET source = 'user' WHERE id = ? AND source = 'turn'").run(id);
  const row = ctx.db.prepare('SELECT campaign_id, chat_id FROM mem_items WHERE id = ?').get(id) as { campaign_id: string | null; chat_id: string };
  index(ctx, owner, { campaignId: row.campaign_id, chatId: row.chat_id }, id, 'memory', text);
  if (patch.text !== undefined) ctx.db.prepare('DELETE FROM mem_vectors WHERE item_id = ?').run(id);
  return getMemory(ctx, owner, id);
}

export function deleteMemory(ctx: AppContext, owner: string, id: string) {
  getMemory(ctx, owner, id);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE mem_items SET folded_into = NULL WHERE folded_into = ?').run(id);
    ctx.db.prepare('DELETE FROM mem_heard WHERE memory_id = ?').run(id);
    ctx.db.prepare('DELETE FROM mem_fts WHERE item_id = ?').run(id);
    ctx.db.prepare('DELETE FROM mem_vectors WHERE item_id = ?').run(id);
    ctx.db.prepare('DELETE FROM mem_items WHERE id = ?').run(id);
  })();
}

/** Settle a fact conflict: keep the old claim, take the new one, or keep both as separate truths. */
export function resolveConflict(ctx: AppContext, owner: string, factId: string, choice: 'keep-old' | 'use-new' | 'both'): void {
  const f = ctx.db.prepare('SELECT * FROM mem_facts WHERE id = ? AND owner_id = ?').get(factId, owner) as any;
  if (!f) throw new HttpError(404, 'Fact not found');
  if (choice === 'keep-old') ctx.db.prepare("UPDATE mem_facts SET status = 'retracted', updated_at = ? WHERE id = ?").run(Date.now(), factId);
  else if (choice === 'use-new') ctx.db.prepare("UPDATE mem_facts SET status = 'active', supersedes = conflicts_with, conflicts_with = NULL, updated_at = ? WHERE id = ?").run(Date.now(), factId);
  else ctx.db.prepare("UPDATE mem_facts SET status = 'active', key = key || '_also', conflicts_with = NULL, updated_at = ? WHERE id = ?").run(Date.now(), factId);
}

export function updateFact(ctx: AppContext, owner: string, id: string, patch: { text?: string; value?: string; retracted?: boolean }): void {
  const f = ctx.db.prepare('SELECT * FROM mem_facts WHERE id = ? AND owner_id = ?').get(id, owner) as any;
  if (!f) throw new HttpError(404, 'Fact not found');
  const text = patch.text?.trim() || f.text;
  const status = patch.retracted === true ? 'retracted' : patch.retracted === false && f.status === 'retracted' ? 'active' : f.status;
  // Edited by the player: re-tracking the message must not overwrite it (it still rewinds with a swipe).
  ctx.db.prepare("UPDATE mem_facts SET text = ?, value = ?, status = ?, source = 'user', updated_at = ? WHERE id = ?").run(text, patch.value?.trim() || f.value, status, Date.now(), id);
  index(ctx, owner, { campaignId: f.campaign_id, chatId: f.chat_id }, id, 'fact', text);
}

// ------------------------------------------------------------------ branching

/** Copy memory rows into a branched chat/campaign, re-anchored through the message map. */
export function forkMemory(ctx: AppContext, owner: string, from: MemScope, to: MemScope, messageMap: Map<string, string>) {
  const w = scopeSql(from);
  const idMap = new Map<string, string>();
  const items = ctx.db.prepare(`SELECT * FROM mem_items WHERE owner_id = ? AND ${w.sql} ORDER BY seq`).all(owner, ...w.args) as any[];
  const keep = (r: any) => r.message_id === null || messageMap.has(r.message_id);
  ctx.db.transaction(() => {
    for (const r of items.filter(keep)) {
      const id = newId('mi_');
      idMap.set(r.id, id);
      ctx.db
        .prepare(
          `INSERT INTO mem_items (id, owner_id, campaign_id, chat_id, message_id, swipe_id, source, kind, text, participants, witnesses, location_id, game_time, importance, secret, pinned, forgotten, edited, folded_into, seq, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(id, owner, to.campaignId, to.chatId, r.message_id ? messageMap.get(r.message_id) : null, r.swipe_id, r.source, r.kind, r.text, r.participants, r.witnesses, r.location_id, r.game_time, r.importance, r.secret, r.pinned, r.forgotten, r.edited, r.seq, r.created_at, r.updated_at);
      index(ctx, owner, to, id, 'memory', r.text);
    }
    for (const r of items.filter(keep)) if (r.folded_into && idMap.has(r.folded_into)) ctx.db.prepare('UPDATE mem_items SET folded_into = ? WHERE id = ?').run(idMap.get(r.folded_into), idMap.get(r.id));
    for (const h of ctx.db.prepare(`SELECT * FROM mem_heard WHERE owner_id = ? AND ${w.sql}`).all(owner, ...w.args) as any[]) {
      if (!keep(h) || !idMap.has(h.memory_id)) continue;
      ctx.db.prepare('INSERT INTO mem_heard (id, owner_id, campaign_id, chat_id, message_id, swipe_id, memory_id, viewer, distortion, from_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(newId('mh_'), owner, to.campaignId, to.chatId, h.message_id ? messageMap.get(h.message_id) : null, h.swipe_id, idMap.get(h.memory_id), h.viewer, h.distortion, h.from_id, h.created_at);
    }
    const factMap = new Map<string, string>();
    const facts = (ctx.db.prepare(`SELECT * FROM mem_facts WHERE owner_id = ? AND ${w.sql} ORDER BY seq`).all(owner, ...w.args) as any[]).filter(keep);
    for (const f of facts) factMap.set(f.id, newId('mf_'));
    for (const f of facts) {
      const id = factMap.get(f.id)!;
      ctx.db
        .prepare(
          `INSERT INTO mem_facts (id, owner_id, campaign_id, chat_id, message_id, swipe_id, source, entity_id, entity_name, key, value, text, status, supersedes, conflicts_with, cite, game_time, seq, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, owner, to.campaignId, to.chatId, f.message_id ? messageMap.get(f.message_id) : null, f.swipe_id, f.source, f.entity_id, f.entity_name, f.key, f.value, f.text, f.status, f.supersedes ? factMap.get(f.supersedes) ?? null : null, f.conflicts_with ? factMap.get(f.conflicts_with) ?? null : null, f.cite, f.game_time, f.seq, f.created_at, f.updated_at);
      index(ctx, owner, to, id, 'fact', f.text);
    }
    for (const s of (ctx.db.prepare(`SELECT * FROM mem_summaries WHERE owner_id = ? AND ${w.sql}`).all(owner, ...w.args) as any[]).filter(keep)) {
      const covers = json<string[]>(s.covers, []).map((c) => idMap.get(c) ?? c);
      const id = newId('ms_');
      ctx.db
        .prepare('INSERT INTO mem_summaries (id, owner_id, campaign_id, chat_id, level, title, text, from_time, to_time, covers, importance, message_id, swipe_id, edited, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, owner, to.campaignId, to.chatId, s.level, s.title, s.text, s.from_time, s.to_time, JSON.stringify(covers), s.importance, s.message_id ? messageMap.get(s.message_id) : null, s.swipe_id, s.edited, s.seq, s.created_at, s.updated_at);
      index(ctx, owner, to, id, 'summary', s.text);
    }
  })();
}

// ------------------------------------------------------------------ summaries

export function insertSummary(ctx: AppContext, owner: string, scope: MemScope, anchor: Anchor, s: Omit<SummaryItem, 'id' | 'seq'>): SummaryRow {
  const id = newId('ms_');
  const now = Date.now();
  ctx.db
    .prepare('INSERT INTO mem_summaries (id, owner_id, campaign_id, chat_id, level, title, text, from_time, to_time, covers, importance, message_id, swipe_id, edited, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
    .run(id, owner, scope.campaignId, anchor.chatId, s.level, s.title.slice(0, 200), s.text.slice(0, 4000), s.fromTime, s.toTime, JSON.stringify(s.covers), s.importance, anchor.messageId, anchor.swipeId, nextSeq(ctx, 'mem_summaries', scope), now, now);
  index(ctx, owner, scope, id, 'summary', s.text);
  return toSummary(ctx.db.prepare('SELECT * FROM mem_summaries WHERE id = ?').get(id));
}

export function updateSummary(ctx: AppContext, owner: string, id: string, text: string) {
  const s = ctx.db.prepare('SELECT * FROM mem_summaries WHERE id = ? AND owner_id = ?').get(id, owner) as any;
  if (!s) throw new HttpError(404, 'Summary not found');
  ctx.db.prepare('UPDATE mem_summaries SET text = ?, edited = 1, updated_at = ? WHERE id = ?').run(text.trim().slice(0, 4000), Date.now(), id);
  index(ctx, owner, { campaignId: s.campaign_id, chatId: s.chat_id }, id, 'summary', text);
}

export function deleteSummary(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM mem_summaries WHERE id = ? AND owner_id = ?').run(id, owner);
  ctx.db.prepare('DELETE FROM mem_fts WHERE item_id = ?').run(id);
}

// ------------------------------------------------------------------ message lifecycle

/** A swipe was deleted: its rows go, and later swipes' rows shift down one (like op_log). */
export function memOnSwipeDeleted(ctx: AppContext, messageId: string, swipeId: number) {
  for (const t of ['mem_items', 'mem_facts', 'mem_heard', 'mem_summaries']) {
    const ids = (ctx.db.prepare(`SELECT id FROM ${t} WHERE message_id = ? AND swipe_id = ?`).all(messageId, swipeId) as Array<{ id: string }>).map((r) => r.id);
    for (const id of ids) ctx.db.prepare('DELETE FROM mem_fts WHERE item_id = ?').run(id);
    ctx.db.prepare(`DELETE FROM ${t} WHERE message_id = ? AND swipe_id = ?`).run(messageId, swipeId);
    ctx.db.prepare(`UPDATE ${t} SET swipe_id = swipe_id - 1 WHERE message_id = ? AND swipe_id > ?`).run(messageId, swipeId);
  }
}

/** Messages were deleted: everything they caused goes with them. */
export function memOnMessagesDeleted(ctx: AppContext, messageIds: string[]) {
  if (!messageIds.length) return;
  const ph = messageIds.map(() => '?').join(',');
  for (const t of ['mem_items', 'mem_facts', 'mem_summaries']) {
    const ids = (ctx.db.prepare(`SELECT id FROM ${t} WHERE message_id IN (${ph})`).all(...messageIds) as Array<{ id: string }>).map((r) => r.id);
    for (const id of ids) {
      ctx.db.prepare('DELETE FROM mem_fts WHERE item_id = ?').run(id);
      ctx.db.prepare('DELETE FROM mem_vectors WHERE item_id = ?').run(id);
      if (t === 'mem_items') {
        ctx.db.prepare('UPDATE mem_items SET folded_into = NULL WHERE folded_into = ?').run(id);
        ctx.db.prepare('DELETE FROM mem_heard WHERE memory_id = ?').run(id);
      }
    }
    ctx.db.prepare(`DELETE FROM ${t} WHERE message_id IN (${ph})`).run(...messageIds);
  }
  ctx.db.prepare(`DELETE FROM mem_heard WHERE message_id IN (${ph})`).run(...messageIds);
}
