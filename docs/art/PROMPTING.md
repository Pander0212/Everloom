# Prompting the image models

Written before any image was generated (Phase 4, part 7). Sources were the services' own model
lists and docs, read on 2026-10-05:

- NanoGPT `GET /api/v1/images/models` and `/api/v1/images/models/{id}/endpoints`
- NanoGPT's Image API, Subscription Usage, Check Balance and billing-override docs
- ElectronHub `GET /v1/models` and its Image Generations docs
- model cards and community guides for each model (listed at the end)

What we may call, and nothing else:

| Service | Model | Exact ID | Why this ID |
|---|---|---|---|
| NanoGPT (subscription) | HiDream I1 Full | `hidream` | Name "Hidream", description "Hidream I1 Full". Not `hidream-i1-fast`, `hidream-i1-dev` or `hidream-o1-image`. |
| NanoGPT (subscription) | Chroma | `chroma` | Name "Chroma", owned by lodestones. |
| NanoGPT (subscription) | Z Image Turbo | `z-image-turbo` | Name "Z Image Turbo". Not `z-image-turbo-lora` or `z-image`. |
| NanoGPT (subscription) | Qwen Image | `qwen-image` | Name "Qwen Image" (v2509). Not `qwen-image-2*` or `qwen-image-edit-*`. |
| NanoGPT (subscription) | Step Image Edit 2 | `step-image-edit-2` | Name "Step Image Edit 2". |
| ElectronHub | standard models only | `premium_model: false` in `/v1/models` | See the ElectronHub section below. |

## How the NanoGPT calls are made (and kept free)

- `POST https://api.nano-gpt.com/api/v1/images` with JSON `{model, prompt, n: 1, resolution}`; edits
  go to `POST /api/v1/images/edits` with `imageDataUrl` (see Step Image Edit 2). Only `resolution` and `n` (plus
  input images on the two image-input models) are exposed. **Steps, guidance (CFG), sampler and
  negative prompt can't be set through this endpoint**, so everything below is about the prompt
  text and the resolution. Each provider runs its model's defaults (HiDream Full about 50
  steps at CFG 5; Z Image Turbo 8 steps at CFG 0; Chroma about 26–40 steps at CFG 3–4).
- The key's routing reports `billingMode: subscription_only` with paid spending off, 100 images a
  day (resetting at 00:00 UTC). Our own cap is **95 a day**.
- Before and after every call, `tools/art/gen.mjs` reads `GET /api/subscription/v1/usage`
  (`dailyImages.used`) and `POST /api/check-balance` (`usd_balance`). A call counts as included only
  if `used` went up and the balance didn't move. A balance change, a 402, any "insufficient",
  "quota" or "payment" error, or `used` not moving stops the run and is written to the ledger.
- Never send `billing_mode`, `X-Billing-Mode` or `X-Provider` (any of these switches to paid
  billing).

## HiDream I1 Full (`hidream`)

- **What it is:** 17B sparse diffusion transformer with Llama-3.1-8B and T5 text encoders. Strong
  prompt adherence and composition, good at illustration and anime, decent with short text.
  MIT-licensed weights.
- **Prompt style:** full natural-language sentences, ordered subject → action/pose → setting →
  style → lighting → composition. Effective length is about 128 tokens; it accepts up to 3,000
  characters, but past roughly 70 words, detail starts to be dropped. Put the medium first:
  "Anime illustration of …".
- **Negatives:** the model supports them, but this endpoint doesn't pass them. State constraints
  positively instead: "clean plain background", "no text anywhere in the image", "single character,
  full body visible".
- **Resolutions:** 1024x1024, 768x1360 / 1360x768 (16:9-ish), 880x1168 / 1168x880, 1248x832 /
  832x1248, plus 1024x768, 768x1024, 1024x576, 576x1024, 1408x1024, 1024x1408, 512x512, 2048x2048,
  1920x1088, 1088x1920. Use **1360x768** for backgrounds, **832x1248** for character art, and
  **1024x1024** for sheets.
