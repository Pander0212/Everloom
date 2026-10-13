# Blender imports: diagnosis, file by file (2026-10-13)

The owner reported that `.blend` models still broke after the earlier fix: skeletons wrong on some,
others not importing at all. Two failing files were named (a pony with wings and a tail; an
anthropomorphic winged dragon with a tail and digitigrade legs), and six more came with them. This is
what each file holds, what the old conversion made of it, and why.

How it was measured (tools in `tools/blender-diagnose/`, run with Blender 5.2.2 LTS on Windows):

1. **Ground truth** — `inspect_blend.py` opens the file in Blender (scripts off) and records the
   armatures, every bone (parent, rest head and tail, roll, deform flag), the pose state, object
   transforms, modifiers in order, shape keys and their drivers, constraints, materials, images
   (packed, external, missing), node groups, particle systems, and per mesh the weights (vertices with
   more than four influences, none, groups that match no bone).
2. **The app's conversion** — `repro.ts` / `convert.sh` run `apps/server/src/blender/worker.py`
   `convert` in a job folder with the server's arguments, as `processAvatar` does.
3. **The app's reading** — `appinspect.ts` runs the server's `inspectModel` on the GLB (bone map,
   roles, warnings) — what the editor and the stage get.
4. **Comparison** — joints against Blender's bones by name: present, parent, rest head position.

The owner's files are in the git-ignored `samples/3d/`; fan-made models of existing characters stay
private, so their screenshots are under the git-ignored `evidence/private/`.

## Summary

| File | Saved with | Before | Cause(s) | After |
|---|---|---|---|---|
| Pony (wings, tail) | 4.1 | Imported, but only `head` mapped; 14 "missing" humanoid bones flagged as a problem; eyes, mouth, hooves and wings **missing from the GLB**; 166 joints incl. IK/controls | non-humanoid skeleton; objects with *Disable selection* and driven visibility silently not selected for export; bone-parented eyes with a Boolean; modifiers skipped on shape-keyed meshes | all 7 parts, 114 joints, winged quadruped (front/hind legs, wings, tail, ears, jaw, eyes), clip baked, check passes |
| Anthro dragon (wings, tail) | 4.5 | **Never imported**: the auto-mapper made > 400 role chains and the schema threw, failing `inspectModel`; Blender also crashed on exit | Auto-Rig Pro control rig: deform bones flat under `c_traj`, placed by `COPY_LOCATION`/`COPY_ROTATION`/`STRETCH_TO` — glTF dropped the constraints, so arms and legs didn't follow the body; 756 joints exported; tail flame bone-parented with an Armature modifier and no weights (5,540 unweighted vertices); 4,773 vertices with up to 13 influences | 188 joints, limbs chained (shoulder → arm → forearm → hand, hips → thigh → shin → foot), 74 bones re-parented, flame skinned to its tail bone, biped creature with wings and tail, no crash |
| Avian dragon (NSFW) | 2.93 | Imported; 3,092 unweighted vertices; 129k triangles; 168 s | two meshes bone-parented without weights; 38 textures stored outside the file; 17 Geometry Nodes modifiers | 0 unweighted, check passes, biped creature with feathered wings and tail; textures still missing (needs the texture folder zipped with the .blend) |
| Humanoid "M…" rig | 2.92 | Imported, **no humanoid bone mapped** (names `MSpine1`, `MThigh.L`, `MShoulder.L` = upper arm) | names the mapper doesn't know; a second root holding face controls | humanoid core from the skeleton's shape (21 slots), check passes |
| VRChat-style (NIKKE) | 4.5 | Imported, 491 joints (phones skin ≤ 256) | Rigify-style rig with ORG/MCH bones exported | 88 deform joints, 33 re-parented, humanoid |
| Pokémon-style humanoid with dress | 4.0 | Imported, fine | — (mirror and Geometry Nodes modifiers on meshes with shape keys left unapplied) | modifiers applied with shape keys kept; dress panels stay skirt, not wings |
| SMD humanoid | 4.1 | Imported, fine | Glossy-BSDF-only materials exported as white | colours kept (red, black, white) |
| Base body | 5.2 | Imported, fine | 3 textures external | unchanged, textures reported |
| Battle droid (`.blend1` backup) | 4.4 | Imported, 8.2 m tall | meshes at 0.01 scale with a 90° turn under the armature (the model *is* that size in Blender) | same size as in Blender, verified; the stage fits it to height |

## Causes (the brief's list, and which applied)

