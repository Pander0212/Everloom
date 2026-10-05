/**
 * Slash commands: `/name key=value more text | /next …`. Commands run left to right; each one's
 * result is `{{pipe}}` for the next and becomes its text when it has none. Quotes keep spaces and
 * pipes together; `\|` is a literal pipe. In the spirit of SillyTavern's STscript, deliberately
 * smaller: no closures, loops or scopes.
 */

export interface SlashCall {
  name: string;
  /** key=value arguments. */
  args: Record<string, string>;
  /** Everything that isn't a key=value argument. */
  text: string;
}

export interface SlashParseError {
  error: string;
  at: number;
}

/** Split on unquoted, unescaped pipes. */
function splitPipes(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === '"') quote = c;
    if (c === '|') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\"/g, '"') : s);

/** Parse one line into calls, or say what's wrong. */
export function parseSlash(line: string): SlashCall[] | SlashParseError {
  const src = line.trim();
  if (!src.startsWith('/')) return { error: 'Commands start with /', at: 0 };
  const calls: SlashCall[] = [];
  for (const part of splitPipes(src)) {
    const m = /^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(part);
    if (!m) return { error: `Not a command: ${part.slice(0, 40)}`, at: src.indexOf(part) };
    const args: Record<string, string> = {};
    const rest: string[] = [];
    // Tokens: key=value (value may be quoted), quoted strings, or words.
    const re = /([A-Za-z_][\w-]*)=("(?:[^"\\]|\\.)*"|\S*)|("(?:[^"\\]|\\.)*")|(\S+)/g;
    let t: RegExpExecArray | null;
    const body = m[2] ?? '';
    let lastEnd = 0;
    let textStart = -1;
    while ((t = re.exec(body))) {
      if (t[1] !== undefined && textStart < 0) {
        args[t[1].toLowerCase()] = unquote(t[2] ?? '');
        lastEnd = re.lastIndex;
      } else {
        // The first non-argument token starts the free text; keep its original spacing.
        if (textStart < 0) textStart = t.index;
        lastEnd = re.lastIndex;
      }
    }
    const text = textStart >= 0 ? body.slice(textStart, lastEnd) : '';
    rest.push(text);
    calls.push({ name: m[1]!.toLowerCase(), args, text: unquote(rest.join(' ').trim()) });
  }
  if (!calls.length) return { error: 'Empty command', at: 0 };
  return calls;
}

export interface SlashCommandDef<Ctx> {
  name: string;
  aliases?: string[];
  /** One line, shown in autocomplete. */
  help: string;
  /** Example usage shown in autocomplete. */
  usage?: string;
  /** Who added it ("Everloom", a script's or extension's name). */
  source?: string;
  run: (call: SlashCall, ctx: Ctx) => Promise<string | void> | string | void;
}

export class SlashRegistry<Ctx> {
  private defs = new Map<string, SlashCommandDef<Ctx>>();
  register(def: SlashCommandDef<Ctx>): () => void {
    const names = [def.name, ...(def.aliases ?? [])].map((n) => n.toLowerCase());
    for (const n of names) this.defs.set(n, def);
    return () => {
      for (const n of names) if (this.defs.get(n) === def) this.defs.delete(n);
    };
  }
  get(name: string) {
    return this.defs.get(name.toLowerCase());
  }
  /** Unique commands, sorted, for autocomplete. */
  list(): SlashCommandDef<Ctx>[] {
    return [...new Set(this.defs.values())].sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Commands whose name starts with the prefix (aliases included), best first. */
  suggest(prefix: string): SlashCommandDef<Ctx>[] {
    const p = prefix.toLowerCase().replace(/^\//, '');
    const hits = new Set<SlashCommandDef<Ctx>>();
    for (const [n, d] of this.defs) if (n.startsWith(p)) hits.add(d);
    return [...hits].sort((a, b) => Number(!a.name.startsWith(p)) - Number(!b.name.startsWith(p)) || a.name.localeCompare(b.name));
  }
}

export interface SlashRunOptions {
  /** Expands macros in arguments ({{pipe}} is already replaced). */
  expand?: (text: string) => string;
  /** Stops a chain after this many commands. */
  maxSteps?: number;
}

/** Run a line. Returns the last command's result. Unknown commands stop the chain with an error. */
export async function runSlash<Ctx>(line: string, registry: SlashRegistry<Ctx>, ctx: Ctx, opts: SlashRunOptions = {}): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const parsed = parseSlash(line);
  if (!Array.isArray(parsed)) return { ok: false, error: parsed.error };
  if (parsed.length > (opts.maxSteps ?? 50)) return { ok: false, error: 'Too many commands in one line' };
  let pipe = '';
  for (const call of parsed) {
    const def = registry.get(call.name);
    if (!def) return { ok: false, error: `Unknown command /${call.name}` };
    const sub = (s: string) => {
      const piped = s.replace(/\{\{pipe\}\}/gi, () => pipe);
      return opts.expand ? opts.expand(piped) : piped;
    };
    const args = Object.fromEntries(Object.entries(call.args).map(([k, v]) => [k, sub(v)]));
    const usedPipe = /\{\{pipe\}\}/i.test(call.text) || Object.values(call.args).some((v) => /\{\{pipe\}\}/i.test(v));
    const text = call.text ? sub(call.text) : usedPipe ? '' : pipe;
    try {
      const out = await def.run({ name: call.name, args, text }, ctx);
      pipe = out === undefined || out === null ? '' : String(out);
    } catch (e) {
      return { ok: false, error: `/${call.name}: ${(e as Error).message}` };
    }
  }
  return { ok: true, result: pipe };
}
