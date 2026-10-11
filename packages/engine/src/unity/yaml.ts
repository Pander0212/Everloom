/**
 * Unity's text serialization ("Force Text" assets: .prefab, .unity, .mat, .anim, .controller,
 * .asset, .meta). Each file is a stream of YAML documents headed `--- !u!<classID> &<fileID>`
 * (optionally followed by `stripped`). Unity writes a small, regular subset of YAML:
 * block mappings, block sequences ("- " at the parent key's indent or deeper), flow mappings and
 * sequences on one line ({fileID: 0, guid: x, type: 3}), and plain or quoted scalars, where a plain
 * or quoted scalar can continue on more-indented lines. This reader handles exactly that subset.
 */

export type YamlValue = string | number | null | YamlValue[] | { [k: string]: YamlValue };
export type YamlMap = { [k: string]: YamlValue };

export interface UnityDoc {
  classId: number;
  fileId: string;
  stripped: boolean;
  /** The document's single top-level key: GameObject, Transform, Material, MonoBehaviour, … */
  type: string;
  body: YamlMap;
}

/** Unity's object references: {fileID, guid?, type?}. */
export interface UnityRef {
  fileID: string;
  guid?: string;
  type?: number;
}

const HEADER = /^--- !u!(\d+) &(-?\d+)( stripped)?\s*$/;

export function isUnityYaml(text: string): boolean {
  return /^%YAML 1\.1/.test(text) || /^--- !u!\d+ &/m.test(text.slice(0, 4096));
}

/** Splits a Unity YAML file into its documents. A plain YAML file (e.g. a .meta) is one document with classId 0. */
export function parseUnityYaml(text: string): UnityDoc[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const docs: UnityDoc[] = [];
  let cur: { classId: number; fileId: string; stripped: boolean; start: number } | null = null;
  const flush = (end: number) => {
    if (!cur) return;
    const body = parseBlock(lines.slice(cur.start, end));
    const type = Object.keys(body)[0] ?? '';
    const inner = body[type];
    docs.push({ classId: cur.classId, fileId: cur.fileId, stripped: cur.stripped, type, body: inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : {} });
  };
  let sawHeader = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = HEADER.exec(line);
    if (m) {
      flush(i);
      sawHeader = true;
      cur = { classId: Number(m[1]), fileId: m[2]!, stripped: !!m[3], start: i + 1 };
    }
  }
  if (sawHeader) flush(lines.length);
  else {
    const body = parseBlock(lines.filter((l) => !/^(%YAML|%TAG|---)/.test(l)));
    docs.push({ classId: 0, fileId: '0', stripped: false, type: '', body });
  }
  return docs;
}

/** Parses a plain YAML block (Unity's subset) into a map. */
export function parseYaml(text: string): YamlMap {
  return parseBlock(text.replace(/\r\n?/g, '\n').split('\n').filter((l) => !/^(%YAML|%TAG|---)/.test(l)));
}

// ------------------------------------------------------------------ the block parser

interface Line {
  indent: number;
  text: string; // without indentation
}

function prepare(raw: string[]): Line[] {
  const out: Line[] = [];
  for (const l of raw) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const indent = l.length - l.trimStart().length;
    out.push({ indent, text: l.slice(indent) });
  }
  return out;
}

function parseBlock(raw: string[]): YamlMap {
  const lines = prepare(raw);
  const pos = { i: 0 };
  const v = parseNode(lines, pos, 0);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** Parses the node starting at lines[pos.i] whose lines are indented at least `min`. */
function parseNode(lines: Line[], pos: { i: number }, min: number): YamlValue {
  const first = lines[pos.i];
  if (!first || first.indent < min) return null;
  if (first.text.startsWith('- ') || first.text === '-') return parseSeq(lines, pos, first.indent);
  return parseMap(lines, pos, first.indent);
}

function parseSeq(lines: Line[], pos: { i: number }, indent: number): YamlValue[] {
  const out: YamlValue[] = [];
  while (pos.i < lines.length) {
    const l = lines[pos.i]!;
    if (l.indent !== indent || !(l.text.startsWith('- ') || l.text === '-')) break;
    const rest = l.text === '-' ? '' : l.text.slice(2);
    if (!rest.trim()) {
      pos.i++;
      out.push(parseNode(lines, pos, indent + 1));
      continue;
    }
    // "- key: value" starts a mapping whose further keys sit at indent + 2.
    if (isKeyLine(rest)) {
      lines[pos.i] = { indent: indent + 2, text: rest };
      out.push(parseMap(lines, pos, indent + 2));
      continue;
    }
    pos.i++;
    out.push(scalarWithContinuation(rest, lines, pos, indent));
  }
  return out;
}

function parseMap(lines: Line[], pos: { i: number }, indent: number): YamlMap {
  const out: YamlMap = {};
  while (pos.i < lines.length) {
    const l = lines[pos.i]!;
    if (l.indent !== indent || l.text.startsWith('- ')) {
      // A sequence under a key may sit at the key's own indent (Unity does this).
      break;
    }
    const kv = splitKey(l.text);
    if (!kv) {
      pos.i++;
      continue;
    }
    pos.i++;
    const [key, rest] = kv;
    if (rest === '') {
      const next = lines[pos.i];
      if (next && (next.indent > indent || (next.indent === indent && (next.text.startsWith('- ') || next.text === '-')))) {
        out[key] = next.indent === indent ? parseSeq(lines, pos, indent) : parseNode(lines, pos, indent + 1);
      } else out[key] = null;
    } else out[key] = scalarWithContinuation(rest, lines, pos, indent);
  }
  return out;
}

function isKeyLine(t: string): boolean {
  return !!splitKey(t) && !/^["'{[]/.test(t);
}

/** "key: rest" → [key, rest]; keys can be quoted. */
function splitKey(t: string): [string, string] | null {
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0]!;
    const end = t.indexOf(q, 1);
    if (end < 0 || t[end + 1] !== ':') return null;
    return [t.slice(1, end), t.slice(end + 2).trim()];
  }
  const m = /^([^:{}[\],]+?):(?:\s+(.*)|$)/.exec(t);
  if (!m) return null;
  return [m[1]!.trim(), (m[2] ?? '').trim()];
}

