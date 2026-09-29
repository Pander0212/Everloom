/**
 * Robust JSON extraction from messy model output.
 * Handles: ```json fences, prose before/after, trailing commas, // and /* comments,
 * smart quotes, single-quoted strings, unquoted keys, and truncated trailing brackets.
 */

export interface ExtractResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
  /** The raw text slice we attempted to parse. */
  raw?: string;
}

/** Find the first balanced {...} or [...] block, respecting strings. */
export function findJsonBlock(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const stack: string[] = [];
  let inStr: string | null = null;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.length && stack[stack.length - 1] === ch) stack.pop();
      if (!stack.length) return text.slice(start, i + 1);
    }
  }
  // Unbalanced: return the rest and let repair close brackets.
  return text.slice(start);
}

function stripComments(s: string): string {
  let out = '';
  let inStr: string | null = null;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Convert single-quoted strings to double-quoted, escaping inner double quotes. */
function singleToDouble(s: string): string {
  let out = '';
  let inStr: string | null = null;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        if (inStr === "'" && ch === "'") {
          out = out.slice(0, -1) + "'";
          continue;
        }
        out += ch;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === inStr) {
        inStr = null;
        out += '"';
        continue;
      }
      if (inStr === "'" && ch === '"') {
        out += '\\"';
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // Treat an apostrophe inside a bare word (e.g. don't) as literal — only open a string after structural chars.
      const prev = out.trimEnd().slice(-1);
      if (ch === "'" && prev && !'{[,:'.includes(prev)) {
        out += ch;
        continue;
      }
      inStr = ch;
      out += '"';
      continue;
    }
    out += ch;
  }
  return out;
}

function closeUnbalanced(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let escaped = false;
  for (const ch of s) {
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  // Drop a dangling key or trailing comma before closing.
  out = out.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

export function repairJson(input: string): string {
  let s = input
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/﻿/g, '');
  s = stripComments(s);
  s = singleToDouble(s);
  // Quote unquoted object keys: { key: 1 } -> { "key": 1 }
  s = s.replace(/([{,]\s*)([A-Za-z_$][\w$.-]*)(\s*:)/g, '$1"$2"$3');
  // Python-isms
  s = s.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
  // Trailing commas
  s = s.replace(/,(\s*[}\]])/g, '$1');
  // Missing commas between adjacent objects/values on new lines: }\n{  or "a"\n"b"
  s = s.replace(/([}\]"\d])(\s*\n\s*)([{["])/g, '$1,$2$3');
  s = closeUnbalanced(s);
  s = s.replace(/,(\s*[}\]])/g, '$1');
  return s;
}

export function extractJson<T = unknown>(text: string): ExtractResult<T> {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  const candidates: string[] = [];
  const fence = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  // Unterminated fence
  const open = /```(?:json)?\s*([\s\S]*)$/i.exec(text);
  if (open && !candidates.length) candidates.push(open[1]);
  candidates.push(text);

  let lastError = 'no json found';
  for (const cand of candidates) {
    const block = findJsonBlock(cand);
    if (!block) continue;
    try {
      return { ok: true, value: JSON.parse(block) as T, raw: block };
    } catch (e) {
      lastError = (e as Error).message;
    }
    try {
      const repaired = repairJson(block);
      return { ok: true, value: JSON.parse(repaired) as T, raw: repaired };
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}
