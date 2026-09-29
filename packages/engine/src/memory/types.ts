/**
 * Memory types. Memories live beside the campaign state (not inside it) but are anchored to
 * messages exactly like ops, so a swipe, edit or delete takes them back.
 *
 * Ids used for people: 'player' for the player, NPC ids for NPCs, 'char:<cardId>' for a
 * chat's character card that has no NPC yet.
 */

export const PLAYER = 'player';

export type MemoryKind = 'beat' | 'scene' | 'chronicle' | 'note';
export type Importance = 1 | 2 | 3;

export interface MemoryItem {
  id: string;
  text: string;
  kind: MemoryKind;
  /** Who it is ABOUT. */
  participants: string[];
  /** Who SAW it (first-hand knowledge). Not the same as participants. */
  witnesses: string[];
  locationId: string | null;
  /** Game minutes when it happened. */
  gameTime: number;
  /** 1 ordinary, 2 durable, 3 milestone (never fades). */
  importance: Importance;
  /** Private to its witnesses: hearsay never carries it. */
  secret: boolean;
  pinned: boolean;
  /** Story order (monotonic across the campaign). */
  seq: number;
}

/** Second-hand knowledge: `viewer` heard about `memoryId`, retold `distortion` times. */
export interface HeardItem {
  memoryId: string;
  viewer: string;
  distortion: number;
  from?: string | null;
}

export type KnowledgeKind = 'witnessed' | 'heard';

export type FactStatus = 'active' | 'superseded' | 'conflict' | 'retracted';

/** A standing truth about someone or something ("Mara is a knight"), versioned. */
export interface FactItem {
  id: string;
  /** 'player', an NPC id, a location id, an org id, or 'world'. */
  entityId: string;
  entityName: string;
  /** Slot, e.g. "rank", "occupation", "home". Two facts with the same key compete. */
  key: string;
  value: string;
  text: string;
  status: FactStatus;
  supersedes?: string | null;
  conflictsWith?: string | null;
  gameTime: number;
  seq: number;
}

export interface IncomingFact {
  entityId: string;
  entityName: string;
  key: string;
  value: string;
  text: string;
  /** The text shows the fact CHANGING ("was knighted"), not a different claim about the same thing. */
  changed?: boolean;
}

export interface SummaryItem {
  id: string;
  level: 'scene' | 'day' | 'chapter';
  title: string;
  text: string;
  fromTime: number;
  toTime: number;
  /** Memory ids it was built from. */
  covers: string[];
  /** Highest importance inside (milestones propagate up). */
  importance: Importance;
  seq: number;
}
