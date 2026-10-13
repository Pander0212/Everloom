import { automap, emoteForBody, type AutomapBone } from '@everloom/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CreatureMotion } from '../src/features/avatar3d/runtime/creature';
import type { LoadedModel } from '../src/features/avatar3d/runtime/loader';

/** A four-legged skeleton (Y up, facing +Z) as three.js bones, and its mapping. */
function pony(clips: THREE.AnimationClip[] = []) {
  const spec: Array<[string, string | null, [number, number, number]]> = [
    ['root', null, [0, 0, 0]], ['pelvis', 'root', [0, 0.75, -0.4]], ['spine', 'pelvis', [0, 0.78, -0.15]], ['chest', 'spine', [0, 0.8, 0.1]], ['neck', 'chest', [0, 0.82, 0.3]], ['head', 'neck', [0, 1.0, 0.45]], ['jaw', 'head', [0, 0.95, 0.5]], ['snout', 'head', [0, 1.02, 0.65]],
    ['tail1', 'pelvis', [0, 0.8, -0.45]], ['tail2', 'tail1', [0, 0.75, -0.62]], ['tail3', 'tail2', [0, 0.65, -0.78]], ['tail4', 'tail3', [0, 0.5, -0.9]],
  ];
  for (const [s, x] of [['L', 1], ['R', -1]] as const) {
    spec.push([`thigh.${s}`, 'pelvis', [0.14 * x, 0.7, -0.4]], [`shin.${s}`, `thigh.${s}`, [0.14 * x, 0.4, -0.42]], [`hoof.${s}`, `shin.${s}`, [0.14 * x, 0.1, -0.45]], [`hooftip.${s}`, `hoof.${s}`, [0.14 * x, 0, -0.42]]);
    spec.push([`front.${s}`, 'chest', [0.14 * x, 0.72, 0.25]], [`fore.${s}`, `front.${s}`, [0.14 * x, 0.4, 0.26]], [`fronthoof.${s}`, `fore.${s}`, [0.14 * x, 0.1, 0.27]], [`fronttip.${s}`, `fronthoof.${s}`, [0.14 * x, 0, 0.3]]);
    spec.push([`ear.${s}`, 'head', [0.06 * x, 1.07, 0.5]], [`eartip.${s}`, `ear.${s}`, [0.08 * x, 1.18, 0.48]]);
  }
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name, parent, pos] of spec) {
    const b = new THREE.Bone();
    b.name = name;
    const world = new THREE.Vector3(...pos);
    const p = parent ? bones.get(parent)! : null;
    (p ?? scene).add(b);
    scene.updateMatrixWorld(true);
    b.position.copy(p ? p.worldToLocal(world.clone()) : world);
    bones.set(name, b);
  }
  scene.updateMatrixWorld(true);
  const auto: AutomapBone[] = spec.map(([name, parent, pos]) => ({ name, parent, pos }));
  const rig = automap({ bones: auto }).rig;
  const model = { scene, bones: { head: bones.get('head'), neck: bones.get('neck'), jaw: bones.get('jaw') }, gltf: { animations: clips }, rawHeight: 1.18, scale: 1, height: 1.18 } as unknown as LoadedModel;
  return { model, rig, bones };
}

const angle = (b: THREE.Object3D, rest: THREE.Quaternion) => b.quaternion.angleTo(rest) * (180 / Math.PI);

describe('creature motion', () => {
  it('is mapped as a four-legged body with its parts', () => {
    const { rig } = pony();
    expect(rig.family).toBe('quadruped');
    const c = new CreatureMotion(pony().model, rig, { full: true, humanoidCore: false });
    expect(c.parts.front).toHaveLength(2);
    expect(c.parts.hind).toHaveLength(2);
    expect(c.parts.tails).toHaveLength(1);
    expect(c.fits.has('wag_tail')).toBe(true);
    expect(c.fits.has('sit')).toBe(true);
    expect(c.fits.has('flap_wings')).toBe(false); // no wings
    expect(c.fits.has('dance')).toBe(false); // humanoid dances don't fit
  });

  it('wags its tail, nods, and holds a sit', () => {
    const { model, rig, bones } = pony();
    const c = new CreatureMotion(model, rig, { full: true, humanoidCore: false });
    const tailRest = bones.get('tail2')!.quaternion.clone();
    expect(c.emote('wag_tail')).toBe(true);
    let swing = 0;
    for (let i = 0; i < 60; i++) {
      c.update(1 / 30, { lookAt: null, mouth: 0, speaking: false });
      swing = Math.max(swing, angle(bones.get('tail2')!, tailRest));
    }
    expect(swing).toBeGreaterThan(10);
    const thighRest = bones.get('thigh.L')!.quaternion.clone();
    const frontRest = bones.get('front.L')!.quaternion.clone();
    c.setBase('sit');
    for (let i = 0; i < 40; i++) c.update(1 / 30, { lookAt: null, mouth: 0, speaking: false });
    expect(angle(bones.get('thigh.L')!, thighRest)).toBeGreaterThan(30);
    // The front legs stay much straighter than the haunches.
    expect(angle(bones.get('thigh.L')!, thighRest)).toBeGreaterThan(angle(bones.get('front.L')!, frontRest));
  });

  it('opens the jaw with the voice and turns the head to look', () => {
    const { model, rig, bones } = pony();
    const c = new CreatureMotion(model, rig, { full: true, humanoidCore: false });
    const jawRest = bones.get('jaw')!.quaternion.clone();
    for (let i = 0; i < 20; i++) c.update(1 / 30, { lookAt: null, mouth: 1, speaking: true });
    expect(angle(bones.get('jaw')!, jawRest)).toBeGreaterThan(8);
    const headRest = bones.get('head')!.quaternion.clone();
    for (let i = 0; i < 90; i++) c.update(1 / 30, { lookAt: new THREE.Vector3(3, 1, 0.5), mouth: 0, speaking: false });
    expect(angle(bones.get('head')!, headRest)).toBeGreaterThan(8);
  });

  it("plays the file's own clip as an emote", () => {
    const track = new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0.38, 0, 0, 0.92, 0, 0, 0, 1]);
    const { model, rig, bones } = pony([new THREE.AnimationClip('Shake', 1, [track])]);
    const c = new CreatureMotion(model, rig, { full: true, humanoidCore: false });
    expect(c.ownClips).toEqual(['Shake']);
    expect(c.emote('own_1')).toBe(true);
    for (let i = 0; i < 15; i++) c.update(1 / 30, { lookAt: null, mouth: 0, speaking: false });
    expect(c.clipPlaying).toBe(true);
    expect(Math.abs(bones.get('head')!.quaternion.x)).toBeGreaterThan(0.15);
  });

  it("does the nearest thing its body can for the story's humanoid emotes", () => {
    const { model, rig } = pony();
    const c = new CreatureMotion(model, rig, { full: true, humanoidCore: false });
    expect(emoteForBody('laugh', c.fits)).toBe('wag_tail');
    expect(emoteForBody('dance', c.fits)).toBe('prance');
    expect(emoteForBody('kneel', c.fits)).toBe('lie_down');
    expect(emoteForBody('wave', c.fits)).toBe('nod');
  });
});
