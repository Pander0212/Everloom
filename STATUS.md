# Status

Snapshot of what's built, what's partial, and how it was tested. Everloom 0.1.0.

## Phase 4 (in progress)

Decisions and reasoning: [docs/PHASE2_DECISIONS.md › Phase 4](docs/PHASE2_DECISIONS.md#phase-4--scripting-sources-feature-switches-privacy-windows-artwork).

### Done ✅
- **Character sources (Part 2)**: Character Tavern and RisuRealm fixed (Tavern's API moved to SvelteKit page data; RisuRealm CHARX cards); CHARX import (also with a picture in front of the zip); one filter language and a filter bar for every site with a final check over each page; Botbooru, Saucepan (account) and AI Character Cards added; site notices; accounts (encrypted, never sent back, Test and Sign out); 429 back-off; server-side thumbnails; tag suggestions; saved searches; all-sources search with duplicates marked; self-test and *Record fixtures*; a rebuilt bridge (per-site readers, single-page aware userscript with Send all, settings panel and install-and-pair; a bookmarklet that opens its window first, with a clipboard fallback and *Paste from bridge*; an Android share target).
- **Feature switches and Classic chat (Part 3)**: Settings › Features with 36 module switches and a memory mode, dependencies explained before they apply; Classic / Story / Full RPG presets (also in first-run setup); per-chat mode and a per-character default; off means off on the server (no tick, tracker, scene block, recall, background jobs; a tracker op list cut to enabled modules, with disabled ops refused) and in the app (no screens, settings pages or downloads). Classic measured at exactly one model call per reply.
- **Name shield (Part 5)**: Settings › Privacy; protected terms with suggested stand-ins, kinds, extra forms and scopes; one outbound choke point (safeFetch) with a leak check and a test that fails if any path skips it; inbound restore for streams (hold-back), reasoning, tracker JSON and utility answers; per-chat collision swaps with a notice; *Send anyway* when the owner chose "ask"; cloud voices get the stand-in by default; inspector *As stored / As sent*; a hint for shortened stand-ins.
- **Key safety**: a pre-commit hook (`scripts/hooks/pre-commit`, set up by `npm install`) refuses commits containing the artwork API keys; it compares hashes, so the keys are stored nowhere.

### Not built (Parts 2–3)
- **Switching a game-less Classic chat to Story or Full RPG** doesn't create a game for it; start a new chat.
- **DataCat direct fetching** — declined: its API is built around recovering definitions creators hid elsewhere. The bridge covers pages the player opens (public fields only).
- **Pygmalion, Wyvern and Character Tavern account features**, and **Chub account features** (favorites, follows, timeline) — their member endpoints need browser sessions or couldn't be checked from here.
- **Chub parameters** beyond the ones Phase 3 verified are sent as documented but unverified; the final page check keeps results right, and the self-test shows what the site honours.

## Phase 3 (the remaining gameplay systems)

What was built, merged or deferred, and why, is in [docs/PHASE2_DECISIONS.md › Phase 3](docs/PHASE2_DECISIONS.md#phase-3--the-remaining-gameplay-systems).

### Done ✅
- **One engine, still.** Every new system is ops in the same reducer, anchored to message + swipe with inverse patches. A rollback suite runs one story through all 134 op types and checks each step's inverse restores the state exactly; a new op without a step fails it.
- **Travel**: transit hubs, lines with timetables, fares and tickets; 22 travel modes by genre; route requirements with a reason and a fix (and *Wait* for opening hours); trip history, recent places, a visited overlay; seeded arrival events (switchable) told to the narrator.
- **Player Home**: homes on the map (owned, rented, borrowed; one primary), rooms with working amenities and upgrades, storage, the household with roles and schedule-based presence, home actions and invitations.
- **Economy**: currencies and denominations, wallet and ledger, containers, banking with interest and loans, bills with a missed-payment ladder, owned assets with upkeep and income, shops with hours, restocking, standing-based prices and haggling, fair trades; crafting in five disciplines with stations, levels, time and a seeded quality roll; AI recipe ideas the player confirms.
- **Party and progression**: leader, rows, active party and reserves, roles and tactics (presets and simple rules), a party bag, classes, a skill tree with requirements and ranks, level curves, XP sources, stat points, custom vitals, a level-up moment, and helper-proposed skills.
- **Battle**: break gauges and weaknesses, enemy intents a turn ahead, target types, reserve swaps, persistent results and injuries, a posted summary.
- **Communication**: phone or fantasy codex by genre; group texts with read receipts; calls (with TTS, written to memory); letters and email with delivery by distance and courier; an in-world browser/archive (cached); a social feed that touches relationships; custom apps; a "While you were away" digest.
- **Stage and sound**: 13 scene effects (each can be turned off; gentle under reduced motion), a director for sprite placement and entrances, idle breathing and a speaking bob, speech bubbles, cutscenes (written or drafted by the utility model), music playlists by scene, battle, place and time with crossfades, ambience (own loops or synthesized), reference voices with consent, a shared asset library with zip import and expression sets, optional Live2D (Core uploaded by the owner, never bundled) with lip-sync.
- **Customization**: save slots that fork, Diagnostics (with a Test button per connection and a debug bundle without keys), four accent palettes and genre themes, show/hide and cinematic mode, floating tool panels and a floating status bar on desktop, a reorderable status bar everywhere, *Reset layout*.
- **Character sources**: a capability matrix (including supported sorts), Character Tavern, RisuRealm, Pygmalion and Wyvern beside Chub, import from any card link, a browser bridge (userscript and bookmarklet with per-device tokens) for sites behind bot protection, hidden definitions labelled and never extracted, per-source browse settings, *Load as I scroll*.

### Partial or not built
- **Chub timeline, favorites, follows, gallery and remote version history** — not built: they need account endpoints whose responses couldn't be recorded as fixtures here (the build environment's network blocks the site). Search, sorts, preview, import, embedded lorebooks and update checks with field diffs work.
- **Music stream URLs** — not built: the security policy only allows the app's own media; tracks are uploaded instead.
- **Item icons from the asset library** — icons can be stored and tagged, but items still use the built-in icon set.
- **Live2D with a real model** — the lip-sync level source was verified in Chromium; loading a model and moving its mouth could not run in CI because the proprietary Cubism Core can't be included.
- **Generated cutscenes** are drafted on request, not triggered automatically at milestones (keeps the call optional and predictable).

### Phase 3 tests
- **Unit and integration (Vitest): 331 tests in 48 files, all passing.** New: economy, home and crafting, journeys, progression and battle, communication, providers and sources, the bridge, customization, stage, music choice, the asset library, the per-op rollback suite, call memory, feed relationships and helper-proposed skills.
- **Soak**: 60 turns with 12 swipe cycles; between cycles the player shops, crafts, stores things at home, fights and rides transit, and the swiped-away takes carry travel, battles, homes, shops, mail and stage ops. Every cycle folds back to byte-identical state and memory.
- **Migration**: a real Phase 2 database (written by the Phase 2 release through its API) upgrades with a backup, every row kept, Phase 3 systems empty and immediately usable, and old results pinned so a rebuild matches what was recorded.
- **Calls per preset**: re-measured, unchanged (cheap 2.03, balanced 2.53, max 4.40 model calls per turn).
- **End to end (Playwright), 33 tests on every viewport and theme, zero console errors:** travel by transit with a ticket, arriving, a blocked route and its fix; shopping, crafting at home, paying rent; a battle with formations, break and a reserve swap; letters, the feed, calls and group texts; save slots; importing from each provider (recorded fixtures), the browser bridge with a good and a bad token, import from a link, per-source sorts; cinematic mode, view controls, palettes, Diagnostics with provider tests, floating panels and the floating status bar; cutscenes, effects, bubbles, music unlock and crossfade, voices consent, the asset library.

| Viewport | Result (dark / light) |
| --- | --- |
| phone 390×844 | ✅ / ✅ |
| phone 360×800 | ✅ / ✅ |
| landscape 844×390 | ✅ / ✅ |
| desktop 1280×800 | ✅ / ✅ |

The desktop-only floating-panel test is skipped on the six phone and landscape runs.

- **Performance**: main script 76 KB brotli (Phase 2: 82 KB), first load 179 KB; all assets 454 KB plus the 140 KB Live2D renderer, which loads only when Live2D is on; zod no longer reaches the browser. 60 fps idle and 59 fps with rain and shake together (p95 frame 16.8 ms, headless Chromium); a measured 2 s linear crossfade.
- **Design QA**: screenshots of every new screen at 360/390 px and 1280 px in both themes were reviewed; fixes included moving scene options to their own tab and the bubble narration's stray speech tags.

Bugs the Phase 3 tests caught and that are fixed: travel modes hidden unless a route had an obstacle; an upgraded campaign that would have changed on its first swipe (old battles replaying under new rules); audio that never unlocked when the first tap came before the story loaded (and `pointerdown` doesn't count on touch screens); the stage chunk carrying the whole op-schema library; a cutscene opening under a tool sheet; a media test that depended on download order.

## Phase 2 (World Engine ideas + Character Library features)

Decisions, the memory benchmark and call costs are in [docs/PHASE2_DECISIONS.md](docs/PHASE2_DECISIONS.md).

### Done ✅
- **One engine**: memory, the living world and the game layer share one op log anchored to message + swipe; swipe, edit, delete, continue and branch roll back exactly (soak test: 60 turns with repeated swipe cycles fold back to identical state and memory).
- **Memory** (top priority): who saw what vs who heard, gossip with distortion, secrets that never travel, versioned facts with conflicts and an evidence firewall, scene/day/chapter summaries, hybrid recall (BM25 + embeddings + people/place/importance/recency), "Why recalled?", editable Memory screen. Benchmark over 320 turns: recall 28% → 86%, knowledge leaks 14% → 0%, current fact shown 57% → 100%, stale facts 29% → 0%; a second, untuned campaign: recall 31% → 100%.
- **Living world**: intent and movement with companions, dice with swipe-stable rolls, the pulse, schedules and goals with route-finding, off-screen life, relationship caps and earned labels, threads and storyline seeding, deadlines and world facts, outfits and vitals, sovereign party members, world import from a lorebook or card.
- **World inspector**: the scene block the model saw, every change with revert, the model call log, a health check with one-click fixes, unresolved names.
- **Cost presets** Cheap / Balanced / Max with measured calls per turn (about 2.0 / 2.5 / 4.4 model calls).
- **Character library, items 1–14**: library view with filter language and presets, batch actions with undo, detail sheet, versions with diffs, collections, duplicates and display names, Character studio, related + "What should I play?", chat history browser, bundles (and SillyTavern zips), AI lorebook entries in the existing Lore screens, media localization + integrity check, custom CSS with assistant and safe mode, online sources (Chub).
- **Also fixed**: pictures in creator notes (blocked by the app's security policy) now load through an authenticated image proxy; after an update, a page on the old build reloads once or offers Reset instead of spinning; character changes refresh other devices; the Background model can now be picked in Settings.

### Partial or not built
- **Chub isn't verified live.** Its API and terms page are geo-blocked from the build environment, so the provider follows the response shape established open-source clients use, and tests run on fixtures built to that shape rather than live recordings. Please try it from your server; if Chub changes a field, the mapping is one small function (`packages/engine/src/library/sources.ts`).
- **Other sources** (Character Tavern, Wyvern, Pygmalion): not built; no public, documented catalog API was found. Chub's follow and timeline features aren't built either (optional in the spec).
- **Creator-hidden definitions** are refused by design, with no workaround.
- The memory benchmark was run in mock mode; its real-model mode (`MEMORY_BENCH_URL`) wasn't run here, since no model API is available in this environment.
- The studio returns each result at once (no token streaming).
- **Open:** the custom CSS e2e failed once on 360×800 light (a visibility check), in a subset run right after the final rebuild. It passed in the full run and in 42 repeats since, and that run's artifacts were overwritten, so the cause isn't known yet. If it shows up again, keep `tests/e2e/.artifacts/results` from that run.

### Phase 2 tests
| Suite | Result |
| --- | --- |
| Engine unit tests (Vitest) | 143 passed (16 files) |
| Server tests (Vitest, real SQLite, mock model) | 80 passed (19 files) |
| Playwright e2e: 17 flows × 8 projects (+ setup) | 137 passed, 0 failed, zero console errors (16 min) |

New in Phase 2:
- **Engine**: memory (knowledge scoping, gossip, facts and conflicts, recall scoring, summaries), chronicler planning, the scene block and its drop order, dice odds and swipe-stable rolls, relationship caps and earned labels, threads, the pulse, deadlines, the fact firewall, NPC/place dedupe, the library filter parser and tri-state tags, card diffs and hashes, duplicates, related, the studio prompts and parsing, the recommender, lorebook entry generation, remote-media scanning, the Chub mapping.
- **Server**: memory across swipe/edit/delete/branch, the chronicler watermark, consolidation, the **memory benchmark** with thresholds (200 turns), a **soak test** (60 turns, swipe cycles fold back to identical state and memory), a **migration test** (a real Phase 1 database upgrades with nothing lost), the World inspector and health fixes, versions/diff/restore, bundles round-trip (Everloom → zip → Everloom, and SillyTavern zips), duplicates, the studio, the recommender, lorebook AI, custom CSS cleaning, media localization and the integrity check (including the private-address guard), the image proxy, online sources against fixtures (caching, rate limiting, adult content enforced by the server, hidden definitions refused, encrypted token), and **calls per preset**.
- **E2E**: 2,000-character library (windowed, filtered within budget), sandboxed notes run no scripts, select/delete/undo and bundle import, "What should I play?", media check, the studio (brainstorm → write → refine → revise a selection → undo → save → overwrite), lorebook AI, custom CSS and safe mode, online sources, and recovery after an update.
- Protections were checked by breaking them on purpose (the tests must then fail): memory edit rollback, the soak, clean-on-save for CSS, the private-address guard, the "still referenced" scan in the integrity check, adult-content enforcement, and both halves of the update recovery.

Latency (mock model, Send → first token, balanced): Phase 1 259 / 323 ms, Phase 2 264 / 327 ms (median / p90, +2%).

## Summary (Phase 1)

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

## Tests (Phase 1 snapshot)

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

Tested from a clean clone with `docker compose` (Everloom + Caddy, IP-only mode with `tls internal`):

- `/api/health` answers through Caddy over HTTPS; the container reports healthy.
- Response headers include HSTS, the Content-Security-Policy, `nosniff` and `X-Frame-Options: DENY`.
- Built assets are served brotli-compressed (main script 82 KB on the wire).
- API routes return 401 without a session; the session cookie is `HttpOnly; Secure; SameSite=Strict`.
- `--migrate-only` and `--reset-password` work inside the container.

In this sandbox the image was built with an extra CA certificate for the build network's proxy; the repository's `Dockerfile` is otherwise identical and needs nothing extra on a normal VPS. The installer's interactive steps (Docker install, DNS prompt, cron) were not run here.

## Suggested next steps

1. Chub account features (timeline, favorites, follows, gallery, remote versions) once real responses can be recorded as fixtures.
2. Inventory items that use pictures from the asset library as their icons.
3. An opt-in "cutscene at milestones" switch (battle victories, a storyline's climax) using the existing draft call.
4. A local check that loads a real Live2D model with an owner-provided Cubism Core (kept out of the repository).
5. Music streams through a small authenticated media proxy, if wanted.
6. Link quests to places (target pins, "go to objective" on the map).
7. Persona expression sprites and per-persona overrides.
8. Split the shared UI chunk further to lift throttled-mobile performance.
