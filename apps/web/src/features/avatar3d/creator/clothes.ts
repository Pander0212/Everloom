/**
 * Clothing templates: shells grown from the body itself (the faces of a body region, pushed out
 * along their normals). A shell shares the body's UV layout, skin weights and shape keys, so it
 * follows every body slider and pose, and a picture painted in the body's UV template fits it.
 * Skirts and coat tails are cones hung from the hips (their own simple layout: around × down).
 */
import * as THREE from 'three';
import { CLOTHING_TEMPLATES, type ClothingItem } from '@everloom/engine';
import { canvasTexture, paintPattern } from './paint';

interface Marks { hipY: number; waistY: number; breastY: number; neckY: number; kneeY: number; ankleY: number; shoulderX: number }

function marks(body: THREE.SkinnedMesh): Marks {
  const bone = (n: string) => { const b = body.skeleton.bones.find((x) => x.name === n)!; b.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); };
  const thigh = bone('thigh_l'), calf = bone('calf_l'), foot = bone('foot_l'), neck = bone('neck_01'), spine2 = bone('spine_02'), upper = bone('upperarm_l');
  const breast = body.skeleton.bones.some((b) => b.name === 'breast_l') ? bone('breast_l') : spine2;
  return { hipY: thigh.y, waistY: (thigh.y + spine2.y) / 2 + 0.02, breastY: breast.y, neckY: neck.y, kneeY: calf.y, ankleY: foot.y, shoulderX: upper.x };
}

type Region = (v: number, bone: string, p: THREE.Vector3, w: number) => boolean;

/** Which body vertices each template covers, and how far out it sits. */
function region(id: ClothingItem['template'], m: Marks): { keep: Region; offset: number; cone?: { top: number; bottom: number; flare: number } } {
  const has = (re: RegExp) => (b: string) => re.test(b);
  const torso = has(/^(spine_0[123]|breast_[lr])$/), arms = has(/^(clavicle|upperarm)_[lr]$/), fore = has(/^lowerarm_[lr]$/), hips = has(/^(pelvis|butt_[lr]|spine_01)$/), thigh = has(/^thigh_[lr]$/), calf = has(/^calf_[lr]$/), foot = has(/^(foot|ball)_[lr]$/), hand = has(/^(hand_[lr]|(thumb|index|middle|ring|pinky)_0[123]_[lr])$/);
  const top = (b: string, p: THREE.Vector3) => (torso(b) || (b === 'spine_01' && p.y > m.hipY + 0.06)) && p.y < m.neckY - 0.035;
  const sleeve = (b: string, p: THREE.Vector3, k: number) => b.startsWith('clavicle') || (b.startsWith('upperarm') && Math.abs(p.x) < Math.abs(m.shoulderX) + k);
  switch (id) {
    case 'bra': return { offset: 0.0016, keep: (_v, b, p) => (torso(b) || b.startsWith('clavicle')) && p.y > m.breastY - 0.07 && p.y < m.breastY + 0.05 };
    case 'briefs': return { offset: 0.0016, keep: (_v, b, p) => (hips(b) || thigh(b)) && p.y < m.hipY + 0.07 && p.y > m.hipY - 0.1 };
    case 'tank': return { offset: 0.004, keep: (_v, b, p) => top(b, p) || (hips(b) && p.y > m.hipY - 0.02) };
    case 'tshirt': return { offset: 0.004, keep: (_v, b, p) => top(b, p) || (hips(b) && p.y > m.hipY - 0.02) || sleeve(b, p, 0.12) };
    case 'longsleeve': return { offset: 0.004, keep: (_v, b, p) => top(b, p) || (hips(b) && p.y > m.hipY - 0.02) || sleeve(b, p, 9) || fore(b) };
    case 'crop': return { offset: 0.004, keep: (_v, b, p) => top(b, p) && p.y > m.breastY - 0.1 || sleeve(b, p, 0.08) };
    case 'shorts': return { offset: 0.004, keep: (_v, b, p) => (hips(b) && p.y < m.waistY) || (thigh(b) && p.y > m.kneeY + 0.2) };
    case 'pants': return { offset: 0.005, keep: (_v, b, p) => (hips(b) && p.y < m.waistY) || thigh(b) || (calf(b) && p.y > m.ankleY + 0.03) };
    case 'leggings': return { offset: 0.0022, keep: (_v, b, p) => (hips(b) && p.y < m.waistY) || thigh(b) || (calf(b) && p.y > m.ankleY + 0.02) };
    case 'skirt': return { offset: 0.006, keep: (_v, b, p) => hips(b) && p.y < m.waistY && p.y > m.hipY - 0.02, cone: { top: m.hipY, bottom: m.hipY - 0.3, flare: 0.35 } };
    case 'long-skirt': return { offset: 0.006, keep: (_v, b, p) => hips(b) && p.y < m.waistY && p.y > m.hipY - 0.02, cone: { top: m.hipY, bottom: m.ankleY + 0.05, flare: 0.28 } };
    case 'dress': return { offset: 0.006, keep: (_v, b, p) => top(b, p) || (hips(b) && p.y > m.hipY - 0.02), cone: { top: m.hipY, bottom: m.kneeY - 0.02, flare: 0.32 } };
    case 'jacket': return { offset: 0.012, keep: (_v, b, p) => top(b, p) || (hips(b) && p.y > m.hipY - 0.06) || sleeve(b, p, 9) || (fore(b)) };
    case 'coat': return { offset: 0.014, keep: (_v, b, p) => top(b, p) || hips(b) || sleeve(b, p, 9) || fore(b), cone: { top: m.hipY, bottom: m.kneeY - 0.08, flare: 0.22 } };
    case 'socks': return { offset: 0.0018, keep: (_v, b, p) => foot(b) || (calf(b) && p.y < m.ankleY + 0.1) };
    case 'stockings': return { offset: 0.0018, keep: (_v, b, p) => foot(b) || calf(b) || (thigh(b) && p.y < m.hipY - 0.13) };
    case 'shoes': return { offset: 0.007, keep: (_v, b, p) => foot(b) && p.y < m.ankleY + 0.03 };
    case 'boots': return { offset: 0.008, keep: (_v, b, p) => foot(b) || (calf(b) && p.y < m.kneeY - 0.06) };
    case 'gloves': return { offset: 0.002, keep: (_v, b) => hand(b) };
    default: return { offset: 0.004, keep: () => false };
  }
}

