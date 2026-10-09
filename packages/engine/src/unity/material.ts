/**
 * Unity materials (.mat) as a portable description: which shader family, the main texture and
 * colour, alpha handling, normal map, emission, toon shading colours, outline and rim, read from
 * the property names lilToon, Poiyomi, MToon, Standard and UTS use. The three.js side builds a
 * material from this (lilToon through three-liltoon where possible, else Everloom's toon material).
 */
import { asList, asMap, asNum, asRef, asStr, parseUnityYaml, type UnityRef, type YamlMap } from './yaml';

export type ShaderFamily = 'liltoon' | 'poiyomi' | 'mtoon' | 'uts' | 'standard' | 'unlit' | 'unknown';

export interface TexSlot {
  ref: UnityRef;
  scale: [number, number];
  offset: [number, number];
}

export interface MaterialSpec {
  name: string;
  family: ShaderFamily;
  /** The shader's name when it's a built-in or known by GUID ("lilToon", "Standard"), else its GUID. */
  shader: string;
  /** opaque, cutout (alpha test) or transparent (blended). */
  alpha: 'opaque' | 'cutout' | 'transparent';
  cutoff: number;
  doubleSided: boolean;
  color: [number, number, number, number];
  map?: TexSlot;
  normalMap?: TexSlot;
  normalScale: number;
  emissive?: { color: [number, number, number]; map?: TexSlot };
  /** Toon: the shadow colour (multiplied in shadow) and where shading starts (0–1). */
  shade?: { color: [number, number, number]; map?: TexSlot; border: number };
  outline?: { color: [number, number, number]; width: number };
  rim?: { color: [number, number, number]; power: number };
  matcap?: TexSlot;
  /** Every texture slot, colour and number as written, for three-liltoon and the report. */
  raw: { textures: Record<string, TexSlot>; floats: Record<string, number>; colors: Record<string, [number, number, number, number]>; keywords: string[] };
  /** What couldn't be carried over. */
  notes: string[];
}

/** Built-in shader GUIDs and well-known shader GUIDs by family. */
const BUILTIN = '0000000000000000f000000000000000';
const KNOWN_SHADERS: Record<string, { name: string; family: ShaderFamily }> = {
  // Built-in shaders (guid 0000000000000000f000000000000000) by fileID.
  [`${BUILTIN}:46`]: { name: 'Standard', family: 'standard' },
  [`${BUILTIN}:45`]: { name: 'Standard (Specular setup)', family: 'standard' },
  [`${BUILTIN}:10752`]: { name: 'Unlit/Texture', family: 'unlit' },
  [`${BUILTIN}:10750`]: { name: 'Unlit/Transparent', family: 'unlit' },
  [`${BUILTIN}:10751`]: { name: 'Unlit/Transparent Cutout', family: 'unlit' },
  [`${BUILTIN}:10755`]: { name: 'Unlit/Color', family: 'unlit' },
};

