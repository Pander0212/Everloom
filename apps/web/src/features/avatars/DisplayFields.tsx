/** On a character: which 3D avatar it uses and how it appears on the stage. */
import type { CharacterGame } from '@everloom/engine';
import { Link } from 'react-router';
import { useFeatureOn } from '@/lib/features';
import { Field, Select } from '@/ui';
import { useAvatars } from './api';

export function DisplayFields({ game, setGame }: { game: CharacterGame; setGame: (p: Partial<CharacterGame>) => void }) {
  const on = useFeatureOn('avatars3d');
  const avatars = useAvatars(on);
  if (!on) return null;
  const ready = (avatars.data ?? []).filter((a) => a.status === 'ready');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="3D avatar" htmlFor="avatar3d" hint={<Link to="/characters/avatars" className="underline">Import or edit avatars</Link>}>
        <Select id="avatar3d" value={game.avatar3d ?? ''} onChange={(e) => setGame({ avatar3d: e.target.value || undefined })}>
          <option value="">None</option>
          {ready.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
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
    </div>
  );
}
