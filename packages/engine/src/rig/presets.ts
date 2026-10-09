/**
 * Known bases, recognised by their bone names (a fingerprint), each with rules for the bones its
 * naming makes plain. Bone-name data only: no asset content of any base is in Everloom.
 * Owners' own presets (a saved mapping per base) are stored separately; see bones.md.
 */
import type { RigRole } from './schema.js';

export interface BasePreset {
  id: string;
  name: string;
  /** A secondary role (or "ignore") that this base's naming gives a bone, if any. */
  role(bone: string): RigRole | 'ignore' | null;
}

const share = (names: string[], re: RegExp) => names.filter((n) => re.test(n)).length / Math.max(1, names.length);

export const BASES: (BasePreset & { match: (names: string[]) => boolean })[] = [
  {
    id: 'vroid',
    name: 'VRoid',
    match: (n) => share(n, /^J_(Bip|Sec|Adj)_/) > 0.4,
    role: (b) =>
      /^J_Sec_[LR]_Bust/i.test(b) ? 'breast'
      : /^J_Sec_Hair/i.test(b) ? 'hair'
      : /^J_Sec_[LR]?_?(CoatSkirt|Skirt)/i.test(b) ? 'skirt'
      : /^J_Sec_[LR]?_?(Tops|Coat|Cape)/i.test(b) ? 'coat'
      : /^J_Adj_[LR]_FaceEye/i.test(b) ? 'ignore'
      : /^J_Sec_[LR]?_?(Ear|Mimi)/i.test(b) ? 'ears'
      : /^J_Sec_[LR]?_?Tail/i.test(b) ? 'tail'
      : null,
  },
  {
    id: 'mmd',
    name: 'MMD',
    match: (n) => n.some((x) => /^(センター|上半身|下半身|グルーブ)$/.test(x)),
    role: (b) =>
      /^(全ての親|センター|グルーブ|操作中心|腰キャンセル.*|.*ＩＫ.*|.*IK.*|両目)$/.test(b) ? 'ignore'
      : /^(左|右)?(足|ひざ|足首)(D|ＤＸ|EX)$/.test(b) ? 'thighHelper'
      : /^(左|右)(腕|手)捩/.test(b) ? 'upperArmHelper'
      : /^(左|右)?(胸|乳|おっぱい)/.test(b) ? 'breast'
      : null,
  },
  { id: 'mixamo', name: 'Mixamo', match: (n) => share(n, /^mixamorig\d*:/i) > 0.5, role: (b) => (/HeadTop_End|_End$/i.test(b) ? 'ignore' : null) },
  {
    id: 'rigify',
    name: 'Rigify',
    match: (n) => share(n, /^(DEF|ORG|MCH)-/) > 0.4,
    role: (b) => (/^(ORG|MCH|VIS|WGT)-/.test(b) ? 'ignore' : /^DEF-breast/i.test(b) ? 'breast' : null),
  },
  {
    id: 'unreal',
    name: 'Unreal mannequin',
    match: (n) => n.includes('pelvis') && n.includes('spine_01') && n.some((x) => /^(clavicle|upperarm|thigh)_[lr]$/.test(x)),
    role: (b) => (/^ik_/.test(b) ? 'ignore' : /^(upperarm|lowerarm)_twist/.test(b) ? (b.startsWith('lower') ? 'forearmHelper' : 'upperArmHelper') : /^(thigh|calf)_twist/.test(b) ? 'thighHelper' : null),
  },
  {
    id: 'daz',
    name: 'Daz Genesis',
    match: (n) => n.some((x) => /^(lShldrBend|lThighBend|chestUpper|abdomenLower)$/.test(x)),
    role: (b) => (/^[lr]Pectoral$/.test(b) ? 'breast' : /^[lr](Shldr|Forearm|Thigh)Twist$/.test(b) ? (/Forearm/.test(b) ? 'forearmHelper' : /Shldr/.test(b) ? 'upperArmHelper' : 'thighHelper') : null),
  },
];

export function recognizeBase(names: string[]): BasePreset | null {
  return BASES.find((b) => b.match(names)) ?? null;
}