function material(item: ClothingItem, textures: Map<string, THREE.Texture>, id: string): THREE.MeshStandardMaterial {
  const custom = item.texture ? textures.get(item.texture) : undefined;
  const map = custom ?? (item.pattern === 'plain' ? null : canvasTexture(paintPattern(item.pattern, item.color, item.accent), true));
  if (map && !custom) map.repeat.set(10, 10);
  return new THREE.MeshStandardMaterial({ name: `Cloth_${id}`, color: custom || map ? 0xffffff : item.color, map, roughness: item.pattern === 'lace' ? 0.5 : 0.8, side: THREE.DoubleSide });
}

/** A shell of the body faces the template covers. */
function shell(body: THREE.SkinnedMesh, keep: Region, offset: number): THREE.BufferGeometry | null {
  const g = body.geometry;
  const p = g.attributes.position!, n = g.attributes.normal!, uv = g.attributes.uv!, si = g.attributes.skinIndex!, sw = g.attributes.skinWeight!, idx = g.index!;
  const names = body.skeleton.bones.map((b) => b.name);
  const ok = new Uint8Array(p.count);
  const v3 = new THREE.Vector3();
  for (let v = 0; v < p.count; v++) {
    let best = 0, bw = 0;
    for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > bw) { bw = sw.getComponent(v, k); best = si.getComponent(v, k); }
    ok[v] = keep(v, names[best] ?? '', v3.set(p.getX(v), p.getY(v), p.getZ(v)), bw) ? 1 : 0;
  }
  const map = new Map<number, number>(), src: number[] = [], index: number[] = [];
  const use = (v: number) => { let k = map.get(v); if (k === undefined) { k = src.length; map.set(v, k); src.push(v); } return k; };
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (ok[a] && ok[b] && ok[c]) index.push(use(a), use(b), use(c));
  }
  if (!index.length) return null;
  const out = new THREE.BufferGeometry();
  const N = src.length;
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uvs = new Float32Array(N * 2), skI = new Uint16Array(N * 4), skW = new Float32Array(N * 4);
  src.forEach((v, i) => {
    pos[i * 3] = p.getX(v) + n.getX(v) * offset; pos[i * 3 + 1] = p.getY(v) + n.getY(v) * offset; pos[i * 3 + 2] = p.getZ(v) + n.getZ(v) * offset;
    nor[i * 3] = n.getX(v); nor[i * 3 + 1] = n.getY(v); nor[i * 3 + 2] = n.getZ(v);
    uvs[i * 2] = uv.getX(v); uvs[i * 2 + 1] = uv.getY(v);
    for (let k = 0; k < 4; k++) { skI[i * 4 + k] = si.getComponent(v, k); skW[i * 4 + k] = sw.getComponent(v, k); }
  });
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(skI, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(skW, 4));
  out.setIndex(index);
  // The body's shape keys, so the shell follows every body slider.
  const morphs = g.morphAttributes.position ?? [];
  out.morphAttributes.position = morphs.map((m) => { const a = new Float32Array(N * 3); src.forEach((v, i) => { a[i * 3] = m.getX(v); a[i * 3 + 1] = m.getY(v); a[i * 3 + 2] = m.getZ(v); }); return new THREE.BufferAttribute(a, 3); });
  out.morphTargetsRelative = true;
  return out;
}

