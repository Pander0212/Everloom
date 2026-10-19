# Vendored: Rev2D core

`src/core` of [Rev2D](https://github.com/RevStudio/Rev2D) (MIT, Copyright (c) 2026 RevStudio; see
`LICENSE` here) at commit `f144581cdf1f12d781379c4df90d262b8c2dfa3d` (2026-10-06): the model format
and the rig evaluator Everloom's full-body puppets (Puppets v2) use. Its tests are in
`packages/engine/test/rev2d/` (import paths adjusted, nothing else).

Why vendored rather than installed: one author and a squashed history (docs/PHASE2_DECISIONS.md ›
Puppets v2), so Everloom keeps a working copy whatever happens upstream. Keep local changes small and
marked `// Everloom:`, and send fixes upstream where the maintainer accepts them.
