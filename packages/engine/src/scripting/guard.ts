/**
 * Loop guard: every loop in a script gets a check at the top of its body. Inside the sandbox the
 * check throws once one task has run longer than its budget, so `while (true) {}` ends with an
 * error instead of freezing the page (a sandboxed frame can share the app's thread). The app's
 * watchdog covers the rest (deep recursion, a stuck frame).
 *
 * Kept out of the engine's main entry (it pulls in a JavaScript parser): import
 * `@everloom/engine/guard`.
 */
import { parse, type Node } from 'acorn';

export const GUARD_FN = '__evGuard';

/** Code that defines the check; the runtime inserts it before guarded code. */
export function guardPrelude(budgetMs: number, fn: string = GUARD_FN): string {
  const ms = Math.max(50, Math.round(budgetMs));
  const msg = `Stopped: a loop ran for more than ${Math.round(budgetMs / 100) / 10} s`;
  // Once tripped it keeps throwing until the task ends, so a try/catch around an inner loop can't
  // swallow it and carry on.
  // Defined read-only on the global object; the runtime picks a random name per frame, so a script
  // can neither overwrite it nor know it in advance.
  return `if(!Object.getOwnPropertyDescriptor(globalThis,${JSON.stringify(fn)}))Object.defineProperty(globalThis,${JSON.stringify(fn)},{writable:false,configurable:false,enumerable:false,value:(function(){var s=0,n=0,dead=false;return function(){if(dead)throw new Error(${JSON.stringify(msg)});if(++n%64!==0)return;var t=performance.now();if(!s){s=t;setTimeout(function(){s=0;dead=false},0);return}if(t-s>${ms}){dead=true;throw new Error(${JSON.stringify(msg)})}}})()});`;
}

interface Insert {
  at: number;
  text: string;
}

type AnyNode = Node & Record<string, any>;

function walk(node: AnyNode, visit: (n: AnyNode) => void) {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit);
    } else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, visit);
  }
}

export type GuardResult = { ok: true; code: string; loops: number } | { ok: false; error: string; line?: number; column?: number };

/** Add the check to every loop. Syntax errors are reported, not run. */
export function guardLoops(code: string, opts: { module?: boolean; fn?: string } = {}): GuardResult {
  let ast: AnyNode;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: opts.module ? 'module' : 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowHashBang: true, locations: true }) as AnyNode;
  } catch (e) {
    const err = e as Error & { loc?: { line: number; column: number } };
    return { ok: false, error: err.message, line: err.loc?.line, column: err.loc?.column };
  }
  const inserts: Insert[] = [];
  let loops = 0;
  const check = `${opts.fn ?? GUARD_FN}();`;
  walk(ast, (n) => {
    if (!/^(For|ForIn|ForOf|While|DoWhile)Statement$/.test(n.type)) return;
    loops++;
    const body = n.body as AnyNode;
    if (body.type === 'BlockStatement') inserts.push({ at: body.start + 1, text: check });
    else {
      inserts.push({ at: body.start, text: `{${check}` });
      inserts.push({ at: body.end, text: '}' });
    }
  });
  if (!inserts.length) return { ok: true, code, loops: 0 };
  // Apply from the end so earlier offsets stay valid; at equal offsets, closing braces go first.
  inserts.sort((a, b) => b.at - a.at || (a.text === '}' ? -1 : 1));
  let out = code;
  for (const ins of inserts) out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  return { ok: true, code: out, loops };
}

/** Guard the inline scripts of an HTML document (message HTML, panels). Unparseable ones are dropped with a note. */
export function guardHtmlScripts(html: string, fn: string = GUARD_FN): { html: string; errors: string[] } {
  const errors: string[] = [];
  const out = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (full, open: string, body: string, close: string) => {
    if (/\bsrc\s*=/.test(open)) return full; // external scripts can't load anyway (the frame's policy blocks them)
    if (/\btype\s*=\s*["']?(?!text\/javascript|module|application\/javascript)[^"'\s>]+/i.test(open)) return full; // data blocks, templates
    const r = guardLoops(body, { module: /type\s*=\s*["']?module/i.test(open), fn });
    if (!r.ok) {
      errors.push(`Script error (line ${r.line ?? '?'}): ${r.error}`);
      return `<!-- script removed: ${r.error.replace(/--/g, '- -')} -->`;
    }
    return open + r.code + close;
  });
  return { html: out, errors };
}
