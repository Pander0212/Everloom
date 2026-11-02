/**
 * Ledger check for the tracker (found on live runs: "bought a bow for 12 coins" came back with the
 * bow but no payment, or with neither). Deterministic: the turn text says money changed hands or
 * something was bought, and the tracker's ops have no matching change. English and German.
 */
import type { Op } from './ops.js';

export interface LedgerGap {
  kind: 'payment' | 'purchase';
  /** The words that triggered it. */
  evidence: string;
  amount?: number;
}

const MONEY = '(coins?|gold|silver|copper|credits?|yuans?|crowns?|gp|sp|cp|m(?:ü|ue)nzen?|goldst(?:ü|ue)cke?|taler)';
const NUM = '(\\d{1,6}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred|ein(?:e|en)?|zwei|drei|vier|f(?:ü|ue)nf|zehn|zw(?:ö|oe)lf|zwanzig|f(?:ü|ue)nfzig|hundert)';
const PAY = /\b(pay|pays|paid|paying|spend|spends|spent|buy|buys|bought|purchase[sd]?|hand(?:s|ed)? over|tip(?:s|ped)?|fee|costs?|zahl(?:e|t|te|en)|bezahl(?:e|t|te|en)|kauf(?:e|t|te|en)|gekauft|ausgegeben|gebühr)\b/i;
const BUY = /\b(buy|buys|bought|purchase[sd]?|kauf(?:e|t|te|en)|gekauft|erstand|ersteht)\b/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, fifty: 50, hundred: 100, ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, zehn: 10, 'zwölf': 12, zwoelf: 12, zwanzig: 20, 'fünfzig': 50, fuenfzig: 50, hundert: 100 };

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Gaps between what the text says changed hands and what the ops record. */
export function ledgerGaps(turnText: string, ops: Op[]): LedgerGap[] {
  const out: LedgerGap[] = [];
  const hasMoney = ops.some((o) => o.type === 'currency.delta' || o.type.startsWith('currency') || o.type === 'shop.buy' || o.type === 'bill.pay');
  const hasItem = ops.some((o) => o.type === 'item.add' || o.type === 'shop.buy');
  const amountRe = new RegExp(`\\b${NUM}\\s+${MONEY}\\b`, 'i');
  for (const s of sentences(turnText)) {
    if (!PAY.test(s)) continue;
    const m = s.match(amountRe);
    if (m && !hasMoney && !out.some((g) => g.kind === 'payment')) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
      out.push({ kind: 'payment', evidence: s.slice(0, 200), ...(n ? { amount: n } : {}) });
    }
    if (BUY.test(s) && !hasItem && !out.some((g) => g.kind === 'purchase')) out.push({ kind: 'purchase', evidence: s.slice(0, 200) });
  }
  return out;
}

/** The follow-up question for the tracker: only the missing ops. */
export function ledgerPrompt(gaps: LedgerGap[]): string {
  const lines = gaps.map((g) => (g.kind === 'payment' ? `- a payment${g.amount ? ` of ${g.amount}` : ''} ("${g.evidence}") but no currency.delta` : `- a purchase ("${g.evidence}") but no item.add`));
  return `Your ops missed something the turn shows:\n${lines.join('\n')}\nIf it really happened in the latest turn (not just offered or refused), return ONLY the missing ops as {"ops":[...]} (currency.delta with a negative amount for spending; item.add for what was bought). Otherwise return {"ops":[]}.`;
}
