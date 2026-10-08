# GPU ledger

Every rented-GPU session (See-through layering), written by `tools/see-through-worker/session.mjs`;
the source of truth is `gpu-ledger.json`. Rules: read the balance first, stop with $0.50 left
on RunPod, no paid storage kept, every pod terminated (checked through the API at the end).

| Date (UTC) | Provider | GPU | Price/h | Start | Stop | Time | Cost | Balance | Images | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-08 | RunPod | — | — | — | 19:09:27 | 0 min | — | $5.00 → $5.00 | f-hip.png, f-master.png, f-raise.png, f-underwear.png, m-hip.png, m-master.png, m-raise.png, m-underwear.png | failed: no 24 GB GPU was available |
