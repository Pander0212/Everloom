# Everloom art style

Decided after the comparison calls (#1–#12 in [LEDGER.md](LEDGER.md)); see
[PROMPTING.md](PROMPTING.md) for how each model is prompted.

## The comparison

| Brief | `qwen-image` | `hidream` | `z-image-turbo` | `chroma` | ElectronHub anime SDXL |
|---|---|---|---|---|---|
| 4×4 pixel icon sheet | all 16 right, in order, on grey tiles | duplicates and skipped items | **all 16 right, crisp pixels, plain background** | not tried (weak at grids) | not tried |
| Character bust | **clean anime, plain background, closest to the brief** | odd red nose, mangled pencil | good, more realistic; pencil became an earring | good, but painted a signature | best anime face; pencil missing; output terms unclear, so not shipped |
| 16:9 tavern background | good, cramped | over-saturated, crushed shadows | **best: open middle for characters, coherent perspective** | — | — |

Choices: **Z Image Turbo** for icons and backgrounds, **Qwen Image** for characters and spot
illustrations, **Step Image Edit 2** for expressions (from one base, never chained).
Everything shipped comes from NanoGPT, whose terms assign the output to us; the ElectronHub
images were comparisons only.

## One look

- **Characters and illustrations:** anime illustration, clean confident line art, soft cel
  shading, warm muted palette, plain flat backgrounds for anything that gets cut out. Faces are
  friendly and calm, adults unless the subject is a creature, always fully clothed.
- **Backgrounds:** painted visual-novel scenes in the same palette, no people, eye-level 16:9
  with the middle kept open for sprites; daylight or warm evening light (the stage adds weather
  and night itself).
- **Item icons:** pixel art on one **32×32 grid**, one shared **64-colour palette** (built from
  all icons), and one **1-pixel dark brown outline** (`#2B1D18`), with soft top-left light and a
  slight 3/4 view. Drawn at 2× or 3× with `image-rendering: pixelated`, smooth below 32 px.

## Never

Text or lettering, logos or brand marks (including look-alikes: rejected the energy-drink claw
and the fries "M"), watermarks or signatures, real people, franchise characters, protected
emblems (the Red Cross: the first-aid kit is green with a white plus), anything not all-ages,
broken anatomy (extra fingers, merged limbs).

## Processing

- Icons: `tools/art/icons.py` (cut, gap-closing background removal, 32×32 grid, shared
  palette, outline, speck removal) → `apps/web/public/art/items/*.png`.
- Pictures: `tools/art/pictures.py` → WebP (quality 80) plus AVIF for large ones, served through
  `<picture>` with the WebP as the fallback; lazy-loaded with explicit sizes.
