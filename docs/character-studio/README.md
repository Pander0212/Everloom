# Character Studio

A paper-doll character generator. A character is a **trait sheet**: body, face, hair, colours,
wardrobe and expressions. Every pose or scene **template** has pre-aligned layers for each trait
option, so one character looks the same in every pose, and changing one trait changes only that
trait.

- Formats (trait sheet, template, story ops): [FORMAT.md](FORMAT.md)
- Making templates: [making-templates.md](making-templates.md)
- Costs: [costs.md](costs.md)
- Evidence: [evidence/](evidence/). The pictures in the repo are procedural shapes only;
  generated-art evidence stays in `samples/gen/studio/evidence/`.

## Using it

The feature switch **Character Studio looks** (`paperdoll`) needs the stage. Open
**Characters → Looks** (`/characters/looks`). It is phone-first; on wide screens the preview sits
beside the editor.

- **The list:** studio characters, story characters (linked to a card) and NPCs, 13 per page
  with ID, name and sex.
- **Editor tabs:** Body, Face, Hair, Clothing, Expressions. Each tab has option chips and colour
  swatches.
- **Preview:** shows the character in every installed template. Swipe, or use the arrows, to
  page through them.
- **Randomize:** rolls a coherent adult NPC. The lock toggles keep chosen groups (body, face,
  hair, clothes).
- **Fill from description:** the owner's utility model reads a story character's card and
  answers with a sheet.
  - If the card says the character is under 18, it is refused.
  - If the card states no age, the owner must enter one before saving.
- **Lock final design:** traits can't change after this (renaming still works).
- **Other actions:** duplicate, and export or import a sheet as JSON.
- **Templates tab:** install or remove packs (zip). An 18+ pack is separate, and its adult layers
  draw only in explicit scenes.

## In the story

A story character with a linked look stands on the stage in a pose template
(`display: "looks"`, or automatically when it has no other avatar).

- The model's ops `studio.pose`, `studio.scene` and `studio.option` change the pose and open
  scenes. A scene's options appear as a **choice menu** under the picture.
- Equipped items select outfit layers, and the story's emotion selects the expression.
- Everything is bound to the message, so a swipe, edit or delete rolls it back.

## How it renders

`packages/engine/src/studio/compose.ts` turns a sheet and a template into a plan:

- layers by trait, with fallbacks for options the template lacks;
- z rules;
- recolours: hair and eyes by gradient map, skin by a Lab shift;
- slider values for the cages: mean-value coordinates.

`apps/web/src/features/paperdoll/compositor.ts` runs the plan on a canvas: recolour, warp each
layer by a triangle mesh, stack. It caches the result by the plan's key, so only a change that
alters pixels rebuilds it. `motion.ts` draws the cached picture with WebGL as a 24×48 grid, and
the vertex shader adds breathing, sway and bounce. That is a few draw calls per character per
frame, which runs at 60 fps on phones.

## Safety

- Studio characters are adults: `age` is required and at least 18.
- The AI fill never invents an adult age for a character whose age it can't find.
- Cards that describe a minor are refused.
- 18+ templates use clearly adult bodies, mature faces and willing expressions.
- The studio makes no youthful-looking or school-themed art.
