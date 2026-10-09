/**
 * Bone names in English, Japanese, Chinese and Korean, brought to plain English words with a side:
 * "J_Sec_L_Bust1" → {words: [bust, 1], side: L}; "左おっぱい２" → {words: [breasts, 2], side: L};
 * "가슴_R" → {words: [chest], side: R}.
 *
 * Japanese uses the Cats Blender Plugin's dictionary (MIT, data/LICENSE.cats.txt) plus our own
 * additions; the Chinese and Korean words are our own.
 */
import CATS from './data/cats-ja-en.json' with { type: 'json' };

/** Our own additions and corrections (bone vocabulary Cats lacks, or words it renders for clothing). */
const JA: Record<string, string> = {
  つま先: 'Toe', 後髪: 'BackHair', 後ろ髪: 'BackHair', もみあげ: 'Sideburn', アホ毛: 'Ahoge', 尻尾: 'Tail', しっぽ: 'Tail', 尾: 'Tail', 翼: 'Wing', 羽: 'Wing', 羽根: 'Wing',
  まぶた: 'Eyelid', 瞼: 'Eyelid', お尻: 'Butt', ケツ: 'Butt', 臀部: 'Butt', お腹: 'Belly', 腹: 'Belly', 腹部: 'Belly', 乳首: 'Nipple', バスト: 'Bust',
  上半身2: 'UpperBody2', 上半身３: 'UpperBody3', 下半身: 'LowerBody', 腰キャンセル: 'WaistCancel', 両目: 'Eyes', 舌: 'Tongue', 歯: 'Teeth', 牙: 'Fang',
  ねじり: 'Twist', 捩: 'Twist', 補助: 'Helper', ダミー: 'Dummy', 先: 'End', 親: 'Parent', 全ての親: 'Root', 操作中心: 'ViewCenter', ＩＫ: 'IK', 耳: 'Ear', 袖: 'Sleeve', 裾: 'Hem', マント: 'Cape', コート: 'Coat', リボン: 'Ribbon',
  前: 'Front', 後: 'Back', 横: 'Side',
};

/** Chinese (simplified and traditional) bone words. */
const ZH: Record<string, string> = {
  中心: 'Center', 脊椎: 'Spine', 腰部: 'Waist', 腰: 'Waist', 胸部: 'Chest', 胸: 'Breast', 上身: 'UpperBody', 下身: 'LowerBody', 颈: 'Neck', 頸: 'Neck', 脖子: 'Neck', 头: 'Head', 頭: 'Head', 头部: 'Head',
  肩膀: 'Shoulder', 肩: 'Shoulder', 上臂: 'UpperArm', 手臂: 'Arm', 臂: 'Arm', 肘: 'Elbow', 前臂: 'Forearm', 手腕: 'Wrist', 腕: 'Wrist', 手: 'Hand',
  大腿: 'Thigh', 小腿: 'Calf', 膝: 'Knee', 脚踝: 'Ankle', 脚: 'Foot', 腳: 'Foot', 脚趾: 'Toe', 拇指: 'Thumb', 食指: 'Index', 中指: 'Middle', 无名指: 'Ring', 無名指: 'Ring', 小指: 'Little',
  乳房: 'Breast', 胸部左: 'BreastL', 臀: 'Butt', 臀部: 'Butt', 屁股: 'Butt', 腹: 'Belly', 肚子: 'Belly', 头发: 'Hair', 頭髮: 'Hair', 发: 'Hair', 髮: 'Hair', 刘海: 'Bangs', 裙: 'Skirt', 裙子: 'Skirt',
  尾巴: 'Tail', 尾: 'Tail', 耳朵: 'Ear', 耳: 'Ear', 翅膀: 'Wing', 翼: 'Wing', 眼: 'Eye', 眼睛: 'Eye', 眼皮: 'Eyelid', 舌头: 'Tongue', 舌: 'Tongue', 牙齿: 'Teeth', 下巴: 'Jaw', 颚: 'Jaw',
  左: 'Left', 右: 'Right', 扭转: 'Twist', 辅助: 'Helper',
};

