/**
 * Character cards: V1 / V2 (chara_card_v2) / V3 (chara_card_v3), PNG `chara` + `ccv3` tEXt chunks, and JSON.
 * Export matches SillyTavern's shape so a round-trip through SillyTavern is lossless.
 */
import { base64ToUtf8, utf8ToBase64 } from '../util/base64.js';
import type { CharacterBook } from '../lore/convert.js';
import { isPng, readPngText, writePngText } from './png.js';

export interface CardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book?: CharacterBook;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, any>;
  // V3 additions (optional)
  nickname?: string;
  creator_notes_multilingual?: Record<string, string>;
  source?: string[];
  group_only_greetings?: string[];
  creation_date?: number;
  modification_date?: number;
  assets?: Array<{ type: string; uri: string; name: string; ext: string }>;
  /** Unknown data.* keys preserved for round-trip. */
  [extra: string]: unknown;
}

export interface ParsedCard {
  spec: 'v1' | 'v2' | 'v3';
  data: CardData;
  /** Unknown top-level keys from the source JSON (e.g. ST's `create_date`, `talkativeness`). */
  topLevelExtras: Record<string, unknown>;
}

const KNOWN_DATA_KEYS = new Set([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt',
  'post_history_instructions', 'alternate_greetings', 'character_book', 'tags', 'creator', 'character_version', 'extensions',
  'nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'creation_date', 'modification_date', 'assets',
]);

const V1_TOP_KEYS = new Set([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creatorcomment', 'avatar', 'chat',
  'talkativeness', 'fav', 'tags', 'spec', 'spec_version', 'data', 'create_date', 'json_data',
]);

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s !== '') : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

export function emptyCardData(name = ''): CardData {
  return {
    name,
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {},
  };
}

/** Normalize any card JSON (V1/V2/V3) into our CardData. */
export function parseCardJson(input: unknown): ParsedCard {
  if (!input || typeof input !== 'object') throw new Error('Card JSON must be an object');
  const raw = input as Record<string, any>;
  const topLevelExtras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!V1_TOP_KEYS.has(k)) topLevelExtras[k] = v;
  if (raw.create_date !== undefined) topLevelExtras.create_date = raw.create_date;
  if (raw.talkativeness !== undefined) topLevelExtras.talkativeness = raw.talkativeness;

  let spec: ParsedCard['spec'] = 'v1';
  let src: Record<string, any> = raw;
  if (raw.spec === 'chara_card_v3' && raw.data) {
    spec = 'v3';
    src = raw.data;
  } else if (raw.spec === 'chara_card_v2' && raw.data) {
    spec = 'v2';
    src = raw.data;
  } else if (raw.data && typeof raw.data === 'object' && raw.data.name) {
    spec = 'v2';
    src = raw.data;
  }

  const data: CardData = {
    ...emptyCardData(),
    name: str(src.name ?? raw.name ?? raw.char_name).trim() || 'Unnamed',
    description: str(src.description ?? raw.description ?? raw.char_persona),
    personality: str(src.personality ?? raw.personality),
    scenario: str(src.scenario ?? raw.scenario ?? raw.world_scenario),
    first_mes: str(src.first_mes ?? raw.first_mes ?? raw.char_greeting),
    mes_example: str(src.mes_example ?? raw.mes_example ?? raw.example_dialogue),
    creator_notes: str(src.creator_notes ?? raw.creatorcomment ?? ''),
    system_prompt: str(src.system_prompt),
    post_history_instructions: str(src.post_history_instructions),
    alternate_greetings: Array.isArray(src.alternate_greetings) ? src.alternate_greetings.map(str) : typeof src.alternate_greetings === 'string' ? [src.alternate_greetings] : [],
    tags: strList(src.tags ?? raw.tags),
    creator: str(src.creator),
    character_version: str(src.character_version),
    extensions: src.extensions && typeof src.extensions === 'object' ? { ...src.extensions } : {},
  };
  if (src.character_book && typeof src.character_book === 'object') data.character_book = src.character_book;
  for (const key of ['nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'creation_date', 'modification_date', 'assets'] as const) {
    if (src[key] !== undefined) (data as any)[key] = src[key];
  }
  if (spec !== 'v1') {
    for (const [k, v] of Object.entries(src)) if (!KNOWN_DATA_KEYS.has(k)) data[k] = v;
  }
  // V1 fav/talkativeness live at top level; mirror into extensions like ST.
  if (spec === 'v1') {
    if (raw.talkativeness !== undefined) data.extensions.talkativeness = Number(raw.talkativeness) || 0.5;
    if (raw.fav !== undefined) data.extensions.fav = raw.fav === true || raw.fav === 'true';
  }
  return { spec, data, topLevelExtras };
}

