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

## Parts maker

Characters › 3D avatars › Make › **From parts**: pick a body, hair, top, bottom, shoes, a hat and
extras from a **part pack**, with a colour for each, in a live preview (emote and expression
buttons, drag to look around). Randomize, undo, duplicate, and download the result as one **GLB**
or **VRM 1.0** file (body and parts merged on one skeleton, in its rest pose).

A saved character keeps the pack's body and its chosen parts as **garments** of the pack's body
family, so it stays editable and the wardrobe works on it: an **equipped item** puts on the part of
the pack it matches (by the item's slot, then the words of its name, description and tags against
each part's id, name and types; "Iron Helmet" finds a helmet), and that rolls back with swipes like
every story change. Parts linked to an item by name in the dressing room take precedence.

**Everloom Basics**, the built-in pack, is made by the code-made generator below
(`tools/avatars/build-starter-pack.ts`, CC0): two bodies with faces, 9 hairstyles, 7 tops, 4
bottoms, 3 kinds of shoes, 7 hats and 4 extras, about 2.6 MB. Settings › 3D characters › Part packs
turns packs on and off, imports new ones and shows each pack's license and credits.

### The pack format

Packs use **CharacterStudio's trait manifest** (https://github.com/M3-org/CharacterStudio), so a
pack made for it works here: a zip with `manifest.json` and the files it names.

```json
{
  "traitsDirectory": "traits",
  "thumbnailsDirectory": "thumbnails",
  "initialTraits": { "BODY": "soft", "HAIR": "short" },
  "requiredTraits": ["BODY"],
  "randomTraits": ["HAIR", "TOP"],
  "traits": [
    { "trait": "BODY", "name": "Body", "collection": [{ "id": "soft", "name": "Soft", "directory": "body/soft.glb", "thumbnail": "body/soft.png", "colorCollection": "SKIN_COLORS" }] },
    { "trait": "HAT", "name": "Hats", "collection": [{ "id": "helmet", "name": "Helmet", "directory": "hat/helmet.glb", "type": ["hides-hair"] }] }
  ],
  "colorCollections": [{ "trait": "SKIN_COLORS", "collection": [{ "id": "s1", "name": "Light", "value": "#f6d7c3" }] }],
  "everloom": { "name": "My pack", "license": "CC-BY 4.0", "credits": "By …", "slots": { "HAT": "head" } }
}
```

- Every part is a **GLB or VRM** rigged to the same skeleton as the bodies (bones are matched by
  name; any naming Everloom maps works). Paths are `traitsDirectory` + `directory`.
- One group is the **body** (`BODY`, `Body`, `Skin` or `Base`, or `everloom.bodyGroup`); a body's
  mesh named `Body` takes the skin colour.
- Each other group is a **wardrobe slot** (hair, head, top, bottom, full, outer, hands, feet, socks,
  underwear), guessed from its name or set in `everloom.slots`.
- `type` tags describe parts for item matching; `hides-<slot>` (e.g. `hides-hair`) hides that slot
  while the part is worn.
- `colorCollections` give the colour choices; any colour can also be picked freely.
- A face that should move needs morph targets named like any model's (`blink`, `aa`, `joy`…; see
  *Face*). A mesh named `face_overlay` is drawn just above the skin.
- Everloom keeps CharacterStudio's other fields (restrictions, culling layers, download options,
  VRM meta) but doesn't use them yet; skin under clothes is not culled, so parts should sit outside
  the body.

Import checks the manifest, that every part exists and really is a GLB/VRM, and refuses the pack
with the reasons (up to eight) otherwise. Every file goes into the media store (the vault encrypts
it). The license shown comes from `everloom.license`, a `LICENSE` file in the zip, or the VRM's own
metadata, and otherwise says it isn't stated.

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

**Upgrading:** a code-made character's menu has *Open in the parts maker*: its hairstyle, clothes,
hat, colours and the closer of the two bodies carry over to the built-in pack.

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

`install.sh` offers to download a portable Blender 4.2 LTS into the data folder (and builds the
container with the few system libraries it needs); the Windows app finds an installed one.

What it does (Settings › 3D characters › Blender lists recent jobs with their logs):

