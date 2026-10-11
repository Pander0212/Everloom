import { type AvatarConfig } from '@everloom/engine';
import { Field, Input, Textarea } from '@/ui';
/** Age and description: used by the server's minor guard (explicit content is never applied to a minor). */
export function ContentStep({ config, set }: { config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void }) {
  const content = config.content;
  return <div className="flex flex-col gap-4">
    <p className="text-sm text-fg-2">Optional. 18+ features need no setting. They are never applied to a character recorded under 18 or described as a child; linked character cards count too.</p>
    <Field label="Recorded character age"><Input aria-label="Recorded character age" type="number" min={0} max={120} value={content.age ?? ''} onChange={e => set({ content: { ...content, age: e.target.value === '' ? null : Number(e.target.value) } })} /></Field>
    <Field label="Character description" hint="The server also checks linked character cards."><Textarea aria-label="Character description" value={content.description} maxLength={4000} onChange={e => set({ content: { ...content, description: e.target.value } })} /></Field>
  </div>;
}
