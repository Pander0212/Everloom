# Tripo ledger

Every model made in Tripo Studio for the 3D parts library, in order: the date, the item, the
reference image it was made from (in `~/Everloom-Tripo/refs`, never the repository), the Studio
credits shown before and after, and whether the model was kept. The outputs belong to the owner as a
paid subscriber (Tripo terms §5.2.2) and are shared only as packs, never committed.

Limits set by the owner (2026-10-13): at most **40 models a day**, in **batches of 10**, one at a time
at a human pace; stop and ask on any captcha, warning, rate-limit message, unusual page or credit
problem. Nothing is published; 18+ items stay private.

The reference images are listed in [LEDGER.md](LEDGER.md) (labels `parts-…`) and the queue in
[parts-queue.json](parts-queue.json).

**How a model is made** (Studio settings, decided 2026-10-14): HD Model, H3.1, Private, Triangle
topology, polycount 50 000, **Generate in Parts (Detailed)** on. Parts mode separates every strand,
bow or panel (and any stand-in head Tripo models underneath), which gives hair and skirts their own
swing chains; the segmentation that follows is included in the 60 credits. Parts mode makes geometry
only: hair takes Everloom's tintable material instead of a Tripo texture (+30 credits, not used);
clothing with prints may need the texture, decided per item. Exporting is free.

**From model to pack:**

1. the GLB goes to `~/Everloom-Tripo/<category>/<name>.glb` (and a copy to `samples/tripo/`, git-ignored);
2. `blender --background --factory-startup --python tools/art/tripo-process.py -- --input … --base apps/web/public/avatar/bases/anime-f.glb --slot hair --name <name> --out ~/Everloom-Tripo/processed [--ref <reference>]`,
   once per base (anime-f, anime-m): cleans, drops stand-ins (separate or fused), decimates, fits to
   the base, wraps outside the skin, rigs (skin weights; hair_N_k / skirt_N_k swing chains), copies
   the body sliders as morphs, and writes the part GLB, a thumbnail and a report;
3. look at the thumbnail and at the part in motion (the parts maker with a `--pending` review pack),
   then set **Kept** to `yes`;
4. `npx tsx tools/art/build-library-pack.ts [--rating adult] [--pending]` writes one pack per base to
   `~/Everloom-Tripo/packs` (meshopt-compressed), imported in Settings › Part packs.

| # | Date | Item | Reference | Credits before | Credits after | Kept | Notes |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-14 | hair-bob-blunt | 220-nano-z-image-turbo-parts-hair-bob-test.jpg | 25035 | 24980 | yes | reviewed in motion (8 sector chains; fused stand-in face removed);  HD model, H3.1, private; 1.91M triangles, 4K texture, 63 MB GLB |
| 2 | 2026-10-14 | hair-short-messy | 221-nano-z-image-turbo-parts-hair-short-messy.jpg | 24980 | 24920 | yes | reviewed in motion (24 chains, tips swing ~2–5 cm in a dance);  HD model H3.1, Generate in Parts (Detailed), private; segmentation free; 44 strand parts, 48.6k triangles, 1.25 MB GLB; parts mode makes geometry only (Tripo texture would be +30, not used: hair takes the Everloom toon material) |
