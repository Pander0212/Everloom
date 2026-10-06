# 3D characters

Everloom can show characters as 3D models on the story stage, alongside sprites and Live2D. This
page is the **Everloom avatar spec**: what a model file needs, what Everloom stores beside it, how
models are imported and prepared, and how they move, emote and dress.

3D is a feature switch (Settings › Features › 3D characters, part of the Story preset; off in
Classic). With it off, or with "Show pictures instead of 3D" on for a device, no 3D code or file is
downloaded: the 3D screens and the three.js runtime live in their own `3d-*` chunks that nothing else
imports and the service worker never precaches.

## The model file

The native format is a **plain GLB** (glTF 2.0, binary). Everything Everloom adds lives beside it in
the avatar's settings, so the file stays usable in any other tool.

| | Needed | Notes |
|---|---|---|
| Skeleton | For movement | Any naming (Mixamo, Rigify, Unreal, VRoid, MMD, Blender defaults, VRM); see *Bones* |
| Skinned meshes | Yes | Up to 4 weights per vertex (glTF's limit) |
| Morph targets | For a moving face | Named shapes (`extras.targetNames`); see *Face* |
| Materials | | Metal/rough PBR; turned into toon shading for the anime look |
| Textures | | Embedded (no outside files) |
| Facing | | Any: models built facing away are turned automatically |
| Units | | Any: sizes that make no sense for a person are fitted, and you set the real height |

**Also accepted:** VRM 0.x and 1.0 (kept as written: their expressions, spring bones and MToon
materials are used as authored), and through Blender (optional): FBX, PMX/PMD (with the MMD Tools
add-on), OBJ and DAE.

### Budgets

For two characters at 30 fps on a mid-range phone:

| | Budget | Over it |
|---|---|---|
| Triangles | 60,000 per character (150,000 hard) | Phones use the lighter copy |
| Texture size | 2048 px | Scaled down |
| Texture memory | 96 MB before compression | KTX2 keeps it compressed on the GPU |
| Materials | 24 | Each is a draw call |
| Bones | 256 | Some phones can't skin more |
| File | 40 MB | |

The import report lists anything over budget.

## What Everloom stores beside the file

`AvatarConfig` (`packages/engine/src/avatar/config.ts`, validated on every save):

| Field | Meaning |
|---|---|
| `boneMap` | Canonical bone → the file's bone name |
| `expressionMap` | Canonical expression → morphs (or `vrm:<expression>`) and weights |
| `look` | `auto` (toon for VRM and flat-coloured models, PBR for textured realistic ones), `toon`, `pbr` |
| `outlines`, `outlineWidth` | The ink line of the toon look |
| `scale`, `floor`, `facing` | File units to metres; feet to the floor; turn in 90° steps |
| `physics` | Hair and cloth springs: on/off, stiffness and gravity multipliers |
| `parts` | Wardrobe level 2: meshes that can be shown or hidden, the body regions they cover, a group (hairstyles replace each other), items that put them on |
| `outfits` | Wardrobe level 1: a set of parts, or a whole other model with the same skeleton; items that pick it; one can be the default |
| `accessories` | Small models on a bone (a sword in the right hand) with position, rotation, size, and items that show them |
| `body` | The meshes that are skin (covered regions are hidden so skin never pokes through) |

The model files themselves are media (`kind` `model`, `model-low`, `model-source`), so the vault
encrypts them and backups include them.

## Import

Characters › menu › **3D avatars** › Import. The server:

1. recognises the file by its bytes (never by its name) and keeps the original;
2. converts FBX, PMX/PMD, OBJ and DAE through the Blender worker (see below);
3. inspects it: skeleton, morphs, VRM expressions, cost, units, warnings;
4. maps bones and the face automatically;
5. optimizes it in a worker thread:
   - **GLB**: duplicates and unused data removed, textures resized and compressed to **KTX2** (stays
     compressed on the graphics card; WebP when KTX2 can't be made in time), geometry compressed
     with **meshopt**;
   - **VRM**: only the texture bytes change (a general glTF library would drop the VRM extensions);
   - and a **lighter copy** for phones (half the triangles, 512 px textures).

The wizard then walks through:

- **Check**: T-pose, arms up, squat and "right hand up" poses show at a glance whether the bones are
  right; play emotes, expressions and talking.
- **Bones**: every canonical bone with the file's bones to choose from (required ones marked).
- **Face**: each expression, mouth shape and blink, with the shapes that make it; tap the eye to
  see it on the model.
- **Fit**: height in metres, floor, facing, look, outlines, physics.
- **Wardrobe**: the dressing room (below).
- **Optimize**: largest texture, KTX2 on or off, how simple the phone copy is; sizes before and after.
- **Details**: name, picture (taken from the preview), which characters use it.

## Bones

The canonical skeleton uses VRM 1.0's humanoid bone names (55 bones; 15 required: hips, spine, head,
both upper arms, forearms, hands, thighs, shins and feet). Automatic mapping reads the hierarchy as
well as the names: hands and feet by name, limbs by walking up from them (skipping twist and helper
bones), the hips where a leg meets the spine, the upper chest where the arms meet. It knows Mixamo,
Rigify (`DEF-`/`ORG-`), Unreal, VRoid (`J_Bip_*`), MMD (`左腕` …), Bip01, and plain Blender names.

Animations are stored once, for the canonical skeleton, and **retargeted** to each model when it
loads: every limb is first brought to a corrected T-pose, so A-poses, odd rest poses and twist
bones don't matter; hips movement is scaled by leg length so feet don't slide.

## Face

Canonical expressions: the emotions (`neutral`, `joy`, `amusement`, `love`, `surprise`, `sadness`,
`anger`, `fear`, `embarrassment`, `confusion`, `curiosity`, `disgust`, `pride`, `relief`,
`nervousness`), the mouth shapes `aa ih ou ee oh` and `jawOpen`, and `blink`, `blinkLeft`,
`blinkRight`. Automatic mapping knows VRM, VRoid (`Fcl_*`), VRChat (`vrc.v_*`), MMD (`あ`, `まばたき`…)
and ARKit blend shapes (expressions are mixed from several). Missing expressions fall back to a
similar one; talking uses the jaw when there are no mouth shapes.

**Lip-sync** follows the voice when one plays (the same audio tap as Live2D: formant bands pick the
mouth shape), and a natural cycle while text types out.

## Motion

Every frame: the held pose (idle, sitting, a dance) cross-fades from the last one; talking gestures
play on the upper body while the character speaks (starting somewhere new each line); a one-shot
emote plays on top; then breathing, a weight shift, and head and eyes turning to whoever speaks.

### Emotes

42 built in (`packages/engine/src/avatar/emotes.ts`): idles, talking, feelings, social, poses,
dances and battle moves. The bundled clips are CC0 (Quaternius Universal Animation Library 1 and 2);
the rest are keyframed for Everloom (`tools/avatars/emotes.ts`). Each emote can wear a face (a laugh
looks amused).

Triggers:

- **The story**: `{"type":"avatar.emote","who":"Mira","emote":"wave"}` and
  `{"type":"avatar.pose","who":"Mira","pose":"sit"}` (`null` stands up; `"who":"everyone"` for the
  whole scene). The model is only offered the emotes that are installed, and only when a character
  in the chat has a 3D avatar; names and aliases resolve to ids and anything unknown is dropped.
  Like every op they roll back with swipes.
- **Automatically**: a new line whose mood changed plays the matching emote (amused → laugh); battles
  hold the ready stance and end in victory or defeat.
- **You**: the stage's emote picker, `/emote wave`, `/pose sit` (`/pose stand` to stop).
- **Scripts**: `everloom.avatar.emote(who, emote)` and `.pose(who, pose)` with the `avatar` permission.

**Dances** follow the music: the playing track's tempo is estimated from the audio (only with 3D on),
and the dance speeds up or slows down to match (halving or doubling to stay natural). Characters
doing the same dance stay on the same step.

### Your own motions

Settings › 3D characters › Motion clips › Import: GLB/glTF, VRMA, FBX and BVH are converted in the
browser; VMD (with the PMX it was made for) and FBX files the browser can't read go through Blender.
Preview on the mannequin, name it, choose its kind and whether it loops, and it joins the built-in
emotes everywhere.

## Wardrobe

What a character wears is decided in this order:

1. the outfit the story put them in (`avatar.outfit`, rolls back with swipes);
2. else an outfit their **equipped items** call for (party member equipment);
3. else their default outfit.

Then parts and accessories linked to equipped items go on (a helmet item shows the helmet), parts in
the same group replace each other, and the **body regions** covered by what is on are hidden:
every vertex of a skin mesh belongs to the region of the bone that moves it most (head, neck, chest,
belly, hips, upper arms, forearms, hands, thighs, knees, calves, feet), and a covered region's
triangles are left out.

The **dressing room** (Wardrobe step) edits outfits (tap one to try it on), parts (meshes, group,
regions covered, items), the skin meshes, and accessories (upload a GLB, pick a bone, move, turn,
size).

## Code-made characters

A character can also be **made from a recipe** instead of a file: a small JSON description
(`AvatarRecipeSchema`, `packages/engine/src/avatar/recipe.ts`) of the body (age stage, height,
build, frame, chest, skin), face (eye colour and size, blush), hair (10 styles, colour, length),
top, bottom, shoes, hat and extras (cape, scarf, belt, glasses, earrings, apron). The browser builds
the model in a worker:

- the body is a set of rounded shapes (one per bone) blended into one smooth surface and meshed
  with surface nets; proportions follow the age stage (a child is about 4.8 heads tall);
- clothes are the same body surface grown a little and cut by planes (sleeves, hems, necklines),
  so they always fit; skin under them is removed and they bend with the same weights as the skin;
- skirts, robes, capes and long hair get their own shapes, and hair and capes get bone chains that
  swing;
- the face is drawn on the head: eyes, lashes, brows, mouth and blush, with morph targets for
  blinking, the mouth shapes and every feeling (a laugh closes the eyes into arcs);
- about 45,000 triangles (15,000 on phones), no file to download, built once per look and cached.

**All-ages bodies:** bodies are smooth mannequins with no anatomical detail, everyone wears at least
plain underwear, and child bodies never get a chest shape whatever the recipe says.

**Making one:** Characters › 3D avatars › Make (then edit with live preview), or on a character,
**Make a code-made look**: the utility model fills a recipe in from the description (anything it
returns is checked field by field; what doesn't fit the schema is replaced), and without a model the
description's own words are used (hair, colours, clothes, "old", "little girl"…).

**NPCs:** a character with no picture, Live2D or avatar appears on the stage as a code-made figure
from its description (stable: the same name always gets the same choices). Settings › 3D
characters › *Code-made figures for characters without a picture* turns this off on a device.

## Rendering

- One WebGL canvas for all 3D characters on a stage; sprites and Live2D stay around it.
- **Looks**: toon (MToon: a shading ramp, tinted shadows, rim light, screen-space outlines) and PBR.
- **Light** follows the scene: time of day, weather and indoor places pick studio, day, golden hour,
  night, indoor or overcast light; tone mapping, soft shadows on an invisible floor.
- **Camera**: face, half or full framing; it frames everyone, leans toward the speaker, drifts
  slowly, follows the pose (lower for sitting, from above for lying), and keeps the shot above the
  dialogue box. *Look around* orbits with a drag or pinch.
- **Performance**: quality low/medium/high/automatic per device (automatic steps resolution,
  shadows, outlines and physics down when frames run long, and back up), a 30 or 60 fps cap, 30 fps
  when nothing but breathing moves, rendering paused when the tab or the canvas is out of sight, the
  lighter model on phones.
- **Fallbacks**: no WebGL 2, a model that fails to load, a lost GPU context or pictures-only on the
  device: the character shows as its sprite (or Live2D).

## The Blender worker

Optional. Everloom finds Blender in Settings › 3D characters (a path), `EVERLOOM_BLENDER`, the
`PATH`, or the usual install places (Program Files and Steam on Windows, `/Applications` on macOS,
`/usr/bin`, `/snap`, `/opt` and a portable copy under the data folder on Linux). Jobs run one at a
time in a background Blender with factory settings and auto-run scripts off, in a private temporary
folder that is deleted afterwards, with a time limit and a minimal environment (no keys or tokens).
The file being converted is decrypted into that folder for the run.

## Files

| | |
|---|---|
| `packages/engine/src/avatar/` | skeleton, bone and expression mapping, emotes, config, wardrobe, recipes |
| `apps/server/src/services/avatars/` | GLB reader, inspection, optimization, storage and processing |
| `apps/server/src/blender/worker.py` | the Blender worker script |
| `apps/web/src/features/avatar3d/runtime/` | loading, retargeting, clips, avatar, stage, materials, lighting, wardrobe, import |
| `apps/web/src/features/avatar3d/runtime/codemade/` | code-made characters: shapes, mesher, body, clothes, face, worker |
| `apps/web/src/features/avatar3d/` | the wizard, preview, stage layer, motion importer |
| `apps/web/public/avatar/clips/` | the built-in clips |
| `tools/avatars/` | building the bundled and authored clips |
