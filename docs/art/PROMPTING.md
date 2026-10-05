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

- `POST https://api.nano-gpt.com/api/v1/images` with JSON `{model, prompt, n: 1, resolution}` and,
  for edits, `input_references: ["data:image/png;base64,…"]`. Only `resolution` and `n` (plus
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
- **How to pass the image:** `input_references: ["data:image/png;base64,…"]`. Resolution may be
  `auto` (follows the input) or one of 1024x1024, 768x1360, 896x1184, 1360x768, 1184x896.
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
