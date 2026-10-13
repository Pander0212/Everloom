# Unity and creator work: verification and remaining work

This is the implementation checkpoint for the owner's brief. Tripo generation, automation and purchases are excluded at the owner's request. The overall brief is **not yet complete**.

## Verified

- Upstream dictionary fix applied from `master` (`66cc7fa`). Baseline: 825 tests passed, 8 skipped; build, typecheck and first-run browser setup passed.
- Resumable 4 MiB uploads, persistent cross-package GUID library, staged-file cleanup, streamed tar/ZIP indexing and lazy browser dependencies.
- The supplied four-colour outfit: each variant converted in Chromium at a 390×844 viewport with its model, four materials and five textures. Two references in the supplied archive genuinely lack their texture files. Private outputs stay under ignored `samples/3d`.
- Blender 5.2.0 LTS installed from the official archive and SHA-256 verified. All three supplied `.blend` files converted with no required humanoid bones missing. The flat constraint-driven rig required hierarchy repair; see the decisions document.
- Synthetic Blender test: restored source parents/selection/rest matrices and valid inverse bind matrices with a rotated, scaled armature.
- 1,075,058,543-byte synthetic Unity ZIP uploaded on the phone profile at 4 MiB/s with 40 ms latency, a forced disconnect at 64 MiB, page reload and reselection. It resumed at the acknowledged offset and imported/rendered the avatar. Browser run: 2 tests passed (including setup), 9.3 minutes. The padding tests archive/transport memory; it is not a billion-byte geometry test.
- [Import sheet after resume](evidence/large-upload-phone.png) and [rendered result](evidence/large-import-phone.png) were inspected. Both use the repository's synthetic avatar, not the owner's private models.
- Latest broad regression run: 851 tests passed, 3 skipped (126 files). The subsequent dress-skirt morph-transfer regression passed separately. Typecheck and production build passed after catalog integration.
- Phone creator edit/save/VRM export/reload passed after fixing a sticky preview that covered controls. Pack installation and generated internal-anatomy save passed. Catalog search, selection and favourite persistence passed on the phone profile. The catalog screenshot and updated dress preview were inspected; the hip seam is closed after morph transfer. The final export/re-import rerun passed (2 tests including setup, 1.1 minutes).
- The supplied 84,774,788-byte `.blend` resumed after a disconnect at 16 MiB, reload and reselection on the throttled phone profile (4 MiB/s, 40 ms). It converted with Blender 5.2, retained its validation report, and had no missing required humanoid bones (2 tests including setup passed, 53 seconds). No private screenshots are published.

- Pending split-avatar phone import passed: queue prefab, reload, add model package, automatically finish exactly one avatar without another Import click. Queue API checks passed (4 library tests).
- Persona 3D and NPC off/ask/automatic modes passed on the phone, including cached recipe reuse (2 tests including setup).

- Unity outfit → different-base fitter → body morph transfer → saved garment passed on the phone. The arms-up/max-morph screenshot was inspected; this is a synthetic shirt/base check, not acceptance of every private outfit.
- The existing fitted-shirt story test passed: inventory equipment, swipe rollback and partner handshake. Persona/NPC phone evidence was inspected.
- License/readme display and saved reports now use the selected product and dependency folders, retaining global terms. This is a path-based association because the retained GUID library does not record original archive boundaries.

## Implemented; acceptance still in progress

Mesh/material wardrobe switches, body-hiding shape associations, cross-avatar skeleton alignment and preservation of weighted secondary chains within the phone bone budget; animation-only package preview and approximate humanoid muscle conversion; persona 3D selection/stage use; description-to-creator recipes constrained to installed built-ins; NPC off/ask/automatic recipes and caching; character/body/face/outfit presets. Hair/clothing catalogs now include 51 rendered thumbnails, search, tag filtering and device-local favourites.

`tools/avatars/build-anatomy-pack.ts` generates an optional external ZIP with parametric male/female anatomy and schematic internal organs. The creator supports their shape parameters and internal cutaway, and hides unavailable chest controls. Geometry is original mathematical construction; generated anatomy remains outside Git. The browser check covers internal-model persistence, not anatomical accuracy or all external-model poses. Existing chest morph/layer packs can be merged as the generator's second argument.

## Remaining acceptance / implementation gaps

- Browser checks for secondary-chain motion, variant switching and standalone animation playback on multiple avatars.
- Large-geometry conversion memory and visual pose comparisons on the private Blender models. Conversion success and bone-map completeness alone do not prove every pose is correct.
- Remaining requested non-Tripo part types and controls; catalog search/favourites cover the existing built-ins.
- Anatomy model alignment, shape extremes and external distribution; internal-model save is checked, but this is not a finished sculpted anatomy library. SPS attachment metadata is retained, but SPS deformation/depth actions are not implemented.
- Salad deployment path and external rented-worker acceptance. No paid worker has been started.
- Final documentation reconciliation and full acceptance after the remaining implementation work.

The follow-up Unity browser checks passed cross-avatar fitting, queued split import, the avatar/outfit package flow, body secondary motion/sliders, and the loose-file fallback. The latter exposed and fixed loss of inferred texture links on replanning, ignored manual texture choices, and unrelated retained materials entering a loose-file import. Focused unit/API regression: 12 passed. Standalone generic rotation, blendshape and approximate humanoid-muscle `.anim` clips previewed and saved on the phone (4 tests including setup passed). Typecheck and both production builds passed. Playback on multiple avatar rigs remains a separate acceptance item.

## Reproducing checks

```sh
export EVERLOOM_BLENDER=/path/to/blender-5.2.0-linux-x64/blender
npm run typecheck
npm test -- --maxWorkers=2
npm run build
python tools/avatars/large-unity-fixture.py samples/3d/large/large-unity.zip
EVERLOOM_LARGE_UNITY="$PWD/samples/3d/large/large-unity.zip" npm run test:e2e -- tests/e2e/large-3d.spec.ts --project=phone-390-light
```

`apps/server/test/private-3d.test.ts` detects the owner's known files under `samples/3d` and skips when absent. Blender checks also require `EVERLOOM_BLENDER`. The optional large browser check skips unless `EVERLOOM_LARGE_UNITY` names a generated archive. `E2E_CHROMIUM` can select a locally installed Chromium for these 3D specs.
