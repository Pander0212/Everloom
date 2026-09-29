# Status

Snapshot of what's built, what's partial, and how it was tested. Everloom 0.1.0.

## Summary

All five tiers are built and pass their tests. The roleplay core (Tier 1) and the game core (Tier 2) are complete; the world (Tier 3) and depth features (Tier 4) are complete apart from the smaller gaps listed under **Partial**.

## By tier

### Tier 0 — Foundation ✅
Monorepo (engine / server / web, TypeScript strict), SQLite with WAL and versioned migrations, owner setup and sign-in (scrypt, httpOnly Secure SameSite=Strict cookies, CSRF, rate limiting and lockout, optional TOTP), AES-256-GCM key storage, strict security headers and CSP, upload validation with re-encoding, SSE event bus, PWA shell, Docker + Caddy deployment, installer/update/backup scripts, `--reset-password` recovery.

### Tier 1 — Roleplay core ✅
Connections (OpenAI-compatible, Anthropic, Gemini, text completion; Main and Utility roles; model lists and connection tests), character cards V1/V2/V3 PNG/WebP/JSON import/export with round-trip of unknown fields, personas, chat with streaming, swipes, edit, branch, regenerate, continue, impersonate, stop, hide, bookmarks, search, reasoning display, lorebooks with SillyTavern-style activation (keys, secondary logic, recursion, sticky/cooldown/delay, scan depth, budget, depth insertion), presets with prompt manager and inspector, SillyTavern preset import/export, macros, instruct templates, author's note, memory summaries, JSONL chat import/export, group chats, semantic lorebook retrieval.

### Tier 2 — Game core ✅
Op-based engine (Zod-validated ops, immer patches as exact inverses), every op anchored to message + swipe so swipe/edit/delete/branch roll back exactly, tracker pass with robust JSON extraction/repair and a retry, inline mode, relevance-ranked game-state injection within a token budget, catch-up world simulation with a seeded RNG, NPC dedupe/merge and card links, FTS5 search. HUD (configurable), command menu, inventory (categories, containers, deterministic effects), NPCs (editor, schedules, convert to/from card), journal, databank, calendar and schedules, world log ("Meanwhile…"), Stage (visual novel) mode.

### Tier 3 — World ✅
Procedural SVG map for five levels with Fantasy/Modern/Sci-fi palettes, pan/pinch/wheel zoom, pins by type with legend, unexplored places shown as "Unknown", node sheet with deterministic travel options (time, fare, energy), Travel here with camera easing, Enter, paths, edit/remove, Place landmark, Expand with AI. Organizations list and dossier (Info, Members, Influence, Rules, Run-ins; standing labels Enemy/Hostile/Neutral/Friendly). Social bonds with memories. Persona Studio with lineage tree. New Game wizard (7-step stepper, AI fill for empty fields, streamed opening scene). SillyTavern migration (folder scan or zip upload; characters, chats, groups, personas, worlds, backgrounds, presets; read-only).

### Tier 4 — Depth and flavor ✅
Voice (browser voices, OpenAI-compatible speech, ElevenLabs; per-character voice), image generation (OpenAI-compatible, OpenRouter, Pollinations, ComfyUI, A1111) for portraits, expression sets, NPC portraits, item icons, backgrounds and diary photos; character gallery. Helper companion (proposes ops, applied only on accept). Diary (AI drafts, markdown formatting, photos, stickers, two-page spread in landscape). Phone (threads, NPC-initiated texts from the simulation, recent texts fed into the story prompt). Atmosphere (background, weather, tint/particles). Party with equipment, deterministic turn-based battle with log and rewards, activities.

## Partial or simplified

- **Map:** no "Target" pin type (quest targets aren't linked to places yet); the NPC editor uses a place picker list rather than picking on the map.
- **Diary:** formatting is markdown (bold, italic, quotes, lists) in the Source Serif face; no per-entry font or ink-colour choice. Page turns are a slide, not a 3D curl.
- **Helper:** lives in the tools menu as a sheet with a small animated avatar; it isn't a floating on-screen pet.
- **Persona Studio:** identity and lineage are complete; persona expression sprites and per-persona engine overrides are not implemented.
- **Battle:** full-screen sheet with animated HP bars and floating damage numbers; no sprite-level hit animations.
- **Phone:** recent texts are always included in the story prompt (last two game days); there's no manual "summarize this thread" button.

## Tests

| Suite | Result |
| --- | --- |
| Engine unit tests (Vitest) | 83 passed |
| Server tests (Vitest, real SQLite, mock model) | 30 passed |
| Playwright e2e — 6 flows × 8 projects | 48 passed |

Server tests cover: auth required everywhere, CSRF, login rate limiting and lockout, 2FA, encrypted key storage, upload validation, path traversal (including a crafted zip), SSE streaming and stop, the SillyTavern importer against a fixture data folder (source left untouched), backup/restore, map expansion, the New Game wizard, image generation and application, voice, phone, helper, diary and media reference cleanup.

End-to-end flows (all against the mock model, zero console errors required):

1. Setup and sign-in; add a connection.
2. Import a card → chat with streaming → swipe, edit, branch, delete, with game-state rollback checked.
3. Prompt inspector, author's note, search, export/import; a second browser context stays in sync over SSE.
4. Game core: tracker pass updates the HUD, inventory use, NPC edit, journal, calendar, stage mode.
5. World: New Game wizard → opening scene → map expand, travel, landmark → organizations → social, persona.
6. Depth: phone threads, diary with a generated photo and sticker, helper proposal accepted, sleep activity, a full battle, painted background.

Viewports × themes: 390×844, 360×800, 844×390 landscape and 1280×800, each in dark and light.

| Project | Roleplay (3 flows) | Game | World | Depth |
| --- | --- | --- | --- | --- |
| phone 390×844 dark / light | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| phone 360×800 dark / light | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| landscape 844×390 dark / light | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| desktop 1280×800 dark / light | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |

Bugs these runs caught and that are fixed: map framing and tap-through in short landscape sheets, landmark taps swallowed by pins, a hook-order crash in the character editor, a model edit landing on top of the player's manual edit for the same message (now the player's edit always wins), the HUD clock wrapping at 360 px, tertiary text below WCAG AA contrast, and a layout shift from the story font loading late.

### Lighthouse (mobile, simulated slow 4G, local server)

| Page | Performance | Accessibility | Best practices | CLS |
| --- | --- | --- | --- | --- |
| Sign-in | 87 | 100 | 100 | 0 |
| Chat | 78 | 100 | 100 | 0 |
| Game chat | 80 | 100 | 100 | 0 |

Assets are pre-compressed with brotli/gzip at build time (1.26 MB → 363 KB) and each screen and tool is its own chunk.

### Deploy

DEPLOY_PLACEHOLDER

## Suggested next steps

1. Link quests to places (Target pins, "go to objective" on the map).
2. Persona expression sprites and per-persona overrides.
3. A floating, dismissible helper pet on the story screen.
4. Diary fonts/ink colours and a page-curl turn.
5. Per-thread phone summaries and a manual "tell the story about this text" action.
6. Split the shared UI chunk further to lift throttled-mobile performance above 90.
