# 3D import: research (Part 0)

Date: 2026-10-09. Every project was shallow-cloned and read; npm packages were downloaded as tarballs and inspected only (nothing installed or run). Licenses below were verified by reading the LICENSE file and package metadata myself; any mismatch with the README is noted.


## What Everloom takes from this

| Need | Decision |
|---|---|
| Unity YAML | Our own reader (`packages/engine/src/unity/yaml.ts`): 64-bit file ids stay strings; generic YAML libraries lose them. Approach informed by watari-basis (MIT). |
| `.unitypackage` | Our own streaming tar reader with limits (`unity/tar.ts`); paths are only names, never written to disk (the safety rule of Cobertos' extractor, MIT). |
| Component identity | Known script GUIDs (table from watari-basis, MIT) **and** recognition by serialized fields, so unknown SDK versions still work. |
| PhysBone → springs | Formulas from UniVRMExtensions (MIT): stiffness from pull, damping from spring, gravity scaled; tuned to Everloom's solver. |
| lilToon | three-liltoon (MIT, lazy chunk) where it works; otherwise Everloom's toon material from the main texture, shadow colour and outline. |
| Bone names | Our own tables, seeded from the original Cats plugin's MIT dictionaries (`armature_bones.py`, `dictionary.json`); Chinese and Korean words written by us (BoneForge and Avatar-Toolkit are GPL: reference only). |
| `.blend` | The Blender worker stays the main path; a TypeScript SDNA reader modelled on lukebitts/blend (MIT) is the experimental no-Blender path. |
| `.7z` / `.rar` | libarchive.js (MIT, libarchive BSD-2), lazy-loaded. |
| `.psd` | ag-psd (MIT). |
| `.clip` | A reader modelled on clipfile-rs (MIT): the embedded SQLite and its layers. |
| MMD | The vendored MMDLoader (MIT) until @takahirox/three-mmd is published. |

## 0. What Everloom already has (fit check)

- `apps/web`: `three ^0.186.1`, `@types/three ^0.186.0`, `@pixiv/three-vrm ^3.5.5`, `vite ^8`.
- `apps/server`: `fflate ^0.8.3`, `yauzl`/`yazl` (zip), `sharp`, `ktx2-encoder`, `meshoptimizer`, `@gltf-transform/* ^4.5.1`, `better-sqlite3-multiple-ciphers` (useful for the SQLite inside .clip files on the server side).
- No YAML parser is a direct dependency. `js-yaml` shows up only in `desktop/package-lock.json`, pulled in by electron-builder.
- MMD is already vendored: `apps/web/src/features/avatar3d/runtime/vendor/{MMDLoader.js, MMDToonShader.js, mmdparser.module.js}` with `LICENSE.three.txt` and `LICENSE.mmd-parser.txt` (both MIT).
- Server-side Blender worker (`apps/server/src/services/blender.ts`) currently converts FBX/PMX/PMD/OBJ/DAE/.blend and FBX/BVH/VMD motions.
- three 0.186 `examples/jsm/loaders` has **TGALoader, DDSLoader, KTX2Loader, KTXLoader, BVHLoader, ColladaLoader (+ `collada/` dir), FBXLoader, TIFFLoader, EXRLoader**. It has **no MMDLoader** (removed in r172). KTX2Loader is already used in `tools/avatars/ktx2-worker.mjs`.

---

## 1. .unitypackage extraction

Format (confirmed from both extractors): a gzip-compressed tar. Each top-level dir is `<guid>/`, containing `pathname` (first line = `Assets/...` path), `asset` (the file body; missing for folders), `asset.meta` (the .meta YAML), and optionally `preview.png`. In TS this is fflate `gunzipSync`/streaming `Gunzip` plus a ~60-line ustar reader. Keep the `asset.meta` (it carries the guid→path map and the importer settings).

### Cobertos/unitypackage_extractor
- URL: https://github.com/Cobertos/unitypackage_extractor (last commit 2021-10-04)
- What: Python CLI (`unitypackage_extractor/extractor.py`, ~60 lines). Uses `tarsafe`, reads `pathname`, rejects outputs outside the output dir, and replaces Windows-reserved chars `[>:"|?*]` with `_`. Drops `asset.meta`.
- License: **MIT**, `LICENSE.txt`, "Copyright 2018 Peter Fornari / "Cobertos"".
- Recommendation: **reuse (MIT, keep notice)**, though there is very little code. Reimplement in TS and keep its two safety rules (path containment check and reserved-char sanitising). Also keep `.meta`, which it throws away.

### ShinuToki/unitypackage_extractor
- URL: https://github.com/ShinuToki/unitypackage_extractor (last commit 2025-11-29)
- What: Rust port of the Cobertos tool (`src/main.rs`, 162 lines). Uses flate2+tar, with the same `pathname`→`asset` move, `path-clean` traversal check, and Windows char regex.
- License: **none**. There is no LICENSE file and `Cargo.toml` has no `license` field. The README only says "This project is open-source. Feel free to modify and distribute it." That is not a license grant, and the README contradicts the missing license.
- Recommendation: **reference only (no license)**. It adds nothing over Cobertos.

### Newer option: @natsuneko-laboratory/unitypackage (npm 1.1.1, 2025-09-08)
- License: **MIT** (`LICENSE`, "Copyright (c) 2022 Natsune Mochizuki"). TS, Node-only (deps `tar`, `normalize-path`).
- Note: `src/extract.ts` joins `pathname` onto root with **no containment check**. A malicious package can write outside the output dir. It also needs a temp dir on disk.
- Recommendation: **not useful as a dependency**. Write our own in-memory extractor using fflate. `src/meta.ts` is a fine small reference for reading `folderAsset`.

### K0lb3/UnityPy
- URL: https://github.com/K0lb3/UnityPy (last commit 2026-10-05, very active)
- What: Python reader for *binary* Unity serialized files and AssetBundles (TypeTree, Mesh/Texture2D decode via `texture2ddecoder`, etc.). This matters when a unitypackage has binary-serialized assets (Force Binary projects) rather than YAML, or for `.asset`/`.mesh` binaries.
- License: **MIT**, `LICENSE`, "Copyright (c) 2019-2026 K0lb3". pyproject agrees.
- Useful bits:
  - `UnityPy/enums/ClassIDType.py`: the authoritative class-ID table (used in section 6).
  - `UnityPy/classes/generated.py`: serialized field names for every class (Material `m_SavedProperties`, Mesh layout, etc.).
  - `UnityPy/helpers/MeshHelper.py` and `UnityPy/export/MeshExporter.py`: how to decode Unity `Mesh` vertex streams (needed if a package ships `.mesh`/`.asset` meshes instead of FBX).
  - `helpers/TypeTreeHelper.py`: binary layout reader.
- Recommendation: **reuse (MIT, keep notice)** for porting specific algorithms (Mesh vertex-stream decode, class IDs). Do not run it. Binary-serialized support can be a later phase, since most BOOTH packages are text YAML + FBX.

---

## 2. lilToon materials

### mochiya-labs/three-liltoon (`@mochiya/three-liltoon` 0.1.4 on npm, 2026-09-20)
- URL: https://github.com/mochiya-labs/three-liltoon (last commit 2026-09-19)
- What: an unofficial lilToon port for three.js WebGL2. Upstream lilToon ShaderLab/HLSL is compiled via DXC → SPIR-V → SPIRV-Cross → GLSL ES at build time. The runtime package ships prebuilt (`dist/` ≈2.6 MB, main chunk 2.0 MB). Peers: `three >=0.180 <0.190` (fits our 0.186) and optional `@pixiv/three-vrm >=3.4 <4` (fits 3.5.5). Includes `GLTFLilToonExtension` (`MOCHIYA_materials_liltoon`), `LilToonMaterialLoader` (standalone JSON), and `enableLilToonVRM`. WebGPU is not supported.
- License: **MIT**, `LICENSE`, "Copyright (c) 2026 Mochiya". `package.json` says MIT. `THIRD_PARTY_NOTICES.md` carries lilToon's MIT ("Copyright (c) 2020-2024 lilxyzw") plus lilToon's own notices (Unlit_WF_ShaderSuite MIT, GTAvaCrypt, ...). The npm tarball includes `dist/THIRD_PARTY_NOTICES.md`. README and LICENSE agree.
- What it maps (docs/MATERIAL_FORMAT.md):
  - **Property keys are the original lilToon names.** Examples: `_Color, _MainTex, _BumpMap, _UseBumpMap, _UseShadow, _ShadowColor, _ShadowColorTex, _ShadowBorder, _ShadowStrength, _Shadow2ndColor, _UseMatCap, _MatCapTex, _UseEmission, _EmissionMap, _EmissionColor, _UseRim, _RimColor, _OutlineColor, _OutlineTex, _OutlineWidth, _Main2ndTex, _UseMain2ndTex, _AlphaMask, _AlphaMaskMode, _Cutoff, _Cull, _ZWrite, _SrcBlend, _TransparentMode`. 588 distinct `_Xxx` names appear in `dist/`. Texture transforms use `<name>_ST`.
  - Standalone JSON shape: `{ specVersion, lilToonVersion, renderMode, transparencyMode?, properties: {name: number|bool|number[]}, textures: {name: id} }`.
  - `renderMode` ∈ `opaque | cutout | transparent | refraction | refraction-blur | fur | fur-cutout | fur-two-pass | gem`. `transparencyMode` ∈ `normal | one-pass | two-pass`. In glTF it is inferred from the Unity shader name (`src/loaders/GLTFLilToonExtension.ts`: contains "refractionblur"/"furcutout"/"furtwopass"/"refraction"/ends "fur"/ends "gem"/contains "cutout"; /OnePassTransparent/, /TwoPassTransparent/). It warns on `furonly|tessellation|liltoonlite|liltoonmulti`.
  - **Colors are expected linear.** Unity `.mat` `m_Colors` are stored as authored (gamma), so convert sRGB→linear for colour properties when building from a `.mat`.
- How to use it for us: a Unity `.mat` (`m_SavedProperties.m_TexEnvs / m_Floats / m_Ints / m_Colors`) maps almost 1:1 onto its `properties`/`textures` dicts. The missing piece is **shader guid → lilToon variant name**: `.mat` `m_Shader` is `{fileID: 4800000, guid: <lilToon .shader.meta guid>, type: 3}`. Harvest those guids from the upstream lilToon repo's `.shader.meta` files (lilxyzw/lilToon, MIT). They are not contained in three-liltoon.
- Recommendation: **reuse (MIT, keep notice + THIRD_PARTY_NOTICES)**. Add it as an npm dependency, lazy-loaded only when a lilToon material is present (2 MB chunk). Fallback: MToon/MeshStandard from `_Color/_MainTex`.

---

## 3. VRChat / VRM component conversion

### yuna0x0/watari-basis (the best single reference)
- URL: https://github.com/yuna0x0/watari-basis (last commit 2026-10-07)
- What: a Unity editor package that converts VRChat/VRM avatars to Basis by **reading prefab YAML directly without the VRChat SDK**. That is exactly our situation. Includes a focused Unity-YAML scanner (`Editor/Sources/UnityYamlScanner.cs`, `UnityYamlDocument.cs`, `UnityYamlBlock.cs`, `UnityYamlValues.cs`), prefab override resolution (`PrefabOverrides.cs`, `PrefabObjectResolver.cs`), readers for PhysBone/DynamicBone/VRM/ModularAvatar/VRCFury/AnimatorController/AnimationClip, and well-written research notes in `agent/research/*.md`.
- License: **MIT**, `LICENSE`, "Copyright (c) 2026 yuna0x0". README agrees and adds a Basis trademark note.
- Reuse specifics:
  - `Editor/Sources/KnownScriptIdentities.cs`: the **(guid, fileID) → component table** (copied in section 6.3).
  - `agent/research/vrchat-serialized-formats.md`: PhysBone/Collider field order, enums, the "empty curve = 1.0" trap, the `(version, integrationType)` keying, the hex-blob `eyelidsBlendshapes`, `AnimLayerType` ordering (Base=0, Deprecated0=1, Additive=2, Gesture=3, Action=4, FX=5, Sitting=6, TPose=7, IKPose=8), VRC constraint 16 inline slots + `overflowList`, and prefab override paths (`Array.data[i]`, `Array.size`, `managedReferences[rid].field`).
  - `agent/research/physbone-to-jiggle-mapping.md`: parameter mapping with confidence ratings and capsule-height conversion (VRChat height is end-to-end, so cap centres are at `±max(0, h/2 − r)` along `rotation * up`).
  - `agent/research/vrm-spring-bones.md`: UniVRM 0.x/1.0 serialized field names and guids.
  - `Tests/Editor/Fixtures/`: small MIT-licensed `.prefab/.mat/.anim/.controller/.asset/.meta` fixtures (SampleAvatar, SampleClothing, PrefabVariant, stripped docs, VRCFury, a binary prefab). These are good seeds for our parser tests.
- Recommendation: **reuse (MIT, keep notice)**. Port the scanner approach and the identity table to TS.

### esperecyan/UniVRMExtensions
- URL: https://github.com/esperecyan/UniVRMExtensions (last commit 2025-01-04; package `jp.pokemori.univrm-extensions` 10.4.0)
- What: Unity editor tools, including **SwayingObjects**: VRMSpringBone ⇄ VRCPhysBone and VRMSpringBone ⇄ DynamicBone conversion.
- License: **MIT**, `LICENSE.md`, "MIT License © 2020 100の人" (100の人 = esperecyan). `package.json` `"license": "MIT"`.
- Reuse specifics (`SwayingObjects/`):
  - `VRCPhysBonesToVRMSpringBonesConverter.cs` `DefaultParametersConverter`: `stiffnessForce = pull * 4`, `dragForce = spring`, `gravityPower = gravity * 20`. Capsule colliders become 3 spheres at `position ± rotation*(0, (height − 2r)/2, 0)`. Plane colliders are not convertible. Radius is rescaled via lossy-scale distance.
  - `VRMSpringBonesToVRCPhysBonesConverter.cs` (inverse): `pull = stiffnessForce/4`, `spring = dragForce`, `stiffness = 0`, `gravity = gravityPower/20`, `immobileType = World`, `immobile = 1`, `version = 1.0`.
  - `VRCPhysBoneParameters.cs`: field set `Pull, PullCurve, Spring, SpringCurve, Stiffness, StiffnessCurve, Gravity, GravityCurve, GravityFalloff, GravityFalloffCurve, ImmobileType, Immobile, ImmobileCurve, GrabMovement, MaxStretch, MaxStretchCurve`.
  - Note the disagreement: esperecyan maps `spring` → VRM `dragForce` directly, while watari treats spring as the *inverse* of drag (`lerp(0.6, 0.05, spring)`). We should tune against real avatars. esperecyan's formula is the established one for the VRM spring-bone target that three-vrm uses.
- Recommendation: **reuse (MIT, keep notice)**. Use its formulas for PhysBone → `VRMC_springBone` (three-vrm) conversion.

### esperecyan/VRMConverterForVRChat
- URL: https://github.com/esperecyan/VRMConverterForVRChat (last commit 2025-01-22; package 41.5.2)
- What: converts VRM prefab → VRChat avatar and VRChat → VRM, plus mesh merge.
- License: **MPL-2.0**. `LICENSE.md` is the full MPL 2.0 text and `package.json` says `MPL-2.0`. No per-file copyright headers; the author is 100の人 per package.json.
- Useful: `Editor/Components/BlendShapeReplacer.cs` has VRChat viseme (`vrc.v_sil, v_pp, v_ff, v_th, v_dd, v_kk, v_ch, v_ss, v_nn, v_rr, v_aa, v_e, v_ih, v_oh, v_ou`) ↔ VRM A/I/U/E/O weight recipes. `VRChatToVRM/VRChatExpressionsReplacer.cs` turns `blendShape.*` animation bindings into VRM expressions.
- Recommendation: **reference only** (MPL-2.0 is weak file-level copyleft; copying code means keeping those files MPL). Re-deriving the viseme weight table is easy.

### FACS01-01/PhysBone-to-DynamicBone
- URL: https://github.com/FACS01-01/PhysBone-to-DynamicBone (last commit 2022-08-13)
- What: a Unity editor script (`FACS01 Utilities/Editor/PhysBonesToDynBones.cs`, 443 lines) that reverts PhysBone → DynamicBone. Mappings: `m_Elasticity = pull`, `m_Inert = immobile`, `m_Damping = 1 − spring` (with curve inversion), radius rescaled by lossyScale ratio, and gravity/force split via gravityFalloff.
- License: **none**. No LICENSE file, and the README makes no claim.
- Recommendation: **reference only (no license)**. Do not copy. Low value for us since we don't target DynamicBone.

---

## 4. Bone-name dictionaries / auto-mapping

### teamneoneko/Cats-Blender-Plugin (and its real code)
- URL given: https://github.com/teamneoneko/Cats-Blender-Plugin. The default branch is a **stub** (README + LICENSE + .gitmodules only, last commit 2026-02-07). Code lives on branch `Blender-5x` (cloned as `Cats-5x`, last commit 2026-01-24). The README says it is "no longer maintained".
- License on teamneoneko: `LICENSE` is **GPL-3.0** text, **but** `blender_manifest.toml` says `license = ["SPDX:MIT"]` and source headers say `# MIT License / Copyright (c) 2017 GiveMeAllYourCats`. This is a conflict. The code descends from the original MIT Cats.
- Original MIT upstream: https://github.com/absolute-quantum/cats-blender-plugin (cloned as `Cats-original`, last commit 2022-01-24). `LICENSE` is **MIT, "Copyright (c) 2017 GiveMeAllYourCats"**, and the file headers agree.
- Dictionary files (identical in both, 2294 vs 2287 lines):
  - `tools/armature_bones.py`: Python `OrderedDict`s. `bone_rename['Hips'|'Spine'|'Chest'|'Upper Chest'|'Neck'|'Head'|'\Left shoulder'|'\Left arm'|'\Left elbow'|'\Left wrist'|'\Left leg'|'\Left knee'|'\Left ankle'|'\Left toe'|'Eye_\L'|'Breast_\L'] = [aliases...]`, plus `bone_reweight`, `bone_list_parenting`, `bone_finger_list`, `bone_list_weight` (Rigify/DEF_* → finger names), `dont_delete_these_bones`, `bone_list_conflicting_names`. Aliases are **romanised/English after normalisation**. The rules in the header comment: capitalise, `-`/space → `_`, strip `ValveBiped_`, `Bip01_`→`Bip_`, `_Bone`; `\Left`/`\L` are side placeholders. Covers MMD-romaji (`J_Kosi`, `Kosi`), Mixamo, Valve, VRoid `J_Bip_*`, DAZ, Unreal, Rigify, etc.
  - `resources/dictionary.json`: **flat JSON object, JP → EN, 881 entries (882 in 5x), ~23 KB**. Contains MMD bone words (`上半身→UpperBody`, `下半身→LowerBody`, `頭→Head`, `首→Neck`, `センター→Center`, `腕→Arm`, `ひじ→Elbow`, `足首→Ankle`, …), plus clothing/colour/shape-key words. Cats translates by longest-substring replacement with this dict, then normalises, then looks up `bone_rename`.
  - `resources/translations.csv` (original) / `resources/translations/` (5x): UI strings only. Not useful.
  - No Chinese or Korean entries (0 hangul in either).
- Recommendation: **reuse (MIT, keep notice) from the original absolute-quantum repo** for `armature_bones.py` aliases and `dictionary.json`. Convert them to a JSON/TS table at build time. Treat the teamneoneko fork as **reference only** because of its GPL-3 LICENSE file.

### teamneoneko/Avatar-Toolkit
- URL: https://github.com/teamneoneko/Avatar-Toolkit (last commit 2025-12-21)
- License: **GPL-3.0**. `LICENSE` is the GPL-3 text with no named holder. `blender_manifest.toml` says `SPDX:GPL-3.0-or-later`, and file header `# GPL Licence`. Consistent.
- Dictionaries:
  - `core/dictionaries.py` (1113 lines): `bone_names = {standard_name: [simplified aliases]}`. Aliases are lowercased with spaces/`_`/`.` removed (`simplify_bonename`). They include Japanese directly, e.g. `"右肩", "肩.r", "右腕", "ik_腕.r"`: ~22 kana + 96 kanji-only strings, no Korean. Also `standard_bones`, `bone_hierarchy`, `finger_hierarchy`, `acceptable_bone_names`, `rigify_unity_names`, `non_standard_mappings`, `resonite_translations`, `reverse_bone_lookup`. Header says the names came "from triazo/immersive_scaler" and "Tuxedo/Cats".
  - `core/enhanced_dictionaries.py` (371 lines): `shapekey_names`, `material_names`, `object_names`, `physics_names` (alias lists).
  - `core/mmd/translations.py`: an MMD Tools copy ("Copyright 2016 MMD Tools authors", GPL-3) with `jp_half_to_full_tuples`, `jp_to_en_tuples`.
- Recommendation: **reference only (GPL)**. Its idea of a pre-simplified alias table with direct Japanese aliases is good to copy *as a design*.

### Axleonex/BoneForge_ALTERNATIVE_CATS_for_5.0_Blender
- URL: https://github.com/Axleonex/BoneForge_ALTERNATIVE_CATS_for_5.0_Blender (last commit 2026-09-29)
- License: **GPL-2.0** text in `LICENSE`. The README says "GPL v2.0 or later". No holder is named in LICENSE; the repo owner is Axleonex. The README says it was "built with heavy AI assistance". The repo also commits release zips under `releases/`.
- Dictionaries (the only CJK+Korean set found):
  - `boneforge/vrchat/cats/translate.py`: Python dicts `JAPANESE_TO_ENGLISH` (93), `CHINESE_TO_ENGLISH` (92, e.g. `中心/脊椎/腰部/胸部/上身/下身`), `KOREAN_TO_ENGLISH` (100, e.g. `중심/척추/허리/가슴/상체/하체/엉덩이/골반`), plus PT/ES/FR (~120 each). Language is auto-detected by Unicode range.
  - `boneforge/mmd/bone_names.py`: `_MMD_TO_UNITY` (70 entries, e.g. `左親指０ → LeftThumbProximal`).
  - `boneforge/vrchat/humanoid/mapper.py`: Unity humanoid slot lists (`REQUIRED_SLOTS`, …).
  - `boneforge/vrm/springbone_convert.py`: a VRM spring → PhysBone preset (pull 0.2, spring 0.4, stiffness 0.2 …).
- Recommendation: **reference only (GPL)**. The tables are small (~100 entries each). Build our own CN/KR word lists independently (MMD standard bone names in Simplified Chinese and Korean are public vocabulary); do not copy the files.

### Bone-mapping plan implied by the above
1. Normalise: NFKC (full-width → half-width, which handles `０`→`0`), lowercase, strip `_ . - space`, strip known prefixes (`mixamorig`, `valvebiped`, `bip01`, `j_bip_`, `def-`, `cf_`).
2. Side detection: `左/右`, `L/R`, `.l/.r`, `_l/_r`, `left/right`, `왼/오른`(KR), `左/右` (CN shares kanji).
3. Translate CJK tokens via our own JP/CN/KR → EN token dict. Seed JP from Cats `dictionary.json` (MIT).
4. Look up an alias table (seeded from Cats `armature_bones.py`, MIT).
5. Fall back to topology heuristics (hips = root of the 3-way branch, etc.).
6. If a `.fbx.meta` carries `humanDescription.human`, **use it first**: it is the authoritative mapping (section 6.4).

---

## 5. .blend reading without Blender

| Project | Lang | License (verified) | Last activity | Blender versions | Verdict |
|---|---|---|---|---|---|
| lukebitts/blend (crate `blend` 0.9.0) https://github.com/lukebitts/blend | Rust | **MIT**, `LICENSE` "Copyright 2019 Lucas Bittencourt de Souza"; Cargo `license = "MIT"` | 2026-07-29 | 0.9 added Blender 5.0/5.1 (17-byte header, 64-bit BHead). **No compressed-file support** (`CompressedFileNotSupported`; gzip/zstd must be decompressed first) | **reuse (MIT)** as the reference for SDNA parsing across versions; port to TS or compile to WASM |
| blend-rs (crate 0.3.0, kKdH / Elmar Schug) | Rust | **Apache-2.0 per Cargo.toml only**; no LICENSE file in the crate tarball; repo `github.com/kKdH/blend-rs` not reachable (clone asked for credentials) | 2022-12-23 | Code-generated per-version structs (`build.rs`, `gen/`), old versions only | **not useful** (stale, version-locked). Note: no LICENSE text shipped |
| acweathersby/js.blend https://github.com/acweathersby/js.blend | JS | **MIT**, `license.md` "Copyright (c) 2020 Anthony C, Weathersby"; package.json MIT | 2025-09-16 (CNAME only; code is old) | Reads legacy `mpoly/mloop/mvert` only, so pre-3.x meshes. No armature or skin weights; ~1400 lines | **reference only in practice** (MIT allows reuse, but the mesh path is obsolete) |
| chinedufn/landon https://github.com/chinedufn/landon | Rust + Blender Python | **MIT per Cargo.toml / README** ("(c) 2017 Chinedu Francis Nwafili" in `crates/iks-to-fks/README.md`); **no LICENSE file at repo root** | 2022-03-26 | Needs Blender installed (exports via Blender addon scripts) | **not useful** (doesn't read .blend itself) |
| jsblender (npm 0.0.4, 2026-05-20) | TS | `package.json` MIT; **no LICENSE file, no repository field** | 2026-05 | **Blender 5+ only** (AttributeStorage); zstd via `fzstd`; meshes, UVs, vcols, materials, objects, armatures, dverts. README: "Heavily vibe-coded … Not recommended for anything important" | **not useful as a dependency** (no license text, Blender 5 only, self-described as unreliable). Interesting as a reference for the Blender 5 AttributeStorage layout |
| @threepipe/plugin-blend-importer 0.1.0 | TS | Apache-2.0 (package.json); fork of js.blend | 2025-09-03 | same legacy limits as js.blend | **not useful** |

- convert3d.org: **could not be checked**. The HTTPS fetch failed (TLS `SSL_ERROR_SYSCALL` on the apex domain; expired certificate on `www.`), and I did not bypass TLS. A web search turned up no source repository for it. Everything open-source found for .blend → glTF either runs real Blender (e.g. RuairidhWilliamson/blend_converter needs Blender installed) or is one of the partial parsers above. **No open-source in-browser .blend → glTF converter that handles modern avatar files (3.x–5.x meshes + armature + weights + shape keys) was found.**
- Practical recommendation: keep the server-side Blender worker as the primary path. For a no-Blender path, write a TS SDNA reader modelled on lukebitts/blend (MIT), with fflate-gzip/fzstd decompression. Handle three mesh eras: legacy `mvert/mpoly` (<3.4), 3.4–4.x attribute layers in `CustomData` (`position`, `.corner_vert`, `poly_offset_indices`), and 5.x `AttributeStorage`. Also handle `MDeformVert` weights and `Key/KeyBlock` shape keys. This is a significant but well-bounded project.

---

## 6. Unity YAML / .meta facts we need

### 6.1 Class IDs (from `UnityPy/UnityPy/enums/ClassIDType.py`)

| Class | ID | Notes |
|---|---|---|
| GameObject | 1 | |
| Transform | 4 | RectTransform = 224 |
| Camera / Light | 20 / 108 | |
| Material | 21 | `.mat` main object fileID 2100000 |
| MeshRenderer | 23 | |
| Texture2D | 28 | importer sub-asset fileID 2800000 |
| MeshFilter | 33 | |
| Mesh | 43 | FBX legacy sub-asset IDs 4300000+n |
| Shader | 48 | `.shader` ref fileID 4800000 |
| AnimationClip | 74 | `.anim` main fileID 7400000 |
| Avatar | 90 | |
| AnimatorController | 91 | `.controller` main fileID 9100000 |
| Animator | 95 | |
| MonoBehaviour | 114 | ScriptableObject `.asset` main fileID 11400000 |
| MonoScript | 115 | loose-script `m_Script` fileID 11500000 |
| SkinnedMeshRenderer | 137 | |
| BlendTree | 206 | |
| AnimatorOverrideController | 221 | |
| AvatarMask | 319 | |
| PrefabInstance | 1001 | (pre-2018.3 this ID was "Prefab") |
| AnimatorStateTransition / AnimatorState | 1101 / 1102 | |
| AnimatorStateMachine | 1107 | |
| AnimatorTransition | 1109 | |

### 6.2 Document / reference syntax (confirmed in the watari fixtures)
- Header lines `%YAML 1.1` and `%TAG !u! tag:unity3d.com,2011:`, then documents `--- !u!<classID> &<fileID>` with optional trailing ` stripped` (a placeholder for an object that lives in a source prefab). Watari regex: `^--- !u!(?<class>\d+) &(?<file>-?\d+)(?<stripped>\s+stripped)?\s*$`.
- **fileIDs are signed int64 and often exceed 2^53.** A generic YAML parser (`yaml`, `js-yaml`) will lose precision. Parse IDs as strings/BigInt. Watari uses a dedicated line scanner rather than a general parser. **Recommendation: write a focused TS scanner** (header split, then a small indentation parser for maps/seqs/inline `{}` flow maps), not js-yaml.
- Refs: `{fileID: N}` (same file); `{fileID: N, guid: G, type: T}` (other asset). `type: 2` = native Unity asset (.mat/.anim/.controller/.prefab), `type: 3` = importer-produced asset (FBX sub-mesh, texture, DLL script), `type: 0` = built-in (e.g. guid `0000000000000000f000000000000000`).
- PrefabInstance: `m_SourcePrefab: {fileID: 100100000, guid: G, type: 3}` and `m_Modification.m_Modifications: [- target: {fileID, guid, type}, propertyPath, value, objectReference]`. Also `m_RemovedComponents`, `m_RemovedGameObjects`, `m_AddedGameObjects`, `m_AddedComponents`. Property paths: dotted names, `Array.data[i]`, `Array.size`, `managedReferences[rid].field`.
- Material: `m_Shader: {fileID, guid, type}` and `m_SavedProperties: {serializedVersion: 3, m_TexEnvs: [- _MainTex: {m_Texture: {fileID, guid, type}, m_Scale, m_Offset}], m_Ints: [], m_Floats: [- _X: v], m_Colors: [- _Color: {r,g,b,a}]}`, plus `m_ValidKeywords`, `m_CustomRenderQueue`.
- .meta: `fileFormatVersion: 2`, `guid: <32 hex>`, then an importer block. Seen: `ModelImporter` (fbx/obj), `PrefabImporter`, `TextScriptImporter`, `DefaultImporter` (`folderAsset: yes` for dirs). Also expect `NativeFormatImporter` (with `mainObjectFileID`) and `TextureImporter`. Newer ModelImporter has `internalIDToNameTable: [- first: {<classID>: <int64 id>}, second: <name>]`. Older ones use `fileIDToRecycleName`.

### 6.3 How `m_Script` identifies VRChat / Modular Avatar / VRM components
Key = **(guid, fileID)**. Loose `.cs` scripts always have `fileID: 11500000` and their own guid. DLL types (the VRChat SDK) share the assembly guid with `fileID = first 4 bytes LE of MD4("s\0\0\0" + namespace + name)`. Source: `watari-basis/.../Editor/Sources/KnownScriptIdentities.cs` (MIT), read from SDK 3.10.3/3.10.5 assets.

| Component | guid | fileID |
|---|---|---|
| VRCPhysBone | 2a2c05204084d904aa4945ccff20d8e5 | 1661641543 |
| VRCPhysBoneCollider | 2a2c05204084d904aa4945ccff20d8e5 | -1631200402 |
| VRCAvatarDescriptor | 67cc4cb7839cd3741b63733d5adf0442 | 542108242 |
| VRCExpressionsMenu | 67cc4cb7839cd3741b63733d5adf0442 | -340790334 |
| VRCExpressionParameters | 67cc4cb7839cd3741b63733d5adf0442 | -1506855854 |
| VRCHeadChop | 67cc4cb7839cd3741b63733d5adf0442 | -1888410255 (derived) |
| VRCSpatialAudioSource | 67cc4cb7839cd3741b63733d5adf0442 | 1610797297 |
| VRCRaycast / VRCImpostorSettings / VRCImpostorEnvironment | 67cc4cb7839cd3741b63733d5adf0442 | 1472509199 / 798808286 / 306702890 |
| PipelineManager | 4ecd63eff847044b68db9453ce219299 | -1427037861 |
| VRCPosition/Rotation/Aim Constraint | 58e2f01a24261a14cb82e6d3399e8b16 | 1116338486 / 1788371120 / -926596935 |
| VRCParent/Scale/LookAt Constraint (derived) | 58e2f01a24261a14cb82e6d3399e8b16 | 575728033 / 41250163 / -372946275 |
| VRCContactReceiver / Sender | 80f1b8067b0760e4bb45023bc2e9de66 | -1450912254 / -802764141 |
| VRCPerPlatformOverrides / Accessory… | 45da21a324e147228aaee066e399bff0 / 8a12ddb63afae28468db699a7e0cb228 | 11500000 |
| DynamicBone / Collider / PlaneCollider | f9ac8d30c6a0d9642a11e5be4c440740 / baedd976e12657241bf7ff2d1c685342 / 4e535bdf3689369408cc4d078260ef6a | 11500000 |
| **MA Merge Armature** | 2df373bf91cf30b4bbd495e11cb1a2ec | 11500000 |
| MA Bone Proxy | 42581d8044b64899834d3d515ab3a144 | 11500000 |
| MA Mesh Settings | 560fdafd46c74b2db6422fdf0e7f2363 | 11500000 |
| MA Blendshape Sync | 6fd7cab7d93b403280f2f9da978d8a4f | 11500000 |
| MA Parameters | 71a96d4ea0c344f39e277d82035bf9bd | 11500000 |
| MA Move To / Replace Object / Scale Adjuster | 4e6bb6a99e499d2489ccf296662fa3cd / 7e949680c0864ee7b441d9b2c93b890b / 09a660aa9d4e47d992adcac5a05dd808 | 11500000 |
| MA Outfit Root | 1895bf16884f4064f8e9550e7493c205 | 11500000 |
| MA Menu Item / Menu Installer / Menu Group / Install Target | 3b29d45007c5493d926d2cd45a489529 / 7ef83cb0c23d4d7c9d41021e544a1978 / 97e46a47dd8a425eb4ce9411defe313d / 1fad1419b52a42ae89b0df52eb861e47 | 11500000 |
| MA Merge Animator / Merge Blend Tree | 1bb122659f724ebf85fe095ac02dc339 / 229dd561ca024a6588e388160921a70f | 11500000 |
| MA Object Toggle / Shape Changer / Material Setter / Material Swap | a162bb8ec7e24a5abcf457887f1df3fa / 2db441f589c3407bb6fb5f02ff8ab541 / 0adf335711644e34b6c635e94ae61fa7 / b259b73280ead4e4fbbdafc5e29175d1 | 11500000 |
| (more MA: Mesh Cutter, vertex filters, Floor Adjuster, PB Blocker, Visible Head Accessory, World Fixed, etc.: see the file) | | |
| VRCFury component / build marker | d9e94e501a2d4c95bff3d5601013d923 / 19d6be1140c9472cbc89e515ffd74126 | 11500000 |
| VRMSpringBone / ColliderGroup (VRM 0.x) | 00ea06e1753e16f4ca870c39c067c86b / 646b65a4a57afd34d8c4ed557efb46a5 | 11500000 |
| VRMMeta / BlendShapeProxy / FirstPerson (0.x) | 690ea0146224b8b4694a1925dddeb352 / 5b678c1df50cfb547990db24a32856da / dedba1309bdf12b42af2362f52eea134 | 11500000 |
| Vrm10Instance / SpringBoneJoint / Collider / ColliderGroup | bfba4ccd3f854e64f868ce83553071a9 / 0a942e03b39600e41a1b161e958048f7 / 35bfb658269b2af478e501de243deda6 / 177ea458e237fee41b0902e3006c744b | 11500000 |

GUIDs are stable in practice but not a contract. Report unknown identities rather than silently dropping them, as watari does.

**VRCPhysBone fields** (in serialized order, per watari): editor `foldout_*` noise first, then `version` (0 = 1.0, 1 = 1.1), `integrationType` (0 Simplified / 1 Advanced), `rootTransform`, `ignoreTransforms`, `endpointPosition`, `multiChildType` (0 Ignore/1 First/2 Average), `pull`(+Curve), `spring`(+Curve), `stiffness`(+Curve), `gravity`(+Curve), `gravityFalloff`(+Curve), `immobileType` (0 AllMotion/1 World), `immobile`(+Curve), `allowCollision`, `collisionFilter`, `radius`(+Curve), `colliders`, `limitType` (0 None/1 Angle/2 Hinge/3 Polar), `maxAngleX`(+Curve), `maxAngleZ`(+Curve), `limitRotation`, `limitRotationX/Y/ZCurve`, `allowGrabbing`, `grabFilter`, `allowPosing`, `poseFilter`, `snapToHand`, `grabMovement`, `maxStretch`(+Curve), `maxSquish`(+Curve), `stretchMotion`(+Curve), `isAnimated`, `resetWhenDisabled`, `parameter`, `showGizmos`, `boneOpacity`, `limitOpacity`. **Empty curve `m_Curve: []` means constant 1.0.**
**VRCPhysBoneCollider**: `rootTransform`, `shapeType` (0 Sphere/1 Capsule/2 Plane), `insideBounds`, `radius`, `height` (end-to-end), `position`, `rotation`, `bonesAsSpheres`; since SDK 3.10.4 also `globalCollision*`.

### 6.4 `humanDescription.human` in `.fbx.meta`
Under `ModelImporter:` you find `animationType` (0 None, 1 Legacy, 2 Generic, 3 Humanoid) and `avatarSetup` (0 none, 1 create from this model, 2 copy from other). Then:
```yaml
  humanDescription:
    serializedVersion: 3
    human:
    - boneName: <transform name in the FBX>
      humanName: <Unity HumanTrait name, e.g. Hips, LeftUpperArm, Left Thumb Proximal>
      limit: {min: {...}, max: {...}, value: {...}, length: 0, modified: 0}
    skeleton:
    - name: <transform>; parentName: <transform>; position/rotation/scale: {...}
    armTwist/foreArmTwist/upperLegTwist/legTwist/armStretch/legStretch/feetSpacing/globalScale
    rootMotionBoneName, hasTranslationDoF, hasExtraRoot, skeletonHasParents
```
The `humanDescription:` / `serializedVersion: 3` / `human:` / `skeleton:` structure and `animationType`/`avatarSetup` were confirmed in `watari-basis/.../Fixtures/SampleModel.obj.meta`; that fixture has `human: []` (generic rig). The `boneName`/`humanName`/`limit` entry shape and the HumanTrait names with spaces for fingers (`Left Index Proximal`, …) come from Unity knowledge and should be checked against a real humanoid FBX .meta from a BOOTH package. When present, this mapping beats any dictionary guess. Map `humanName` → VRM humanoid names (`LeftUpperArm` → `leftUpperArm`, `Left Thumb Proximal` → `leftThumbMetacarpal` in VRM 1.0 / `leftThumbProximal` in 0.x, `UpperChest` → `upperChest`, `Jaw`, `LeftEye`, …).

### 6.5 Animation / controller essentials
- `.anim` (74): `m_RotationCurves`, `m_CompressedRotationCurves`, `m_EulerCurves`, `m_PositionCurves`, `m_ScaleCurves`, `m_FloatCurves` (e.g. `attribute: blendShape.<name>`, `path: Body`, `classID: 137`; humanoid muscle curves use `classID: 95` with muscle names), `m_PPtrCurves`, `m_SampleRate`, `m_AnimationClipSettings`, `m_EditorCurves`.
- `.controller` (91): `m_AnimatorParameters`, `m_AnimatorLayers[].m_StateMachine {fileID}`. The machines (1107), states (1102), transitions (1101/1109) and blend trees (206) are separate documents in the same file. Watari's `FxControllerReader.cs` / `AnimationClipReader.cs` show a working reader.
- For VRChat FX layers, `VRCAvatarDescriptor.baseAnimationLayers[].type` uses the corrected enum in section 3.

### JS Unity YAML parser options
- `unity-yaml-parser` (npm 0.1.7, MIT, 2024-03): a thin wrapper over `yaml` that loses int64 precision. **Not useful.**
- `@inxep/unityimporter` (npm 0.1.0, MIT): a C# Unity UPM package published to npm, not JS. **Not useful.**
- **Recommendation:** write our own scanner, porting watari's approach (MIT).

---

## 7. Clip Studio `.clip`

Format (from all three): container `CSFCHUNK` → `CHNKHead` → many `CHNKExta` (external blobs keyed by a 40-byte ID) → `CHNKSQLi` (**an embedded SQLite DB** holding all metadata) → `CHNKFoot`. Key tables: `Canvas`, `Layer` (tree via `CanvasRootFolder`, `LayerFirstChildIndex`, `LayerNextIndex`), `Mipmap`/`MipmapInfo`, `Offscreen` (tile attributes + `BlockData` external id), `ExternalChunk`, `ExternalTableAndColumnName`, and **`CanvasPreview` (`ImageData` = a ready PNG)**. Raster tiles are 256×256, zlib, 5 channels: 65536 bytes alpha, then interleaved B,G,R,x. Mask tiles are 1 channel. Blocks are wrapped in UTF-16BE `BlockDataBeginChunk`/`BlockDataEndChunk` labels. Sparse tiles are allowed.
- Cheapest useful feature: extract `CanvasPreview` PNG. Server side we already have `better-sqlite3-multiple-ciphers`; in the browser we would need sql.js (WASM, MIT).

| Project | License (verified) | Last activity | Notes | Verdict |
|---|---|---|---|---|
| Aodaruma/clipfile-rs (crate `clipfile` 1.1.0) https://github.com/Aodaruma/clipfile-rs | **MIT**, `LICENSE` "Copyright (c) 2026 Aodaruma"; Cargo `license = "MIT"` | 2026-08-04 | Most complete: strict chunk validation, `CanvasPreview` PNG, raster decode (RGBA/gray/gray-alpha), vectors, text, corrections, animation, write support. `docs/format-analysis.md` (Japanese) is an excellent spec | **reuse (MIT, keep notice)**: port the reader logic to TS, or compile to WASM |
| LavenderSnek/clipdecode https://github.com/LavenderSnek/clipdecode | **LGPL-2.1**, `LICENSE.txt`; no `license` field in Cargo.toml | 2025-12-04 | Smaller Rust parser; `SPEC.md` is a short spec | **reference only** (LGPL; avoid copying code) |
| dobrokot/clip_to_psd https://github.com/dobrokot/clip_to_psd | **MIT**, `LICENSE`, "Copyright (c) 2024" with **no holder name** (blank); the repo owner is dobrokot | 2024-07-05 | 3142-line single Python script, stdlib only (sqlite3, zlib). Converts to PSD including text, fills, masks, blend modes | **reuse (MIT, keep notice)** as reference for layer-property and blend-mode mapping |

---

## 8. Archives (.7z, .rar) and other formats

| Package | Version / date | License (verified) | Pure JS / WASM | Notes | Verdict |
|---|---|---|---|---|---|
| **libarchive.js** (nika-begiashvili) | 2.0.2 / 2024-01-27 | **MIT** `LICENSE` "Copyright (c) 2018 ნიკა"; libarchive itself is BSD-2 | WASM (1.0 MB) + Web Worker; Node entry `dist/libarchive-node.mjs` | ZIP, **7z**, **RAR4, RAR5**, TAR, gz/bz2/lzma. libarchive's RAR reader is a clean-room BSD implementation (no unRAR licence) | **reuse (MIT/BSD)**: best single option for .7z + .rar in browser and Node |
| libarchive-wasm (ofk) | 1.2.0 / 2025-03-15 | package.json MIT; **no LICENSE file in tarball** | WASM | same formats, simpler API | backup option; add a notice manually |
| node-unrar-js | 2.0.2 / 2023-11-28 | **MIT** wrapper (`LICENSE.md` "Copyright (c) 2017 Jianrong Yu"), **but the WASM is compiled from RARLAB unrar 6.1.7**, which carries the unRAR freeware licence (cannot be used to re-create RAR compression) | WASM (204 KB) | RAR only | acceptable for RAR, but prefer libarchive.js |
| 7z-wasm | 1.2.0 / 2025-06-23 | **LGPL-2.1+ with the unRAR restriction** (`License.txt`, `unRarLicense.txt`); package.json says "SEE LICENSE IN License.txt" | WASM (1.65 MB) | full 7-Zip | **reference only / avoid** (LGPL + unRAR) |
| archive-wasm (spacedrive) | 2.1.0 | **GPL-3.0-or-later** | WASM | | **avoid** |
| 7zip-min, node-7z | | MIT / ISC | native 7za binaries | need native binaries | not useful (not pure JS) |
| **ag-psd** | 31.0.3 / 2026-10-07 | **MIT** `LICENSE` "Copyright (c) 2016 Agamnentzar" | pure JS (deps pako, base64-js) | full PSD read/write with layers | **reuse (MIT)** for PSD textures |
| @webtoon/psd | 0.4.0 / 2023 | MIT | pure TS | read only, stale | fallback |
| psd / psd.js | | none / UNLICENSED | | | avoid |
| **@takahirox/three-mmd** (GitHub `takahirox/three-mmd-loader`, cloned, last commit 2026-10-10) | 0.1.0, **not yet on npm** | **MIT** `LICENSE` "Copyright © 2010-2024 three.js authors" | JS | MMDLoader/AnimationHelper/OutlineEffect restored from r171, targets **three r186**, depends on `mmd-parser ^1.1.4` (MIT, updated 2026-10-08) | **reuse (MIT)**: the official successor; switch from our vendored copy once it is published |
| @moeru/three-mmd | 0.2.0-beta.2 / 2026-09-05 | MIT `LICENSE.md` (three.js authors + "Copyright (c) 2025 Moeru AI") | TS, peer three ≥0.184 | MMD/VMD/VPD loaders, IK, grants, pluggable physics | alternative (beta) |
| @yohawing/three-mmd-loader | 0.8.4 / 2026-09-20 | MIT `LICENSE` "Copyright (c) 2026 yohawing" | TS, peer three ≥0.176 | PMX/PMD/VMD/VPD + PMM/.x/VAC parsers; 6 MB unpacked | alternative |
| three-mmd-loader (old) | 0.0.11 / 2017 | MIT | | | stale, skip |
| three `examples/jsm/loaders` (0.186.1, installed) | | MIT | JS | **TGALoader, DDSLoader, KTX2Loader (+ Basis transcoder), BVHLoader, ColladaLoader (DAE), FBXLoader, TIFFLoader** all present | **reuse**: already a dependency. DAE and BVH can move from the Blender worker to the browser |
| bvh-parser | 1.0.0 / 2018 | MIT | | | unnecessary (three has BVHLoader) |
| yaml / js-yaml | 2.9.1 ISC / 5.4.3 MIT | | pure JS | int64 fileIDs lose precision | not recommended for Unity YAML |

Other notes:
- `.unitypackage` itself only needs fflate (already a server dependency; add it to web).
- Zip already works via yauzl (server); `@zip.js/zip.js` (BSD-3) would cover the browser if needed.

---

## 9. Summary of license verdicts

- **Reuse (keep notice):** Cobertos extractor (MIT), UnityPy (MIT), three-liltoon (MIT + lilToon MIT notices), watari-basis (MIT), UniVRMExtensions (MIT), original Cats absolute-quantum (MIT: `tools/armature_bones.py`, `resources/dictionary.json`), lukebitts/blend (MIT), js.blend (MIT, obsolete), clipfile-rs (MIT), clip_to_psd (MIT, no holder named), libarchive.js (MIT/BSD), ag-psd (MIT), @takahirox/three-mmd (MIT), three examples (MIT).
- **Reference only:** VRMConverterForVRChat (MPL-2.0), Avatar-Toolkit (GPL-3), BoneForge (GPL-2.0+), teamneoneko Cats fork (GPL-3 LICENSE vs MIT manifest/headers; use the MIT original instead), clipdecode (LGPL-2.1), 7z-wasm (LGPL + unRAR), ShinuToki extractor (no license), PhysBone-to-DynamicBone (no license).
- **Not useful:** landon (needs Blender, no LICENSE file), blend-rs (stale, Cargo-only Apache-2.0, repo unreachable), jsblender (no LICENSE file, Blender 5 only, self-described unreliable), unity-yaml-parser, @inxep/unityimporter, @natsuneko-laboratory/unitypackage (no path-traversal guard).
- **Unverified:** convert3d.org (site unreachable over TLS; no source found).
