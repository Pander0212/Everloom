# Making templates

A template is one pose or scene, drawn once, plus a layer for each trait option. All of a
template's layers come from one base picture: an edit model changes **one** trait at a time and
keeps everything else identical. That is why the layers line up.

## 1. The base

Generate the pose with a neutral base character. For example, for `stand-neutral`:

- an adult woman (about 30, mature face);
- A-pose, front view, full body, plain light backdrop;
- grey sports bra and briefs;
- hair in a low bun.

The base must be clearly adult. For 18+ scenes, the bodies are clearly adult, the faces mature,
and the expressions willing. The studio never makes youthful-looking or school-themed art.

Generate it with `tools/art/gen.mjs` (NanoGPT, logged in `docs/art/ledger.json`; paid calls
show their price first and stop at the cap):

```sh
ART_RAW_DIR=samples/gen/studio/raw node tools/art/gen.mjs --service nano --model qwen-image \
  --label cs-base --prompt "…"
```

## 2. One edit per trait option

With `qwen-image-2.1/edit` (aligned edits about $0.03 each; FLUX Klein reframes the picture, so
it is not used), start from the base and add these edits:

| Edit | Prompt | Gives |
| --- | --- | --- |
| bald | "remove all of her hair … keep everything else identical" | the body layer |
| one per hairstyle | "change only her hairstyle: …" | a hair layer for `hair.back` |
| one per outfit item | "dress her in … keep everything else identical" | a clothing layer for `wardrobe.<slot>` |
| one per expression | "change only her facial expression to …" | an expression overlay |
| eye colour | "change only the colour of her irises to bright green" | the eye recolour mask |

Colours are not separate pictures. Hair, eyes and skin are recoloured at runtime, and body
shapes come from the cages. One base therefore gives every colour and body type.

## 3. Build the pack

Write a spec (see the header of `tools/studio/make_template.py`), then run:

```sh
python3 tools/studio/make_template.py samples/gen/studio/stand-neutral.json samples/gen/studio/packs
npx tsx tools/studio/check-template.ts samples/gen/studio/packs/stand-neutral/template.json
```

### What the maker does

1. **Keys** the bald body with rembg (IS-Net).
2. **Aligns** every variant to its reference by phase correlation. A shift of up to 1.5 px is
   corrected; a larger one rejects the variant, so regenerate it.
3. **Diff layers:** pixels whose ΔE76 exceeds 14 against the reference. The mask is opened and
   closed, islands under 120 px are dropped, holes are filled, and the result is feathered and
   clipped to the variant's own silhouette.
4. **Hair** is diffed against the bald picture. Hair outside the body becomes `hairBack` (z 5);
   hair over the body becomes `hairFront` (z 40). The base's own hair becomes the option named
   `baseHair`.
5. **Masks:**
   - the eye mask is the diff between the base and the eye-colour edit inside the face;
   - the skin mask is body pixels near the median arm and leg colour, minus the eyes.
6. **Cages** come from RTMPose keypoints:
   - bands for shoulders, waist, hips and thighs, widening and narrowing about the centre line;
   - a box per breast that grows outward and down about its inner edge (so the two never
     overlap).
7. **Rig:** the breathing rect over the chest, the sway pivot at the pelvis, and bounce rects on
   the breast cages.
8. **Gates** are written to `<id>-report.json`; the exit code is 1 if any fails:

   | Gate | Limit | What it catches |
   | --- | --- | --- |
   | `alignment_px` | ≤ 1.5 | a variant that moved |
   | `reconstruction_de` | ≤ 4 | reference + layer ≠ variant (seams, missing pixels) |
   | `halo_px` | ≤ 400 | fringe pixels far from the variant (halos) |
   | `swap_holes_px` | ≤ 60 | holes inside the body silhouette (visible when hair or clothes are swapped) |
   | `drift_de` | ≤ 3.5 | an edit that changed the whole picture (colour drift) |

   `check-template.ts` adds the schema, z conflicts, adult rules, and slider distortion. Every
   slider at ±1, and every body type with small and large sizes, must keep the local area ratio
   within ×0.55…×1.8.
9. **Contact sheet** `<id>-sheet.png`: the base, the body with its cages and keypoints, then each
   layer over the body.

## 4. Install and review

On the Looks page (`/characters/looks` → Templates → Install pack), add the zip. Then check the
template with a few random characters and the body-type extremes. If a layer looks wrong,
regenerate that one edit; the rest of the pack stays.

Generated art goes in `samples/gen/studio/` (git-ignored) and in the shared packs: an all-ages
pack and a separate 18+ pack. It never goes in the repository.

## Adding an option

- **A hairstyle** in an existing template: one edit, add it to the spec's `hair`, and rebuild.
  If the style is new to the catalog, add it to `HAIR_BACK` in
  `packages/engine/src/studio/traits.ts`, with a fallback in `compose.ts`.
- **An outfit item:** one edit under `wardrobe.<slot>.<item>`. Item ids are free text, and story
  items whose name contains the id select it.
- **An expression:** one edit. It must be one of `EXPRESSIONS`.
- **A scene option** (time of day, place): add the option to the template and give the
  background layers `when: {"option.<id>": "<value>"}`.
