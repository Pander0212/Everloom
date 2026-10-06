/**
 * The emote library: every built-in emote has a clip, the clips are well formed, nothing breaks a
 * rig, and standing emotes keep the feet on the floor.
 */
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILTIN_EMOTES } from '@everloom/engine';
import { applyCanonical, prepareRig } from '../src/features/avatar3d/runtime/canonical';
import { sampleClip } from '../src/features/avatar3d/runtime/clip';
import { clipIdFor } from '../src/features/avatar3d/runtime/clips';
import { bonesOf, clip, footClearance, loadGlb, ROOT } from './helpers3d';

const OFF_FLOOR = new Set(['lie_down', 'sleep', 'defeat', 'cheer', 'victory', 'scared', 'kneel', 'sit', 'dance_bounce', 'angry', 'walk_in', 'walk_out']);

describe('emote clips', () => {
  it('every built-in emote has a clip', () => {
    for (const e of BUILTIN_EMOTES) expect(existsSync(new URL(`apps/web/public/avatar/clips/${clipIdFor(e.id)}.json`, ROOT)), e.id).toBe(true);
  });

  it('play on a real rig without breaking it; standing ones keep the feet down', async () => {
    const g = await loadGlb('tests/fixtures/avatars/models/mannequin-f.glb');
    const rig = prepareRig(g.scene, bonesOf(g.scene));
    const floor = footClearance(rig, 0) * rig.hipsHeight;
    for (const e of BUILTIN_EMOTES) {
      const c = clip(clipIdFor(e.id));
      for (let i = 0; i <= 8; i++) {
        applyCanonical(rig, sampleClip(c, (c.duration * i) / 8));
        g.scene.updateMatrixWorld(true);
        g.scene.traverse((o: THREE.Object3D) => {
          if ((o as THREE.Bone).isBone) expect(o.matrixWorld.elements.every(Number.isFinite), `${e.id} ${o.name}`).toBe(true);
        });
        if (!OFF_FLOOR.has(e.id)) {
          const clear = footClearance(rig, floor);
          expect(clear, `${e.id} at ${i}/8`).toBeGreaterThan(-0.08);
          expect(clear, `${e.id} at ${i}/8`).toBeLessThan(0.15);
        }
      }
    }
  });

  it('dances loop at their tempo', () => {
    for (const e of BUILTIN_EMOTES.filter((x) => x.category === 'dance' && x.source === 'authored')) {
      const c = clip(e.id);
      const beats = c.duration / (60 / e.bpm!);
      expect(Math.abs(beats - Math.round(beats)), e.id).toBeLessThan(0.05);
    }
  });
});
