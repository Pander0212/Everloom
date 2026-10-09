# .blend files

## Why .blend import failed

The web app refused every `.blend` before it reached the server
(`apps/web/src/features/avatar3d/runtime/import.ts` threw "has to be exported from Blender first"),
although the server's Blender worker already converted `.blend` files. Where Blender wasn't installed
(most VPSs), there was also no way in the app to get it.

Now:

- A `.blend`, or a zip holding a `.blend` with its texture folders, is uploaded and converted by
  Blender on the server (meshes, armature, weights, shape keys, materials; modifiers applied where the
  mesh has no shape keys; Subdivision dropped as too heavy).
- The import report says which Blender converted it, which version saved the file, and lists the
  file's animations (they import as motions with Settings › 3D characters › Motion clips).
- A file saved by a newer Blender than the converter is flagged; if that Blender can't open it, the
  error says so and which version to install.
- Without Blender, the message lists the ways to get one (below) instead of failing.

Tested with real files made by `tools/avatars/blend-fixtures.py` from Everloom's CC0 test body (an
armature, 25 shape keys, two materials; one with modifiers and an action; plain and zstd-compressed),
saved by Blender 3.6 and 4.2 and converted by both (`apps/server/test/blend-convert.test.ts`, runs
when `EVERLOOM_BLENDER` is set; `EVERLOOM_BLEND_DIR` adds more files).

## Where Blender can run

| Where | How | Needs |
|---|---|---|
| **The Everloom server** | Settings › 3D characters › Blender › **Install** (one click): Blender 4.2 LTS from blender.org, checked against its published SHA-256, unpacked into the data folder. Or `install.sh`'s portable Blender, or `apt install blender` and the path. | x86-64 Linux, about 2 GB of memory, 1.5 GB of disk. No graphics card. |
| **Your PC (Windows app)** | A Blender installed from blender.org is found by itself. | — |
| **A rented CPU machine** | `RUNPOD_API_KEY=… node tools/blender-worker/session.mjs convert --out converted/ *.blend`, then import the GLBs. Balance read first (refuses below $0.50 plus the worst case), no paid storage, pod terminated in a `finally` step and checked through the API, every session in `docs/art/gpu-ledger.json`; the pod also ends itself when idle or past its limit. The files go to RunPod: not for files that must stay private. | A RunPod key. About $0.10/h for a small CPU machine; a batch takes minutes. |
| **SaladCloud** | Not built: Salad's containers are billed per running replica and need a container image of our own; RunPod covers the case. | — |

The RunPod converter's pod side (`tools/blender-worker/server.py`) was tested here with a local
Blender; the RunPod session itself has not run yet (the key was switched off for this work).

## No-Blender options (researched, not offered)

- **A browser-side reader** (WASM or TypeScript) for current Blender files would need Blender's SDNA
  for each file era (pre-3.4 meshes, 3.4–4.x attribute layers, 5.x attribute storage), weights and
  shape keys. The open-source candidates (blend-rs, js.blend, jsblender, landon) either read only old
  files, lack a license, or call themselves unreliable ([research.md](research.md#5-blend-reading-without-blender)).
  None is reliable enough, so Everloom says plainly that a `.blend` needs Blender instead of offering
  a half-working converter.
- **convert3d.org** says it converts `.blend` to `.glb` "in your browser, without uploading to a
  server". Its pages are a Next.js app; the scripts that could be fetched contain no WebAssembly
  module, and the rest of the site's code could not be downloaded from here (the site reset the
  connections), so the library it uses couldn't be identified and our test files couldn't be run
  through it. No open-source library or developer API from it was found. If one turns up, a remote
  converter would be off by default, never used with the Vault on, and would warn that the file
  leaves the server.
