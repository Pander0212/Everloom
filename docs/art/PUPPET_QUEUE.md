# Everloom Puppets: work queue

Where the puppet work stands and what comes next, so each run continues where the last stopped.
Budget rules: [PROMPTING.md](PROMPTING.md) (NanoGPT at most 95 images per UTC day, five models),
[GPU_LEDGER.md](GPU_LEDGER.md) (RunPod: keep $0.50). Spec: [../puppets.md](../puppets.md).

## Done (2026-10-08, run 1)

- Research and the format decision (PHASE2_DECISIONS.md › Everloom Puppets).
- Engine: format, evaluation, template rig, life, physics, auto-meshes, Inochi2D import/export,
  with tests. Web: the WebGL player and `/lab/puppets`. The placeholder puppet.
- Masters: female `#96` → working master `#102`; male `#103` → working master `#107`
  (Z Image Turbo, 1024x1536, flat green). Working files in `.puppets-work/f|m/working.png`.
- Edit sets (Step Image Edit 2), both templates: eyes half/shut/smile/blank, mouth a/wide/smile/i/u/
  e/o, brows up/down, blush, bald, underwear, armless, hand on hip, raised hand (female `#98–#123`,
  male `#124–#142`; the male "u" mouth, #132, failed with a 503 and needs a retry). Mostly good; mouth "i"/"e" read alike; blush is strong (use at low opacity);
  "raise" moved the trousers' colour (cut by region, colour-matched).
- `tools/puppets/cut.py`: registration, keying, tolerant differences, landmarks, a first cut of
  every slot from edits.
- The See-through worker and the RunPod session tool, with its guards. Inputs prepared in
  `.puppets-work/seethrough-in/` (both masters, hip, raise, underwear, keyed).

## Done (2026-10-08, run 2): first real See-through session

- One RunPod session (RTX 3090 community, $0.22/h, 46 min of which ~17 were the image pull,
  $0.17; nothing left running or stored): the owner's own test character in four pictures
  (three outfits and an 18+ body), keyed with `tools/puppets/key.py`. All four layered.
- `tools/puppets/map.py` (layers → slots and landmarks) and `build-puppet.ts` (parts folder →
  rigged puppet) work end to end: the three outfits run in `/lab/puppets` with head turns, blinks
  (lids made from the lash layer), talking (placeholder mouth shapes), breathing, hair physics.
- Fixed on the way: `puppet.json` rounded texture coordinates to 0.01 (20 px on a 2000 px page;
  small parts sampled their neighbours), now 1e-6 (`puppetJson`); a disposed stage could come back
  to life after an in-flight load (React's double mount in dev) and blank the canvas.
- Seen in See-through's output: `handwear` is the arms and hands (mapped to `arm.l/r`), `legwear`
  the bare legs, `topwear` carries the visible torso skin; there is no separate body-skin tag. The
  face comes back with the eyes, brows and mouth painted out (good for expressions); the back hair
  is completed behind the head.

## Next

0. With the owner's verdict on the test: mouth and eye-smile drawings by edit (Step Image Edit 2
   on the owner's picture, cut by `cut.py`) instead of the placeholder shapes; warps sized to long
   hair (hair reaches past the back-hair warp, which only matters in turns).

1. **Run See-through** on `.puppets-work/seethrough-in/*.png` (one session, about 40–60 min,
   $0.15–0.45): `RUNPOD_API_KEY=… node tools/see-through-worker/session.mjs run --max-minutes 75
   --out .puppets-work/seethrough-out .puppets-work/seethrough-in/*.png`. Needs the owner's
   permission in the agent environment (the first try found no free card; the second was held for
   approval).
2. **Map the layers to the schema** (a `map.py` beside `cut.py`): tags → slots as in
   puppets.md, visible pixels re-projected from the master, left/right split; expression parts from
   the edits via `cut.py` (which already measures landmarks).
3. **Pack builder** (`npm run puppets:pack`): parts → atlas → `buildTemplateRig` → `puppet.json`,
   manifest, checksums, Discord readme; the gitignore guard for pack images.
4. **Tune the rigs by looking** in `/lab/puppets?puppet=…`: sweeps of AngleX/Y, eyes, mouth, breath,
   body shape; clips; evidence in `docs/puppets-evidence/`.
5. **Feature switch, stage integration, story ops** (expression, form, outfit; roll back with swipes),
   the installer (Settings › Puppets), the maker, recolouring UI, the wardrobe link.
6. **Starter hairstyles and outfits** (8 + 8 per template): edit the master, run See-through on the
   batch, take the new hair or clothing layers. About 1–3 images each.
7. **Adult layer**: NanoGPT's terms don't forbid fictional adult content (they forbid minors, real
   people and non-consent, and defer to each model's provider); confirm Chroma's provider terms
   and the account's explicit-content setting first. 18+ pack only.
8. In-app "make a puppet from a picture" (a layering-service connection) and "create a new part".

## Budget

| Day (UTC) | NanoGPT images | GPU |
|---|---|---|
| 2026-10-08 | 51 of 95 (#90–#142, all puppets; #90 and #132 failed, not counted); models: Qwen Image, HiDream, Z Image Turbo, Step Image Edit 2 | RunPod $0.17 of $5.00 (one start with no card free; one 46-minute session); $4.83 left |
