# Import formats

Where each file type is read, what comes in, and what is tested. "Browser" means the file never
leaves the device until the converted GLB is saved; "server Blender" needs Blender on the Everloom
server (Settings › 3D characters › Blender, see [blend.md](blend.md)).

## 3D models (Characters › 3D avatars › Import, or drop)

| Format | Read by | What comes in | Tested with |
|---|---|---|---|
| `.vrm` (0.x and 1.0) | browser (three-vrm) | everything: humanoid map, expressions, springs, look-at, license metadata | Seed-san, Twist, robot-vrm0 (`real-models.spec`) |
| `.glb`, `.gltf` (+ `.bin`, textures) | browser | meshes, skins, morphs, materials, animations | CesiumMan, RiggedFigure, RobotExpressive |
| `.fbx` binary | browser (FBXLoader); old or unusual files through server Blender | meshes, skin, morphs, materials, animations | knight.fbx; Ava.fbx inside the Unity fixtures |
| `.fbx` ASCII | browser (FBXLoader reads ASCII 7.x) | same as binary | not with a real file: Blender only writes binary FBX, and no CC0 ASCII FBX was found |
| `.obj` + `.mtl` | browser | static mesh, materials, textures (TGA/DDS/PSD/KTX2 converted) | robot.obj + robot.mtl from Blender 4.2; with TGA and DDS textures (`formats.spec`) |
| `.dae` (Collada) | browser (ColladaLoader) | meshes, skin, materials | the CC0 test body exported by Blender 4.2 (`formats.spec`) |
| `.pmx`, `.pmd` | browser (MMDLoader) | mesh, bones, morphs, materials (as PBR) | robot.pmx |
| `.blend` (or a zip with the `.blend` and its texture folders) | server Blender | meshes, armature, weights, shape keys, materials; actions listed | Blender 3.6 and 4.2 files, compressed or not ([blend.md](blend.md)) |
| `.unitypackage`, extracted Unity folders (with or without `.meta`), `.prefab` | browser | avatar or outfit, materials, humanoid map, PhysBones, toggles, animations, license notes ([unity.md](unity.md)) | `tests/fixtures/unity` (`unity-import.spec`) |
| `.zip`, `.7z`, `.rar` | browser (libarchive.js, MIT/BSD) | the archive's files, routed as if dropped: a Unity folder goes to the Unity import, a model with its textures to the model import | a 7z with OBJ+MTL, a zip with a DAE in folders, a password-protected 7z (`formats.spec`). RAR: same code path, not tested with a real RAR (no free RAR writer here) |

Guards for archives: at most 20 000 files and 2 GB unpacked, entries that climb out of the archive
(`..`) and macOS litter (`__MACOSX`, `.DS_Store`) are skipped, password-protected archives are
refused with a message.

### Formats that can't be imported (and the message says what to do)

| File | Why | What the message suggests |
|---|---|---|
| `.vrca`, and any Unity asset bundle (`UnityFS` header) | a built VRChat upload: compiled for VRChat, often encrypted | import the avatar's `.unitypackage` from where it was bought |
| `.cs3c`, `.cs3o`, `.cs3s` | Clip Studio 3D files, a closed format | export FBX or OBJ from Clip Studio |
| `.vroid`, `.vroidcustomitem` | VRoid Studio project | export VRM from VRoid Studio |
| `.max`, `.ma`, `.mb`, `.c4d`, `.lwo`, `.skp`, `.3dm`, `.hip`, `.spp`, `.ztl`, `.zpr` | other programs' project files | export FBX, glTF/GLB or OBJ |
| password-protected `.zip`/`.7z`/`.rar` | encrypted | unpack with the password first |

## Motions (Settings › 3D characters › Motion clips › Import)