- **Text:** short words can come out right but often don't; we never want text, so say "no
  lettering".
- **Backgrounds:** good. Ask for "empty scene, no people" or it adds figures.
- **Grids:** follows "a 4 by 4 grid" moderately; cells drift. Prefer Qwen Image for sheets.
- **Pixel art:** passable with "16-bit pixel art, crisp square pixels, limited palette"; edges are
  often anti-aliased, so the post-process snaps to a grid.
- **Weaknesses:** hands at small sizes; a glossy "AI render" look unless the style is named
  ("flat cel shading, clean line art"); adds signatures in corners when "artwork" is mentioned
  without "no signature".

## Chroma (`chroma`)

- **What it is:** 8.9B de-distilled FLUX.1-schnell derivative with a T5 encoder, Apache-2.0. Neutral,
  unopinionated base. **Uncensored**, so every prompt must be explicitly all-ages ("fully clothed",
  "wholesome", "family-friendly") and every output is reviewed.
- **Prompt style:** natural-language sentences. Tags work as a tail; comma-separated tags pull
  toward anime/cartoon, period-separated toward realism. Template: subject with detail, setting,
  style and palette, lighting, composition.
- **Negatives:** the model benefits from a real one (over 70 tokens or none), but this endpoint can't
  pass it, so phrase quality positively ("finished, detailed, in focus, clean shapes").
- **Resolutions:** 1024x1024, 1536x1024, 1024x1536, 768x1024, 1024x768, 576x1024, 1024x576,
  512x512.
- **Text:** weak. Backgrounds: good painterly range.
- **Grids/sheets:** weak. Pixel art: inconsistent.
- **Weaknesses:** raw base model, so quality varies more between seeds; anatomy errors more often
  than HiDream. Use it for painterly backgrounds and as a comparison only.

## Z Image Turbo (`z-image-turbo`)

- **What it is:** 6B distilled model, Apache-2.0, Qwen3-4B text encoder, 8 steps, **no CFG** (the
  negative prompt is ignored even where it can be passed). Fast, sharp, photoreal by default.
  Bilingual text rendering is good.
- **Prompt style:** detailed descriptive prose, at most 1,200 characters. It leans photographic,
  so name the style early and twice ("anime cel-shaded illustration … flat colors, clean line
  art"). Every constraint goes in positively ("plain white background", "sharp focus", "fully
  clothed"). A short list of the two or three defects actually seen helps; a long quality-tag wall
  hurts.
- **Resolutions:** `1024*1024`, `1280*720`, `720*1280`, `1536*1024`, `1024*1536`, `1536*1536`,
  `768*768`, `512*512`, `256*256` (asterisk form, not "x").
- **Text:** good, which is a liability; ask for "no writing or symbols".
- **Backgrounds:** strong, crisp.
- **Grids:** decent with explicit counts.
- **Pixel art:** fair.
- **Weaknesses:** drifts back to photorealism; little variety between seeds for the same prompt
  (vary the wording, not just the seed).

## Qwen Image (`qwen-image`)

- **What it is:** 20B MMDiT (v2509), Apache-2.0. Best of the set at layout, counting, and text. Also
  takes up to 3 input images (image-to-image and multi-image edits).
- **Prompt style:** precise natural language with explicit layout. It follows numbered structure
  well: "A 4×4 grid of sixteen separate game item icons, evenly spaced on a flat light grey
  background, each icon centred in its cell with empty space around it. Row 1, left to right: …".
  It accepts up to 3,000 characters.
- **Negatives:** not passable; positive constraints only.
- **Resolutions:** auto, 1024x1024, 512x512, 768x1024, 1024x768, 576x1024, 1024x576. Sheets at
  **1024x1024** (4×4 gives 256 px cells; 3×3 gives about 340 px).
- **Text:** excellent, so it must be told "no text, no labels, no numbers" or it captions every cell.
- **Backgrounds:** good. **Grids:** best of the set.
- **Pixel art:** good with "pixel art game icon, 32×32 pixel style, crisp hard pixel edges, 1-pixel
  dark outline, limited 16-colour palette".
- **Image input:** pass one to three images in `input_references` and describe the change. Good for
  "same character, new pose" from a reference.
- **Weaknesses:** the anime style is a bit generic; it adds labels unless told not to.

## Step Image Edit 2 (`step-image-edit-2`)

- **What it is:** StepFun's 3.5B instruction editor. It takes **one** input image (at most
  4096×4096, png/jpeg/webp) and returns the edited image **at the input's size**.
