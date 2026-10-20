# Costs per character

Measured on the first test character ("Ines", 2026-10-19/20; ledger: docs/art/LEDGER.md #226–#247).

| Step | Calls | Price | Cost |
|---|---|---|---|
| Base body (front, underwear, A-pose) | 1 × `qwen-image` | NanoGPT subscription | $0 |
| Three-quarter and profile views | 2 × `qwen-image-2.1/edit` | $0.03 | $0.06 |
| Outfits: 2 outfits × 3 views | 6 × edit | $0.03 | $0.18 |
| Faces: blink, smile, angry, sad, surprised | 5 × edit | $0.03 | $0.15 |
| Mouth shapes A I U E O | 5 × edit | $0.03 | $0.15 |
| Waving hand | 1 × edit | $0.03 | $0.03 |
| Background removal, keypoints, decomposition, gates | CPU (rembg IS-Net, RTMPose) | — | $0 |
| Rig | on import, in the server | — | $0 |
| **Total** | 20 pictures | | **≈ $0.57** |

- A second character from an existing base (the male base, "Teo") cost nothing more: decomposition
  runs on the CPU, about 15–60 s per view on this container.
- Each extra outfit is 3 edits (one per view), about $0.09; each extra expression one edit.
- No GPU pod was needed: See-through (RunPod, `tools/gpu`) is only for single finished pictures where
  clothes and hair have to be separated without layered generation.
- The subscription edit model (`step-image-edit-2`) was retired on 2026-10-19; with it the edits
  were free. Cheaper paid edit models exist (`flux-3/klein/edit-image` at $0.008), untested for
  alignment.
