# Tripo sessions

One report per Tripo Studio session: what was made, what it cost, what was kept, and what the
processing (tools/art/tripo-process.py) needed. The model-by-model record is [TRIPO_LEDGER.md](TRIPO_LEDGER.md).

## 2026-10-14 — hair, batches 1 and 2

**Made:** 20 models (2 batches of 10; the daily cap is 40), all hairstyles, all HD H3.1, private,
"Generate in Parts (Detailed)". One free retry (Studio's "Free Retry", no charge).

**Credits:** 25 035 → 23 840 (1 195: the first model 55, the others 60 each). Segmentation, the
free retry and every export cost nothing. Texturing (30 per model) was not used: parts mode makes
geometry only, and hair takes Everloom's tintable material.

**Kept:** 19 for review in packs; 1 rejected (hair-ponytail-high: its stand-in face is fused into
the fringe; the free retry came out as a side ponytail with the same problem; regenerate later
from a cleaner reference). Two came out unlike their reference but usable: hair-curly-short is
tousled rather than curly, hair-undercut shaggy rather than an undercut.

**What Tripo does that the processing had to handle:**

- most hair comes with a **stand-in head** (sometimes cut into several pieces, sometimes with a
  neck, sometimes with bits of it fused into the fringe); it is found from the hollow under the
  crown, used to place the hair on the base's head, and removed;
- a model can come out **turned sideways**; the fringe side is found and turned back to face front
  (when there is a stand-in head, its face settles it);
- one-piece models (no parts) have the stand-in fused in; its smooth shell is cut out;
- parts are many (25–122 per hairstyle); the 24 that hang furthest get swing chains, caps and crown
  pieces stay on the head, anything lying on the scalp is pinned to it.

**Checked:** thumbnails of all 19 on both bases (anime-f, anime-m); all 19 loaded in the parts maker
from the built pack and danced, with the motion of every chain tip measured against the head: no
NaN, no runaway tips; short styles move a few centimetres (spiky 6, short curly 3), long hair 20–40.
The first motion check found crown pieces flung off the head in a dance; fixed (only hanging pieces
swing, the scalp is pinned, locks are rooted at the skull) and looked at frame by frame again.

**Packs:** `~/Everloom-Tripo/packs/everloom-library-anime-f.zip` (19 parts, 14.8 MB) and
`…-anime-m.zip` (14.4 MB), meshopt-compressed; imported in the local app for the review. Not
shared anywhere.

**Next:** clothing (tops, jackets, dresses, skirts) — first one or two items to test the body-span
fit and skirt chains before a batch; then footwear, accessories, fantasy parts; the 18+ parts after
the all-ages set. Missing references to redo with Qwen: swim-onepiece, shoe-loafer, gloves,
ears-wolf, horns-small, tail-cat, tail-fox, tail-dragon, wings-insect.

### Later on 2026-10-14 — four-side review and the new method

The owner found most hairstyles didn't fit (short curly missing its back). A four-side review
(tools/art/tripo-views.py) rejected 11 of 19; 8 kept. New method, proven on short curly: render our
bald base bust (tools/art/base-bust.py; --span 1.0 for long hair), let Tripo's free image tool draw the
hairstyle on it, generate the whole model (30), check it from four sides, only then segment (40), name
the bust pieces (tools/art/tripo-pieces.py → sidecar JSON) and process: the hair is registered by the
bust, so it lands where it was drawn. Credits now 23 700.

**Next session:** finish hair-short-messy-v2 (name leftover pieces), then redo pixie, spiky, undercut,
double buns (short bust) and twintails, hime, long straight, low/high ponytail, shoulder layers (long
bust). Base body: Tripo's terms forbid "obscene" content, so explicit anatomy is made locally in
Blender (morphs on our base), not on Tripo; Tripo can do a better clothed/neutral base and auto-rig (20).
