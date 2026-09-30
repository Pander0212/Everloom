/** Deterministic labels derived from numbers. The model narrates; code decides. */
import type { Relationship, Tracker } from './state.js';

export type StandingLabel = 'Enemy' | 'Hostile' | 'Neutral' | 'Friendly';

export function standingLabel(standing: number): StandingLabel {
  if (standing < 15) return 'Enemy';
  if (standing < 35) return 'Hostile';
  if (standing < 65) return 'Neutral';
  return 'Friendly';
}

export function relationshipLabel(r: Pick<Relationship, 'affection' | 'trust'>): string {
  const a = r.affection;
  const t = r.trust;
  if (a <= -60) return 'Nemesis';
  if (a <= -25) return t < 0 ? 'Rival' : 'Cold';
  if (a < 15) return t >= 40 ? 'Reliable acquaintance' : 'Acquaintance';
  if (a < 45) return t >= 30 ? 'Friend' : 'Friendly';
  if (a < 75) return t >= 50 ? 'Close friend' : 'Fond';
  return t >= 60 ? 'Devoted' : 'Infatuated';
}

export function trackerState(t: Tracker): { label: string; severity: 0 | 1 | 2 | 3 } {
  const pct = t.max > 0 ? t.value / t.max : 0;
  const bad = t.direction === 'need' ? pct : 1 - pct;
  if (t.id === 'hunger') {
    if (bad >= 0.85) return { label: 'Starving', severity: 3 };
    if (bad >= 0.6) return { label: 'Hungry', severity: 2 };
    if (bad >= 0.35) return { label: 'Peckish', severity: 1 };
    return { label: 'Full', severity: 0 };
  }
  if (t.id === 'energy') {
    if (bad >= 0.85) return { label: 'Exhausted', severity: 3 };
    if (bad >= 0.6) return { label: 'Tired', severity: 2 };
    if (bad >= 0.35) return { label: 'Okay', severity: 1 };
    return { label: 'Rested', severity: 0 };
  }
  if (t.id === 'hygiene') {
    if (bad >= 0.85) return { label: 'Filthy', severity: 3 };
    if (bad >= 0.6) return { label: 'Grimy', severity: 2 };
    if (bad >= 0.35) return { label: 'Fine', severity: 1 };
    return { label: 'Fresh', severity: 0 };
  }
  if (bad >= 0.85) return { label: 'Critical', severity: 3 };
  if (bad >= 0.6) return { label: 'Low', severity: 2 };
  if (bad >= 0.35) return { label: 'Fair', severity: 1 };
  return { label: 'Good', severity: 0 };
}

export function xpForLevel(level: number): number {
  return Math.round(100 * Math.pow(1.25, Math.max(0, level - 1)));
}

/**
 * Labels that must be earned. The model may name a relationship, but a romantic or close label
 * only sticks when the numbers support it; kinship labels need nothing. Returns the label to keep.
 */
export function earnedLabel(proposed: string, r: Pick<Relationship, 'affection' | 'trust'> & { desire?: number; tension?: number }): string | null {
  const l = proposed.trim().toLowerCase();
  if (!l) return null;
  if (/\b(mother|father|parent|sister|brother|sibling|cousin|aunt|uncle|daughter|son|grand\w*|family|twin)\b/.test(l)) return proposed;
  if (/\b(partner|lover|girlfriend|boyfriend|spouse|wife|husband|fianc\w*|beloved|sweetheart)\b/.test(l)) return r.affection >= 40 && r.trust >= 20 ? proposed : null;
  if (/\bcrush\b/.test(l)) return (r.desire ?? 0) >= 15 && r.affection >= 0 ? proposed : null;
  if (/\b(best friend|confidant|soulmate)\b/.test(l)) return r.affection >= 50 && r.trust >= 40 ? proposed : null;
  if (/\b(enemy|nemesis|rival|foe)\b/.test(l)) return r.affection <= -20 || (r.tension ?? 0) >= 30 ? proposed : null;
  if (/\b(friend|ally)\b/.test(l)) return r.affection >= 15 ? proposed : null;
  return proposed;
}
