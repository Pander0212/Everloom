# Image-to-3D generator: TRELLIS.2 or Hunyuan3D

Checked 2026-10-19 by reading each project's official README, model card and LICENSE (Hugging Face
API for weights and sizes). Nothing here is redistributed: pods download the weights themselves
from the official sources, and only generated outputs leave the pod.

## 1.1 Research

| | **TRELLIS.2** (Microsoft) | **Hunyuan3D 2.1** (Tencent) | Step1X-3D (StepFun) |
|---|---|---|---|
| Latest open version | TRELLIS.2-4B, weights 2025-12 (paper arXiv 2512.14692); repo active (last commit 2026-06-05), 12.3k stars | 2.1, released 2025-06-13; repo quiet since 2025-10, 4.2k stars. No open 2.5/3.0 weights exist | 2025-05, 0.9k stars |
| Weights | `microsoft/TRELLIS.2-4B`, 16.2 GB, not gated | `tencent/Hunyuan3D-2.1`, 14.9 GB, not gated | `stepfun-ai/Step1X-3D`, 19.6 GB |
| VRAM | "at least 24 GB" (README; shape and texture not given separately) | 10 GB shape, 21 GB texture, 29 GB both loaded (README) | 27 GB (README) |
| Time (official) | 1024³: ~17 s on an H100 (10 s shape + 7 s material) | not stated | 152 s |
| Output | GLB with PBR (base colour, roughness, metallic, opacity); texture size chosen at export (up to 4096) | mesh + PBR paint from 6–8 generated views | mesh + texture |
| Part-aware / multi-view | neither (single image); SegviGen adds part segmentation on its code | 2.1: single image (multi-view only in the older 2mv model) | on its roadmap only |
| Known weaknesses | raw meshes "may occasionally contain small holes"; style not aligned to preferences | not listed | not listed |
| Install | Linux, CUDA 12.4, torch 2.6; compiles nvdiffrast, nvdiffrec, CuMesh, FlexGEMM, o-voxel (flash-attn optional: xformers works) | Python 3.10, torch 2.5.1; compiles a rasterizer and a mesh painter; pins old transformers/numpy | pytorch3d, kaolin, two rasterizers |
| License | **MIT** (code and weights) | **Tencent Hunyuan 3D 2.1 Community License**: does **not apply in the EU, UK and South Korea**; MAU threshold | Apache-2.0 |

Step1X-3D was not benchmarked: it doesn't fit a 24 GB card and nothing in its README suggests it
would beat the other two.

**Hunyuan3D's license.** It excludes the EU, UK and South Korea. The owner knows this and chose to use
it for private use anyway, under these rules: the weights are never redistributed (not in the repo,
installer, packs or Discord), pods download them from Tencent's Hugging Face repo, and only generated
outputs are shared. Recorded in the decisions doc and `CREDITS.md`.

**Gated parts TRELLIS.2 needs, and what Everloom uses instead.** Its `pipeline.json` names two gated
models: Meta's DINOv3 ViT-L/16 (manual approval) and BRIA's RMBG-2.0 (CC BY-NC 4.0). Everloom's pod
setup (`tools/gpu/models/trellis2/setup.sh`) rewrites a local copy of `pipeline.json` to use:
- `camenduru/dinov3-vitl16-pretrain-lvd1689m`: an ungated copy of the same file (same size,
  1,212,559,808 bytes; Meta hides its hash, so byte identity can't be proven) that carries Meta's
  DINOv3 License, which allows redistribution under its terms;
- `ZhengPeng7/BiRefNet` (MIT) for background removal, the architecture RMBG-2.0 is built on.

## 1.2 Benchmark

_Running: see the contact sheet and scores below once the pod session is done._

## 1.3 Decision

_After the benchmark._
