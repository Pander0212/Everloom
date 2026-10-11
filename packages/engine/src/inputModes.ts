/**
 * Input modes for the message box: what the player's text is (an action, spoken words, narration
 * they write themselves, or an out-of-character direction), which changes how it is framed for the
 * model and shown in the story. "Continue" is sending an empty box. Plain chat (no mode) is unchanged.
 */
export type InputMode = 'act' | 'say' | 'story' | 'direct';

export const INPUT_MODES: Array<{ id: InputMode; label: string; hint: string; placeholder: string }> = [
  { id: 'act', label: 'Act', hint: 'Something you do', placeholder: 'You open the door…' },
  { id: 'say', label: 'Say', hint: 'Words you speak', placeholder: 'What do you say?' },
  { id: 'story', label: 'Story', hint: 'Write the narration yourself', placeholder: 'Write what happens…' },
  { id: 'direct', label: 'Direct', hint: 'A note to the narrator, outside the story', placeholder: 'Tell the narrator what you want…' },
];

const unwrap = (t: string, a: string, b = a) => (t.startsWith(a) && t.endsWith(b) && t.length > a.length + b.length ? t.slice(a.length, -b.length) : t);

/** The player's text as the model reads it. */
export function frameInput(mode: InputMode | null | undefined, text: string): string {
  const t = text.trim();
  if (!mode || !t) return text;
  if (mode === 'act') return `*${unwrap(unwrap(t, '*'), '_')}*`;
  if (mode === 'say') return `"${unwrap(unwrap(t, '"'), '“', '”')}"`;
  if (mode === 'story') return `[Narration written by the player; it happened. Continue the story from it.]\n${t}`;
  return `[Out of character: a direction for the narrator, not part of the story. Follow it in the next reply.]\n${t}`;
}

export const isInputMode = (v: unknown): v is InputMode => v === 'act' || v === 'say' || v === 'story' || v === 'direct';
