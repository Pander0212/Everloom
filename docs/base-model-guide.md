# Making a base model for Everloom

A **base model** is a body that clothes are fitted to and characters are made from: one rigged
body, any number of characters (each with its own slider values, skin, colours and wardrobe), and
garments fitted once that every one of them can wear. This guide is for whoever makes or buys the
body. What Everloom does with it is in [avatars.md](avatars.md).

Everloom reads the file and tells you, in its **Base model check** (avatar editor › Body), what it
found and which features that turns off. Nothing here is required beyond a skeleton and skinned
meshes; each item says what you lose without it.

## The essentials

| | What Everloom needs | Without it |
|---|---|---|
| Format | One **GLB** (glTF 2.0 binary), textures embedded. VRM 0.x/1.0 works too. FBX, OBJ, .blend go through Blender if it's installed. | — |
| Skeleton | A humanoid with at least hips, spine, head, both upper arms and both upper legs. Any common naming (Mixamo, Rigify, Unreal, VRoid, MMD, Blender defaults). Fingers optional. | No animation, no fitting |
| Skinning | Every body mesh skinned to that skeleton, at most 4 weights per vertex, normalized | Nothing moves; clothes can't be rigged to it |
| Rest pose | A clean T- or A-pose as the file's rest pose (the bind pose), transforms applied | Fitting places clothes on the rest pose: a crooked rest pose makes fitting harder |
| Size | Real-world metres, feet on the ground (any facing; Everloom turns it) | Fitted automatically; set the height in the Fit step |
| UVs | One non-overlapping UV layout for the skin | No skin layers, tattoos or underwear-as-texture |
| Budget | Under 60,000 triangles (150,000 at most), 24 materials, 256 bones, textures 2048 px | Phones use the lighter copy Everloom makes |

## Body morphs (shape keys)

Body sliders come from **morph targets** in the file (Blender: shape keys; exported with "Shape
keys" on). Name them plainly; Everloom reads common conventions:

- **Opposite pairs** become one slider that goes both ways: `Breast_Large` / `Breast_Small`,
  `Hips_Wide` / `Hips_Narrow`, `Waist_Wide` / `Waist_Thin`, `Butt_Big` / `Butt_Small`,
  `Thighs_Thick` / `Thighs_Thin`, `Shoulders_Wide` / `Shoulders_Narrow`, `Belly_Out` / `Belly_In`,
  `Weight_Heavy` / `Weight_Thin`. A single key (`Muscular`) is a slider from 0 to 1.
- **Left and right**: `…_L` / `…_R`, `Left…` / `Right…`, `.l` / `.r` are twins that move together
  unless unlinked.
- **Face** shapes (`eyeBlinkLeft`, `jawOpen`, `mouthSmile…`, ARKit's 52, VRM and VRoid presets) go in
  the Face group and also drive expressions and lip-sync.
- Anything else lands in **Other**, where you can rename, regroup, pair or hide it. The mapping is
  saved with the model and comes back when the same file is read again.
- Shapes that are explicit by name are marked adults-only and show only in adult mode, for adult
  characters.

Keep morphs **sculpted on the rest pose** and moderate at 1.0: fitted clothes copy the body's offset
at each point, so a garment follows a morph exactly as far as the skin under it does.

No morph for a region? Everloom offers **generated adjusters** for breast, hips, waist, butt, thighs
and shoulders (they push that region in or out, clothes too), labelled as generated so nobody
mistakes them for sculpted shapes.

## For clothes to fit well

- Keep the **skin as one mesh** (or a few: body, head) and name it plainly (`Body`, `Skin`); the
  check lists the meshes it takes for skin, and you can change the list in the Wardrobe step.
- **Weights that are clean** at the shoulders, hips and elbows transfer cleanly: a garment takes the
  weights of the skin under it.
- **Normals pointing out** (Everloom detects and handles inverted garment normals, but not a body's).
- No clothes baked into the body mesh; underwear as a separate mesh or as a skin layer texture.

## Chest, hair and other physics

- **Breast bones** (`Breast_L`, `breast.R`, `Bust`…), children of the chest, enable chest motion with
  a strength slider and an off switch. Without them there's no chest motion (sliders still work).
- **Hair, tails, skirts already in the file**: give them bone chains (`Hair_1` → `Hair_2` …; names
  with hair, skirt, tail, cloth, cape) and Everloom makes them springs. VRM spring bones and colliders
  are used as authored. Other chains can be picked by hand in the Fit step.
- Colliders (head, neck, chest, hips, arms, legs) are measured from the body; no setup needed.

## Licences and adult content

Only import bodies and garments you have the rights to use. Everloom never bundles third-party
assets. Bodies are treated as all-ages unless the character is saved as a confirmed adult in adult
mode; explicit sliders, adult-rated skin layers and adult paired animations only appear then.

## A quick check before you export

- [ ] GLB, textures embedded, real-world metres, feet on the ground
- [ ] Humanoid skeleton; rest pose is a clean T- or A-pose; transforms applied
- [ ] Every body mesh skinned, ≤ 4 weights per vertex
- [ ] One clean UV layout for the skin
- [ ] Body shape keys named plainly, sculpted on the rest pose (pairs for both directions)
- [ ] Face shapes if the face should move (blink, the five vowels, a few emotions)
- [ ] Breast bones if you want chest motion; bone chains for hair or tails in the file
- [ ] Under 60,000 triangles, 24 materials, 256 bones, 2048 px textures

Then import it (Characters › 3D avatars › Import) and open the **Body** step: the check tells you
what it found.
