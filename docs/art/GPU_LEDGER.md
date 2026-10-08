# GPU ledger

Every rented-GPU session (See-through layering), written by `tools/see-through-worker/session.mjs`;
the source of truth is `gpu-ledger.json`. Rules: read the balance first, stop with $0.50 left
on RunPod, no paid storage kept, every pod terminated (checked through the API at the end).

| Date (UTC) | Provider | GPU | Price/h | Start | Stop | Time | Cost | Balance | Images | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-08 | RunPod | — | — | — | 19:09:27 | 0 min | — | $5.00 → $5.00 | f-hip.png, f-master.png, f-raise.png, f-underwear.png, m-hip.png, m-master.png, m-raise.png, m-underwear.png | failed: no 24 GB GPU was available |
| 2026-10-08 | RunPod | RTX 3090 | $0.220 | 20:31:10 | 21:17:26 | 46 min | $0.170 | $5.00 → $4.83 | u-belt.png, u-lace.png, u-tank.png, u-nude.png | 4/4 layered; 70 MB |
| 2026-10-08 | RunPod | RTX 3090 Ti | $0.270 | 22:24:53 | 23:07:27 | 43 min | $0.191 | $4.82 → $4.63 |  | failed: setup hung at "installing Python packages" for 27 min on this host; stopped by hand, pod terminated, nothing left |
| 2026-10-08 | RunPod | RTX 3090 | $0.500 | 23:07:57 | 23:08:38 | 1 min | $0.006 | $4.63 → $4.63 |  | stopped on purpose during setup (secure card too dear for the batch in the budget); pod terminated |
| 2026-10-08 | RunPod | RTX 3090 Ti | $0.270 | 23:09:11 | — | — | — | $4.63 → ? |  | started |
