/**
 * The base-model check: what an imported model has and lacks, in plain words, and which editor
 * features that turns on or off. A model that lacks something still loads; the matching feature is
 * switched off with the reason (and a fallback where there is one).
 */
import { buildMorphSliders } from './morphs.js';
import { REQUIRED_BONES, type HumanBone } from './skeleton.js';

export interface BaseFacts {
  /** Canonical bone → the file's bone name, for every bone that was found. */
  mapped: Partial<Record<HumanBone, string>>;
  boneCount: number;
  /** Bones outside the humanoid that look like chains (hair, skirt, breast, tail). */
  extraBones: string[];
  morphs: string[];
  meshes: number;
  skinnedMeshes: number;
  /** Meshes with no skin weights (they won't move with the skeleton). */
  unskinned: string[];
  vertices: number;
  triangles: number;
  textures: Array<{ name: string; width: number; height: number }>;
  hasUv: boolean;
  /** Height in metres after scaling, and whether the units had to be guessed. */
  height: number;
  autoFit: boolean;
}

export type ReportTone = 'ok' | 'warn' | 'off' | 'info';
export interface ReportLine { tone: ReportTone; title: string; detail: string }
export type BaseFeature = 'animation' | 'bodySliders' | 'faceSliders' | 'expressions' | 'fitting' | 'skinLayers' | 'chestPhysics' | 'fingers';
export interface BaseReport {
  lines: ReportLine[];
  features: Record<BaseFeature, { on: boolean; why: string }>;
  /** Body morphs the file has, by kind; kinds it lacks can use the generated fallback. */
  bodyKinds: string[];
  missingBodyKinds: string[];
}

