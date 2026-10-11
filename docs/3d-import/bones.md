# Bone mapping for complex rigs

VRChat avatars often have 100–300 bones: spines of 3–5 bones, several chest and breast bones, butt
bones, twist and helper bones, and many hair, skirt and tail chains. Everloom maps all of them.

## The data model (`packages/engine/src/rig/schema.ts`)

- **Humanoid core** (`boneMap`): VRM 1.0's humanoid slots (hips … little-finger distal), one bone
  each, as before.
- **Spine chain** (`rig.spine`): every bone from the hips up to the neck, in order
  (`Spine → Spine1 → Spine2 → Chest → UpperChest`). When an animation bends the spine, the bend of
  each mapped spine bone is shared out over the unmapped ones up to the next mapped bone, so a
  five-bone spine bends smoothly (`apps/web/src/features/avatar3d/runtime/canonical.ts`).
- **Roles** (`rig.roles`): any number of chains per role, each with a side (L, R, middle), a
  confidence and the reason:

  | Role | What it drives |
  |---|---|
  | breast | chest jiggle physics (the chest strength slider), the chest body slider (bone scale) |
  | butt | its own stiff jiggle preset, the butt body slider (bone scale) |
  | belly | a stiffer jiggle preset |
  | thigh / upper-arm / forearm / shoulder helper | follows the next joint by half (twist bones: only its twist) |
  | hair, skirt, coat, tail, ears, wings, accessory | spring chains with that kind's preset |
  | eyelid, tongue, teeth | kept for expressions and look-at; no physics |

- **Ignored** (`rig.ignore`): end bones, IK targets, controls, roots above the hips.
- **Base** (`rig.base`): a known base the skeleton was recognised as.

## The auto-mapper (`packages/engine/src/rig/automap.ts`)

Runs on the server for every model (stored as the default mapping), in the Bones tab ("Map
automatically", with skin-weight footprints), and on the command line:

```
npm run bones:automap -- model.glb [--meta model.fbx.meta] [--out mapping.json]
```

It prints a report (counts per role, the spine chain, what to review) and writes `boneMap` + `rig`
as JSON. Evidence, strongest first; agreeing evidence raises the confidence:

1. **The file's own mapping**: Unity's humanoid map in `.fbx.meta` (Unity packages, `--meta`), VRM
   0.x/1.0 humanoid, VRM spring roots, PhysBone roots.
2. **Known bases** (`rig/presets.ts`, bone-name patterns only): VRoid (`J_Bip_*`, `J_Sec_*_Bust*`,
   `J_Sec_Hair*`), MMD (センター, 上半身, …, D bones, 捩 twist bones), Mixamo, Rigify (`DEF-`, `ORG-`,
   `MCH-`), the Unreal mannequin (`*_twist_*`, `ik_*`), Daz Genesis (`lPectoral`, `*Twist`).
3. **Names** (`rig/names.ts`): English, Japanese (the Cats plugin's MIT dictionary plus our own words:
   胸, おっぱい, 乳, バスト, 尻, お尻, 腰, 髪, スカート, しっぽ, 左/右, 上半身, 下半身…), Chinese (乳房, 臀部, 头发,
   裙…) and Korean (가슴, 엉덩이, 머리카락, 치마…). Prefixes are removed (`J_Bip_C_`, `J_Sec_`, `J_Adj_`,
   `mixamorig:`, `ValveBiped.`, `Bip01`, `Armature|`, `DEF-`…), sides read from `.L`/`_R`/`Left`/左,
   numbering and `.001` copies dropped.
4. **Hierarchy**: what a chain hangs from (a helper under the upper arm is an upper-arm helper; a
   second segment named like its parent follows it), chains split where they branch (one entry per
   hair strand or skirt panel).
5. **Rest-pose geometry**, relative to the body: forward of the chest and to one side → breast;
   behind and below the hips, to one side → butt; a chain behind the hips in the middle → tail; one of
   several chains hanging around the hips → skirt; above the neck → hair; forward of the lower spine →
   belly.
6. **Skin-weight footprint**: where the vertices a bone moves are (used instead of the joint's
   position when known).

Nothing is dropped: every bone ends up mapped, in a role, ignored with a reason, or (under 60%
confidence) flagged for review with the reason. Fingers that a file's own map leaves out are filled
from each finger's chain under the hand.

**Accuracy** is measured on fixture rigs made from names, hierarchy and positions only
(`packages/engine/test/rig-fixtures.ts`): VRoid, MMD, Mixamo, Rigify and three VRChat-style rigs
(English names, Japanese names, and meaningless names where only the geometry can tell), 53–250
bones. The test fails below each rig's floor; the per-role report is in
[evidence/automap-accuracy.json](evidence/automap-accuracy.json) (`AUTOMAP_REPORT=path`).

## The Bones tab

- **Skeleton**: every bone with search and filters (unmapped, to review, humanoid, any role), and
  multi-select. Assign the selection to a role (with a side), the spine chain, a humanoid slot (one
  bone), "Ignore" or "Clear". The spine chain can be reordered. Each row shows what the bone is and
  how sure the mapping is.
- **3D view**: a dot on every bone, coloured by role (the selected one larger and white), the
  selected bone's skin weights as a heat map (what it moves), and tapping near a dot selects that
  bone. On a phone the tree opens in a bottom sheet with large rows.
- **Test poses**: idle, T-pose, A-pose, arms up, squat, a shake (breast and butt physics swing and
  settle), and a walk.
- **Humanoid**: the core slots, one bone each, as before.

## Presets

"Save mapping preset" downloads `boneMap`, `rig` and the physics settings as JSON
(`everloom-rig-map`, version 1); "Import mapping preset" applies one to another avatar with the same
bones. Presets can be shared in packs like any other file.

### Adding a base preset

Add an entry to `BASES` in `packages/engine/src/rig/presets.ts`: an `id`, a `name`, a `match`
(a test on the bone names, e.g. "more than 40% start with `J_Bip_`"), and `role(bone)` returning a
role, `'ignore'` or `null` for the bones its naming makes plain. Bone-name rules only: never any
asset content. Add a fixture rig to `rig-fixtures.ts` with the expected answers and a floor.
