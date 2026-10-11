/** Skin layers: decals land where they were tapped at the right size and turn; the stack paints in order. */
import { describe, expect, it } from 'vitest';
import { SkinLayerSchema, stackOrder } from '@everloom/engine';
import { decalTransform, paintStack } from '../src/features/avatar3d/runtime/skin';

const apply = ([a, b, c, d, e, f]: number[], x: number, y: number) => [a! * x + c! * y + e!, b! * x + d! * y + f!];

describe('decal placement', () => {
  const decal = { u: 0.25, v: 0.6, size: 10, rotation: 0, right: [0.01, 0] as [number, number], up: [0, -0.01] as [number, number] };

  it('centres the image on the tapped spot', () => {
    const m = decalTransform(decal, 200, 100, 1024, 2048);
    const [x, y] = apply(m, 100, 50);
    expect(x).toBeCloseTo(0.25 * 1024, 6);
    expect(y).toBeCloseTo(0.6 * 2048, 6);
  });

  it('is `size` centimetres wide along the skin, keeping the image aspect, upright', () => {
    const m = decalTransform(decal, 200, 100, 1000, 1000);
    const [lx, ly] = apply(m, 0, 50), [rx, ry] = apply(m, 200, 50);
    // 10 cm × 0.01 uv per cm × 1000 px = 100 px across, nothing vertical.
    expect(rx - lx).toBeCloseTo(100, 6);
    expect(ry - ly).toBeCloseTo(0, 6);
    const [, top] = apply(m, 100, 0), [, bottom] = apply(m, 100, 100);
    // Half as tall; the image's top is the skin's up (v decreases upward in glTF).
    expect(bottom - top).toBeCloseTo(50, 6);
  });

  it('turns clockwise on the skin by `rotation` degrees', () => {
    const m = decalTransform({ ...decal, rotation: 90 }, 100, 100, 1000, 1000);
    const [cx, cy] = apply(m, 50, 50), [rx, ry] = apply(m, 100, 50);
    // The image's right edge now points down the skin.
    expect(rx - cx).toBeCloseTo(0, 6);
    expect(ry - cy).toBeGreaterThan(40);
  });

  it('follows a skewed or mirrored UV layout through the measured frame', () => {
    const m = decalTransform({ ...decal, right: [-0.01, 0], up: [0, -0.02] }, 100, 100, 1000, 1000);
    const [cx] = apply(m, 50, 50), [rx] = apply(m, 100, 50);
    expect(rx).toBeLessThan(cx); // mirrored island: the skin's right runs left in the texture
    const [, top] = apply(m, 50, 0), [, bottom] = apply(m, 50, 100);
    expect(bottom - top).toBeCloseTo(200, 6); // stretched island: 2× in v
  });
});

describe('layer stack', () => {
  /** A 2D context that records what is drawn. */
  function recorder() {
    const ops: string[] = [];
    const ctx = {
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      setTransform(...m: number[]) { ops.push(`transform ${m.map((n) => Math.round(n)).join(',')}`); },
      drawImage(img: { name: string }) { ops.push(`draw ${img.name} alpha=${ctx.globalAlpha} op=${ctx.globalCompositeOperation}`); },
      fillRect() { ops.push(`fill ${ctx.fillStyle} alpha=${ctx.globalAlpha} op=${ctx.globalCompositeOperation}`); },
    };
    return { ctx, ops };
  }
  const img = (name: string) => ({ name, width: 64, height: 64 }) as never;
  const layer = (o: object) => SkinLayerSchema.parse({ id: 'l', name: 'L', kind: 'tattoo', ...o });

  it('paints base, tone wash, then each layer in order with its own opacity', () => {
    const { ctx, ops } = recorder();
    paintStack(ctx as never, 512, 512, img('base'), '#a07050', [
      { layer: layer({ kind: 'underwear', opacity: 1 }), image: img('briefs') },
      { layer: layer({ kind: 'paint', tint: '#ff0000', opacity: 0.4 }), image: null },
      { layer: layer({ opacity: 0.8, decal: { u: 0.5, v: 0.5, size: 8 } }), image: img('rose') },
    ]);
    const draws = ops.filter((o) => !o.startsWith('transform'));
    expect(draws).toEqual([
      'draw base alpha=1 op=source-over',
      'fill #a07050 alpha=1 op=multiply',
      'draw briefs alpha=1 op=source-over',
      'fill #ff0000 alpha=0.4 op=source-over',
      'draw rose alpha=0.8 op=source-over',
    ]);
    // The decal is stamped through its own transform, then the transform is reset.
    expect(ops.at(-1)).toBe('transform 1,0,0,1,0,0');
    expect(ctx.globalAlpha).toBe(1);
  });

  it('skips a layer with neither image nor tint', () => {
    const { ctx, ops } = recorder();
    paintStack(ctx as never, 64, 64, null, null, [{ layer: layer({}), image: null }]);
    expect(ops.filter((o) => o.startsWith('draw') || o.startsWith('fill'))).toEqual(['fill #e6c2a8 alpha=1 op=source-over']);
  });

  it('orders layers skin-first: makeup and tattoos under underwear and stockings', () => {
    const kinds = stackOrder([layer({ kind: 'stockings' }), layer({ kind: 'tattoo' }), layer({ kind: 'underwear' }), layer({ kind: 'makeup' })]).map((l) => l.kind);
    expect(kinds.indexOf('tattoo')).toBeLessThan(kinds.indexOf('underwear'));
    expect(kinds.indexOf('makeup')).toBeLessThan(kinds.indexOf('underwear'));
    expect(kinds.indexOf('underwear')).toBeLessThan(kinds.indexOf('stockings'));
  });
});