/** Recognises the family from the material's properties when the shader itself isn't in the package. */
export function familyFromProps(floats: Record<string, number>, textures: Record<string, unknown>, keywords: string[], shaderName = ''): ShaderFamily {
  const n = shaderName.toLowerCase();
  if (/liltoon/.test(n)) return 'liltoon';
  if (/poiyomi|\.poiyomi/.test(n)) return 'poiyomi';
  if (/mtoon/.test(n)) return 'mtoon';
  if (/unitychantoon|uts|toon\/toon/.test(n)) return 'uts';
  if (/^standard/.test(n)) return 'standard';
  const has = (k: string) => k in floats || k in textures;
  if (has('_lilToonVersion') || has('_UseShadow') && has('_ShadowBorder') && has('_TransparentMode')) return 'liltoon';
  if (has('_ShadingEnabled') || has('_LightingMode') && has('_MainColorAdjustToggle') || Object.keys(floats).some((k) => /^_?(Poi|poi)/.test(k)) || keywords.some((k) => /POI_/.test(k))) return 'poiyomi';
  if (has('_ShadeColor') && has('_ShadeToony') || has('_ShadeTexture') && has('_OutlineWidthMode')) return 'mtoon';
  if (has('_1st_ShadeColor') || has('_BaseColor_Step')) return 'uts';
  if (has('_Glossiness') && has('_Metallic')) return 'standard';
  return 'unknown';
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Reads a .mat file's text into a spec. Colours stay as authored (sRGB); the renderer converts. */
export function readMaterial(text: string, opts: { shaderNames?: Record<string, string> } = {}): MaterialSpec | null {
  const doc = parseUnityYaml(text).find((d) => d.classId === 21 || d.type === 'Material');
  if (!doc) return null;
  const b = doc.body;
  const props = asMap(b.m_SavedProperties);
  const textures: Record<string, TexSlot> = {};
  for (const e of asList(props.m_TexEnvs).map(asMap)) {
    // Unity writes either "- _MainTex: {...}" (2018+) or "- first: {name: _MainTex} second: {...}" (older).
    const [k, v] = 'first' in e ? [asStr(asMap(e.first).name), asMap(e.second)] : (Object.entries(e)[0] ?? ['', {}]);
    const m = asMap(v as YamlMap);
    const ref = asRef(m.m_Texture);
    if (!k || !ref) continue;
    const sc = asMap(m.m_Scale);
    const of = asMap(m.m_Offset);
    textures[k] = { ref, scale: [asNum(sc.x, 1), asNum(sc.y, 1)], offset: [asNum(of.x), asNum(of.y)] };
  }
  const floats: Record<string, number> = {};
  for (const list of [props.m_Floats, props.m_Ints]) {
    for (const e of asList(list).map(asMap)) {
      const [k, v] = 'first' in e ? [asStr(asMap(e.first).name), e.second] : (Object.entries(e)[0] ?? ['', 0]);
      if (k) floats[k] = asNum(v as never);
    }
  }
  const colors: Record<string, [number, number, number, number]> = {};
  for (const e of asList(props.m_Colors).map(asMap)) {
    const [k, v] = 'first' in e ? [asStr(asMap(e.first).name), e.second] : (Object.entries(e)[0] ?? ['', {}]);
    const c = asMap(v as never);
    if (k) colors[k] = [asNum(c.r, 1), asNum(c.g, 1), asNum(c.b, 1), asNum(c.a, 1)];
  }
  const keywords = [...asStr(b.m_ShaderKeywords).split(/\s+/), ...asList(b.m_ValidKeywords).map((v) => asStr(v))].filter(Boolean);
  const shaderRef = asRef(b.m_Shader);
  const known = shaderRef?.guid ? KNOWN_SHADERS[`${shaderRef.guid}:${shaderRef.fileID}`] : undefined;
  const shaderName = known?.name ?? (shaderRef?.guid ? opts.shaderNames?.[shaderRef.guid] : undefined) ?? '';
  const family = known?.family ?? familyFromProps(floats, textures, keywords, shaderName);
  const notes: string[] = [];
  const f = (k: string, d = 0) => (k in floats ? floats[k]! : d);
  const col = (k: string, d: [number, number, number, number] = [1, 1, 1, 1]) => colors[k] ?? d;
  const rgb = (c: [number, number, number, number]): [number, number, number] => [c[0], c[1], c[2]];

  // Alpha: each family says it differently.
  let alpha: MaterialSpec['alpha'] = 'opaque';
  const queue = asNum(b.m_CustomRenderQueue, -1);
  if (family === 'liltoon') {
    const mode = f('_TransparentMode');
    alpha = mode === 1 ? 'cutout' : mode >= 2 ? 'transparent' : 'opaque';
    if (/cutout/i.test(shaderName)) alpha = 'cutout';
    if (/transparent/i.test(shaderName)) alpha = 'transparent';
  } else if (family === 'poiyomi') {
    const mode = f('_Mode', f('_BlendMode'));
    alpha = mode === 1 ? 'cutout' : mode >= 2 ? 'transparent' : 'opaque';
  } else if (family === 'mtoon') {
    const mode = f('_BlendMode');
    alpha = mode === 1 ? 'cutout' : mode >= 2 ? 'transparent' : 'opaque';
  } else if (family === 'standard') {
    const mode = f('_Mode');
    alpha = mode === 1 ? 'cutout' : mode >= 2 ? 'transparent' : 'opaque';
  }
  if (alpha === 'opaque' && queue >= 3000) alpha = 'transparent';
  else if (alpha === 'opaque' && queue >= 2450 && queue < 3000) alpha = 'cutout';
  if (alpha === 'opaque' && keywords.some((k) => /_ALPHATEST_ON/.test(k))) alpha = 'cutout';
  if (alpha === 'opaque' && keywords.some((k) => /_ALPHABLEND_ON|_ALPHAPREMULTIPLY_ON/.test(k))) alpha = 'transparent';

  const cull = f('_Cull', f('_CullMode', 2));
  const map = textures._MainTex ?? textures._BaseMap ?? textures._MainTexture ?? textures._BaseColorMap;
  const spec: MaterialSpec = {
    name: asStr(b.m_Name) || 'Material',
    family,
    shader: shaderName || (shaderRef?.guid ?? ''),
    alpha,
    cutoff: f('_Cutoff', f('_AlphaClip', 0.5)),
    doubleSided: cull === 0,
    color: col('_Color', col('_BaseColor', col('_MainColor'))),
    map,
    normalMap: textures._BumpMap ?? textures._NormalMap,
    normalScale: f('_BumpScale', 1),
    raw: { textures, floats, colors, keywords },
    notes,
  };
  if (family === 'liltoon' && f('_UseBumpMap', 1) === 0) delete spec.normalMap;

  // Emission.
  const emOn = family === 'liltoon' ? f('_UseEmission') !== 0 : family === 'poiyomi' ? f('_EnableEmission', f('_EmissionEnabled')) !== 0 : keywords.includes('_EMISSION') || 'EmissionColor' in colors || '_EmissionColor' in colors;
  if (emOn && (textures._EmissionMap || colors._EmissionColor)) {
    const c = rgb(col('_EmissionColor', [0, 0, 0, 1]));
    if (c.some((x) => x > 0.001) || textures._EmissionMap) spec.emissive = { color: c, map: textures._EmissionMap };
  }

  // Toon shading.
  if (family === 'liltoon' && f('_UseShadow', 0) !== 0) {
    spec.shade = { color: rgb(col('_ShadowColor', [0.82, 0.76, 0.85, 1])), map: textures._ShadowColorTex, border: f('_ShadowBorder', 0.5) };
  } else if (family === 'mtoon') {
    spec.shade = { color: rgb(col('_ShadeColor', [0.97, 0.81, 0.86, 1])), map: textures._ShadeTexture, border: 0.5 - f('_ShadeShift', 0) * 0.5 };
  } else if (family === 'uts') {
    spec.shade = { color: rgb(col('_1st_ShadeColor', [0.8, 0.8, 0.8, 1])), map: textures._1st_ShadeMap, border: f('_BaseColor_Step', 0.5) };
  } else if (family === 'poiyomi' && f('_ShadingEnabled', 1) !== 0) {
    spec.shade = { color: rgb(col('_ShadowColor', col('_LightingShadowColor', [0.8, 0.8, 0.85, 1]))), map: textures._ShadowColorTex ?? textures._ToonRamp, border: f('_ShadowBorder', f('_LightingShadowStart', 0.5)) };
  }

  // Outline.
  const outlineOn = family === 'liltoon' ? /outline/i.test(shaderName) || f('_OutlineWidth') > 0 && keywords.some((k) => /OUTLINE/i.test(k)) : family === 'poiyomi' ? f('_EnableOutlines', f('_OutlineEnable')) !== 0 : family === 'mtoon' ? f('_OutlineWidthMode') !== 0 : false;
  if (outlineOn) {
    // lilToon's width is in centimetres-ish units (0.08 typical); MToon's in metres (0.002 typical).
    const w = family === 'mtoon' ? f('_OutlineWidth', 0.5) * 0.01 : f('_OutlineWidth', f('_LineWidth', 0.08)) * 0.01;
    spec.outline = { color: rgb(col('_OutlineColor', [0.3, 0.25, 0.25, 1])), width: Math.min(0.02, w) };
  }

  // Rim and matcap.
  if ((family === 'liltoon' && f('_UseRim') !== 0) || (family === 'poiyomi' && f('_EnableRimLighting') !== 0)) spec.rim = { color: rgb(col('_RimColor', [0.66, 0.5, 0.48, 1])), power: f('_RimFresnelPower', f('_RimPower', 3)) };
  if ((family === 'liltoon' && f('_UseMatCap') !== 0) || (family === 'poiyomi' && f('_MatcapEnable') !== 0) || family === 'mtoon') {
    const mc = textures._MatCapTex ?? textures._Matcap ?? textures._SphereAdd;
    if (mc) spec.matcap = mc;
  }

  if (family === 'unknown') notes.push(`Unknown shader${shaderName ? ` (${shaderName})` : ''}: shown with its main texture and toon shading.`);
  if (family === 'poiyomi') notes.push('Poiyomi: main texture, colour, alpha, normal map, emission, shadow colour, rim and outline carried over; its other effects are not.');
  if (family === 'liltoon' && (textures._Main2ndTex || textures._Main3rdTex) && (f('_UseMain2ndTex') || f('_UseMain3rdTex'))) notes.push('lilToon layers 2 and 3 need three-liltoon; without it only the main layer shows.');
  return spec;
}

/** Converts an authored (sRGB) colour to linear for three.js. */
export const linearColor = (c: [number, number, number] | [number, number, number, number]): [number, number, number] => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
