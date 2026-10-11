/** An owner-initiated round trip through upload, encrypted media, preparation and rendering. */
import { useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { deleteAvatar, uploadAvatar, type AvatarDetail } from '@/features/avatars/api';
import { Button } from '@/ui';
import Preview3D from './Preview3D';

export default function ImportDiagnostics() {
  const [steps, setSteps] = useState<string[]>([]);
  const [model, setModel] = useState<AvatarDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [passed, setPassed] = useState(false);
  const id = useRef<string | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { generation.current++; clearTimeout(timer.current); if (id.current) void deleteAvatar(id.current).catch(() => {}); }, []);
  const fail = (reason: string) => { clearTimeout(timer.current); setError(reason); setRunning(false); };
  const run = async () => {
    if (running) return;
    const current = ++generation.current;
    setRunning(true); setPassed(false); setError(null); setModel(null); setSteps([]);
    const add = (s: string) => { if (current === generation.current) setSteps(old => old.includes(s) ? old : [...old, s]); };
    let stage = 'Bundled fixture download';
    try {
      if (id.current) { await deleteAvatar(id.current); id.current = null; }
      const r = await fetch('/avatar/mannequin.glb', { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: the bundled diagnostic model is missing.`);
      const file = new File([await r.arrayBuffer()], 'import-self-test.glb', { type: 'model/gltf-binary' });
      add('Bundled model downloaded'); stage = 'Upload';
      const uploaded = await uploadAvatar(file, 'Import self-test', add);
      if (current !== generation.current) { await deleteAvatar(uploaded.id).catch(() => {}); return; }
      id.current = uploaded.id; add('Upload accepted'); stage = 'Server preparation';
      const deadline = Date.now() + 120000;
      let detail: AvatarDetail | undefined;
      while (Date.now() < deadline && current === generation.current) {
        detail = await get<AvatarDetail>(`/api/avatars/${uploaded.id}`);
        if (detail.status === 'failed') throw new Error(detail.error ?? 'No failure details were returned.');
        if (detail.status === 'ready') break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (current !== generation.current) return;
      if (detail?.status !== 'ready' || !detail.model) throw new Error('Preparation timed out after two minutes. Check your server logs.');
      add('Server preparation passed'); stage = 'Media download';
      const media = await fetch(detail.model, { signal: AbortSignal.timeout(15000) });
      if (!media.ok) throw new Error(`HTTP ${media.status}: the prepared file could not be read.`);
      const bytes = new Uint8Array(await media.arrayBuffer());
      if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'glTF') throw new Error('The media response was not a binary glTF model.');
      add('Stored media read back correctly'); add('Starting WebGL and decoders');
      setModel(detail);
      timer.current = setTimeout(() => fail('WebGL/decoder step: no rendered model within 70 seconds.'), 70000);
    } catch (e) { if (current === generation.current) fail(`${stage}: ${(e as Error).message}`); }
  };
  return <div className="flex flex-col gap-3" data-testid="import-diagnostics">
    <p className="text-sm text-fg-2">Loads a small bundled model through the same import and preview used for your characters. The temporary test avatar is removed when you leave.</p>
    <Button variant="secondary" loading={running} onClick={() => void run()} data-testid="import-self-test">Import self-test</Button>
    {steps.length ? <ol className="list-decimal pl-5 text-sm" aria-live="polite">{steps.map(s => <li key={s}>{s}</li>)}</ol> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {passed ? <p role="status" className="text-sm">Passed: upload, preparation, media, WebGL and emote loading.</p> : null}
    {model ? <Preview3D src={model.model} fallbackSrc={model.source} config={model.config} className="h-64" onError={reason => fail(`WebGL/decoder step: ${reason}`)} onLoaded={h => {
      if (!h) return;
      void h.avatar.emote('wave').then(played => {
        if (!played) throw new Error('The wave emote file could not be loaded.');
        const previous = h.stage.onFrame;
        h.stage.onFrame = stats => {
          previous?.(stats);
          if (!stats.avatars || !stats.drawCalls) return;
          h.stage.onFrame = previous; clearTimeout(timer.current); setRunning(false); setPassed(true); setSteps(s => [...s, 'Model rendered; wave emote loaded']);
        };
        h.stage.kick();
      }).catch(e => fail(`Emote step: ${(e as Error).message}`));
    }} /> : null}
    {(error || passed) ? <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(JSON.stringify({ steps, passed, error }, null, 2)).catch(() => setError('Clipboard unavailable; select and copy the diagnostic text.'))}>Copy details</Button> : null}
  </div>;
}
