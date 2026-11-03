/**
 * The story's language, guessed from recent text by common function words. ECHO's notes are in
 * English; in a story written in another language they must not pull the writer into English
 * (seen live: a German session switched to English once ECHO was on).
 */
const COMMON: Record<string, string[]> = {
  English: ['the', 'and', 'you', 'that', 'with', 'her', 'his', 'she', 'was', 'for', 'not', 'what'],
  German: ['der', 'die', 'das', 'und', 'ich', 'nicht', 'mit', 'sie', 'ist', 'ein', 'eine', 'auf', 'zu', 'den', 'dem'],
  French: ['le', 'la', 'les', 'et', 'je', 'vous', 'une', 'est', 'pas', 'que', 'dans', 'avec'],
  Spanish: ['el', 'la', 'los', 'que', 'y', 'una', 'con', 'por', 'para', 'pero', 'como', 'está'],
  Italian: ['il', 'che', 'non', 'una', 'per', 'sono', 'con', 'della', 'gli', 'questo'],
  Portuguese: ['não', 'uma', 'com', 'para', 'que', 'você', 'ela', 'ele', 'mas', 'como'],
  Russian: ['и', 'не', 'что', 'он', 'она', 'это', 'как', 'на', 'с', 'я'],
};

export function storyLanguage(text: string): string {
  const words = (text.toLowerCase().match(/[\p{L}]+/gu) ?? []).slice(-1500);
  if (words.length < 20) return 'English';
  let best = 'English';
  let bestScore = 0;
  for (const [lang, list] of Object.entries(COMMON)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length / words.length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

/** The line that keeps the writer in the story's language (empty for English). */
export function languageLine(lang: string): string {
  return lang === 'English' ? '' : `[The story is written in ${lang}. Keep writing in ${lang}; these notes are in English only for brevity.]`;
}
