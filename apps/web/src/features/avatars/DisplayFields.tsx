/** On a character: which 3D avatar it uses and how it appears on the stage. */
import type { CharacterGame } from '@everloom/engine';
import { Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useFeatureOn } from '@/lib/features';
import { toast, toastError } from '@/lib/store';
import { Button, Field, Select } from '@/ui';
import { createCodeAvatar, fillRecipe, useAvatars } from './api';

export function DisplayFields({ game, setGame, characterId }: { game: CharacterGame; setGame: (p: Partial<CharacterGame>) => void; characterId?: string }) {
  const on = useFeatureOn('avatars3d');
  const avatars = useAvatars(on);
  const navigate = useNavigate();
  const [making, setMaking] = useState(false);
  if (!on) return null;
  const ready = (avatars.data ?? []).filter((a) => a.status === 'ready');
  const chosen = ready.find((a) => a.id === game.avatar3d);
  /** A code-made avatar from this character's description, linked and opened for editing. */
  const make = async () => {
    if (!characterId) return;
    setMaking(true);
    try {
      const { recipe, source } = await fillRecipe({ characterId });
      const a = await createCodeAvatar('', recipe);
      // Linked in the draft; saving the character keeps it.
      setGame({ avatar3d: a.id });
      toast({ title: 'Code-made look ready', lines: [source === 'model' ? 'Filled in by the utility model.' : 'Worked out from the description.', 'Save the character to keep it.'], tone: 'success', action: { label: 'Edit the look', run: () => navigate(`/characters/avatars/${a.id}`) } });
    } catch (e) {
      toastError(e);
    } finally {
      setMaking(false);
    }
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="3D avatar" htmlFor="avatar3d" hint={<Link to="/characters/avatars" className="underline">Import or edit avatars</Link>}>
        <Select id="avatar3d" value={game.avatar3d ?? ''} onChange={(e) => setGame({ avatar3d: e.target.value || undefined })}>
          <option value="">None (a code-made figure from the description when there's no picture)</option>
          {ready.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.kind === 'code' ? ' (code-made)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="On the stage" htmlFor="display" hint="Automatic uses 3D when there's an avatar, then Live2D, then pictures.">
        <Select id="display" value={game.display ?? 'auto'} onChange={(e) => setGame({ display: e.target.value as CharacterGame['display'] })}>
          <option value="auto">Automatic</option>
          <option value="3d">3D</option>
          <option value="live2d">Live2D</option>
          <option value="sprite">Pictures</option>
        </Select>
      </Field>
      {characterId && !chosen ? (
        <div className="sm:col-span-2">
          <Button variant="secondary" icon={Wand2} loading={making} onClick={make} data-testid="make-code-avatar">
            Make a code-made look
          </Button>
          <p className="mt-1 text-xs text-fg-2">Built from the description (the utility model fills it in when one is set up). No file to download; edit it like any avatar.</p>
        </div>
      ) : null}
    </div>
  );
}