| Cause | Applied? | Where |
|---|---|---|
| **Non-humanoid rigs** — import/mapper/stage requiring hips, spine, arms | **Yes, main cause** | pony, dragons. The mapper flagged arms as missing on a pony, the role list overflowed on a 756-bone rig, the stage drove only humanoid slots |
| Object/armature transforms not applied; scale 0.01/100; Y-up vs Z-up | Partly | pony armature rotated 90° on X (exported correctly; the server's height measurement ignored the bind matrix — fixed); droid at 0.01 scale (correct) |
| Bone orientation/roll, leaf bones, **rest vs current pose**, inverse binds | Checked: rests and binds were right; bone-parented meshes were captured in the *current pose* | pony eyes |
| **Modifiers not applied** (mirror especially), order, shape keys with modifiers | **Yes** | modifiers were skipped on every mesh with shape keys; Subdivision dropped silently |
| **Meshes parented to bones instead of skinned** | **Yes** | pony eyes, dragon flame, avian slit meshes |
| Several armatures; **constraints, IK, drivers that need baking** | **Yes** | Auto-Rig Pro and Rigify-style control rigs; the old repair handled only a flat `def-` humanoid |
| Vertex groups not matching bones; **more than four weights** | **Yes** | 4,773 vertices on the dragon, 2,089 on the M-rig body |
| Textures not packed or external | Yes (reported, not fixable without the files) | avian dragon (38), M-rig (7), droid (5) |
| Unsupported material nodes | **Yes** | toon/shader-to-RGB setups, Glossy-only materials |
| Curve, particle or Geometry Nodes hair | Curves present but not rendering (pony); GN modifiers on several | handled generally now |
| Very large files | Partly | dragon (178 MB) converted in 27 s once the crash at exit was avoided; avian 168–215 s (the server limit was 8 minutes, now 20 as documented) |
| **Objects hidden from selection** (not in the brief) | **Yes** | pony: parts with *Disable selection*, driven visibility, or a hidden collection were silently left out of the export |

## The fixes (one export script, tested)

`tools/blender-addon/everloom/export_core.py` is the only export, used by the server worker, the
rented worker and the add-on (which now exports a saved copy in a background Blender, so the open
file is never changed). It:

1. converts renderable curves, text, surfaces, hair curves and particle hair to meshes (hair as thin
   tubes weighted from the scalp);
2. applies modifiers as a render shows them, **shape keys included** (each key evaluated through the
   stack; stacks that change topology per key, like a boolean on a blinking eye, carry keys over by
   nearest vertex); Subdivision, simulations and motion-only deformers are dropped and listed;
3. skins bone-parented and unweighted rigid parts to their bone;
4. builds a **deform-only skeleton**: parents from constraint targets, joint contact (a bone's head at
   another's tail) and stand-ins (a deform bone copying a control bone); twist/helper bones stay
   leaves; one root; rest matrices copied exactly. The file's **clips are baked** onto it (Action-
   constraint poses and old pose libraries are not clips);
5. limits weights to four, normalizes them, gives unweighted vertices a neighbour's weights;
6. turns toon/custom materials into Principled with their colour texture or flat colour; packs
   textures that exist;
7. makes every chosen object selectable and visible (drivers on visibility removed), exports in the
   rest pose, and **reads the GLB back**: bones present, parents as planned, rest heads, every vertex
   weighted, ≤ 4 influences, per-object bounds. The result is in the import report (`blend_check`).

The worker keeps every object until export (boolean cutters, mirror centres), and exits without
Blender's teardown (the 178 MB file crashed there).

## Non-humanoid characters

See [creatures.md](creatures.md): skeleton families, creature bone roles, the creature motion layer
(own clips, procedural life, family emotes), lip-sync with a jaw, retargeting only between compatible
families, stage framing.

## Tests

- `apps/server/test/blender-creatures.test.ts` — synthetic fixtures from
  `tools/avatars/creature-fixtures.py`, one per cause (control rig, rigid parts, modifiers with keys,
  hidden parts, transforms, materials, curves and particle hair, weights, clips) and per family
  (humanoid named/unnamed, quadruped named/unnamed, winged quadruped, dragon, serpent, generic);
  plus the owner's samples when `samples/3d` exists. Needs `EVERLOOM_BLENDER`.
- `tools/avatars/test-export-core.py` — the flat constraint rig and inverse binds.
- `packages/engine/test/family.test.ts` — family detection and structural mapping without Blender.
- `tests/e2e/creatures.spec.ts` — the samples through the app onto the stage (screenshots, video).