/** A cone from the hips down: a skirt, or a dress's or coat's tail. */
function cone(body: THREE.SkinnedMesh, c: { top: number; bottom: number; flare: number }, offset: number): THREE.BufferGeometry {
  const p = body.geometry.attributes.position!;
  const names = body.skeleton.bones.map((b) => b.name);
  const pelvis = names.indexOf('pelvis'), tl = names.indexOf('thigh_l'), tr = names.indexOf('thigh_r');
  const A = 48, R = 10;
  // The body's outline by angle, at each ring's height (both legs together below the hips), so the
  // cone never cuts into the hips or thighs.
  const centre = new THREE.Vector2();
  let cn = 0;
  for (let v = 0; v < p.count; v++) if (Math.abs(p.getY(v) - c.top) < 0.012 && Math.abs(p.getX(v)) < 0.25) { centre.x += p.getX(v); centre.y += p.getZ(v); cn++; }
  centre.divideScalar(Math.max(1, cn));
  const outline = (y: number) => {
    const r = new Float32Array(A).fill(0);
    for (let v = 0; v < p.count; v++) {
      if (Math.abs(p.getY(v) - y) > 0.02 || Math.abs(p.getX(v)) > 0.3) continue;
      const dx = p.getX(v) - centre.x, dz = p.getZ(v) - centre.y;
      const a = Math.floor(((Math.atan2(dx, dz) / (Math.PI * 2) + 1) % 1) * A);
      r[a] = Math.max(r[a]!, Math.hypot(dx, dz));
    }
    for (let k = 0; k < 3; k++) for (let a = 0; a < A; a++) r[a] = Math.max(r[a]!, (r[(a + A - 1) % A]! + r[(a + 1) % A]!) / 2);
    return r;
  };
  const radius = outline(c.top);
  for (let a = 0; a < A; a++) if (!radius[a]) radius[a] = 0.12;
  const rings = Array.from({ length: R + 1 }, (_, r) => outline(c.top + (c.bottom - c.top) * (r / R)));
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], skI: number[] = [], skW: number[] = [], idx: number[] = [];
  const legGap = (Math.max(...Array.from(radius)) || 0.15) * 0.15;
  for (let r = 0; r <= R; r++) {
    const t = r / R, y = c.top + (c.bottom - c.top) * t;
    for (let a = 0; a <= A; a++) {
      const ang = (a / A) * Math.PI * 2;
      const rad = Math.max(radius[a % A]! * (1 + c.flare * t ** 1.2) + legGap * t, rings[r]![a % A]! * 1.04) + offset;
      const x = centre.x + Math.sin(ang) * rad, z = centre.y + Math.cos(ang) * rad;
      pos.push(x, y, z);
      nor.push(Math.sin(ang), 0.15, Math.cos(ang));
      uv.push(a / A, t);
      const side = Math.sin(ang) >= 0 ? tl : tr;
      const toLeg = Math.min(0.55, t * 0.7) * Math.abs(Math.sin(ang));
      skI.push(pelvis, side, 0, 0);
      skW.push(1 - toLeg, toLeg, 0, 0);
    }
  }
  for (let r = 0; r < R; r++) for (let a = 0; a < A; a++) { const i = r * (A + 1) + a, j = i + A + 1; idx.push(i, j, i + 1, i + 1, j, j + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skW, 4));
  g.setIndex(idx);
  return g;
}

/** The meshes for the outfit, bound to the body's skeleton. */
export function buildClothes(body: THREE.SkinnedMesh, items: ClothingItem[], textures: Map<string, THREE.Texture>): THREE.SkinnedMesh[] {
  const m = marks(body);
  const out: THREE.SkinnedMesh[] = [];
  items.forEach((item, i) => {
    const t = CLOTHING_TEMPLATES.find((x) => x.id === item.template);
    if (!t) return;
    const r = region(item.template, m);
    const mat = material(item, textures, `${item.template}_${i}`);
    const parts = [shell(body, r.keep, r.offset + i * 0.0004), r.cone ? cone(body, r.cone, r.offset) : null].filter((g): g is THREE.BufferGeometry => !!g);
    parts.forEach((g, k) => {
      const mesh = new THREE.SkinnedMesh(g, mat);
      mesh.name = `Clothes_${item.template}${k ? '_tail' : ''}_${i}`;
      mesh.frustumCulled = false;
      mesh.userData.everloomGarment = { slot: t.kind, layer: t.layer };
      mesh.bind(body.skeleton, body.bindMatrix);
      if (g.morphAttributes.position?.length) { mesh.morphTargetDictionary = { ...body.morphTargetDictionary }; mesh.morphTargetInfluences = [...(body.morphTargetInfluences ?? [])]; }
      out.push(mesh);
    });
  });
  return out;
}

/** The body's UV layout as a picture to paint clothes and skin on (white lines on transparent). */
export function uvTemplate(body: THREE.SkinnedMesh, size = 2048): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(40,40,40,0.55)';
  g.lineWidth = 1;
  const uv = body.geometry.attributes.uv!, idx = body.geometry.index!;
  g.beginPath();
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), cc = idx.getX(t + 2);
    g.moveTo(uv.getX(a) * size, uv.getY(a) * size); g.lineTo(uv.getX(b) * size, uv.getY(b) * size); g.lineTo(uv.getX(cc) * size, uv.getY(cc) * size); g.closePath();
  }
  g.stroke();
  return c;
}
