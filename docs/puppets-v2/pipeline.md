# Making a full-body character

Generate in layers, decompose, check the gates, import. Every step writes to the git-ignored
`samples/gen/…`; nothing generated goes into the repository. Packs are shared with the owner
(all-ages, and the 18+ pack separately).

## 1. Pictures (NanoGPT, `tools/art/gen.mjs`, ledgered in docs/art/LEDGER.md)

All pictures of one view share the base picture's canvas: they are **edits of the base**, so they line
up pixel for pixel and the differences are clean layers.

| Picture | How | Prompt essentials |
|---|---|---|
| **Base body** | text-to-image (`qwen-image`, subscription) | one clearly adult character, about 7.5 heads tall, A-pose (arms 30–45° from the body, legs apart with a gap), front view, neutral face, mouth closed, hair tied back or short, even light, plain light background, whole body in frame. Underwear for the all-ages base. |
| **Outfits** | edit (`qwen-image-2.1/edit`, ~$0.03) | "Dress this exact woman in …. Keep the pose, body, face, hair, lighting, background and framing exactly identical; only add the clothes." |
| **Faces** | edit | "This exact woman with her eyes closed / smiling / angry / sad / surprised / mouth open as saying A… Keep … identical; change nothing else." |
| **Hands** | edit | "… her left hand (on the right of the picture) open, palm forward, fingers spread …" |
| **Views** | edit | three-quarter and profile (facing left, arms a little forward so they don't hide the body), same scale and ground line. |
| **18+ layer** | edit on an adult-content model (`--adult`; prompt kept out of the repo) | the same picture nude; only for 18+ packs. |

The subscription edit model (`step-image-edit-2`) was retired on 2026-10-19; edits now use a few-cent
paid model within the owner's NanoGPT allowance (`EVERLOOM_NANO_PAID_CAP_USD`, checked per call
against the balance).

## 2. Background removal

`rembg` with IS-Net (`isnet-general-use`, CPU): `remove(image, session=new_session('isnet-general-use'))`.
The flat-colour key (`tools/puppets/key.py`) fails on pale skin over a pale gradient.

## 3. Decomposition (`tools/puppets2/decompose.py`, CPU)

```
python3 tools/puppets2/decompose.py --image base.png --out samples/gen/puppets2/<name> --name <Name> \
  --outfit-image casual=casual.png --outfit-image street=street.png \
  --variant eyes_closed=blink.png --variant smile=smile.png --variant mouth_a=a.png --variant wave_L=wave.png
python3 tools/puppets2/decompose.py --image side.png --view side --out samples/gen/puppets2/<name> --zip
```

1. **Keypoints:** RTMPose body-with-feet (Halpe-26, rtmlib, ONNX on CPU): head top, neck, hips and feet
   included. On the generated test bodies the core joints came back at 0.83–0.85 confidence. When it
   misses (stylised art), give `--keypoints` (a JSON of landmarks); a drag-to-fix review in the maker
   is planned.
2. **Limb split:** every pixel goes to its nearest bone chain: torso, head, arms, hands, legs. Cuts
   overlap a few pixels (filtered edges never show the background), and **joint caps** go to the layer
   drawn behind: the torso keeps a soft cap under each shoulder and at the crotch, the legs keep a cap
   under the hips. Elbows and knees stay inside one smoothly skinned mesh.
3. **Occlusion fill:** torso pixels an arm covered are inpainted from the torso's own pixels (never
   from the arm, never into the background).
4. **Breasts:** soft-edged copies over the torso on the breast bones (front and three-quarter views),
   so the bounce never opens a seam; tops get matching `chestwear` copies.
5. **Outfits:** the changed pixels of each outfit picture, split like the body: top, sleeves (on the
   arm bones), trousers per leg, or a **skirt** (clothing across the gap between the thighs) on its own
   swinging bone; shoes with the legs.
6. **Variants:** the changed pixels of each face picture (feathered) become face overlays; a hand
   picture's hand replaces the drawn hand while its pose is on.
7. **Profiles:** the far arm and leg are darker copies of the near ones, drawn behind the body.
8. **Gates** (`gates-<view>.json`, any failure stops the pack): keypoint confidence ≥ 0.3; limb
   symmetry ≤ 20 %; A-pose arms 15–65° from the body; **adult proportions ≥ 5.5 heads** (a body drawn
   with child proportions is never packed, whatever `--force` says); silhouette coverage ≥ 99.5 %;
   joint-cap overlap; torso hidden by the arms ≤ 12 %; no empty layers.
9. **Contact sheet** (`contact-<view>.png`): picture, skeleton, region map, every layer, gate results.
   Look at it.

## 4. Import and review

Settings › Puppets › Full-body puppets › Import a character pack. The server re-encodes every
picture, refuses adult layers outside an 18+ pack, rigs every view, and the lab
(`/lab/puppets2?p2=<id>`) plays every motion, turn, walk, expression and outfit on it.

## Not built yet

- See-through (amodal layers for hair, clothes, accessories) as a step before the body split, through
  the existing worker (tools/see-through-worker) or `tools/gpu`. The tool already takes its layers
  (`--layers`); the generated-in-layers route above made it unnecessary for the test characters.
- A SAM-family segmenter for breasts and buttocks (the soft copies stand in for it).
- The phone maker's joint and weight editing (the lab has every parameter on a slider).
- Turning v1 (face) puppets into full-body ones: v1 puppets keep their own runtime and keep working.
