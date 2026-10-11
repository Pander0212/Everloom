/**
 * Scenario questions: placeholders in a card or scenario that are asked before a story starts, then
 * filled in. The original text is never changed; the filled copy goes into the new chat.
 *
 *   ${What is your name?}
 *   ${Your ship's name? | options: The Skipper, Nebula}     suggestions; any answer is fine
 *   ${Which hand do you write with? | choices: Left, Right} one of these
 *   \${not a question}                                       a literal "${…}"
 *
 * The same question (ignoring case and spacing) asked twice is one question with one answer.
 * Text placeholders only: nothing in them runs.
 */

export interface Question {
  /** Normalized question, the key for its answer. */
  key: string;
  /** The question as written (first occurrence). */
  text: string;
  options: string[];
  /** Answers must be one of the options. */
  fixed: boolean;
}

const RE = /(\\?)\$\{([^{}]{1,300})\}/g;

const keyOf = (q: string) => q.trim().replace(/\s+/g, ' ').toLowerCase();

function parse(body: string): { text: string; options: string[]; fixed: boolean } {
  const bar = body.indexOf('|');
  if (bar < 0) return { text: body.trim(), options: [], fixed: false };
  const text = body.slice(0, bar).trim();
  const rest = body.slice(bar + 1).trim();
  const m = /^(options|choices)\s*:\s*(.*)$/is.exec(rest);
  if (!m) return { text, options: [], fixed: false };
  const options = m[2]!.split(',').map((o) => o.trim()).filter(Boolean).slice(0, 20);
  return { text, options, fixed: m[1]!.toLowerCase() === 'choices' && options.length > 0 };
}

/** Every question in these texts, in order of first appearance. */
export function findQuestions(texts: Array<string | null | undefined>): Question[] {
  const out = new Map<string, Question>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(RE)) {
      if (m[1]) continue; // escaped
      const p = parse(m[2]!);
      if (!p.text) continue;
      const key = keyOf(p.text);
      const prev = out.get(key);
      if (prev) {
        for (const o of p.options) if (!prev.options.includes(o)) prev.options.push(o);
        prev.fixed = prev.fixed || p.fixed;
      } else out.set(key, { key, text: p.text, options: p.options, fixed: p.fixed });
    }
  }
  return [...out.values()];
}

/** Whether an answer is acceptable for a question. */
export function validAnswer(q: Question, a: string | undefined): boolean {
  const v = (a ?? '').trim();
  if (!v) return false;
  return !q.fixed || q.options.some((o) => o.toLowerCase() === v.toLowerCase());
}

/** The text with every answered question filled in (unanswered ones are left as written). */
export function fillQuestions(text: string, answers: Record<string, string>): string {
  if (!text || !text.includes('${')) return text;
  return text.replace(RE, (all, esc: string, body: string) => {
    if (esc) return all.slice(1);
    const p = parse(body);
    const a = answers[keyOf(p.text)];
    return a !== undefined && a.trim() ? a.trim() : all;
  });
}

const CARD_TEXT = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions'] as const;
const CARD_LISTS = ['alternate_greetings', 'group_only_greetings'] as const;
type CardLike = Partial<Record<(typeof CARD_TEXT)[number], string>> & Partial<Record<(typeof CARD_LISTS)[number], string[]>>;

/** The questions a character card asks (its story fields and greetings). */
export function cardQuestions(card: CardLike): Question[] {
  return findQuestions([...CARD_TEXT.map((k) => card[k]), ...CARD_LISTS.flatMap((k) => card[k] ?? [])]);
}

/** A copy of the card with the answers filled in (the card itself is not changed). */
export function fillCard<T extends CardLike>(card: T, answers: Record<string, string> | null | undefined): T {
  if (!answers || !Object.keys(answers).length) return card;
  const out: T = { ...card };
  for (const k of CARD_TEXT) if (typeof card[k] === 'string') (out as CardLike)[k] = fillQuestions(card[k]!, answers);
  for (const k of CARD_LISTS) if (Array.isArray(card[k])) (out as CardLike)[k] = card[k]!.map((g) => fillQuestions(g, answers));
  return out;
}
