# Puppets v2: full-body 2D characters

Full-body puppets that bend their elbows and knees, wave, cross their arms, walk across the stage,
turn, talk and bounce. They sit next to the first puppets (docs/puppets.md: face and bust puppets,
which keep their own runtime and keep working).

- **Runtime:** the Rev2D format and evaluator, vendored at a pinned commit
  (`packages/engine/src/puppet2/rev2d/`), drawn by Everloom's own WebGL renderer
  (`apps/web/src/features/puppets/v2/`). Why: docs/PHASE2_DECISIONS.md › Puppets v2.
- **Skeleton standard:** [skeleton.md](skeleton.md). One set of bone names for every character and view.
- **Motions:** [motions.md](motions.md). Written once, retargeted to each character.
- **Making a character:** [pipeline.md](pipeline.md). Generate in layers, decompose, import.
- **Costs:** [costs.md](costs.md).
- **Evidence:** `evidence/` (the procedural test figure; screenshots of generated characters stay
  out of the repository with the art).

## Where things are

| What | Where |
|---|---|
| Skeleton, auto-rig, motion library, story mapping | `packages/engine/src/puppet2/` (`@everloom/engine/puppet2`) |
| Renderer, stage (views, walking, life), lab, story layer | `apps/web/src/features/puppets/v2/` |
| Character packs: import, rig, serve, minor guard | `apps/server/src/services/puppets2/store.ts`, `routes/puppets2.ts`, `services/minor-guard.ts` |
| Decomposition (picture → pack) | `tools/puppets2/decompose.py` |
| Test figure as a picture | `tools/puppets2/render-figure.ts` |
| Tests | `packages/engine/test/puppet2-rig.test.ts`, `apps/server/test/puppets2.test.ts`, `tests/e2e/puppets2.spec.ts` |

## Using one

1. Settings › Puppets › **Full-body puppets** › Import a character pack (a zip from the pipeline).
   Every view is rigged on import; open it in the lab to review (`/lab/puppets2?p2=<id>`).
2. On a character: On the stage › **Full-body puppet**, and pick it.
3. In a story, the stage follows the same ops as 3D characters: `avatar.emote` (wave, nod, bow, cheer,
   point, surprised…), `avatar.pose` (held poses: arms crossed, hands on hips), `avatar.outfit`
   (wardrobe sets), and slots from `stage.layer` (a character who changes slot walks there, in profile
   when it has a side view). It all lives in each message's state, so a swipe puts it back.
4. While a character's line is spoken the mouth moves; it blinks on its own; the story's emotion picks
   the expression.
