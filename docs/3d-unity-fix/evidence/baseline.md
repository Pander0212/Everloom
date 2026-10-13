# Baseline — 2026-10-11

Commit: `66cc7fa0097c3a165ee368a9bbcf745297a5c57f` (master, dictionary fix).
Environment: Linux, Node 24.19.0, npm 11.9.0, system Blender 4.3.2, Chromium 154.

- `npm run build`: passed (web and server).
- `npm run typecheck`: passed.
- `npm test -- --maxWorkers=2`: 117 files passed, 1 skipped; 825 tests passed, 8 skipped, 267.61 seconds. No failures.
- Playwright first-run setup: 1 passed. Account creation, logout/login, model list and connection test against the mock LLM.
- Production server: health returned `ok: true`; initial authentication status returned `setupRequired: true`.

The browser uses an external environment config selecting system Chromium and the repository working directory; repository test assertions are unchanged. Logs retained outside the checkout under `/workspace/everloom-cloud/`.
Private owner samples have not been provided yet. Tests using them must be gated and never commit the samples.
