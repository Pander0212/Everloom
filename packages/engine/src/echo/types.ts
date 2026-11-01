/**
 * ECHO: Everloom's epistemic memory engine. Types.
 *
 * The authoritative history is an append-only log of EchoEvents. Every event is bound to the
 * message (and swipe) that caused it, so the active branch of the message tree is simply "the
 * events whose message is on the active path". Everything else (world facts, observations,
 * beliefs, hypotheses, memory units) is a derived projection, rebuilt or extended from the log.
 *
 * Actor ids follow the rest of the engine: 'player' for the persona, NPC ids, 'char:<cardId>'.
 */

export type ActorId = string;

/** A proposition: subject, predicate, object/value. "ring | location | clara_bag". */
export interface Prop {
  s: string;
  p: string;
  o: string;
  /** "not P". */
  neg?: boolean;
}

/** How much of an event a perceiver got. Ordered: each level includes the ones before it. */
export type Reveal = 'presence' | 'behavior' | 'identity' | 'content';
export const REVEAL_ORDER: Reveal[] = ['presence', 'behavior', 'identity', 'content'];

export type SenseChannel = 'sight' | 'sound' | 'smell' | 'touch';

/** One perceivable aspect of an event, written from an onlooker's point of view. */
export interface Cue {
  channel: SenseChannel;
  /** What a perceiver of this cue experiences ("Anna slid something into the drawer"). */
  detail: string;
  /** 0..1: how hard it is to miss. */
  salience: number;
  reveals: Reveal;
  /** Propositions a perceiver of this cue now knows first-hand. */
  props?: Prop[];
}

export type Hearing = 'clear' | 'muffled' | 'none';

/** One possible observer's situation when the event happened (a snapshot taken at commit). */
export interface ObserverState {
  actor: ActorId;
  /** here: same place; adjacent: next room / through a door; remote: elsewhere. */
  place: 'here' | 'adjacent' | 'remote';
  /** Line of sight to the event. */
  sight: boolean;
  hearing: Hearing;
  awake: boolean;
  /** 0 sober and well … 1 out of it (drunk, concussed). */
  impairment: number;
  /** 0 absorbed elsewhere … 1 watching closely. */
  attention: number;
  /** Languages understood (absent = understands everything spoken here). */
  languages?: string[];
  /** Recognises the disguised actors (default true). */
  recognises?: boolean;
}

/** Something an actor asserted (speech, letter, message). */
export interface Claim {
  prop: Prop;
  /** How the claim reads ("Anna said she was fetching documents"). */
  text: string;
}

export type EventType =
  | 'action'
  | 'speech'
  | 'message'
  | 'thought'
  | 'move'
  | 'world'
  | 'promise'
  | 'promise.update'
  | 'reveal'
  | 'group'
  | 'note';

export type Visibility = 'public' | 'private' | 'secret';

export interface HypothesisSeed {
  owner: ActorId;
  /** Stable key for the question ("why was anna in the office"). */
  question: string;
  options: Array<{ label: string; prop: Prop; weight: number; sinister?: boolean }>;
}

export interface CommitmentSeed {
  id: string;
  by: ActorId;
  to: ActorId[];
  what: string;
  /** Game minutes by which it is due. */
  due?: number | null;
}

export type ConstraintKind = 'oneOf' | 'not' | 'matches';
export interface Constraint {
  kind: ConstraintKind;
  values: string[];
  /** Why this constraint exists (the clue). */
  why?: string;
}

export interface UndeterminedSeed {
  s: string;
  p: string;
  label: string;
  candidates?: string[];
}

export interface MetaBeliefSeed {
  owner: ActorId;
  /** owner believes [about0 kind0 [about1 kind1 …]] prop. */
  chain: Array<{ about: ActorId; kind: 'knows' | 'believes' | 'suspects' }>;
  prop: Prop;
}

