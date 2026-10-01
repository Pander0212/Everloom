/**
 * A Live2D model in place of a sprite. Loaded only when Live2D is turned on: first the owner's own
 * Cubism Core (never shipped with Everloom), then the renderer. Anything missing or failing falls
 * back to the ordinary sprite.
 */
import { useEffect, useRef, useState } from 'react';

let coreLoading: Promise<void> | null = null;
function loadCore(url: string): Promise<void> {
  if ((window as any).Live2DCubismCore) return Promise.resolve();
  coreLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => ((window as any).Live2DCubismCore ? resolve() : reject(new Error('Cubism Core did not load')));
    s.onerror = () => reject(new Error('Cubism Core did not load'));
    document.head.appendChild(s);
  }).catch((e) => {
    coreLoading = null;
    throw e;
  });
  return coreLoading;
}

const MOTION_FOR: Record<string, string> = { joy: 'TapBody', surprise: 'Tap', anger: 'Shake', sadness: 'Idle' };

export default function Live2DSprite({ coreUrl, modelUrl, expression, fallback }: { coreUrl: string; modelUrl: string; expression: string; fallback: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const model = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let app: any = null;
    let cancelled = false;
    (async () => {
      try {
        await loadCore(coreUrl);
        const PIXI = await import('pixi.js');
        (window as any).PIXI = PIXI;
        const { Live2DModel } = await import('pixi-live2d-display/cubism4');
        if (cancelled || !host.current) return;
        const w = host.current.clientWidth || 300;
        const h = host.current.clientHeight || 500;
        app = new PIXI.Application({ width: w, height: h, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
        host.current.appendChild(app.view as HTMLCanvasElement);
        const m = await Live2DModel.from(modelUrl, { autoInteract: false });
        if (cancelled) return;
        const scale = Math.min(w / m.width, h / m.height);
        m.scale.set(scale);
        m.x = (w - m.width) / 2;
        m.y = h - m.height;
        app.stage.addChild(m);
        model.current = m;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      model.current = null;
      app?.destroy(true, { children: true });
    };
  }, [coreUrl, modelUrl]);
  useEffect(() => {
    const m = model.current;
    if (!m) return;
    try {
      m.expression?.(expression);
      const motion = MOTION_FOR[expression];
      if (motion) m.motion?.(motion);
    } catch {
      /* the model may not have this expression */
    }
  }, [expression]);
  if (failed) return <>{fallback}</>;
  return <div ref={host} className="absolute inset-0" aria-hidden="true" />;
}
