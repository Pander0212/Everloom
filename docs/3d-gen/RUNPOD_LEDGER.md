# RunPod ledger (3D generation)

Written by `tools/gpu/run.mjs` from `runpod-ledger.json`. Cap for this work: **$25.50**
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
| 2026-10-20 | L40S (COMMUNITY) | $0.81 | 2 min | $0.024 | $0.711 | cs2-qi2-test | failed: bad host: failed: CUDA does not start on this host (NVIDIA L40S) |
| 2026-10-20 | RTX 6000 Ada (COMMUNITY) | $0.76 | 9 min | $0.110 | $0.821 | cs2-qi2-test | failed: no model finished setting up ({"gpu":"ok NVIDIA RTX 6000 Ada Generation, 550.78, 49140 MiB","qi2edit":"failed: .Optional[torch.dtype], <class 'torch.device'>, typing.Optional[torch.device]]). Got func |
| 2026-10-20 | L40S (COMMUNITY) | $0.81 | 1 min | $0.010 | $0.831 | cs2-qi2-test | failed: bad host: failed: CUDA does not start on this host (NVIDIA L40S) |
| 2026-10-20 | L40S (COMMUNITY) | $0.81 | 1 min | $0.010 | $0.841 | cs2-qi2-test | failed: bad host: failed: CUDA does not start on this host (NVIDIA L40S) |
| 2026-10-20 | L40S (COMMUNITY) | $0.81 | 1 min | $0.015 | $0.856 | cs2-qi2-test | failed: bad host: failed: CUDA does not start on this host (NVIDIA L40S) |
| 2026-10-20 | RTX 6000 Ada (COMMUNITY) | $0.76 | 14 min | $0.179 | $1.035 | cs2-qi2-test | ok: qi2edit 2 files |
| 2026-10-20 | RTX 6000 Ada (COMMUNITY) | $0.76 | 20 min | $0.247 | $1.282 | cs2-qi2-test | ok: qi2edit 1 files |
| 2026-10-20 | RTX 6000 Ada (COMMUNITY) | $0.76 | 20 min | $0.252 | $1.534 | cs2-qi2-test | ok: qi2edit 1 files |
| 2026-10-20 | RTX 6000 Ada (COMMUNITY) | $0.76 | 16 min | $0.198 | $1.732 | cs2-qi2-test | ok: qi2edit 2 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 5 min | $0.053 | $1.785 | cs2-qi2-test | ok: qi2edit 2 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 9 min | $0.094 | $1.879 | cs2-qi2-test | ok: qi2edit 15 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 9 min | $0.090 | $1.969 | cs2-mixed-test | ok: qi2edit 16 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 14 min | $0.144 | $2.113 | cs2-lora-test | ok: qi2edit 46 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 73 min | $0.738 | $2.851 | cs2-fix-test | ok: qi2edit 70 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 22 min | $0.226 | $3.077 | cs2-research-test | ok: qi2edit 48 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 22 min | $0.219 | $3.296 | cs2-research-test2 | ok: qi2edit 49 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 14 min | $0.142 | $3.438 | cs2-pony-test | ok: qi2edit 31 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 9 min | $0.087 | $3.525 | cs2-verify | ok: qi2edit 13 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 35 min | $0.356 | $3.881 | b1-hair-faces | ok: qi2edit 94 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 32 min | $0.327 | $4.208 | b1-underwear | ok: qi2edit 82 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 30 min | $0.306 | $4.514 | b1-races | failed: no model finished setting up ({}) |
| 2026-10-20 | A40 (SECURE) | $0.61 | 4 min | $0.039 | $4.553 | b1-body | failed: no model finished setting up ({"gpu":"ok NVIDIA A40, 595.91.07, 46068 MiB","qi2edit":"failed: r rate limits and faster downloads. weights ok + python - extra NoctQA_V1_int8_convrot.safetensors 6920 MB |
| 2026-10-20 | A40 (SECURE) | $0.61 | 33 min | $0.337 | $4.890 | b1-outfits | ok: qi2edit 82 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 17 min | $0.177 | $5.067 | b1-detail | ok: qi2edit 43 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | — | — | $5.067 | b1-body | starting |
| 2026-10-20 | A40 (SECURE) | $0.61 | 10 min | $0.098 | $5.165 | b1-redo | ok: qi2edit 19 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | — | — | $5.165 | b1-races | starting |
| 2026-10-20 | A40 (SECURE) | $0.61 | 38 min | $0.384 | $5.549 | b1-body | ok: qi2edit 51 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 30 min | $0.308 | $5.857 | b1-races | failed: no model finished setting up ({}) |
| 2026-10-20 | A40 (SECURE) | $0.61 | 17 min | $0.170 | $6.027 | b2-orc-redo | ok: qi2edit 29 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 8 min | $0.083 | $6.110 | b1-races | failed: bad host: the worker never answered in 8 min |
| 2026-10-20 | A40 (SECURE) | $0.61 | 41 min | $0.414 | $6.524 | b1-races | ok: qi2edit 36 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 21 min | $0.209 | $6.733 | b3-fat | stopped by the owner (A-pose switch); cost from the log time |
| 2026-10-20 | A40 (SECURE) | $0.61 | 20 min | $0.206 | $6.939 | b3-chubby | stopped by the owner (A-pose switch); cost from the log time |
| 2026-10-20 | A40 (SECURE) | $0.61 | 20 min | $0.203 | $7.142 | b3-pregnant-9m | stopped by the owner (A-pose switch); cost from the log time |
| 2026-10-20 | A40 (SECURE) | $0.61 | 20 min | $0.199 | $7.341 | b3-pregnant-6m | stopped by the owner (A-pose switch); cost from the log time |
| 2026-10-20 | A40 (SECURE) | $0.61 | 19 min | $0.196 | $7.537 | b3-muscular | stopped by the owner (A-pose switch); cost from the log time |
| 2026-10-20 | A40 (SECURE) | $0.61 | 24 min | $0.246 | $7.783 | b4-views | ok: qi2edit 38 files |
| 2026-10-20 | A40 (SECURE) | $0.61 | 21 min | $0.211 | $7.994 | b5-apose | ok: qi2edit 22 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 7 min | $0.073 | $8.067 | b6-arms | interrupted |
| 2026-10-21 | A40 (SECURE) | $0.61 | 17 min | $0.174 | $8.241 | b6-arms | ok: qi2edit 14 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 35 min | $0.358 | $8.599 | b7-hair-faces | ok: qi2edit 94 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 32 min | $0.320 | $8.919 | b7-underwear | failed: ENOSPC: no space left on device, write |
| 2026-10-21 | A40 (SECURE) | $0.61 | 31 min | $0.318 | $9.237 | b7-outfits | failed: ENOSPC: no space left on device, write |
| 2026-10-21 | A40 (SECURE) | $0.61 | 38 min | $0.391 | $9.628 | b7-races | ok: qi2edit 34 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 38 min | $0.384 | $10.012 | b7-body | ok: qi2edit 51 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 20 min | $0.208 | $10.220 | b7-detail | ok: qi2edit 41 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 6 min | $0.062 | $10.282 | b7-detail-redo | ok: qi2edit 11 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 55 min | $0.556 | $10.838 | b7-clothes-redo | ok: qi2edit 140 files |
| 2026-10-21 | A40 (SECURE) | $0.61 | 20 min | $0.199 | $11.037 | b8-views | ok: qi2edit 16 files |