export interface EchoEvent {
  id: string;
  storyId: string;
  /** The message that caused it (null: a manual or migration event that is always live). */
  messageId: string | null;
  swipeId: number | null;
  /** Story order. Monotonic within a story. */
  seq: number;
  type: EventType;
  /** World time (game minutes). */
  occurredAt: number;
  /** System time (ms). */
  recordedAt: number;
  locationId: string | null;
  actors: ActorId[];
  targets: string[];
  /** The omniscient description. Never shown to someone who did not perceive it at 'content'. */
  action: string;
  /** Exact source dialogue/action excerpt (detail level L2). Same access rule as `action`. */
  quote?: string;
  attempted: boolean;
  outcome: 'success' | 'failure' | 'unknown';
  visibility: Visibility;
  cues: Cue[];
  /** Who might perceive it, and how well (from the world state when it was committed). */
  observers: ObserverState[];
  /** Addressees (speech) or recipients (messages, letters). */
  recipients: ActorId[];
  /** For private channels: who intercepted it (justified by the world: a camera, a spy). */
  interceptors?: ActorId[];
  /** What the speaker asserted (speech, letters). Testimony, not truth. */
  claims?: Claim[];
  /** Omniscient: false when the claims are a lie. Never projected into an actor's view. */
  sincere?: boolean;
  /** Canonical changes, applied only when the outcome is a success. */
  establishes?: Prop[];
  /** Spoken language (for comprehension). */
  language?: string;
  hypotheses?: HypothesisSeed[];
  commitment?: CommitmentSeed;
  commitmentUpdate?: { id: string; status: 'kept' | 'broken' };
  groupJoin?: Array<{ actor: ActorId; group: string }>;
  groupLeave?: Array<{ actor: ActorId; group: string }>;
  /** Common knowledge given to a group (membership at the time grants it). */
  common?: Array<{ group: string; prop: Prop; text: string }>;
  undetermined?: UndeterminedSeed[];
  constrains?: Array<{ s: string; p: string; constraint: Constraint }>;
  meta?: MetaBeliefSeed[];
  /** An actor draws a conclusion from beliefs they hold (each `from` must be held, or nothing is inferred). */
  infers?: Array<{ owner: ActorId; prop: Prop; text: string; from: Prop[]; reflection?: boolean }>;
  /** An actor realises a belief was mistaken. */
  corrects?: Array<{ owner: ActorId; prop: Prop; reason: string }>;
  emotions?: Array<{ actor: ActorId; emotion: string; intensity: number; toward?: ActorId }>;
  relations?: Array<{ from: ActorId; to: ActorId; trust?: number; attachment?: number; suspicion?: number; resentment?: number }>;
  /** 1 ordinary, 2 lasting, 3 milestone. */
  importance: 1 | 2 | 3;
  causes: string[];
  sourceMessageIds: string[];
  provenance: 'extraction' | 'manual' | 'migration' | 'rule';
  /** Migration: the real observers could not be reconstructed. Grants nothing universally. */
  unresolved?: boolean;
  schemaVersion: 1;
}

// ------------------------------------------------------------------ derived records

export interface FactVersion {
  id: string;
  s: string;
  p: string;
  o: string;
  neg?: boolean;
  /** Story seq / world time the version became valid, and stopped being valid (null = still). */
  validFrom: number;
  validFromTime: number;
  validTo: number | null;
  validToTime: number | null;
  sourceEventIds: string[];
  status: 'canonical' | 'collapsed';
}

export interface Observation {
  id: string;
  owner: ActorId;
  eventId: string;
  level: Reveal;
  details: string[];
  channels: SenseChannel[];
  seq: number;
  at: number;
}

export type BeliefMode = 'observed' | 'told' | 'rumor' | 'inferred' | 'common' | 'reflection';

export interface Belief {
  id: string;
  owner: ActorId;
  prop: Prop;
  mode: BeliefMode;
  /** Subjective strength, 0..1 (not a calibrated probability). */
  confidence: number;
  /** Justification: node ids this belief rests on (obs:…, tes:…, bel:…, ev:…). All must hold. */
  supports: string[];
  /** Rumor chain, nearest teller first. */
  via: ActorId[];
  /** How the belief reads to its owner. */
  text: string;
  eventId: string;
  since: number;
  sinceTime: number;
  until: number | null;
  untilTime: number | null;
  status: 'in' | 'out';
  outReason?: string;
  /** Another in-belief disagrees and neither outranks the other. */
  contested?: boolean;
}

export interface Testimony {
  id: string;
  speaker: ActorId;
  listener: ActorId;
  claim: Claim;
  eventId: string;
  accepted: boolean;
  seq: number;
  at: number;
}

export interface HigherOrder {
  id: string;
  owner: ActorId;
  chain: Array<{ about: ActorId; kind: 'knows' | 'believes' | 'suspects' }>;
  prop: Prop;
  text: string;
  depth: number;
  supports: string[];
  since: number;
  until: number | null;
  status: 'in' | 'out';
}