| Format | Read by | Notes |
|---|---|---|
| `.glb`/`.gltf` with animations, `.vrma` | browser | VRMA names its humanoid bones itself |
| `.fbx` | browser; server Blender for files the browser can't read | Mixamo and others |
| `.bvh` | browser (BVHLoader) | |
| `.vmd` (MMD motion) | browser | with its `.pmx`/`.pmd` for that model's proportions, or alone: a standard MMD skeleton stands in (VMD rotations are relative to bones with no rest rotation). Bones the motion doesn't key stay in MMD's relaxed rest pose. Tested: `wave.vmd` (our own) |
| `.vpd` (MMD pose) | browser | a held pose, looping by default. UTF-8 or Shift-JIS. Tested: `hands-up.vpd` |
| `.blend` actions | server Blender | |
| `.anim` (Unity) alone | — | a Unity clip only plays on the avatar it was made for: the message says to import that avatar's `.unitypackage` (its clips come in with it) or export FBX from Unity |

## Textures (Materials step, and inside models and Unity packages)

| Format | Read by | Notes |
|---|---|---|
| `.png`, `.jpg`, `.webp` | browser | as they are |
| `.tga` | browser (TGALoader) → PNG | |
| `.psd` | browser (ag-psd, MIT) → PNG | the flattened image; a PSD saved without "Maximize compatibility" has none and is refused with that hint |
| `.dds` | browser, own BC1/BC2/BC3 (DXT1/3/5) decoder and uncompressed → PNG | BC4–BC7 and ETC are refused with a message (rare in avatar textures) |
| `.ktx2` | browser (Basis transcoder, drawn into a canvas) → PNG | |

All five converted formats are checked pixel by pixel (colours, orientation, alpha) against the same
picture in `tests/fixtures/textures` (`formats.spec`, made by `tools/avatars/texture-fixtures.ts`).

## 2D drawings for puppets: Clip Studio Paint `.clip` and Photoshop `.psd`

Settings › Puppets › Import takes a layered drawing and makes a rigged puppet from it, the way a
See-through layering result is used (docs/puppets.md).

- **`.clip`** is read on the server by Everloom's own reader (`apps/server/src/services/puppets/clipfile.ts`,
  written from the format notes of clipfile-rs and clip_to_psd, both MIT): the `CSFCHUNK` container,
  its embedded SQLite database (canvas, layer tree, mipmaps) and the 256×256 zlib tiles of each
  layer. Visible raster and vector layers come in (vector layers as Clip Studio rendered them),
  bottom first, with folder names, layer and folder opacity, and enabled layer and folder masks.
  Paper is left out; correction layers are skipped and named in the result. Blend modes, layer
  effects (outlines) and colour-fill layers that keep their colour outside the pixels are not
  reproduced; a puppet doesn't need them.
- **`.psd`** is read with ag-psd: visible pixel layers, groups as folders, opacity.
- **Layer names → parts.** The artist's names are matched to parts in English or Japanese, with
  folders counting: Face/顔, Front hair/前髪, Back hair/後ろ髪 (or a "Back" layer in a "Hair" folder),
  Eye white/白目, Iris/瞳, Eyelash/まつげ, Eyebrow/眉, Mouth/口, Nose/鼻, Ears/耳, Neck/首, Arms/腕,
  Top/Shirt/服, Bottom/Skirt/Pants, Legs/Socks, Shoes/靴, Hat/Ribbon, Glasses, Necklace, Tail,
  Wings. Sides come from the picture, so one "Eye white" layer with both eyes is fine. Without a
  face layer the import stops and says how to name the layers.
- Limits: 400 MB per file, 8192 pixels per side, 300 layers.

Tested with a `.clip` and a `.psd` built in the test from the format notes (layers, a folder, a
mask, an offset layer, a hidden layer, paper) and through the import API into a rigged puppet
(`apps/server/test/clipfile.test.ts`, `puppets.test.ts`), and with four real Clip Studio files
from the clipdecode and clip_to_psd projects (`EVERLOOM_CLIP_DIR=<folder>`; not shipped): every
layer came in, the composite matched Clip Studio's own preview apart from blend modes and effects,
and a blank drawing was refused with its message.

## Making the test files

- `tools/avatars/format-fixtures.py` (Blender 4.2): OBJ+MTL and Collada.
- `tools/avatars/mmd-motion-fixtures.py`: VMD and VPD (Shift-JIS bone names).
- `tools/avatars/texture-fixtures.ts`: TGA, PSD, DDS, KTX2 (and the PNG reference).
- The archives in `tests/fixtures/models/formats` were made with py7zr and Python's zipfile.
