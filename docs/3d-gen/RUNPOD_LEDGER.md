# RunPod ledger (3D generation)

Written by `tools/gpu/run.mjs` from `runpod-ledger.json`. Cap for this work: **$15.50**
(the owner's limit). Every pod is named `everloom-gen-…`, stops itself when idle (10 min) or past
its time limit, and is terminated by the runner in a `finally` step; leftovers are cleaned up at the
start and end of every session. No network volumes are used (they cost money every month).

| Date (UTC) | GPU (cloud) | Price/h | Time | Cost | Running total | Job | Result |
|---|---|---|---|---|---|---|---|
| 2026-10-19 | RTX 3090 (COMMUNITY) | $0.24 | 17 min | $0.069 | $0.069 | bench-1 | ok: trellis2 0 files, hunyuan3d 0 files |
| 2026-10-19 | RTX 4090 (COMMUNITY) | $0.36 | 34 min | $0.202 | $0.271 | bench-3 | ok: trellis2 0 files; setup failed: hunyuan3d |
| 2026-10-19 | RTX 3090 (COMMUNITY) | $0.24 | 30 min | $0.120 | $0.391 | bench-4 | ok: trellis2 1 files, hunyuan3d 9 files |
| 2026-10-19 | RTX 4090 (COMMUNITY) | $0.36 | 3 min | $0.017 | $0.408 | bench-5 | failed: bad host: failed: CUDA does not start on this host (NVIDIA GeForce RTX 4090) |
| 2026-10-19 | RTX A5000 (SECURE) | $0.29 | 35 min | $0.169 | $0.577 | bench-6 | ok: trellis2 1 files, hunyuan3d 19 files |
| 2026-10-19 | RTX 3090 (COMMUNITY) | $0.24 | 28 min | $0.110 | $0.687 | bench-trellis | ok: trellis2 10 files |
| 2026-10-20 | L40S (COMMUNITY) | $0.81 | — | — | $0.687 | cs2-qi2-test | starting |
