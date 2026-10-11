# Test baseline before the redesign

Commit `4b0502d` (2026-10-09), before any change from the Design/UX prompt.

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build -w apps/web` | ok |
| Vitest (`npx vitest run`) | 100 files, **618 passed**, 5 skipped (Blender-gated) |
| Playwright (`npx playwright test`) | phone 390×844 dark and light and phone 360×800 dark: **162 passed, 14 skipped, 0 failed** |

The Playwright baseline was stopped after three of its eight projects: the suite serves the live
`apps/web/dist`, and the first redesign build replaced it mid-run, so later results would have
tested the new code. The last complete run of all eight projects (end of Phase 5, recorded in
STATUS.md) was 446 passed, 6 skipped, 0 failed. Later runs snapshot the build first.
