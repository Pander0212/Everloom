/**
 * The 3D lab (/lab/3d): load a model file, play any clip or emote, switch the look, framing and
 * quality, and read the frame stats. Used to review rendering and motion, and by the tests.
 */
import { BUILTIN_EMOTES, EMOTIONS, type Emotion } from '@everloom/engine';
import { useEffect, useRef, useState } from 'react';
import { Button, FileButton, Select } from '@/ui';
import { loadModel } from './runtime/loader';
import { PRESETS, type LightingPreset } from './runtime/lighting';
import { Stage3D, type Framing, type Quality, type StageStats } from './runtime/stage';

declare global {
  interface Window {
    __lab?: { stage: Stage3D; load: (buf: ArrayBuffer, id?: string) => Promise<void> };
  }
}

export default function Lab3D() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage3D | null>(null);
  const [stats, setStats] = useState<StageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<Emotion>('neutral');

  useEffect(() => {
    const s = new Stage3D(canvas.current!, { quality: 'high', fpsCap: 60, physics: true, outlines: true });
    stage.current = s;
    let tick = 0;
    s.onFrame = (st) => {
      if (++tick % 15 === 0) setStats({ ...st });
    };
    s.start();
    const load = async (buf: ArrayBuffer, id = `m${s.ids().length + 1}`) => {
      setError(null);
      try {
        const model = await loadModel(buf, s.renderer);
        s.add(id, model);
        s.snapCamera();
        setIds(s.ids());
      } catch (e) {
        setError((e as Error).message);
      }
    };
    window.__lab = { stage: s, load };
    return () => {
      s.dispose();
      delete window.__lab;
    };
  }, []);

  const all = (fn: (id: string) => void) => ids.forEach(fn);
  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
        <FileButton accept=".glb,.gltf,.vrm" onFiles={async ([f]) => f && window.__lab?.load(await f.arrayBuffer())}>
          Load model
        </FileButton>
        <Select aria-label="Emote" defaultValue="" onChange={(e) => all((id) => void stage.current?.get(id)?.emote(e.target.value))} className="w-auto">
          <option value="" disabled>
            Emote…
          </option>
          {BUILTIN_EMOTES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Emotion" value={emotion} onChange={(e) => (setEmotion(e.target.value as Emotion), all((id) => (stage.current!.get(id)!.emotion = e.target.value as Emotion)))} className="w-auto">
          {EMOTIONS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <Select aria-label="Framing" defaultValue="half" onChange={(e) => stage.current?.setFraming(e.target.value as Framing)} className="w-auto">
          {['portrait', 'half', 'full'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <Select aria-label="Lighting" defaultValue="studio" onChange={(e) => stage.current?.setLighting(PRESETS[e.target.value as LightingPreset['id']])} className="w-auto">
          {Object.keys(PRESETS).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <Select aria-label="Quality" defaultValue="high" onChange={(e) => stage.current?.setOptions({ quality: e.target.value as Quality })} className="w-auto">
          {['low', 'medium', 'high', 'auto'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <Select aria-label="Look" defaultValue="toon" onChange={(e) => all((id) => stage.current?.get(id)?.setLook(e.target.value as 'toon' | 'pbr'))} className="w-auto">
          <option value="toon">Toon</option>
          <option value="pbr">PBR</option>
        </Select>
        <Button variant="ghost" onClick={() => all((id) => stage.current?.get(id)?.setSpeaking(!stage.current?.get(id)?.speaking))}>
          Talk
        </Button>
      </div>
      <div className="relative min-h-0 flex-1" style={{ background: 'linear-gradient(#cfd8e3, #eef1f4)' }}>
        <canvas ref={canvas} data-testid="lab-canvas" className="block h-full w-full" />
        <pre data-testid="lab-stats" className="pointer-events-none absolute left-2 top-2 rounded bg-surface/80 p-2 text-xs">
          {stats ? `${stats.fps} fps · ${stats.frameMs} ms · level ${stats.level} · ${stats.drawCalls} calls · ${stats.triangles} tris${stats.paused ? ' · paused' : ''}` : 'no frames yet'}
          {error ? `\n${error}` : ''}
        </pre>
      </div>
    </div>
  );
}
