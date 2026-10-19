# 3D generation on rented GPUs

Everloom's server has no GPU, so 3D generation (image → 3D model) runs on a GPU rented from RunPod
for the length of one job. This folder documents how, what it costs, and which models are used.

- [DECISION.md](DECISION.md): TRELLIS.2 or Hunyuan3D, researched and benchmarked.
- [RUNPOD_LEDGER.md](RUNPOD_LEDGER.md): every pod, its cost and the running total.
- `evidence/`: contact sheets and renders.

## How a job runs

```
reference image (NanoGPT, tools/art/gen.mjs)
  → tools/gpu/run.mjs run job.json
      cleanup of leftover pods → budget check → pod (cheapest GPU that fits, community cloud first)
      → set up the models on the pod (official sources) → upload inputs → run → download → terminate
  → tools/gpu/evaluate.py (Blender): GLB, renders, mesh checks
  → samples/gen/ (git-ignored) → Discord packs for the owner
```

- **Job file** (JSON): `job` (name), `models`, `inputs`, `out`, `minVramGb`, `allowGpus` (cards the
  setup is compiled for: Ampere 8.6 by default), `maxMinutes`, `setupMinutes`, `maxPricePerHr`,
  per-model `opts`. See the header of `tools/gpu/run.mjs`.
- **On the pod** (`tools/gpu/worker/`): a small HTTP server behind RunPod's proxy, protected by a
  random per-session token; it stops the pod itself after 10 minutes without requests or at
  `maxMinutes`. Each model has `tools/gpu/models/<model>/setup.sh` (its own virtualenv, weights from
  the official Hugging Face repos) and `run.py`.
- **Resume:** outputs already downloaded are skipped, so re-running a job after an interruption only
  does what is missing.

## Safety rules

- **Keys:** `RUNPOD_API_KEY` and `NANOGPT_API_KEY` come from the environment only. Logs pass through
  `redact()`. `scripts/check-secrets.mjs` (pre-commit hook, `npm run build`, and a test over every
  tracked file) refuses anything shaped like a RunPod, NanoGPT or Hugging Face key.
- **Budget:** the guard refuses a job whose worst case (price × time limit, plus disk) could take the
  spending past the cap (`EVERLOOM_GPU_CAP_USD`, default $2.90, the owner's limit for this work) or
  the balance below $0.05. The balance is read from RunPod before every job.
- **No pod left running:** pods are named `everloom-gen-…`; the runner terminates its pod in a
  `finally` step (also on Ctrl-C), checks the account afterwards, and terminates any leftover pod of
  ours before and after each session. The pod also stops itself (idle or time limit).
- **No network volumes:** they cost money every month; weights are downloaded at pod start instead
  (about 5–8 minutes).
- **Nothing generated or downloaded goes into the repository.** Outputs live in `samples/gen/`
  (git-ignored). Model weights are never redistributed: not in the repo, the installer, packs or
  Discord.

## Running it

```
RUNPOD_API_KEY=… node tools/gpu/run.mjs status            # balance, our pods, spent vs cap
RUNPOD_API_KEY=… node tools/gpu/run.mjs estimate job.json # worst case per GPU, and whether it's allowed
RUNPOD_API_KEY=… node tools/gpu/run.mjs run job.json
blender -b --factory-startup -P tools/gpu/evaluate.py -- report.json renders/ samples/gen/…/*.glb
```

Only the owner starts paid jobs.