- **How to pass the image:** use the edits endpoint, `POST /api/v1/images/edits` with JSON
  `{model, prompt, imageDataUrl: "data:image/png;base64,…"}`. *Found the hard way:* the normalized
  `POST /api/v1/images` with `input_references` was accepted but the picture never reached this
  model; it drew an unrelated person at 1024×1024 (ledger #40–#44, four images lost). The edits
  endpoint refuses a request without the picture (`missing_image_input`), and a correct edit comes
  back at the input's size, which `gen.mjs` now checks for. Resolution follows the input.
- **Prompt limit:** 512 characters (negative prompt too, but this endpoint doesn't pass one).
- **How to phrase edits:** one change per call, imperative, naming what stays.
  1. What to change: "Change her expression to a warm open-mouthed smile with closed eyes."
  2. What to keep: "Keep the same character, hair, outfit, pose, framing, line art and colours
     exactly; keep the plain background."
  3. The format: "Same illustration style."
  Don't restate the whole scene; don't stack several edits (do them in sequence).
- **Good for:** expression sets from one neutral portrait; recolours; removing a stray artefact;
  swapping a held item.
- **Weaknesses:** large pose changes fail; repeated edits soften detail (always edit from the
  original, never from an edit); it may change the face shape slightly, so compare against the
  base and reject drift.

## ElectronHub (standard models, $2.00 hard stop)

- `POST https://api.electronhub.ai/v1/images/generations`, OpenAI-style:
  `{model, prompt, n: 1, size, response_format: "b64_json"}`.
- "Standard" means `premium_model: false` in `/v1/models`. Prices are per image, from that list,
  read before the first call:
  - `sdxl` $0.007
  - `chroma` $0.02, `z-image` $0.02
  - `neta-lumina` $0.044, `qwen-image-2512` $0.044
  - the Illustrious/anime SDXL fine-tunes (for example `sdxl-novaanimexl-ilv100`) $0.044
- The key can't read `/v1/user/me` (401), so spend is counted from the listed price of every call,
  rounded up, and the run stops before a call would take the total past **$2.00**.
- Anime SDXL fine-tunes (Illustrious family) want **booru-style tags**, not prose: `1girl, solo,
  upper body, smile, …, masterpiece, best quality`. Quality tags go first or last. They're strong at
  anime faces and weak at objects, text and layout. Size: 832x1216 portrait or 1024x1024.
- Neta Lumina (Lumina 2 base, Gemma encoder) takes natural language plus tags and is good for anime
  characters at 832x1216.

## Textures and reference sheets (Phase 5)

Written before the Phase 5 texture calls, from the model notes above and the usual guidance for
material scans; what the calls taught is added at the end.

**Seamless tiles (fabric, leather, knit, patterns):**

- Model: **Z Image Turbo** first. It leans photographic, which is what a material scan should be,
  and it's sharp at 1024. Qwen Image for printed patterns that need exact repeats (plaid, regular
  florals), since it follows layout best.
- Ask for the *material*, not an object: "a seamless tileable texture of dark blue denim twill
  fabric, flat top-down scan". Never "a pair of jeans" (you get the garment, folds and all).
- Say how it's lit and framed, positively: "evenly lit, flat diffuse light, no shadows, no
  highlights, no perspective, orthographic, the weave fills the whole frame edge to edge, uniform
  scale, no border, no vignette, no folds or wrinkles". Folds and light falloff are what break a
  tile.
- Keep the pattern small relative to the frame (several repeats across): a big motif shows as an
  obvious repeat on a sleeve.
- "No text, no logo, no watermark" as always.
- Afterwards, in code (never with more image calls): offset by half and check the seam
  (`seamScore` in `apps/server/src/services/avatars/textures.ts`); blend it (`makeSeamless`) when the
  score is poor; scale down (256–512 px is plenty for clothing), and for code-made clothes turn it
  into a neutral detail map (luminance only, normalised bright) so it multiplies with the garment's
  own colour instead of replacing it. Roughness or normal maps, if wanted, come from the same image
  in code.

**What the Phase 5 calls taught (ledger 83–89):**

- A photographic denim scan from Z Image Turbo was a perfect material, but its weave is far too fine
  to read on a toon character a few hundred pixels tall. "Stylized hand-painted game texture" plus
  an explicit scale ("about thirty diagonal ridges across the frame", "six vertical columns of
  cables") gave weaves you can see.
- Qwen Image doesn't count repeats exactly ("exactly four repeats" gave about two and a half), so
  regular patterns are cropped to a whole number of repeats in code (autocorrelation finds the
  period) instead of trusting the prompt.
- Even with "evenly lit", Z Image Turbo adds a soft light gradient; dividing by a heavy blur removes
  it, but not for flat colour blocks like plaid (it smears them), which have no lighting to remove.
- Qwen sometimes leaves a thin white border on one edge: crop 3% all round before anything else.
- "Smooth leather" came back almost featureless: ask for visible features (grain, creases, wear).
- One transient HTTP 503 (`rate_limiter_unavailable`) on the first call; the retry went through.

**Reference sheets (front, side, back) for modelling or image-to-3D:**

- Qwen Image (layout): "character turnaround reference sheet, three views of the same character
  side by side, left to right: front view, side view facing right, back view; standing straight,
  arms slightly away from the body (A-pose), neutral expression, full body head to toe, orthographic,
  no perspective, evenly lit, plain light grey background, same proportions and clothes in every
  view, no text, no labels". Image-to-3D services want the front view alone, cropped, on a plain
  background.

## Puppet templates and parts (Everloom Puppets)

Written before the first puppet call (2026-10-08), from the notes above and what the expression
sets taught (#45–#51). What the calls teach is added at the end of this section. The pipeline is
in `docs/puppets.md`; the queue and today's budget are in `PUPPET_QUEUE.md`.

**The rule: one master per template, every part by editing that master.** Parts generated one by
one never match in line weight, shading, proportions or angle. A part is the *difference* between
the master and an edit of the master (or of a base layer made from it), so it lines up by
construction.

**The master (text to image):**

- Model: the character model from `STYLE.md` (Qwen Image) unless the comparison below says
  otherwise. Try the same brief on HiDream (more pixels: 832x1248) and Z Image Turbo (1024*1536)
  once, and keep the best; parts need the face large enough (eyes at least ~40 px wide).
- Brief, in this order: the style line; "an adult woman in her mid twenties" / "an adult man in
  his late twenties" (clearly adult face and proportions, never youthful); standing straight,
  facing the viewer, symmetrical front view, arms relaxed and held a little away from the body
  with a gap between arm and waist, hands open; neutral calm expression, mouth closed, eyes open
  looking at the viewer; hair that clears the face and ears (shoulder length, tucked behind the
  ears is easier to remove than bangs over the eyes); a simple fitted base outfit in plain colours
  (this becomes the default outfit, and the edit pass reveals the underwear layer under it);
  framing from the top of the head to mid-thigh, centred, nothing cropped at the sides; "flat
  solid pure green background, uniform, no floor, no shadow, no gradient" (the key colour); "even
  soft front lighting, clean line art, soft cel shading"; "no text, no logo, no watermark".
- Colours: nothing green on the character (hair, eyes, clothes), since green is keyed out. Hair
  brown or black: it is recoloured in code later (hue shift inside the layer keeps its shading).
- Pick the master by looking: symmetry, both arms clear of the body, both hands readable, the
  face large and calm, edges clean against the green. Several attempts; the best one fixes the
  style for everything after.

**Making it big enough:** the master is upscaled 2x in code (Lanczos), then one Step Image Edit 2
pass "Keep the image exactly the same; redraw it crisply at this size with clean sharp line art,
same colours" restores line sharpness at the new size (the edit model returns the input's size).
If that pass changes the drawing (face shape, colours), skip it and work from the plain upscale.
Every later edit starts from this one *working master*, never from an edit (edits soften).

**Edits that make the layers (Step Image Edit 2, one change per call, at most 512 characters):**

- Phrase: what to change, then "Keep everything else exactly the same: the same character,
  face, pose, outfit, framing, line art and colours, and the flat green background."
- Layers by edit: hair removed ("her hair removed completely, showing the bare scalp, forehead
  and ears, as a bald head with the same skin tone"); eyes closed; eyes half closed; eyes smiling
  (closed upward arcs); mouth shapes (open, wide open, smile, "a", "i", "u", "e", "o"); brows
  raised, brows furrowed; blush; clothing removed down to plain simple underwear (sports bra and
  briefs / boxer briefs, all-ages); each alternate arm pose.
- Hidden areas are painted by a further edit of the *layer* (for example the eyeball under the
  lids: an edit of the eyes-closed image is useless; instead the eye white and iris come from the
  master, and the lid is the difference between master and eyes-closed).
- Hairstyles and outfits: edit the right base ("the same bald character, now with a long
  ponytail"; "the same character in underwear, now wearing a pleated skirt and a cardigan"), then
  the difference against that base is the new part, split into the schema's slots in code.

**In code, never with more image calls:** the difference mask (per-pixel colour distance after
a small blur, thresholded, cleaned with open/close and limited to the slot's region), keying the
green out (distance from the key colour with a soft edge and green-spill removal), filling small
holes, cutting the part with a 1–2 px overlap so neighbours never show a gap, and aligning: the
edit model can shift or rescale the whole picture a little, so each edit is registered to the
master (phase correlation on the unchanged area) before the difference is taken; an edit that
moved the face or changed its shape beyond a small tolerance is rejected.

**What to expect (to be confirmed by the first calls):** edits re-render the whole picture, so
"unchanged" areas differ by a few levels and the background may not stay perfectly flat; small
features (irises, mouths) may drift a few pixels; large pose changes fail (arm poses may need
several tries or a hand fix); Qwen tends to centre and simplify.

**For See-through (the layering step):** it was trained on anime and VTuber-style illustrations.
Give it a clear silhouette on a flat background (we send the keyed master with a transparent
background), nothing crossing the face (no hands, props or hair strands across the eyes), arms
held away from the body so it doesn't have to guess where they end, and plain readable clothing
layers. Hairstyles and outfits for a template are edits of the template's master ("the same
character, now with a long ponytail"), run through See-through in the same batch as everything
else, so the new hair or clothes come out as layers that line up.

**What the first puppet calls taught (2026-10-08, ledger #90–#142):**

- Master model: Qwen Image has the nicest anime faces but painted a floor and wall instead of a flat
  key and is limited to 768x1024; HiDream ignored the green and smudged the shirt; **Z Image Turbo**
  with "anime cel-shaded illustration" said twice gave a truly flat key, the framing asked for,
  clear gaps between arms and body, and 1024x1536 (the face about 230 px wide). Chosen.
- **The working master:** every Step Image Edit 2 result is a little brighter and greener than a Z
  Image Turbo JPEG (~14 levels off on the background). One identity edit ("keep the image exactly
  the same… clean up compression noise only") gives a master in the editor's own colours; against
  it, later edits differ by ~3 levels where nothing changed. All edits start from it.
- A 2x Lanczos upscale plus a "redraw crisply" edit sharpened lines a little but faded colours: not
  worth it. Native 1024x1536 is enough for phones.
- Edits line up well (registration shifts under 3 px) but leak: "eyes closed" also smiled; "mouth
  wide" also frowned; "raise the hand" recoloured the trousers. Cut every part from its own region
  only, and colour-match per region.
- "Remove the irises" gives clean white eyes; the difference to the master is exactly the irises,
  which is the best way to find the eyes.
- Line art jitters by a pixel or two between edits: a plain difference marks every outline. Compare
  each pixel with the best match within two pixels, and fill only small holes (filling all holes
  fills the whole face outline).
- Underwear, "remove both arms" (they end up tucked behind the back), hand on hip and a raised hand
  all came out cleanly on the first try for both templates.
- Two transient 503s (`rate_limiter_unavailable`), not counted; retried later.

## Rules for every prompt (all models)

- **All-ages only:** fully clothed, no suggestive poses, no gore. For Chroma and the anime fine-tunes,
  say it.
- No real people, no franchise characters, no logos or brand marks, no text or watermarks: say "no
  text, no logo, no watermark, no signature".
- One art direction, from `docs/art/STYLE.md` once it exists: the prompt opens with the style line.
- Record every call in `docs/art/LEDGER.md` (date, service, model, prompt, cost or count, running
  total, kept or not).

## Sources

- HiDream I1: [fal model page](https://fal.ai/models/fal-ai/hidream-i1-full), [ComfyUI tutorial](https://docs.comfy.org/tutorials/image/hidream/hidream-i1), [Civitai prompt notes](https://civitai.com/articles/16050/hi-dream-prompt-engineering)
- Chroma: [lodestones/Chroma1-HD](https://huggingface.co/lodestones/Chroma1-HD), [diffusers docs](https://huggingface.co/docs/diffusers/api/pipelines/chroma), [community guide](https://github.com/maybleMyers/chromaforge/blob/main/levzzz_chroma_guide.md)
- Z Image Turbo: [fal prompt guide](https://fal.ai/learn/devs/z-image-turbo-prompt-guide), [community guide](https://gist.github.com/illuminatianon/c42f8e57f1e3ebf037dd58043da9de32)
- Step Image Edit 2: [StepFun docs](https://platform.stepfun.ai/docs/en/guides/models/step-image-edit-2)
- Qwen Image: the NanoGPT model description and its model card (text rendering, multi-image editing)
- NanoGPT: [Image API](https://docs.nano-gpt.com/api-reference/image-generation.md), [Subscription Usage](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage.md), [billing override](https://docs.nano-gpt.com/api-reference/miscellaneous/billing-override.md)
- ElectronHub: [Image Generations](https://docs.electronhub.ai/api-reference/images/generations.md), `/v1/models`

### Outfits on a nude base (Seedream 4.5), lessons from run 3

- Seedream keeps the base's pose and face exactly, which is what makes outfits line up as layers.
- It sometimes leaves the base showing: a skirt with no top, a dress or bikini drawn sheer enough
  that nipples or genitals show through. Check every outfit by eye. Redo the half-dressed ones
  ("…covers her whole chest completely, with its top and straps clearly drawn"); rate the
  see-through ones 18+ (they then show only with adult content on) or redo them.
- None of this art goes to GitHub: generated characters, outfits and built puppets stay in the
  git-ignored `.puppets-work/` and `apps/web/public/puppets/local/` (scripts/check-pack-art.mjs
  refuses them), and 18+ prompts stay out of the ledger (`gen.mjs --adult`).