/** Korean bone words. */
const KO: Record<string, string> = {
  중심: 'Center', 척추: 'Spine', 허리: 'Waist', 가슴: 'Chest', 상체: 'UpperBody', 하체: 'LowerBody', 목: 'Neck', 머리: 'Head', 어깨: 'Shoulder', 위팔: 'UpperArm', 팔: 'Arm', 팔꿈치: 'Elbow', 손목: 'Wrist', 손: 'Hand',
  허벅지: 'Thigh', 다리: 'Leg', 무릎: 'Knee', 발목: 'Ankle', 발: 'Foot', 발가락: 'Toe', 엄지: 'Thumb', 검지: 'Index', 중지: 'Middle', 약지: 'Ring', 소지: 'Little', 새끼: 'Little',
  유방: 'Breast', 엉덩이: 'Butt', 골반: 'Pelvis', 배: 'Belly', 머리카락: 'Hair', 앞머리: 'Bangs', 뒷머리: 'BackHair', 치마: 'Skirt', 스커트: 'Skirt', 꼬리: 'Tail', 귀: 'Ear', 날개: 'Wing', 눈: 'Eye', 눈꺼풀: 'Eyelid', 혀: 'Tongue', 이빨: 'Teeth', 턱: 'Jaw',
  왼쪽: 'Left', 오른쪽: 'Right', 왼: 'Left', 오른: 'Right', 비틀기: 'Twist', 보조: 'Helper',
};

const SIDE_WORDS = new Map([['左', 'L'], ['右', 'R']]);

/** Longest first, so 上半身2 beats 上半身 and 頭髮 beats 頭. */
const DICT: [string, string][] = Object.entries({ ...(CATS as Record<string, string>), ...ZH, ...KO, ...JA })
  .filter(([k]) => /[^\x00-\x7f]/.test(k))
  .sort((a, b) => b[0].length - a[0].length);
const FIRST_CHARS = new Set(DICT.map(([k]) => k[0]!));

/** Replaces CJK words with English ones (longest match first), keeping the rest. */
export function translate(raw: string): string {
  const s = raw.normalize('NFKC');
  if (!/[^\x00-\x7f]/.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; ) {
    const ch = s[i]!;
    if (FIRST_CHARS.has(ch)) {
      const hit = DICT.find(([k]) => s.startsWith(k, i));
      if (hit) {
        out += ` ${hit[1]} `;
        i += hit[0].length;
        continue;
      }
    }
    out += SIDE_WORDS.has(ch) ? ` ${SIDE_WORDS.get(ch) === 'L' ? 'Left' : 'Right'} ` : ch;
    i++;
  }
  return out;
}

/** Prefixes that name a rig, not a body part. */
const PREFIX = /^(?:mixamorig\d*[:_]?|valvebiped[._]?|bip0*\d*[\s_]?|armature[|:_]?|j_bip_[clr]_|j_sec_[clr]?_?|j_adj_[clr]_|j_|def[-_]|org[-_]|mch[-_]|cc_base_|cf_[jsd]_|cf_|sk_|b_|bn_|jnt_)/i;

export type Side = 'L' | 'R' | null;

export interface NameInfo {
  raw: string;
  /** Lower-case English words, without rig prefixes, side words and numbering. */
  words: string[];
  joined: string;
  side: Side;
  /** A trailing number (Hair_01 → 1), or null. */
  index: number | null;
}

/** Splits a bone name into English words with a side and a number. */
export function nameInfo(raw: string): NameInfo {
  let n = translate(raw).replace(/^.*[:|]/, '');
  // VRoid: J_Sec_L_Bust1, J_Bip_R_UpperArm: the side letter is a word of its own.
  let side: Side = null;
  const vroid = /^j_(?:bip|sec|adj)_([lr])_/i.exec(n);
  if (vroid) side = vroid[1]!.toUpperCase() as Side;
  n = n.replace(PREFIX, '').replace(PREFIX, '');
  // .001 copies, " (1)" duplicates.
  n = n.replace(/\.\d{3}$/, '').replace(/\s*\(\d+\)$/, '');
  const words = n
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s._\-]+/)
    .filter(Boolean);
  const out: string[] = [];
  let index: number | null = null;
  words.forEach((w, i) => {
    if (w === 'l' || w === 'left') side ??= 'L';
    else if (w === 'r' || w === 'right') side ??= 'R';
    else if (/^\d+$/.test(w)) index = i === words.length - 1 || index === null ? Number(w) : index;
    else out.push(w);
  });
  return { raw, words: out, joined: out.join(''), side, index };
}

/** True when any of the words matches. */
export const hasWord = (info: NameInfo, re: RegExp) => info.words.some((w) => re.test(w)) || re.test(info.joined);
