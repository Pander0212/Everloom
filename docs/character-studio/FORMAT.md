# Character Studio formats (version 1)

Two JSON formats, both versioned. Readers upgrade older versions (`migrateTraitSheet`,
`migrateTemplate` in `packages/engine/src/studio/`); a higher version than the reader knows is
refused. Version 1 is the first.

## Trait sheet (`TraitSheetSchema`)

One character: a list of traits, the same in every template.

| Field | Values |
| --- | --- |
| `version` | `1` |
| `name` | 1–80 chars |
| `sex` | `female` \| `male` |
| `age` | **required**, integer ≥ 18. Studio characters are adults; an unstated age is never assumed. |
| `body.type` | `slim` `average` `athletic` `curvy` `muscular` `plus` (a preset of slider values) |
| `body.breast`, `body.hips` | `small` `medium` `large` (added to the sliders) |
| `body.sliders` | `breast` `hips` `butt` `thighs` `waist` `shoulders`, each −1…1, fine adjustment on top of the preset |
| `body.skin` | `#rrggbb` |
| `body.bodyHair` | `none` \| `light` \| `natural` |
| `face.preset` | `soft` `sharp` `round` `mature` `cool` `cheerful` |
| `face.eyeColor` | `#rrggbb` |
| `face.brows`, `face.makeup`, `face.freckles`, `face.mole` | small options |
| `hair.front` | `none` `bangs` `side_swept` `parted` |
| `hair.back` | `short` `bob` `long_straight` `long_wavy` `ponytail` `twin_tails` `bun` `braid` |
| `hair.side` | `none` `locks` |
| `hair.color`, `hair.highlight` | `#rrggbb` (highlight may be null) |
| `wardrobe.<slot>` | slots `top` `bra` `bottom` `underwear` `legwear` `shoes` `accessory`; an item id or null |
| `expressions` | the character's usual expressions, most typical first |
| `locked` | true: the "final design" — trait changes are refused, only the name changes |

The slider values a sheet resolves to are `BODY_PRESETS[type] + SIZE_PRESET[size] + sliders`,
clamped to −1…1 (`resolvedSliders`).

## Template (`TemplateSchema`, `format: "everloom-studio-template"`)

A pose or a scene, drawn once, with pre-aligned layers per trait option. A pack is a zip of one
folder per template: `<id>/template.json` plus its PNG/WebP files (re-encoded on install).

```jsonc
{
  "format": "everloom-studio-template", "version": 1,
  "id": "stand-neutral", "name": "Standing", "category": "standing",   // standing | sitting | action | scene
  "rating": "all-ages",                                                // or "18+" (separate packs)
  "width": 832, "height": 1280, "tags": ["neutral"],
  "supports": {                       // options with art; the rest fall back to the nearest one
    "hairBack": ["bun", "long_straight", "bob"], "hairFront": [], "expressions": ["neutral", "smile"],
    "wardrobe": { "top": ["blouse"], "bottom": ["jeans"] }
  },
  "options": [{ "id": "time", "label": "Time", "values": [{ "id": "day", "label": "Afternoon" }, …], "default": "day" }],
  "slots": [{
    "id": "a", "sex": ["female"],
    "layers": [{
      "id": "hair-bob-front", "part": "hairFront", "file": "hair-bob-front.png",
      "rect": [x, y, w, h],           // where the (cropped) picture goes on the canvas
      "z": 40,
      "zRules": [{ "when": { "hair.back": "ponytail" }, "z": 6 }],   // first match wins
      "when": { "hair.back": "bob" },  // all keys must match; an array means any of
      "recolor": [{ "kind": "hair", "base": "#3b2a22", "mask": "…png" }],
      "cages": ["breast-l"],           // optional: only these cages deform the layer
      "adult": false                   // true only in 18+ templates, drawn only in explicit states
    }],
    "cages": [{ "id": "hips", "slider": "hips", "rest": [[x, y], …], "min": […], "max": […], "margin": 60 }],
    "rig": { "breathe": [x, y, w, h], "pivot": [x, y], "bounce": [[x, y, w, h]] },
    "keypoints": { "neck": [x, y], … }
  }]
}
```

**`when` keys:** `hair.front|back|side`, `face.preset|makeup|brows|freckles|mole`,
`body.bodyHair`, `sex`, `wardrobe.<slot>`, `expression`, `option.<id>`.

**Parts:** `background`, `pov`, `body`, `bodyDetail`, `hairBack`, `hairSide`, `hairFront`,
`face`, `eyes`, `brows`, `expression`, `clothing`, `accessory`, `effect`. These are the usual z
bands:

| Part | z |
| --- | --- |
| back hair | 5 |
| body | 10 |
| underwear | 14 |
| legwear | 15 |
| shoes | 16 |
| bottom | 18 |
| bra | 19 |
| top | 20 |
| expression | 31 |
| front hair | 40 |
| accessory | 45 |

**Recolour:**

- `hair`, `highlight` and `eyes` use a gradient map: a 256-step ramp in Lab around the target
  colour, indexed by the base pixel's luma, so shading stays.
- `skin` uses a Lab shift.
- `base` is the colour the art was painted in. The mask (white = recolour) defaults to the whole
  layer.

**Cages:**

- A body slider at −1…1 moves the polygon from `min` through `rest` to `max`.
- Points inside follow by mean-value coordinates.
- Within `margin` outside the cage, the movement fades out smoothly.
- Several cages add up.
- A layer is deformed by its slot's cages unless it names its own.

**Validation (`validateTemplate`, run on install):**

- unique layer ids;
- no two layers that can be drawn together share a z;
- adult layers only in `18+` templates;
- layers name only cages that exist;
- option defaults exist.

The maker's checks (`tools/studio/check-template.ts`) add slider distortion.

## Story state

These ops are bound to the message that produced them. A swipe, edit or delete of that message
rolls them back like every other op.

- `studio.pose { who, template|null, expression? }`: a character's pose template on the stage.
- `studio.scene { template|null, who[≤2], options }`: a scene. Its options become a choice menu.
- `studio.option { option, value }`: one scene option, which is also what a choice-menu tap sends.

They are stored in `stage.studio` (`poses`, `scene`).

**Wardrobe from the story:** the character's equipped items pick outfit layers whose item id
appears in the item's name (`wardrobeFromItems`). The story's emotion picks the expression
(`expressionForEmotion`).

## Versioning

Add a field with a default and the version stays the same. When the meaning of a field changes,
bump `version`, and add the upgrade to `migrateTraitSheet` / `migrateTemplate` with a test.
