/**
 * Custom game op types from extensions. They are declarative on purpose: an extension describes
 * its arguments (checked like any other op) and a list of steps on its own corner of the game state
 * (`state.ext[extensionId]`). The reducer runs the steps, so the inverse is computed the same way as
 * for built-in ops and every custom op rolls back with swipes, edits and deletes. No extension code
 * runs inside the reducer.
 */
import { z } from 'zod';
import { OpError } from '../game/errors.js';

const ident = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'Lowercase letters, digits, - and _');

const paramSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean', 'enum']),
  values: z.array(z.string().max(80)).max(100).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().min(1).max(2000).optional(),
  optional: z.boolean().optional(),
  description: z.string().max(200).optional(),
});
export type ExtOpParam = z.infer<typeof paramSchema>;

/** A value in a step: a literal, or "{param}" for an argument (keeps its type), or a template string. */
const valueSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const stepSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('set'), path: z.string().max(200), value: valueSchema }),
  z.object({ do: z.literal('add'), path: z.string().max(200), value: valueSchema, min: z.number().optional(), max: z.number().optional() }),
  z.object({ do: z.literal('push'), path: z.string().max(200), value: valueSchema, limit: z.number().int().min(1).max(1000).optional() }),
  z.object({ do: z.literal('delete'), path: z.string().max(200) }),
  /** Fails the op (nothing changes) unless the check holds. */
  z.object({ do: z.literal('require'), path: z.string().max(200), check: z.enum(['exists', 'missing', 'gte', 'lte']), value: valueSchema.optional(), message: z.string().max(200) }),
]);
export type ExtOpStep = z.infer<typeof stepSchema>;

export const extOpDefSchema = z.object({
  name: ident,
  label: z.string().min(1).max(60),
  description: z.string().max(300).default(''),
  params: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/), paramSchema).default({}),
  steps: z.array(stepSchema).min(1).max(40),
  /** What the change toast says, with {param} placeholders. */
  summary: z.string().max(200).optional(),
  /** The story's AI may use it (the description and params are added to its op list). */
  ai: z.boolean().default(false),
});
export type ExtOpDef = z.infer<typeof extOpDefSchema>;

/** Extension id → op name → definition. Loaded from installed extensions at start-up. */
const registry = new Map<string, Map<string, ExtOpDef>>();
/**
 * Extensions that are off or uninstalled keep their definitions, so the story can still be replayed
 * (and rolled back) exactly; they just can't be used for new changes, and the AI isn't offered them.
 */
const retired = new Set<string>();
export const extOpRetired = (extId: string) => retired.has(extId);

export function registerExtOps(extId: string, defs: unknown[], opts: { retired?: boolean } = {}): { ok: string[]; errors: string[] } {
  const ok: string[] = [];
  const errors: string[] = [];
  const map = new Map<string, ExtOpDef>();
  for (const d of defs) {
    const p = extOpDefSchema.safeParse(d);
    if (p.success) {
      map.set(p.data.name, opts.retired ? { ...p.data, ai: false } : p.data);
      ok.push(p.data.name);
    } else errors.push(p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  if (map.size) registry.set(extId, map);
  else registry.delete(extId);
  if (opts.retired) retired.add(extId);
  else retired.delete(extId);
  return { ok, errors };
}
export const unregisterExtOps = (extId: string) => {
  retired.delete(extId);
  return registry.delete(extId);
};
export const extOpDef = (extId: string, name: string) => registry.get(extId)?.get(name);
export function listExtOps(): Array<{ ext: string; def: ExtOpDef }> {
  const out: Array<{ ext: string; def: ExtOpDef }> = [];
  for (const [ext, m] of registry) for (const def of m.values()) out.push({ ext, def });
  return out;
}

/** Op list lines for the story AI (only definitions marked `ai`). */
export function extOpReference(): string {
  const lines = listExtOps()
    .filter((x) => x.def.ai)
    .map(({ ext, def }) => {
      const args = Object.entries(def.params)
        .map(([k, p]) => `"${k}":${p.type === 'enum' ? `"${(p.values ?? []).slice(0, 6).join('|')}"` : p.type === 'string' ? '"…"' : p.type === 'boolean' ? 'true' : '0'}`)
        .join(',');
      return `- {"type":"ext.op","ext":"${ext}","name":"${def.name}","args":{${args}}}  ${def.description || def.label}`;
    });
  return lines.length ? `Extension ops:\n${lines.join('\n')}` : '';
}

function checkArgs(def: ExtOpDef, args: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, p] of Object.entries(def.params)) {
    const v = args[k];
    if (v === undefined || v === null || v === '') {
      if (p.optional) continue;
      throw new OpError(`${def.label}: "${k}" is missing`);
    }
    if (p.type === 'number' || p.type === 'integer') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new OpError(`${def.label}: "${k}" must be a number`);
      if (p.type === 'integer' && !Number.isInteger(n)) throw new OpError(`${def.label}: "${k}" must be a whole number`);
      if (p.min !== undefined && n < p.min) throw new OpError(`${def.label}: "${k}" is below ${p.min}`);
      if (p.max !== undefined && n > p.max) throw new OpError(`${def.label}: "${k}" is above ${p.max}`);
      out[k] = n;
    } else if (p.type === 'boolean') {
      out[k] = v === true || v === 'true';
    } else {
      const s = String(v).trim();
      if (s.length > (p.maxLength ?? 200)) throw new OpError(`${def.label}: "${k}" is too long`);
      if (p.type === 'enum' && !(p.values ?? []).includes(s)) throw new OpError(`${def.label}: "${k}" must be one of ${(p.values ?? []).join(', ')}`);
      out[k] = s;
    }
  }
  for (const k of Object.keys(args)) if (!(k in def.params)) throw new OpError(`${def.label}: unknown argument "${k}"`);
  return out;
}