export interface HypothesisOption {
  id: string;
  label: string;
  prop: Prop;
  amplitude: number;
  sinister: boolean;
  support: string[];
  contra: string[];
}

export interface HypothesisSet {
  id: string;
  owner: ActorId;
  question: string;
  options: HypothesisOption[];
  status: 'open' | 'resolved';
  resolvedTo?: string;
  eventId: string;
  since: number;
  history: Array<{ seq: number; amplitudes: Record<string, number>; why: string }>;
}

export interface Commitment {
  id: string;
  by: ActorId;
  to: ActorId[];
  what: string;
  due: number | null;
  status: 'open' | 'kept' | 'broken';
  eventId: string;
  since: number;
  /** Who knows about it (perceived the promise). */
  knownBy: ActorId[];
}

export interface Undetermined {
  key: string;
  s: string;
  p: string;
  label: string;
  candidates: string[];
  constraints: Array<Constraint & { eventId: string }>;
  status: 'open' | 'collapsed' | 'predecided';
  value?: string;
  collapsedBy?: string;
  since: number;
}

export type MemoryType = 'episodic' | 'semantic' | 'social' | 'autobiographical' | 'procedural' | 'prospective' | 'reflective';
export type EpistemicStatus = 'experienced' | 'told' | 'rumored' | 'inferred' | 'common';

/** One actor's individually addressable memory of one event. */
export interface MemoryUnit {
  id: string;
  owner: ActorId;
  eventId: string;
  episodeId: string;
  level: Reveal;
  status: EpistemicStatus;
  kind: MemoryType;
  /** ~15 tokens. */
  l0: string;
  /** ~60 tokens. */
  l1: string;
  /** Exact source text is allowed (the owner perceived the event completely). */
  quoteAllowed: boolean;
  entities: string[];
  locationId: string | null;
  occurredAt: number;
  seq: number;
  importance: 1 | 2 | 3;
  emotion: number;
  /** Trigger signature: when this memory may become relevant. Never shown to the writer. */
  triggers: string[];
  /** Attribute words (season, time of day, weather) for interference. */
  attributes: string[];
  via: ActorId[];
  commitmentId?: string;
  /** Event ids this memory's event was caused by (for causal recall). */
  causes: string[];
}

export interface Membership {
  actor: ActorId;
  group: string;
  from: number;
  to: number | null;
}

export interface Relationship {
  from: ActorId;
  to: ActorId;
  trust: number;
  attachment: number;
  suspicion: number;
  resentment: number;
  /** Event ids that moved it. */
  history: string[];
}

export interface EmotionState {
  actor: ActorId;
  emotion: string;
  intensity: number;
  toward?: ActorId;
  seq: number;
  /** World time it was felt. */
  at: number;
}

/** Owner edits and decisions, applied on top of the log (themselves message-bound or always live). */
export type ManualOp =
  | { id: string; kind: 'predecide'; s: string; p: string; value: string; messageId?: string | null; swipeId?: number | null }
  | { id: string; kind: 'retract-belief'; beliefId: string; messageId?: string | null; swipeId?: number | null }
  | { id: string; kind: 'suppress'; unitId: string; messageId?: string | null; swipeId?: number | null }
  | { id: string; kind: 'forget'; unitId: string; messageId?: string | null; swipeId?: number | null }
  | { id: string; kind: 'drift'; unitId: string; note: string; messageId?: string | null; swipeId?: number | null };

export interface ProjectorConfig {
  /** Attention threshold for noticing a cue: salience × awareness ≥ this. */
  noticeThreshold: number;
  /** Trust needed to accept testimony as a belief. */
  acceptThreshold: number;
  defaultTrust: number;
  /** Higher-order depth kept (2 default, 3 allowed). */
  maxDepth: 2 | 3;
  /** Personality knobs that bias hypotheses. */
  traits: Record<ActorId, { paranoia?: number; credulity?: number }>;
  /** Display names for actors (used in memory text). */
  names: Record<string, string>;
  /** Scene gap (minutes) that starts a new episode. */
  episodeGap: number;
}

export const DEFAULT_PROJECTOR_CONFIG: ProjectorConfig = Object.freeze({
  noticeThreshold: 0.35,
  acceptThreshold: 0.35,
  defaultTrust: 0.6,
  maxDepth: 2,
  traits: {},
  names: {},
  episodeGap: 120,
}) as ProjectorConfig;
