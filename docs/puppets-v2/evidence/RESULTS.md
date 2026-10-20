# Acceptance results (2026-10-20)

Recorded with `tools/puppets2/evidence.mjs` in Chromium on a phone viewport (390×844, pixel ratio 1.5
for the stage), against the server rigging the packs on import. Clips and frames are in the
git-ignored `samples/gen/puppets2/evidence/` (generated characters stay out of the repository); the
procedural-figure equivalents are in this folder.

Characters: **Ines** (generated, adult, 7.1 heads: front + three-quarter + profile, outfits *casual*
with a pleated skirt and *street* with a jacket and jeans, 5 expressions, 5 mouth shapes, a waving
hand; 85 layers), **Teo** (a second generated adult body, 7.8 heads, broader build: retargeting), and
the **v1 placeholder** upgraded to a full-body pack (22 layers).

| # | Check | Result |
|---|---|---|
| 1 | Wave: elbow ~120°, waving hand, no hole at elbow or shoulder | Pass. Elbow 105–135° through the swing (unit test); the waving hand sprite swaps in; the skinned arm bends as one mesh. The torso's shoulder cap shows a little skin edge when the arm is fully up. |
| 2 | Arms up, arms crossed (right over left), hands on hips | Pass. |
| 3 | Walk across in profile, feet locked, turn back | Pass. Front → three-quarter → profile turn, walk at ground speed (planted foot drift < 1.5 px in the unit test), turn back on arrival. The profile is the weakest view: its arm is drawn over the body, so 10 % of the torso there is filled in. |
| 4 | Physics on walk and jump | Pass for hair, skirt (own swinging bone), bust and butt pendulums; they settle within ~2 s. No tearing seen; feathered caps and overlapping cuts keep seams closed. |
| 5 | Outfit swap in the story, sleeves bend, swipe rolls back | Pass: the story's `avatar.outfit` swaps the set, sleeves are skinned to the arm bones; the e2e test swipes and the outfit comes back off. |
| 6 | Talking with expressions, blinks | Pass: mouth shapes cycle while a line is spoken, blinks every 2–6 s, the story's emotion picks the expression (smile, angry, sad, surprised). |
| 7 | Same motions on a differently proportioned character | Pass (Teo: wave, arms crossed, walk; retargeting unit test: stride scales with leg length). |
| 8 | Three on stage at 60 fps | **33 fps measured** with 4× CPU throttle and software WebGL (SwiftShader) for three real characters (14 000 triangles, 40 draw calls); CPU time 8.6 ms per frame, inside the 16.7 ms budget. The procedural figures run at 57–61 fps in the same setup. The pixel fill of large textures in software rendering is the limit here; a phone GPU wasn't available to measure. |
| 9 | Gate reports and contact sheets for both characters | Pass: `samples/gen/puppets2/{ines,teo,v1-placeholder}/gates-*.json` and `contact-*.png`; every gate passes (the placeholder's A-pose gate is overridden on purpose: its arms hang down). |
| 10 | An existing puppet, migrated and working | Pass: the v1 placeholder (`tools/puppets2/from_v1.py`) waves, crosses its arms and stands on stage with the others; the v1 puppet itself still runs on its own runtime. |

Bugs found in these runs and fixed: knees flipping at rest (IK bend side now follows the drawing),
seams at the crotch (cut overlap, torso crotch cap), underwear over the skirt (clothes above the
torso), the skirt found in one view only, specks in layers (noise islands removed), a mixed cast
sharing one wardrobe in the lab.