const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** "/towns/{town}/rep" → ["towns", "<town>", "rep"]. Placeholders become plain keys, never paths. */
function resolvePath(path: string, args: Record<string, string | number | boolean>): string[] {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((seg) => seg.replace(/\{(\w+)\}/g, (_m, k: string) => (k in args ? String(args[k]) : '')).trim());
  if (!parts.length) throw new OpError('An extension op needs a path');
  for (const p of parts) if (!p || BAD_KEYS.has(p) || p.length > 120) throw new OpError(`Bad key "${p}"`);
  return parts;
}

function resolveValue(v: string | number | boolean | null, args: Record<string, string | number | boolean>): unknown {
  if (typeof v !== 'string') return v;
  const whole = /^\{(\w+)\}$/.exec(v);
  if (whole) return whole[1]! in args ? args[whole[1]!] : null;
  return v.replace(/\{(\w+)\}/g, (_m, k: string) => (k in args ? String(args[k]) : ''));
}

/** The container for a path, created as plain objects on the way down. */
function parentOf(root: Record<string, any>, parts: string[], create: boolean): Record<string, any> | null {
  let cur: Record<string, any> = root;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] === undefined || cur[p] === null) {
      if (!create) return null;
      cur[p] = {};
    }
    if (typeof cur[p] !== 'object' || Array.isArray(cur[p])) throw new OpError(`"${p}" is not a group`);
    cur = cur[p];
  }
  return cur;
}

export interface ExtOpResult {
  summary: string;
}

/** Run an extension op on the (draft) state. Throws OpError to reject it; nothing is changed then. */
export function runExtOp(state: { ext?: Record<string, Record<string, any>> }, extId: string, name: string, rawArgs: Record<string, unknown>, source: string): ExtOpResult {
  const def = extOpDef(extId, name);
  if (!def) throw new OpError(`Unknown extension op ${extId}/${name} (is the extension installed and on?)`);
  if (source === 'ai' && !def.ai) throw new OpError(`${def.label} can't be used by the AI`);
  const args = checkArgs(def, rawArgs);
  state.ext ??= {};
  const root = (state.ext[extId] ??= {});
  // Checks first, so a failed check changes nothing.
  for (const st of def.steps) {
    if (st.do !== 'require') continue;
    const parts = resolvePath(st.path, args);
    const parent = parentOf(root, parts, false);
    const cur = parent ? parent[parts[parts.length - 1]!] : undefined;
    const want = st.value === undefined ? undefined : resolveValue(st.value, args);
    const okay = st.check === 'exists' ? cur !== undefined : st.check === 'missing' ? cur === undefined : st.check === 'gte' ? Number(cur ?? 0) >= Number(want) : Number(cur ?? 0) <= Number(want);
    if (!okay) throw new OpError(st.message);
  }
  for (const st of def.steps) {
    if (st.do === 'require') continue;
    const parts = resolvePath(st.path, args);
    const key = parts[parts.length - 1]!;
    if (st.do === 'delete') {
      const parent = parentOf(root, parts, false);
      if (parent) delete parent[key];
      continue;
    }
    const parent = parentOf(root, parts, true)!;
    const value = resolveValue(st.value, args);
    if (st.do === 'set') parent[key] = value;
    else if (st.do === 'add') {
      let n = Number(parent[key] ?? 0) + Number(value);
      if (!Number.isFinite(n)) throw new OpError(`${def.label}: not a number`);
      if (st.min !== undefined) n = Math.max(st.min, n);
      if (st.max !== undefined) n = Math.min(st.max, n);
      parent[key] = n;
    } else if (st.do === 'push') {
      const list = Array.isArray(parent[key]) ? parent[key] : (parent[key] = []);
      list.push(value);
      if (st.limit && list.length > st.limit) list.splice(0, list.length - st.limit);
    }
  }
  const summary = def.summary ? String(resolveValue(def.summary, args)).replace(/\{(\w+):\+\}/g, (_m, k: string) => (Number(args[k]) >= 0 ? `+${args[k]}` : String(args[k]))) : def.label;
  return { summary };
}
