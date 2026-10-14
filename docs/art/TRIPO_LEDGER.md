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
| 3 | 2026-10-14 | hair-pixie | 222-nano-z-image-turbo-parts-hair-pixie.jpg | 24920 | 24860 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 25 parts incl. a separate stand-in head; 46.4k triangles |
| 4 | 2026-10-14 | hair-long-straight | 224-nano-z-image-turbo-parts-hair-long-straight.jpg | 24860 | 24800 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 44 parts; 45.2k triangles |
| 5 | 2026-10-14 | hair-long-straight-bangs | 225-nano-z-image-turbo-parts-hair-long-straight-bangs.jpg | 24800 | 24740 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 122 parts; 43.6k triangles |
| 6 | 2026-10-14 | hair-long-wavy | 226-nano-z-image-turbo-parts-hair-long-wavy.jpg | 24740 | 24680 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 49 parts incl. stand-in head; 48.2k triangles |
| 7 | 2026-10-14 | hair-ponytail-high | 227-nano-z-image-turbo-parts-hair-ponytail-high.jpg | 24680 | 24620 | no | the stand-in face is fused into the fringe and cannot be separated cleanly; a free retry (exported as hair-ponytail-high-r2) came out as a side ponytail with the same problem. Regenerate later from a cleaner reference; HD H3.1, parts (Detailed), private; 56 parts incl. stand-in head; 48.7k triangles; Tripo turned it sideways |
| 8 | 2026-10-14 | hair-ponytail-low | 228-nano-z-image-turbo-parts-hair-ponytail-low.jpg | 24620 | 24560 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 51 parts incl. stand-in head; 48.5k triangles |
| 9 | 2026-10-14 | hair-twintails | 229-nano-z-image-turbo-parts-hair-twintails.jpg | 24560 | 24500 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 34 parts, no stand-in; 47.9k triangles |
| 10 | 2026-10-14 | hair-braid-single | 230-nano-z-image-turbo-parts-hair-braid-single.jpg | 24500 | 24440 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 31 parts incl. stand-in head and neck; 47.6k triangles |
| 11 | 2026-10-14 | hair-twin-braids | 234-nano-z-image-turbo-parts-hair-twin-braids.jpg | 24440 | 24380 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 55 parts incl. stand-in head; 47.7k triangles |
| 12 | 2026-10-14 | hair-bun-top | 232-nano-z-image-turbo-parts-hair-bun-top.jpg | 24380 | 24320 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 68 parts incl. stand-in head; 40.2k triangles |
| 13 | 2026-10-14 | hair-double-buns | 233-nano-z-image-turbo-parts-hair-double-buns.jpg | 24320 | 24260 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 40 parts, no stand-in; 47.1k triangles |
| 14 | 2026-10-14 | hair-curly-long | 236-nano-z-image-turbo-parts-hair-curly-long.jpg | 24260 | 24200 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 64 parts incl. stand-in head; 48.3k triangles |
| 15 | 2026-10-14 | hair-curly-short | 248-nano-z-image-turbo-parts-hair-curly-short.jpg | 24200 | 24140 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 31 parts; 48.2k triangles; came out tousled rather than curly |
| 16 | 2026-10-14 | hair-hime | 238-nano-z-image-turbo-parts-hair-hime.jpg | 24140 | 24080 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 54 parts incl. stand-in head; 45.7k triangles |
| 17 | 2026-10-14 | hair-shoulder-layers | 239-nano-z-image-turbo-parts-hair-shoulder-layers.jpg | 24080 | 24020 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 26 parts incl. stand-in head; 48.5k triangles |
| 18 | 2026-10-14 | hair-side-ponytail | 240-nano-z-image-turbo-parts-hair-side-ponytail.jpg | 24020 | 23960 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 45 parts incl. stand-in head; 47.0k triangles |
| 19 | 2026-10-14 | hair-undercut | 241-nano-z-image-turbo-parts-hair-undercut.jpg | 23960 | 23900 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 27 parts incl. stand-in head; 46.6k triangles; came out shaggy rather than an undercut |
| 20 | 2026-10-14 | hair-spiky | 242-nano-z-image-turbo-parts-hair-spiky.jpg | 23900 | 23840 | yes | reviewed (thumbnails on both bases, motion in the parts maker); HD H3.1, parts (Detailed), private; 51 parts incl. stand-in head; 48.5k triangles |
