# Everloom Puppets

Animated 2D characters in the spirit of Live2D, in a format of our own: textured parts with
meshes, a tree of deformers, parameters that drive keyforms, pendulum physics, expressions and
motions. Decisions and research: [PHASE2_DECISIONS.md › Everloom Puppets](PHASE2_DECISIONS.md).
Status and what's next: [STATUS.md](../STATUS.md), [art/PUPPET_QUEUE.md](art/PUPPET_QUEUE.md).

Code: `packages/engine/src/puppet/` (format, evaluation, rig, life, physics, meshes, Inochi2D),
`apps/web/src/features/puppets/` (the WebGL player and the lab at `/lab/puppets`),
`tools/puppets/` (placeholder, atlas, cutting), `tools/see-through-worker/` (the GPU layering worker).

## The format (`everloom-puppet`, version 1)

A puppet is one JSON file plus its texture pages (PNG), checked by `parsePuppet` (schema, then
cross-references and keyform sizes). Coordinates are the art's pixels, y down.

| Field | What it holds |
|---|---|
| `id`, `name`, `template`, `rating` | `template` is what parts fit (`everloom-f`, `everloom-m`, `placeholder`); `rating` is `all-ages` or `18+` |
| `canvas`, `anchors` | Art size; `floor`, `eyes`, `headTop`, `centerX` for staging |
| `textures` | Texture page file names (atlases), next to the JSON |
| `params` | `{id, min, max, default, internal?}`: the standard set below plus the template's own |
| `deformers` | `warp` (a rest rectangle split into `cols × rows` cells) or `rotate` (an origin); each may have a parent |
| `parts` | `{id, slot, texture, mesh: {positions, uvs, indices}, parent, z, opacity, blend, masks, color}` |
| `bindings` | Keyforms: `{target, prop, params (1–2), keys, values}`; `prop` is `grid`, `verts`, `angle`, `offset`, `scale`, `opacity` or `z` |
| `physics` | Pendulum chains: inputs (parameters as sideways motion or turning), outputs (parameters), segments, length, gravity, damping, stiffness, limit |
| `expressions` | Emotion → parameter values (defaults exist for Everloom's emotions) |
| `motions` | Parameter tracks of `[time, value]` keys (additive by default) |
| `colors` | Colour group → base colour; the maker recolours by shifting hue, saturation and brightness from it |

**Evaluation** (`PuppetRig`): keyforms interpolate linearly between keys (bilinearly over two
parameters) and hold at the ends; bindings from different parameters on the same target add up
(`scale` and `opacity` multiply). Deformers run parents first: a warp maps a point by where it sits
in its rest rectangle onto its current grid; a rotation turns and scales around its origin, which
follows the parent. Parts then follow their deformer. Draw order is `z` plus bindings, stable.

**Every frame** (`PuppetAnimator`): base pose (the character's own settings, such as body shape) →
expression (eased) → breathing, idle sway, look target → motions (on top) → lip-sync (the voice's
level opens the mouth; vowel weights pick shapes) → clamp → blink (multiplies eye openness) →
physics (writes its outputs) → evaluate.

**Drawing** (`PuppetRenderer`, WebGL 2): one canvas for everyone on stage; visible parts go into one
dynamic buffer and consecutive parts with the same texture, blend and mask are one draw call; masks
use the stencil buffer; textures are premultiplied; colour groups are recoloured in the shader.
Quality sets the pixel ratio (low 1, medium 1.5, high 2); 30 fps when only breathing; paused when
the tab or canvas is hidden.

## Parameters

Standard (every template; story, life and lip-sync use them): `AngleX`, `AngleY`, `AngleZ` (±30),
`BodyAngleX`, `BodyAngleZ` (±10), `Breath`, `EyeLOpen`, `EyeROpen`, `EyeSmile`, `EyeBallX`,
`EyeBallY`, `BrowY`, `BrowAngle`, `MouthOpen`, `MouthForm`, `Cheek`, `MouthA`/`I`/`U`/`E`/`O`, and
body shape `Bust`, `Waist`, `Hips`, `Thighs`, `Shoulders`, `Build` (−1…1, clamped to where they
still look right). The template adds `ArmLPose`, `ArmRPose` (swap the arm drawings), `ArmWave`, and
internal physics outputs `HairFront`, `HairSide`, `HairBack`, `BustY`, `ArmLSwing`, `ArmRSwing`.
The ±30 of `AngleX`/`AngleY` maps to 20° and 14° of real turn (the art's limit).

Motions built in: `nod`, `shake`, `tilt`, `surprise`, `laugh`, `wave`, `flinch`, `lean`.

## The part schema (both templates)

Back to front. "Deformer" is what moves the slot; "depth" is its distance in front of the face's
surface for head-turn parallax. An option after a colon (`arm.r:raised`) is one of several drawings
for a slot; the first is the resting one.

| Slot | z | Deformer | Depth | Mask | Colour | What |
|---|---|---|---|---|---|---|
| `hair.back` | 0 | hairBack | −0.55 | | hair | Hair behind the head and body |
| `acc.back` | 2 | body | | | | Capes, wings |
| `body` | 10 | body | | | skin | Body and neck (the 18+ pack swaps it) |
| `underwear` | 11 | body | | | | Removable only in adult mode |
| `legwear`, `shoes` | 12–13 | body | | | cloth3 | |
| `bottom` | 14 | body | | | cloth2 | Trousers, skirts |
| `top` | 16 | body | | | cloth1 | Shirts, blouses, dresses |
| `outer` | 18 | body | | | cloth4 | Jackets, coats |
| `acc.body` | 19 | body | | | | Belts, bags, necklaces |
| `arm.l`, `arm.r` | 20 | armL / armR | | | skin | Arm drawings per pose (relaxed, hip, raised) |
| `sleeve.l`, `sleeve.r` | 21 | armL / armR | | | cloth1 | The top's sleeves per pose |
| `face` | 30 | face | 0 | | skin | Face and ears, with the eyes shut and mouth closed drawn in |
| `eye.*.white` | 32 | eyeL / eyeR | 0.02 | | | Eye whites (mask the iris) |
| `eye.*.iris` | 33 | eyeL / eyeR | 0.02 | eye white | eyes | Irises, follow EyeBall |
| `eye.*.lash` | 35 | eyeL / eyeR | 0.03 | | | Lids and lashes, open |
| `eye.*.half`, `.closed`, `.smile` | 36–37 | eyeL / eyeR | 0.03 | | | The eye half shut, shut, smiling |
| `brow.l`, `brow.r` | 38 | browL / browR | 0.05 | | hair | |
| `nose` | 39 | face | 0.12 | | | |
| `mouth.open`, `.wide`, `.smile`, `.i`, `.u`, `.e`, `.o` | 40 | mouth | 0.04 | | | Mouth drawings |
| `blush` | 42 | face | 0.03 | | | Cheek |
| `hair.side` | 44 | hairSide | 0.25 | | hair | Hair beside the face |
| `hair.front` | 46 | hairFront | 0.45 | | hair | Fringe |
| `acc.head` | 48 | hairFront | 0.5 | | | Clips, hats, glasses |

"l" and "r" are the character's own left and right (the picture's right and left).

**Template landmarks** (`TemplateLandmarks`): head centre and radius, top and chin; each eye's
centre and half size; brows; mouth; neck; shoulders; chest, waist and hips (height and width); the
bottom of the art. `tools/puppets/cut.py` measures them from the template's edits; every part made
for a template lines up with them.

**The rig** (`buildTemplateRig`): body warp (8×12) with BodyAngleX, BodyAngleZ, Breath, body-shape
and BustY keyforms; a neck rotation (AngleZ, a small move with AngleX); one warp per depth layer
(face, hairFront, hairSide, hairBack) with AngleX × AngleY keyforms from a sphere projection plus
hair sway; eye warps (EyeSmile), brow rotations (BrowY, BrowAngle), the mouth warp (MouthForm,
MouthOpen); shoulder rotations for the arms (swing, wave). Physics: front, side and back hair, the
chest, both arms.

## Making a template or a character

1. **Master image** (docs/art/PROMPTING.md › Puppet templates and parts): front-facing, arms a
   little away from the body, flat green background, 1024x1536 from Z Image Turbo. Then one
   identity edit (Step Image Edit 2) to get the *working master* in the editor's colours.
2. **Layers with See-through** (`tools/see-through-worker`, below): the keyed master (transparent
   background) goes to the worker; it returns up to 23 inpainted layers with draw order and depth.
3. **Map to the schema**: See-through's tags → slots (`front hair` → `hair.front`, `back hair` →
   `hair.back`, `face` + `ears` + `nose` → `face`, `eyewhite` → `eye.*.white`, `irides` →
   `eye.*.iris`, `eyelash` → `eye.*.lash`, `eyebrow` → `brow.*`, `mouth` → the face's closed mouth,
   `neck` + body skin → `body`, `topwear` → `top` and sleeves, `bottomwear` → `bottom`, `handwear`
   → arms, `legwear`, `footwear`, `headwear`/`earwear`/`eyewear` → `acc.head`, `neckwear` →
   `acc.body`, `tail`/`wings` → `acc.back`). Visible pixels come from the master (sharper); only
   hidden areas keep See-through's painted pixels. Left and right are split by the face's centre.
   Body-level parts (arms, legs, top, bottoms, neck) take See-through's own front-to-back order
   as their `z` (10–29) instead of the slot's: one picture has arms behind the top's straps,
   another a waistband over the shirt. Head parts keep the schema's order.
4. **Expressions by edit** (`tools/puppets/edits.sh`, `cut.py`): eyes half shut, shut, smiling;
   mouth shapes; blush; arm poses. Each is cut where it differs from the working master (with one-
   or two-pixel tolerance for line jitter) inside its own region.
5. **Pack it**: atlas pages and meshes (`tools/puppets/atlas.ts`), then `buildTemplateRig`.

## The layering worker (`tools/see-through-worker`)

`server.py` (standard library) serves `GET /health`, `PUT /images/<name>.png`, `POST /run`,
`GET /log`, `GET /result.zip`, all behind a per-session token; `start.sh` installs See-through at a
pinned commit on RunPod's PyTorch 2.8 / CUDA 12.8 image and fetches the weights (about 15 GB). A
watchdog ends the pod after 10 idle minutes or its time limit. `Dockerfile` builds the same thing
for any GPU host (a local machine, SaladCloud).

`session.mjs` runs one batch on RunPod: reads the balance (refuses unless the worst case leaves
$0.50), picks the cheapest free 24 GB card (community, then secure up to $0.60/h) with no paid
storage, uploads, runs, downloads, terminates in `finally`, then checks the account's pod and
volume lists. Every session is in [art/GPU_LEDGER.md](art/GPU_LEDGER.md).

## Inochi2D

`exportInochi(model, pages)` writes an `.inp`/`.inx` Inochi Creator opens; `importInochi(bytes)`
reads one back (docs: PHASE2_DECISIONS.md, and the header of `inochi.ts`, for exactly what is
exchanged). An Everloom puppet round-trips losslessly (it rides along in the `everloom.puppet`
extension); what was changed in Creator comes back as a correction layer. A puppet made in Creator
imports as parts with per-parameter deforms and opacity.

## Packs (format; the builder and installer are not built yet)

A pack is a zip: `manifest.json` (`name`, `version`, `template`, `rating` `all-ages` or `18+`,
`requires` (the base pack for 18+ parts), `parts` (id, slot, file, colour group), `presets`,
`credits`, `licenses`) and the part images or atlases, with `SHA256SUMS` beside it and a short
readme for Discord. Packs are built from the git-ignored `.puppets-work/` folder; generated art
never enters the repository.
