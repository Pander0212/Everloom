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
materials are used as authored), and through Blender (optional): .blend, FBX, PMX/PMD (with the MMD Tools
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

## Checklist for creators

Before you send a model, garment, motion or part pack to Everloom (the Blender add-on runs most of
these checks for you):

**An avatar**

- [ ] One GLB (textures embedded) or VRM 0.x/1.0; FBX, PMX, OBJ and DAE work only through Blender.
- [ ] A skeleton with hips, spine, head, both upper arms and both upper legs (any common naming).
- [ ] Every mesh skinned to that skeleton, at most 4 weights per vertex, weights normalized.
- [ ] Real-world size in metres, feet on the ground, transforms applied (any facing is fine).
- [ ] Under 60,000 triangles (150,000 at most), 24 materials, 256 bones; textures 2048 px or less.
- [ ] For a moving face: blink, the five vowel shapes (aa, ih, ou, ee, oh) and a few emotions as
      morph targets (VRM presets, ARKit's 52, VRoid's `Fcl_*` or MMD names all map).
- [ ] Bodies all-ages: no anatomical detail; underwear or clothes on the base body.
- [ ] You may share it: the license allows redistribution if you put it in a bundle or pack.

**A garment** (wardrobe level 3)

- [ ] Made on the same body as the avatar family it's for (the same skeleton and bone names).
- [ ] Skinned to that skeleton, with the body's weights copied onto it so they bend together.
- [ ] A few millimetres off the skin everywhere; nothing passes through the body in its rest pose.
- [ ] One slot (hair, head, top, bottom, full, outer, hands, feet, socks, underwear); list the body
      regions it covers so the skin under it can hide.
- [ ] For colour variants: a light base colour (variants multiply it) or a texture per variant.

**A motion**

- [ ] FBX, BVH, GLB/VRMA, or VMD zipped with its PMX; one action per file.
- [ ] Starts and ends in a neutral standing pose (one-shots) or loops seamlessly (idles, dances).
- [ ] No root motion that walks off: Everloom keeps characters in place.
- [ ] For a dance, its tempo in BPM, so it can follow the music.

**A part pack** (the parts maker)

- [ ] CharacterStudio's `manifest.json`, every part a full rigged model on the same skeleton.
- [ ] A body trait; other traits mapped to slots (`everloom.slots` if the names aren't obvious).
- [ ] A thumbnail per part; `type` tags such as `hides-hair` where a part covers another.
- [ ] `everloom.license` and `everloom.credits` (or a LICENSE file) that allow sharing.

## What Everloom stores beside the file

`AvatarConfig` (`packages/engine/src/avatar/config.ts`, validated on every save):

| Field | Meaning |
|---|---|
| `boneMap` | Canonical bone → the file's bone name |
| `expressionMap` | Canonical expression → morphs (or `vrm:<expression>`) and weights |
| `look` | `auto` (toon for VRM and flat-coloured models, PBR for textured realistic ones), `toon`, `pbr` |
| `outlines`, `outlineWidth` | The ink line of the toon look |
| `scale`, `floor`, `facing` | File units to metres; feet to the floor; turn in 90° steps |
| `physics` | Hair, cloth and chest springs: on/off, stiffness, gravity, damping, wind, chest motion and strength, extra chains picked by hand, collider edits |
| `morphs` | Body sliders made from the file's morph targets: the mapping (label, group, range, left/right twin, hidden), the values, body presets, and the base's fingerprint (presets carry across characters on the same base) |
| `bodyShape` | Generated adjusters (breast, hips, waist, butt, thighs, shoulders) for bases without those morphs |
| `skinLayers`, `appearance` | Layers painted onto the skin (makeup, paint, tattoos, underwear, swimwear, stockings, scars); skin tone, hair and eye colours |
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

- **Body**: the base model check (in plain words: what the file has, what's missing, which features
  that switches off) and the body sliders; see *Custom bases* below.
- **Skin**: skin tone, hair and eye colours, and skin layers; see *Skin layers* below.
- **Check**: T-pose, arms up, squat and "right hand up" poses show at a glance whether the bones are
  right; play emotes, expressions and talking.
- **Bones**: every canonical bone with the file's bones to choose from (required ones marked).
- **Face**: each expression, mouth shape and blink, with the shapes that make it; tap the eye to
  see it on the model.
- **Fit**: height in metres, floor, facing, look, outlines, physics (springs, chest, colliders).
- **Wardrobe**: the dressing room and clothes fitting (below).
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

### Paired animations

Two to four characters doing something together. Four are built in, keyframed for Everloom (CC0,
`tools/avatars/paired.ts`, compiled by `build-paired.ts` into `public/avatar/clips/paired/`):
**handshake**, **high five**, **hug** and **dance together** (a loop). A paired clip is one ordinary
clip per participant, plus where each stands relative to the others (at 1.7 m tall), which way they
face, and **contacts**: which bones meet and when (hands in a handshake; hands on the other's back in a
hug).

Playing one (`runtime/paired.ts`):

1. The participants step to their spots around where they were standing, spaced for their average
   height, and turn to each other (they look at each other, not the camera). The clip starts when
   they're in place (or after 1.5 s).
2. Every participant's clip runs on **one shared clock**, so dropped frames never put them out of
   step; a one-shot ends together and everyone goes back to the pose they had.
3. **Contacts** use light two-bone inverse kinematics on the arms (or legs): hands meet halfway, in a
   point both arms can reach, wrists a palm apart; a hand on a body goes round to the back on its own
   side with the elbow pointing out. If the arms are too short for the spacing (a short character
   with a tall one), the pair steps closer, never nearer than a chest's depth.
4. Springs keep running (hair and skirts swing as usual).
5. There's no collision between characters beyond the spacing: arms in a hug go round the other's
   back by the contacts, but a swinging skirt or a hand can pass into the other character.

Triggers: the story (`{"type":"avatar.paired","clip":"handshake","who":["Mira","Theo"]}`; `clip:
null` stops a loop; rolls back with swipes; offered to the model only when installed and when the chat
has 3D characters), the emote picker's **Together** row (the selected character and the next one),
`/pair handshake Mira Theo`, and scripts (`everloom.avatar.paired(clip, who)`).

**Importing** (Settings › 3D characters › Paired animations › Import): one motion per participant,
from separate files or one file holding an animation for each (GLB, VRMA, FBX, BVH; retargeted like
single emotes), then how far apart they stand and what meets (right hands, right-to-left, both
hands, a hug). Adult-rated paired clips can only be saved and played in adult mode, and only when
every participant is a confirmed adult character.

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

## Custom bases

Any rigged GLB can be a base: a body that clothes are fitted to and that other characters can be
made from. The [base model guide](base-model-guide.md) says what a good one has.

**The base model check** (Body step) reads the file and says, in plain words, what it has and what
that means: the skeleton (missing required bones; finger bones), skinned meshes, morph targets (body,
face and other), expression shapes, UVs and textures, chest bones, cost. Features the file can't
support are switched off with the reason given (no UVs: no skin layers; no skin weights: no fitting).

**Body sliders** are made from the file's morph targets (`packages/engine/src/avatar/morphs.ts`):

- names are read whatever the convention (`Breast_Large`, `BreastSize`, `breast-big`, `Hips_Wide`,
  `CC_Base_Body.Butt_Big`…) and sorted into **Body**, **Face** and **Other**;
- opposite pairs (`Hips_Wide`/`Hips_Narrow`, `Breast_Large`/`Breast_Small`) become one slider that
  goes both ways; left and right twins move together unless unlinked;
- the mapping can be edited (label, group, range, twin, hidden) and is saved with the model, keyed by
  the base's fingerprint, so it comes back when the same file is read again;
- explicit shapes are marked adults-only and shown only in adult mode for adult characters;
- values change smoothly (no pops), and garments fitted to the base carry the same morphs, so clothes
  follow the sliders.

Where the file has no morph for breast, hips, waist, butt, thighs or shoulders, **generated
adjusters** (labelled as such) push that region of the mesh, and its clothes, in or out.

**Body presets** save the slider values; any character made from the same base can apply them
("From another character on this base").

## Fitting clothes

Wardrobe › *Fit clothes to this body* takes a raw or unrigged garment (GLB, OBJ or FBX with its
textures) and makes it a garment of this base, in the browser:

1. **Place.** The body stands in its rest pose with every slider at zero. The garment is guessed into
   place (units, landmarks: chest, hips, feet, head), and you adjust it: drag the gizmo on a computer,
   or big hold-to-repeat buttons on a phone (move, turn, size; fine or coarse), snap to a landmark,
   mirror, auto-align, reset, exact numbers. Several pieces in one file can be switched off.
2. **Rig.** In a worker (the page stays responsive; there's a progress bar and Cancel):
   - the placement is baked into the vertices;
   - every vertex finds the closest point on the body (a BVH over the body surface), keeping only
     body surface that faces the same way and is near enough, so a sleeve takes the arm's weights,
     not the chest's; vertices too far away take their weights from the nearest matched cloth;
   - weights are smoothed over the garment's own edges and limited to 4 bones per vertex, normalized;
   - every body morph is carried over (the body's offset at the matched point), so the garment
     follows the sliders;
   - cloth that went into the skin is pushed out (optional);
   - skirts and long hair get **swing chains**: bones generated down the garment, pinned to the body
     above a gradient and swinging below it;
   - the body triangles the garment covers are found and hidden while it's worn (skin never pokes
     through; hair hides nothing).
3. **Check.** Poses (T-pose, arms up, squat, right hand up, a dance) and every slider at its lowest
   or highest; flagged areas can be shown (red: pulled by both left and right limbs; amber: filled
   in; yellow: pushed out). Adjust and fit again, or save.
4. **Save.** The rigged garment is written as a GLB with its weights, morphs and chain bones, and
   added to the wardrobe with its slot, layer and physics.

What it can't do: it doesn't simulate cloth, so a long coat or a gown is a skirt on chains (it swings
and collides but doesn't drape); garments that need different topology at slider extremes still
clip at the ends of the range (the test jeans open a small gap on the inside of the lower leg with
every slider at its highest); garments don't collide with each other (each is fitted to the bare
body, so long hair can let the back of a top show through it in lively poses, and a skirt fitted
over trousers doesn't push out of them); hand-made weights are better for very loose or layered
clothes.

**How long it takes** (October 2026, the CC0 test base: 14,549 vertices, 26,800 triangles, 31 morph
targets; `tests/e2e/measure-3d.spec.ts`, numbers in `docs/3d-base-evidence/measurements.json`): a
20,000-vertex garment rigs in **0.47–0.54 s of worker time** with nothing rendering (median of three,
phone and desktop viewports on the same machine), and the same input through the same code in Node
takes 0.34–0.44 s (the body's BVH: 33 ms). While it rigs the page keeps answering (the slowest 50 ms
timer fired at most 7 ms late). The test garments (600–3,300 vertices) rig in 20–180 ms; with the page's own
work around it (reading the body, building the result) a fit takes about 1 s from *Fit* to the
review, and saving (upload, optimizing, the phone copy) 1–3 s. Headless Chromium with software
WebGL; a real phone's worker is slower than this machine's, so expect a few seconds for 20,000.

## Physics

Hair, skirts, tails, accessories and the chest are springs: a fixed-step Verlet solver
(`runtime/physics/solver.ts`) with the VRM spring-bone settings (stiffness, drag, gravity and its
direction, hit radius), bone lengths held, and **colliders**: spheres and capsules for the head,
neck, chest, hips, arms and legs measured from the body in its rest pose (editable, and shown in the
Fit step). VRM files keep their own springs and colliders, run by the same solver.

- **Chest motion** uses the file's breast bones, with a strength slider and an off switch. A base
  without breast bones has no chest motion: helper bones aren't generated (they would need the
  chest's skin weights split between new bones), and the base model check says so.
- **Settings**: damping, wind, chest; presets per kind (hair, cloth, chest, tail, accessory); chains
  picked by hand for bones the file doesn't mark.
- **Contact at rest**: a chain that was made touching the body (long hair lying on the shoulders and
  back, a skirt over the hips) keeps that contact: each point may sit as deep inside a collider as it
  did in the rest pose, and no deeper. Pushing it fully out would turn the top bone and swing the
  whole chain away from the body like a cape.
- **Cost**: the quality level caps the points each character simulates and the solver rate (low: off;
  medium: 48 points at 30 Hz; automatic's middle step: 96 at 60 Hz; high: 160 at 60 Hz); characters
  out of the shot don't simulate. Chains are added until the cap is reached and a chain that doesn't
  fit is cut: its upper bones swing and the rest follows them. A skirt (40 points) and long hair (50)
  together fit on high; on medium the hair is mostly still.
- **Measured** (the CC0 base in a fitted skirt on chains, long hair on chains, a shirt and shoes,
  dancing for 6 s on high): no skirt point went more than 5 mm into a leg capsule in 4,800 checks;
  the breast bones turned up to 2.1° from the animated pose with chest motion on and 0° with it off.
  Screenshots: `5-skirt-dance-*`, `5-hair-back-*` in `docs/3d-base-evidence/`.
- **Weak spots**: chains hang from the hips, so in a deep squat the thighs come out over the front of
  a skirt, and when a leg swings far out a strip of thigh can show through the cloth between two
  chains near the hem (the chains themselves stay outside the legs). Skin under the upper, mostly
  pinned part of a skirt is hidden while it's worn, so the buttocks don't push through it.

## Skin layers

Skin layers are painted onto the skin texture once (the texture is copied through the GPU, so KTX2
works too), so they cost nothing per frame and bend with every pose, slider and animation: they *are*
the skin. A layer is a whole image in the body's UV layout (underwear, swimwear, stockings), a plain
colour wash, or an image placed by **tapping the body** (tattoos, scars, makeup): size, rotation,
opacity; drag to move. A placed image keeps its shape whatever the UV layout (the skin's frame at the
spot is measured when you tap). Underwear, swimwear and stockings act as clothing: outfits and
equipped items put them on.

Not built: a decal is cut where it crosses a UV seam (it isn't projected onto the mesh), and a
garment can't be baked into a skin layer (a painted-on top is made as an image layer).

Colours change at once: skin tone (a multiplied wash, so the skin's detail stays), eyes, hair (base,
tips gradient, highlight). Uploaded images go through the usual upload checks; adult-rated layers
show only for adult characters in adult mode.

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
- **Measured** (October 2026, `perf` run in headless Chromium with software WebGL, the 13,700-triangle
  mannequin; "phone" is 390×844 at 2× with the CPU slowed 4×). The frame rate there is set by the
  software rasteriser (12–24 fps whatever the load), so the number that carries over to real devices
  is the CPU time each frame takes: under 12 ms even for four characters on high, well inside the
  33 ms a 30 fps frame has. Rendering paused when the tab was hidden in every run, and the e2e
  suite checks that nothing 3D downloads when the module or the device setting is off.

| Profile | Quality | Avatars | CPU ms / frame | Draw calls | Triangles | JS heap |
|---|---|---|---|---|---|---|
| phone | low | 1 | 3 | 3 | 13,746 | 19 MB |
| phone | low | 2 | 6.5 | 6 | 27,492 | 19 MB |
| phone | low | 4 | 7.5 | 12 | 54,984 | 17 MB |
| phone | medium | 1 | 4.3 | 5 | 27,490 | 16 MB |
| phone | medium | 2 | 9.4 | 10 | 54,980 | 20 MB |
| phone | medium | 4 | 10.7 | 20 | 109,960 | 26 MB |
| phone | high | 1 | 5.5 | 10 | 54,980 | 19 MB |
| phone | high | 2 | 7.8 | 19 | 109,958 | 19 MB |
| phone | high | 4 | 11.5 | 37 | 219,914 | 22 MB |
| desktop | low | 1 | 0.8 | 2 | 13,744 | 17 MB |
| desktop | low | 2 | 1.6 | 6 | 27,492 | 22 MB |
| desktop | low | 4 | 2.2 | 12 | 54,984 | 29 MB |
| desktop | medium | 1 | 1 | 4 | 27,488 | 14 MB |
| desktop | medium | 2 | 1.2 | 10 | 54,980 | 22 MB |
| desktop | medium | 4 | 1.7 | 20 | 109,960 | 18 MB |
| desktop | high | 1 | 1 | 9 | 54,978 | 20 MB |
| desktop | high | 2 | 3.3 | 19 | 109,958 | 19 MB |
| desktop | high | 4 | 2.5 | 37 | 219,914 | 31 MB |

- **Dressed characters on a custom base** (October 2026, `tests/e2e/measure-3d.spec.ts`; numbers in
  `docs/3d-base-evidence/measurements.json`): one to three characters made from the CC0 test base,
  each wearing a fitted shirt, a skirt on chains, long hair on chains and shoes, dancing with physics
  on, sampled for 8 s. Same caveat as above: headless Chromium draws with SwiftShader (software
  WebGL), so its frame rate is the software rasteriser's and doesn't say what a GPU would do; the
  CPU time per frame (animation, physics, skinning upload and draw submission) is the number that
  carries over. "phone" is 390×844 at 2× with the CPU slowed 4× (it loads the lighter copy on medium
  and low). Triangles count every pass (shadows and outlines draw the scene again).

| Profile | Quality | Characters | CPU ms / frame (mean, p95) | Frames / s (software) | Draw calls | Triangles drawn |
|---|---|---|---|---|---|---|
| phone | low | 1 | 7.7, 14.2 | 12.7 | 8 | 20,357 |
| phone | medium | 1 | 12.9, 21.6 | 7 | 13 | 37,491 |
| phone | high | 1 | 22.8, 48.5 | 2.4 | 26 | 143,108 |
| phone | low | 2 | 12, 22.4 | 10.1 | 16 | 40,714 |
| phone | medium | 2 | 16.5, 29.8 | 5.8 | 26 | 74,982 |
| phone | high | 2 | 35.4, 66.1 | 2.1 | 51 | 286,214 |
| phone | low | 3 | 15.2, 25.1 | 7.3 | 24 | 61,071 |
| phone | medium | 3 | 24.1, 47.3 | 4.2 | 39 | 112,473 |
| phone | high | 3 | 53.5, 114.8 | 1.5 | 76 | 429,320 |
| desktop | low | 1 | 1.7, 5.2 | 12.3 | 8 | 20,357 |
| desktop | medium | 1 | 2.6, 5.1 | 6.1 | 13 | 71,554 |
| desktop | high | 1 | 4.8, 9.6 | 4.1 | 26 | 143,108 |
| desktop | low | 2 | 2.5, 4.9 | 7.8 | 16 | 40,714 |
| desktop | medium | 2 | 5.2, 9.8 | 3.5 | 26 | 143,108 |
| desktop | high | 2 | 8.7, 12.8 | 2.4 | 51 | 286,214 |
| desktop | low | 3 | 3.4, 7 | 7.2 | 24 | 61,071 |
| desktop | medium | 3 | 6.1, 8.6 | 2.8 | 39 | 214,662 |
| desktop | high | 3 | 11.3, 20.1 | 2 | 76 | 429,320 |

  On a phone, keep to medium or *Automatic* with more than one dressed character: high with two or
  three goes past the 33 ms a 30 fps frame has, on the CPU alone. Desktop stays under 12 ms on
  average at every setting.

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
| Convert | Import | .blend (alone or zipped with its textures), FBX, PMX/PMD, OBJ, DAE to GLB; .blend, VMD and stubborn FBX motions |
| Clean up | Avatar › Optimize | Merges duplicate points, simplifies meshes over a triangle budget (faces with expressions are left alone), shrinks textures, then prepares the model again |
| Turntable | Avatar › Optimize | Eight views rendered with Cycles on the CPU (no graphics card needed) |
| Realistic character | Avatars › Make › Realistic | MPFB makes a human from sliders and MakeHuman assets (see below) |
| Fit a garment | Dressing room › Garments | A garment mesh (GLB, OBJ, FBX, DAE) is placed where its slot sits on the body, the parts inside the skin are wrapped just outside it, the skin weights are copied from the nearest body surface, and the body regions it covers are worked out (to hide skin). **Experimental:** close-fitting things work; loose or layered ones come out rough |

Tested here: an FBX round trip of the mannequin keeps all its bones; a plain tube fitted as a top
covers the chest, belly and hips and bends with the body; clean-up of the mannequin to 2,000
triangles; an 8-view turntable in about 6 seconds.


### .blend files

Blender's own files import directly (Characters › 3D avatars › Import, the motion importer, and
*Fit a garment*), converted by the worker:

- **Textures:** pack them into the file (File › External Data › Pack Resources) and upload the
  .blend, or upload a **zip** of the .blend with its texture folders so its relative paths
  (`//textures/skin.png`) resolve. Missing textures and linked libraries are listed in the import
  report.
- **What's kept:** the meshes that would render (in the view layer, not hidden from render by
  themselves or a collection) and the armatures that move them; cameras, lights, hidden helpers and
  other scenes are left out. Subdivision is dropped; other modifiers (mirror, solidify…) are applied
  on meshes without shape keys, and left alone on meshes with them (the report says so).
- **Motions:** the armature's action (or the first action made for its bones) becomes the clip.
- **Safety:** nothing in a .blend runs. Blender starts with auto-run off and the file is opened with
  scripts disabled, so Python drivers and scripts saved in it stay inert; a test checks that a
  script set to run on load never does. Files saved by a much newer Blender than the server's may
  not open.

## Realistic characters (MPFB)

Avatars › Make › **Realistic** makes a human with [MPFB](https://static.makehumancommunity.org/mpfb.html),
the MakeHuman add-on for Blender, on your server. Offered only where Blender runs (4.2 or later).

- **Setup:** the first time, Everloom offers to install MPFB 2.0.17 (GPL-3.0, from
  extensions.blender.org) and MakeHuman's system assets (CC0: skins, eyes, brows, lashes, hair,
  clothes; from makehumancommunity.org), about 330 MB. Both downloads are checked against pinned
  SHA-256 hashes and unzipped as they stream into `<data>/blender/extensions`, which is used as
  Blender's extensions folder for these jobs only: your own Blender profile isn't touched. If MPFB
  is already installed in your Blender (with the system assets), that one is used instead. Settings ›
  3D characters › Realistic characters can reinstall or remove Everloom's copy. Neither is shipped
  with Everloom.
- **Choices:** feminine to masculine, age (adults only: the slider starts at 18), weight, muscle,
  height; skin, hair, eyes, eyebrows, eyelashes and any of the clothes. They're saved on the avatar
  (`realistic` in its settings).
- **The job:** MPFB builds the body with the game-engine skeleton (53 bones) and puts on the assets;
  the body's sliders are baked in and helper geometry is removed. Skin, eyes and clothes are opaque
  and hair, brows and lashes are cut-outs (glTF `MASK`) so nothing sorts wrongly. About half a
  minute in Blender, then the normal import: bones mapped automatically, textures to KTX2, a lighter
  copy for phones (the body is about 4 MB and 1 MB).
- **Clothes are garments.** Each piece of clothing comes out as its own garment of this body, on the
  same skeleton: the avatar gets its own body family (`mpfb:<avatar id>`), and the dressing room
  can take clothes off, link them to inventory items or add others. The body stays whole; the skin
  regions a garment covers (worked out from MPFB's own "delete under this garment" groups) hide
  while it's worn. The slot comes from the garment's name and tags (shoes → feet, suit or dress →
  full, trousers or skirt → bottom, shirt → top, jacket → outer, hat → head), else from what it
  covers. Deleting the avatar deletes its garments.
- **Limits:** the face doesn't move yet (MPFB's face shape keys come in separate packs, and baking
  the body sliders removes shape keys); MakeHuman clothes fit only the body they were made for.
  Looks best with the PBR look.

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

## Elsewhere in Everloom

- **Stage:** 3D characters share the stage with sprites and Live2D, under speech bubbles and scene
  effects; group scenes place several. Battles play battle emotes (a won fight, a hit).
- **Cutscenes:** a spoken line can end with `{wave}` (the speaker plays that emote) or
  `{outfit: Ball gown}` (`{outfit: none}` for their own clothes). Steps like that let the stage show
  through above the text, so you see it happen.
- **Character sheet:** "Show in 3D" on a character's details loads their avatar on tap (nothing 3D
  downloads before that).
- **Portraits:** in the avatar editor's Details step, "Use as … portrait" turns the pose and framing
  in the preview into the character's portrait.
- **Asset library › 3D:** models, garments, accessories and animations with tags and search; select
  some to export a zip, or import one (garments and accessories travel with their avatar).
- **Character bundles** include each character's 3D avatar: its settings, the original model
  (prepared again on import) and the files its outfits, garments and accessories use, under
  `avatars/<name>/`. Code-made and parts-made characters carry only their recipe or choices.

## Files

| | |
|---|---|
| `packages/engine/src/avatar/` | skeleton, bone and expression mapping, emotes, config, wardrobe, recipes |
| `apps/server/src/services/avatars/` | GLB reader, inspection, optimization, storage and processing |
| `apps/server/src/blender/worker.py` | the Blender worker script (convert, motion, optimize, fit, render, mpfb) |
| `apps/server/src/services/avatars/mpfb.ts` | realistic characters: MPFB install, status, the job, garments |
| `apps/server/src/services/avatars/bundle3d.ts`, `library3d.ts` | avatars in character bundles; the asset library's 3D shelf |
| `apps/server/src/services/avatars/model3d.ts`, `textures.ts` | image-to-3D jobs; seamless garment textures |
| `tools/blender-addon/` | the Blender exporter add-on (GPL-3.0) |
| `apps/web/src/features/avatar3d/runtime/` | loading, retargeting, clips, avatar, stage, materials, lighting, wardrobe, import |
| `runtime/fit/` | clothes fitting: BVH, weight and morph transfer, coverage, the worker and the session |
| `runtime/physics/`, `runtime/ik.ts`, `runtime/paired.ts`, `runtime/skin.ts`, `runtime/morphs.ts` | springs and colliders; inverse kinematics and paired playback; skin layers and colours; body sliders |
| `packages/engine/src/avatar/morphs.ts`, `layers.ts`, `physics.ts`, `paired.ts`, `base-report.ts` | slider mapping, skin layers, physics and paired-clip formats, the base model check |
| `tools/avatars/paired.ts`, `build-paired.ts` | the built-in paired animations |
| `tools/avatars/build-test-base.ts`, `build-test-garments.ts` | the CC0 test base and garments in `tests/fixtures/avatars/` |
| `apps/web/src/features/avatar3d/runtime/codemade/` | code-made characters: shapes, mesher, body, clothes, face, worker |
| `apps/web/src/features/avatar3d/Maker.tsx`, `parts.ts` | the parts maker; packs as garments |
| `apps/web/public/avatar/packs/basics/` | the built-in part pack (generated) |
| `tools/avatars/build-starter-pack.ts`, `glb-writer.ts` | building the built-in pack |
| `apps/web/src/features/avatar3d/` | the wizard, preview, stage layer, motion importer |
| `apps/web/public/avatar/clips/` | the built-in clips |
| `tools/avatars/` | building the bundled and authored clips |
| `apps/web/public/avatar/fabrics/`, `tools/avatars/build-fabrics.ts` | fabric detail maps for code-made clothes, and how they were made |
| `apps/web/src/features/avatars/Realistic.tsx`, `Assets3D.tsx` | the realistic maker and MPFB setup; the 3D shelf |