const FINGERS: HumanBone[] = ['leftIndexProximal', 'leftMiddleProximal', 'leftThumbProximal', 'rightIndexProximal', 'rightMiddleProximal', 'rightThumbProximal'];
const BUDGET = { triangles: 60_000, hardTriangles: 150_000, texture: 2048 };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function baseReport(f: BaseFacts): BaseReport {
  const lines: ReportLine[] = [];
  const found = Object.keys(f.mapped) as HumanBone[];
  const missing = REQUIRED_BONES.filter((b) => !f.mapped[b]);
  const sliders = buildMorphSliders(f.morphs);
  const body = sliders.filter((s) => s.group === 'body');
  const face = sliders.filter((s) => s.group === 'face' && !s.expression);
  const expressionMorphs = sliders.filter((s) => s.expression);
  const adult = sliders.filter((s) => s.adult);
  const kinds = [...new Set(body.map((s) => s.kind).filter(Boolean))] as string[];
  const WANTED = ['breastSize', 'hips', 'waist', 'butt', 'thighs', 'shoulders'];
  const missingKinds = WANTED.filter((k) => !kinds.includes(k));
  const chestBones = f.extraBones.filter((b) => /breast|bust|boob|oppai|胸/i.test(b));

  // Skeleton.
  if (!missing.length) lines.push({ tone: 'ok', title: `Skeleton: ${plural(f.boneCount, 'bone')}, all required ones mapped`, detail: `Found ${found.length} of the standard bones (${found.slice(0, 8).join(', ')}${found.length > 8 ? ', …' : ''}).` });
  else lines.push({ tone: 'off', title: `Skeleton: ${missing.length} required bone${missing.length === 1 ? '' : 's'} missing`, detail: `Missing ${missing.join(', ')}. Map them by hand in Bones, or animations stay off for this model.` });
  const fingers = FINGERS.filter((b) => f.mapped[b]).length;
  if (!missing.length && fingers < FINGERS.length) lines.push({ tone: 'info', title: 'No finger bones', detail: 'Hands stay as they are in the file while animations play.' });
  // Morphs.
  if (!f.morphs.length) lines.push({ tone: 'warn', title: 'No morph targets (shape keys)', detail: 'Body and face sliders need them. Generated adjusters (labelled as such) can stand in for breast, hips, waist, butt, thighs and shoulders; the face won\'t move.' });
  else {
    lines.push({ tone: body.length ? 'ok' : 'warn', title: body.length ? `Body sliders: ${plural(body.length, 'slider')} from the file` : 'No body morph targets', detail: body.length ? body.map((s) => s.label).slice(0, 10).join(', ') + (body.length > 10 ? ', …' : '') : 'The file\'s morphs are all face or other shapes. Generated adjusters can stand in for body shape.' });
    if (body.length && missingKinds.length) lines.push({ tone: 'info', title: `Not in the file: ${missingKinds.map(label).join(', ')}`, detail: 'Generated adjusters can stand in for these (marked "generated").' });
    if (face.length || expressionMorphs.length) lines.push({ tone: 'ok', title: `Face: ${plural(face.length + expressionMorphs.length, 'shape')}`, detail: `${expressionMorphs.length} drive expressions, blinking or lip-sync; ${face.length} are face sliders.` });
    else lines.push({ tone: 'info', title: 'No face shapes', detail: 'Expressions, blinking and lip-sync are off; talking moves the jaw bone if there is one.' });
    if (adult.length) lines.push({ tone: 'warn', title: `${plural(adult.length, 'explicit shape')}: adults only`, detail: `${adult.map((s) => s.label).join(', ')}. These sliders are never applied to a character under 18.` });
  }
  // Meshes and skinning.
  if (!f.skinnedMeshes) lines.push({ tone: 'off', title: 'No skinned mesh', detail: 'Nothing is weighted to the skeleton, so the model can\'t move and clothes can\'t be rigged to it. Export with skinning (armature modifier) on.' });
  else if (f.unskinned.length) lines.push({ tone: 'warn', title: `${plural(f.unskinned.length, 'mesh', 'meshes')} not weighted to the skeleton`, detail: `${f.unskinned.slice(0, 5).join(', ')} won't follow animations.` });
  else lines.push({ tone: 'ok', title: `${plural(f.skinnedMeshes, 'skinned mesh', 'skinned meshes')}`, detail: 'Every mesh follows the skeleton.' });
  // Cost.
  const triTone: ReportTone = f.triangles > BUDGET.hardTriangles ? 'warn' : f.triangles > BUDGET.triangles ? 'info' : 'ok';
  lines.push({ tone: triTone, title: `${plural(f.triangles, 'triangle')}, ${plural(f.vertices, 'vertex', 'vertices')}`, detail: triTone === 'ok' ? 'Within the phone budget (60,000).' : triTone === 'info' ? 'Over the 60,000 phone budget: phones use the lighter copy.' : 'Over the 150,000 limit: expect slow phones, and use a lighter export.' });
  const big = f.textures.filter((t) => Math.max(t.width, t.height) > BUDGET.texture);
  if (!f.textures.length) lines.push({ tone: 'info', title: 'No textures', detail: 'Plain colours only. Skin layers paint onto a plain skin texture made for it.' });
  else lines.push({ tone: big.length ? 'info' : 'ok', title: `${plural(f.textures.length, 'texture')}, largest ${Math.max(...f.textures.map((t) => Math.max(t.width, t.height)))} px`, detail: big.length ? `${big.map((t) => t.name || 'unnamed').slice(0, 3).join(', ')} will be scaled to 2048 px.` : 'Within the 2048 px budget.' });
  if (!f.hasUv) lines.push({ tone: 'warn', title: 'No texture coordinates (UVs)', detail: 'Skin layers and tattoos need them.' });
  lines.push({ tone: f.autoFit ? 'warn' : 'ok', title: `Height ${f.height.toFixed(2)} m`, detail: f.autoFit ? 'The file\'s units looked wrong, so it was fitted to a typical height. Set the real height in Fit.' : 'Real-world size.' });
  if (chestBones.length) lines.push({ tone: 'ok', title: 'Chest bones found', detail: `${chestBones.slice(0, 4).join(', ')}: chest physics uses them.` });

  const features: BaseReport['features'] = {
    animation: { on: !missing.length, why: missing.length ? `Missing ${missing.join(', ')}` : 'All required bones mapped' },
    bodySliders: { on: body.length > 0, why: body.length ? `${body.length} body morphs` : 'No body morph targets: generated adjusters instead' },
    faceSliders: { on: face.length > 0, why: face.length ? `${face.length} face shapes` : 'No face shapes beyond expressions' },
    expressions: { on: expressionMorphs.length > 0, why: expressionMorphs.length ? `${expressionMorphs.length} expression shapes` : 'No blink, viseme or emotion shapes' },
    fitting: { on: f.skinnedMeshes > 0, why: f.skinnedMeshes ? 'Skin weights can be copied to clothes' : 'No skin weights to copy to clothes' },
    skinLayers: { on: f.hasUv, why: f.hasUv ? 'The body has texture coordinates' : 'No texture coordinates' },
    // Chest motion needs breast bones in the file (helper bones aren't generated for bases without them).
    chestPhysics: { on: chestBones.length > 0, why: chestBones.length ? 'Chest bones in the file' : 'No breast bones in the file' },
    fingers: { on: fingers === FINGERS.length, why: fingers === FINGERS.length ? 'Finger bones mapped' : 'No finger bones' },
  };
  return { lines, features, bodyKinds: kinds, missingBodyKinds: missingKinds };
}

function label(kind: string) {
  return ({ breastSize: 'breast size', hips: 'hips', waist: 'waist', butt: 'butt', thighs: 'thighs', shoulders: 'shoulders' } as Record<string, string>)[kind] ?? kind;
}
