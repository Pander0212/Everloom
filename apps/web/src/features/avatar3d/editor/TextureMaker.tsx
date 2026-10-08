/**
 * A pattern or fabric for a garment from the owner's image connection: describe it, and it comes
 * back as a seamless tile (made seamless on the server) added as a variant, shown on the model
 * straight away. With an editing model, it changes the selected texture instead.
 */
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { post } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button, Input, Switch } from '@/ui';
import { useConnections, useSettings } from '@/lib/queries';

export function TextureMaker({ onMade, base, avatarId, adultCharacter = false }: { onMade: (textureId: string, name: string) => void; base: string | null; avatarId?: string; adultCharacter?: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [adult, setAdult] = useState(false);
  const settings = useSettings(), connections = useConnections();
  const connection = connections.data?.find(value => value.id === settings.data?.roles.image);
  const canAdult = adultCharacter && settings.data?.library.nsfw === true && connection?.params.allowAdult === true;
  return (
    <div className="flex flex-col gap-2">
    {canAdult ? <Switch label="Adult texture (18+)" checked={adult} onChange={setAdult} /> : null}
    <div className="flex items-center gap-2">
      <Input aria-label="Pattern or fabric" placeholder="A pattern or fabric: red tartan, blue denim…" value={prompt} maxLength={400} onChange={(e) => setPrompt(e.target.value)} className="min-w-0 flex-1" />
      <Button
        size="sm"
        variant="secondary"
        icon={Sparkles}
        loading={busy}
        disabled={prompt.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await post<{ id: string; url: string }>('/api/avatars/texture', { prompt, base, adult: canAdult && adult, avatarId });
            onMade(r.id, prompt.slice(0, 60));
            setPrompt('');
          } catch (e) {
            toastError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        Make
      </Button>
    </div>
    </div>
  );
}