| Job | Where | What |
|---|---|---|
| Convert | Import | FBX, PMX/PMD, OBJ, DAE to GLB; VMD and stubborn FBX motions |
| Clean up | Avatar › Optimize | Merges duplicate points, simplifies meshes over a triangle budget (faces with expressions are left alone), shrinks textures, then prepares the model again |
| Turntable | Avatar › Optimize | Eight views rendered with Cycles on the CPU (no graphics card needed) |
| Fit a garment | Dressing room › Garments | A garment mesh (GLB, OBJ, FBX, DAE) is placed where its slot sits on the body, the parts inside the skin are wrapped just outside it, the skin weights are copied from the nearest body surface, and the body regions it covers are worked out (to hide skin). **Experimental:** close-fitting things work; loose or layered ones come out rough |

Tested here: an FBX round trip of the mannequin keeps all its bones; a plain tube fitted as a top
covers the chest, belly and hips and bends with the body; clean-up of the mannequin to 2,000
triangles; an 8-view turntable in about 6 seconds.

## AI-made props, garments and textures

- **Props** (Dressing room › Accessories › *Make with AI*): from a description or a picture, through a
  **3D models** connection (Settings › Connections): **Meshy** (text or picture; textured), or
  **Hunyuan3D 2** or **TRELLIS** on **fal.ai** (picture only: for a description, the image connection
  draws a reference first). The job runs in the background with progress; the model is cleaned up
  like any import, then *Put it on* attaches it to the right hand (move, turn and size it there) or
  *Discard* deletes it. Rigid things (hats, weapons, bags, jewelry) work well. Tripo's API documents
  couldn't be checked, so it isn't offered.
- **Garments** (same sheet, **experimental**): image-to-3D, then the Blender fit above. Expect rough
  results for anything loose.
- **Textures** (Dressing room › a garment's colours): describe a pattern or fabric; the image
  connection draws a tile, Everloom makes it seamless (blending in a half-shifted copy towards the
  edges, so it repeats without a visible join) and adds it as a variant that repeats 4 times across
  the garment. With an editing model (NanoGPT's Step Image Edit 2), it changes the selected texture
  instead. This is how a few meshes become many items.

Image connections can carry a prompt style (`prompt_prefix`, `prompt_suffix`); the NanoGPT presets
(HiDream, Chroma, Z Image Turbo, Qwen Image, Step Image Edit 2) come with the style each model needs,
from `docs/art/PROMPTING.md`.

## The Blender add-on

`tools/blender-addon/` checks a model against this spec and exports it, or sends it to your
Everloom with a device token: avatars are imported, garments join the chosen avatar's dressing room,
animations wait in Settings › 3D characters › *From Blender*. See its README, and
[blender-ai-workflow.md](blender-ai-workflow.md) for making assets with an AI assistant in Blender.

## Files

| | |
|---|---|
| `packages/engine/src/avatar/` | skeleton, bone and expression mapping, emotes, config, wardrobe, recipes |
| `apps/server/src/services/avatars/` | GLB reader, inspection, optimization, storage and processing |
| `apps/server/src/blender/worker.py` | the Blender worker script (convert, motion, optimize, fit, render) |
| `apps/server/src/services/avatars/model3d.ts`, `textures.ts` | image-to-3D jobs; seamless garment textures |
| `tools/blender-addon/` | the Blender exporter add-on (GPL-3.0) |
| `apps/web/src/features/avatar3d/runtime/` | loading, retargeting, clips, avatar, stage, materials, lighting, wardrobe, import |
| `apps/web/src/features/avatar3d/runtime/codemade/` | code-made characters: shapes, mesher, body, clothes, face, worker |
| `apps/web/src/features/avatar3d/Maker.tsx`, `parts.ts` | the parts maker; packs as garments |
| `apps/web/public/avatar/packs/basics/` | the built-in part pack (generated) |
| `tools/avatars/build-starter-pack.ts`, `glb-writer.ts` | building the built-in pack |
| `apps/web/src/features/avatar3d/` | the wizard, preview, stage layer, motion importer |
| `apps/web/public/avatar/clips/` | the built-in clips |
| `tools/avatars/` | building the bundled and authored clips |
