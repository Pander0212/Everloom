/** Cutscene scripts as the owner writes them: one step per line. */
export type Draft = { name: string; steps: Array<{ text: string; speaker?: string; fx?: string; mood?: string; seconds?: number; emote?: string; outfit?: string | null }> };

/**
 * "Name: line" becomes a spoken step; other lines are narration. A spoken line can end with
 * {wave} (the speaker's 3D character plays that emote) or {outfit: Ball gown} ({outfit: none} for
 * their own clothes).
 */
export function parseSteps(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([A-Z][\w .'-]{0,40}):\s+(.+)$/.exec(l);
      if (!m) return { text: l };
      let line = m[2]!;
      const step: Draft['steps'][number] = { speaker: m[1]!, text: '' };
      line = line.replace(/\{\s*outfit:\s*([^}]{1,60})\}/i, (_, o: string) => ((step.outfit = /^none$/i.test(o.trim()) ? null : o.trim()), ''));
      line = line.replace(/\{\s*([a-z][a-z0-9_]{0,39})\s*\}/, (_, e: string) => ((step.emote = e), ''));
      step.text = line.trim() || '…';
      return step;
    });
}