/** Build SillyTavern-shaped V2 JSON (with V1 mirror fields at top level). */
export function buildV2Json(data: CardData, topLevelExtras: Record<string, unknown> = {}): Record<string, any> {
  const ext: Record<string, any> = { talkativeness: 0.5, fav: false, world: '', ...data.extensions };
  if (!ext.depth_prompt) ext.depth_prompt = { prompt: '', depth: 4, role: 'system' };
  const out: Record<string, any> = {
    ...topLevelExtras,
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    creatorcomment: data.creator_notes,
    avatar: 'none',
    talkativeness: ext.talkativeness,
    fav: !!ext.fav,
    tags: data.tags,
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      ...Object.fromEntries(Object.entries(data).filter(([k]) => !KNOWN_DATA_KEYS.has(k))),
      name: data.name,
      description: data.description,
      personality: data.personality,
      scenario: data.scenario,
      first_mes: data.first_mes,
      mes_example: data.mes_example,
      creator_notes: data.creator_notes,
      system_prompt: data.system_prompt,
      post_history_instructions: data.post_history_instructions,
      tags: data.tags,
      creator: data.creator,
      character_version: data.character_version,
      alternate_greetings: data.alternate_greetings,
      extensions: ext,
    },
  };
  if (data.character_book) out.data.character_book = data.character_book;
  for (const key of ['nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'creation_date', 'modification_date', 'assets'] as const) {
    if (data[key] !== undefined) out.data[key] = data[key];
  }
  if (out.create_date === undefined) out.create_date = new Date().toISOString();
  return out;
}

export function buildV3Json(data: CardData, topLevelExtras: Record<string, unknown> = {}): Record<string, any> {
  const v2 = buildV2Json(data, topLevelExtras);
  return { ...v2, spec: 'chara_card_v3', spec_version: '3.0', data: { ...v2.data, group_only_greetings: data.group_only_greetings ?? [] } };
}

/** Read a card from PNG bytes (ccv3 takes precedence over chara, like SillyTavern). */
export function readCardFromPng(bytes: Uint8Array): ParsedCard {
  const text = readPngText(bytes);
  const payload = text['ccv3'] ?? text['chara'];
  if (!payload) throw new Error('PNG has no character data (no chara/ccv3 chunk)');
  const json = JSON.parse(base64ToUtf8(payload));
  return parseCardJson(json);
}

/** Write card data into a PNG: `chara` (V2) and `ccv3` (V3), replacing previous ones. */
export function writeCardToPng(image: Uint8Array, data: CardData, topLevelExtras: Record<string, unknown> = {}): Uint8Array {
  const v2 = buildV2Json(data, topLevelExtras);
  const v3 = { ...v2, spec: 'chara_card_v3', spec_version: '3.0' };
  return writePngText(image, { chara: utf8ToBase64(JSON.stringify(v2)), ccv3: utf8ToBase64(JSON.stringify(v3)) });
}

/** WebP cards: look for a base64 or JSON `chara` payload inside EXIF/XMP chunks (best-effort). */
export function readCardFromWebp(bytes: Uint8Array): ParsedCard {
  const text = new TextDecoder('latin1').decode(bytes);
  const b64 = /chara["'=:\s>]*([A-Za-z0-9+/]{40,}={0,2})/.exec(text);
  if (b64) {
    try {
      return parseCardJson(JSON.parse(base64ToUtf8(b64[1])));
    } catch {
      /* fall through */
    }
  }
  const json = /\{"(?:spec|name|data)"[\s\S]*\}/.exec(text);
  if (json) {
    try {
      return parseCardJson(JSON.parse(json[0]));
    } catch {
      /* fall through */
    }
  }
  throw new Error('WebP has no character data');
}

export function sniffImageType(bytes: Uint8Array): 'png' | 'webp' | 'jpeg' | 'gif' | null {
  if (isPng(bytes)) return 'png';
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  return null;
}

/** Parse a card from any supported file (PNG, WebP, JSON). */
export function readCardFile(bytes: Uint8Array): ParsedCard {
  const kind = sniffImageType(bytes);
  if (kind === 'png') return readCardFromPng(bytes);
  if (kind === 'webp') return readCardFromWebp(bytes);
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  return parseCardJson(JSON.parse(text));
}