/** A scalar, flow collection or quoted string, joined with any more-indented continuation lines. */
function scalarWithContinuation(first: string, lines: Line[], pos: { i: number }, indent: number): YamlValue {
  let text = first;
  const open = (s: string) => (s.startsWith('{') && !balanced(s, '{', '}')) || (s.startsWith('[') && !balanced(s, '[', ']')) || (s.startsWith('"') && !closedQuote(s, '"')) || (s.startsWith("'") && !closedQuote(s, "'"));
  while (pos.i < lines.length) {
    const n = lines[pos.i]!;
    if (n.indent <= indent) break;
    // An unfinished flow collection or quoted string always continues; a plain scalar continues
    // on more-indented lines that aren't keys of their own.
    const plain = !/^["'{[]/.test(text);
    if (!open(text) && !(plain && !splitKey(n.text))) break;
    text += ' ' + n.text;
    pos.i++;
  }
  return parseScalar(text);
}

function balanced(s: string, o: string, c: string): boolean {
  let d = 0;
  let q: string | null = null;
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === o) d++;
    else if (ch === c) d--;
  }
  return d <= 0;
}

function closedQuote(s: string, q: string): boolean {
  if (q === "'") {
    // '' is an escaped quote inside single quotes.
    const inner = s.slice(1).replace(/''/g, '');
    return inner.includes("'");
  }
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return true;
  }
  return false;
}

export function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s.startsWith('{')) return parseFlowMap(s);
  if (s.startsWith('[')) return parseFlowSeq(s);
  if (s.startsWith('"')) return unescapeDouble(s.slice(1, s.lastIndexOf('"')));
  if (s.startsWith("'")) return s.slice(1, s.lastIndexOf("'")).replace(/''/g, "'");
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) {
    // Big integers (fileIDs, hashes) stay strings so they don't lose digits.
    if (/^-?\d{16,}$/.test(s)) return s;
    return Number(s);
  }
  return s;
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_m, e: string) => {
    if (e[0] === 'u' || e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ' } as Record<string, string>)[e] ?? e;
  });
}

/** Splits a flow collection's inside at top-level commas. */
function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let d = 0;
  let q: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '{' || ch === '[') d++;
    else if (ch === '}' || ch === ']') d--;
    else if (ch === ',' && d === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (inner.slice(start).trim()) parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseFlowMap(s: string): YamlMap {
  const out: YamlMap = {};
  for (const part of splitFlow(s.slice(1, s.lastIndexOf('}')))) {
    const kv = /^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(.*)$/s.exec(part);
    if (!kv) continue;
    const k = kv[1]!.replace(/^["']|["']$/g, '').trim();
    out[k] = parseScalar(kv[2]!);
  }
  return out;
}

function parseFlowSeq(s: string): YamlValue[] {
  return splitFlow(s.slice(1, s.lastIndexOf(']'))).map(parseScalar);
}

// ------------------------------------------------------------------ helpers for readers

export const asMap = (v: YamlValue | undefined): YamlMap => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export const asList = (v: YamlValue | undefined): YamlValue[] => (Array.isArray(v) ? v : []);
export const asNum = (v: YamlValue | undefined, d = 0): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
export const asStr = (v: YamlValue | undefined, d = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);

export function asRef(v: YamlValue | undefined): UnityRef | null {
  const m = asMap(v);
  if (!('fileID' in m)) return null;
  const fileID = asStr(m.fileID, '0');
  const guid = asStr(m.guid) || undefined;
  if (fileID === '0' && !guid) return null;
  return { fileID, guid, type: m.type === undefined ? undefined : asNum(m.type) };
}
