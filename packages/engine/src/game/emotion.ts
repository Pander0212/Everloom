/** Tiny lexicon-based emotion guess for picking expression sprites (no model call needed). */
export const EMOTIONS = [
  'neutral', 'joy', 'amusement', 'love', 'surprise', 'sadness', 'anger', 'fear', 'embarrassment', 'confusion', 'curiosity', 'disgust', 'pride', 'relief', 'nervousness',
] as const;
export type Emotion = (typeof EMOTIONS)[number];

const LEXICON: Record<Exclude<Emotion, 'neutral'>, RegExp> = {
  joy: /\b(smil(e|es|ed|ing)|grin(s|ned|ning)?|beam(s|ed|ing)?|happ(y|ily)|delight(ed)?|cheer(ful|s|ed)?|brighten(s|ed)?|glad)\b/gi,
  amusement: /\b(laugh(s|ed|ing)?|chuckl(e|es|ed|ing)|giggl(e|es|ed|ing)|snicker(s|ed)?|smirk(s|ed|ing)?|amused)\b/gi,
  love: /\b(blush(es|ed|ing)? softly|tender(ly)?|lov(e|ing|ingly)|adore(s|d)?|affection(ate|ately)?|kiss(es|ed)?)\b/gi,
  surprise: /\b(gasp(s|ed)?|startl(e|ed)|surpris(e|ed)|eyes widen(ed)?|blink(s|ed) in surprise|stunned|shocked)\b/gi,
  sadness: /\b(sigh(s|ed)? sadly|tear(s|y)|cr(y|ies|ied)|sob(s|bed|bing)?|sad(ly|ness)?|mourn(s|ed)?|heartbroken|frown(s|ed)? sadly)\b/gi,
  anger: /\b(glare(s|d)?|snarl(s|ed)?|furious|anger|angr(y|ily)|scowl(s|ed)?|clench(es|ed)|growl(s|ed)?|shout(s|ed)?|seeth(e|es|ing))\b/gi,
  fear: /\b(trembl(e|es|ed|ing)|shiver(s|ed)? in fear|afraid|terrified|scared|panic(s|ked)?|flinch(es|ed)?|fear(ful)?)\b/gi,
  embarrassment: /\b(blush(es|ed|ing)?|flush(es|ed)|embarrass(ed|ment)|avert(s|ed) (her|his|their) (eyes|gaze)|sheepish(ly)?|fluster(ed)?)\b/gi,
  confusion: /\b(confus(ed|ion)|puzzl(ed|ement)|tilt(s|ed) (her|his|their) head|frown(s|ed)? in confusion|bewilder(ed)?|huh\?)\b/gi,
  curiosity: /\b(curious(ly)?|intrigu(ed|ing)|lean(s|ed) (in|closer)|raise(s|d) an eyebrow|wonder(s|ed|ing)?)\b/gi,
  disgust: /\b(disgust(ed)?|grimac(e|es|ed)|wrinkl(e|es|ed) (her|his|their) nose|revolt(ed)?|gross)\b/gi,
  pride: /\b(proud(ly)?|puff(s|ed) (out )?(her|his|their) chest|smug(ly)?|triumphant(ly)?)\b/gi,
  relief: /\b(relie(f|ved)|exhale(s|d) (slowly|in relief)|sigh(s|ed)? (of|in) relief)\b/gi,
  nervousness: /\b(nervous(ly)?|fidget(s|ed|ing)?|bit(es|ing)? (her|his|their) lip|anxious(ly)?|stammer(s|ed)?|stutter(s|ed)?|hesitat(e|es|ed|ing))\b/gi,
};

export function detectEmotion(text: string): Emotion {
  let best: Emotion = 'neutral';
  let bestScore = 0;
  // Later sentences matter more: weight matches in the last third double.
  const cut = Math.floor(text.length * 0.66);
  for (const [emotion, re] of Object.entries(LEXICON) as Array<[Emotion, RegExp]>) {
    let score = 0;
    for (const m of text.matchAll(re)) score += (m.index ?? 0) >= cut ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = emotion;
    }
  }
  return best;
}
