# Status

Snapshot of what's built, what's partial, and how it was tested. Everloom 0.1.0.

## 3D import and editor (2026-10-10)

Unity packages without Unity, bone mapping, more formats, `.blend` through Blender, a VRoid-style
character creator, and the adult switch removed (the minor guard stays). Docs:
[docs/3d-import/](docs/3d-import/) (research, formats, Unity tables, bones and presets, `.blend`,
creator); acceptance: [docs/3d-import/evidence/acceptance.md](docs/3d-import/evidence/acceptance.md).

### Done ✅
- **Unity**: `.unitypackage` and extracted folders (with or without `.meta`) import in the browser:
  humanoid from `.fbx.meta`, lilToon/Poiyomi/Standard materials, prefab variants and blendshape
  values, PhysBones and Dynamic Bones as springs (hair, cloth, chest, butt), VRChat visemes and
  blink, Modular Avatar toggles and outfits (Merge Armature), face and body animations; an import
  report; the package's license kept, with a warning on export and sharing.
- **Bones**: one mapping model (humanoid plus roles: spine chains, breast, butt, belly, hair,
  skirt, tail, helpers…), an auto-mapper (file maps, base presets, Japanese/Chinese/Korean names,
  geometry) measured at 100% on the fixture rigs, a Bones tab that works on a phone with 250 bones,
  mapping presets. Roles drive physics and the breast and butt bone sliders.
- **Formats**: OBJ+MTL, DAE, PMX/PMD with VMD/VPD, BVH, VRMA, zip/7z/rar, TGA/PSD/DDS/KTX2
  textures; `.clip` and `.psd` drawings become puppets; clear messages for Unity `.anim` and the rest.
- **`.blend`**: converted by Blender on the server (one-click verified install), the Windows app, or
  a RunPod CPU session; the old failure was the web app refusing the file before upload.
- **Creator**: own CC0 bases (anime woman and man), 44 body and many face sliders, eyes, 32 hair
  presets by part, skin and makeup, 19 clothing templates with patterns and a UV template, save and
  re-edit, GLB and VRM 1.0 export with the owner's license; VRM license panel for imported VRMs.
- **Anatomy** from a separate pack (never in the repo), no unlock; the **minor guard**
  (`apps/server/src/services/minor-guard.ts`) refuses it and other explicit content for minors on
  the server. The adult-mode switch and its confirmations are gone; "Blur 18+ pictures in lists"
  is the one privacy option, off by default.

### Partial or not built
- RAR and ASCII FBX are untested with real files (no free RAR writer, no CC0 ASCII FBX here).
- The texture library is code-made; image-model textures need an image connection key.
- Genital shapes for the anatomy pack need sculpted art; the pack tool makes the chest only.
- On-screen fps can't be measured here (software WebGL); CPU time per frame is (item 11).
- The RunPod Blender session has not run against RunPod (no key during this work).

### Tests
- Typecheck clean; Vitest 117 files, 825 passed, 8 skipped (Blender and real-file tests without their env vars; the `.blend` tests pass 3/3 with Blender 4.2).
- Playwright e2e, all eight projects: 539 passed, 170 skipped (heavy 3D specs run on two projects), 0 failed (1.5 h).
- Measurement specs (`MEASURE_3D=1`): `perf-250.spec.ts`, results in `docs/3d-import/evidence/perf-250.json`.

## Design & UX (2026-10-09)

Making the app understandable, themes with scenery, and features from Hakawati. Docs:
[docs/ux/](docs/ux/) (audit, navigation before/after, task tests, glossary, themes, Hakawati);
acceptance evidence: [docs/ux/evidence/acceptance.md](docs/ux/evidence/acceptance.md).

### Done ✅
- **Clarity**: Tools grouped by intent (This scene, My character, The world, Story tools, Create,
  Settings, Advanced) with pins per preset and search (Ctrl/⌘K, phone search); plain names
  (Auto-tracking, What the AI sees, Story state, …) in one glossary; message actions under the
  message with More in labelled groups; one send button and an input-mode switch; customizable
  quick actions; a line and a **What is this?** on every screen; Simple and Advanced settings;
  a first-run tour per preset; Classic chat shows no game entry anywhere.
- **Measured**: visible controls on a phone's play screen 20 → 16; nine common tasks 32 → 25 taps,
  2 → 0 scrolls ([task-tests.md](docs/ux/task-tests.md)).
- **Themes**: ten themes plus Everloom's own, each with fonts, shapes, motion and scenery around
  the story (never under the text; a band on phones; paused when hidden, scrolled away or typing;
  still under reduced motion); live gallery in Settings › Appearance & themes; per world and per
  device; reading settings; AA contrast tested for every theme in light and dark; scene script
  0.5–1.0% of a 4× slowed core on the phone profile.
- **From Hakawati** (ideas only, clean-room): input modes, scenario questions, Quickstart with
  cancel, scenarios, story cards (merged with lorebooks) with generation, the story panel, undo/redo
  of turns, thinking levels, dictation through the voice connection, interface scaling, migrations
  as one step with a recovery message. Researched, not built: Continue with ChatGPT. Skipped:
  right-to-left (no translations yet). Decisions: [docs/ux/hakawati.md](docs/ux/hakawati.md).

### Tests
- Typecheck clean; Vitest 106 files, 780 passed, 5 skipped (Blender).
- Playwright e2e, eight projects: 499 passed, 60 skipped, 2 failed, then fixed; the fixed specs re-run in all eight projects: 121 passed.
- UX suite (`playwright.ux.config.ts`): task tests, screens, themes, scenery CPU, presets (Classic,
  Story, Full RPG) all passing.
- Found and fixed by the final runs: a closing sheet's fading backdrop swallowed the next tap; the
  scenery could draw with a negative clock on its first frame and throw.

## Phase 5

3D characters: import, rendering, motion, a wardrobe that follows the inventory, four ways to make
a character, creation tools and integration. Spec: [docs/avatars.md](docs/avatars.md); decisions:
[docs/PHASE2_DECISIONS.md › Phase 5](docs/PHASE2_DECISIONS.md#phase-5--3d-characters).

### Done ✅
- **Viewer**: GLB and VRM 0.x/1.0 import with a wizard (checks, bone and face mapping for Mixamo,
  VRM, Rigify, Unreal, MMD and Blender names, units, floor, facing), optimization off the main
  thread (meshopt, KTX2, a lighter phone copy), toon (MToon) and PBR looks, lighting presets that
  follow the scene, a directed camera with *Look around*, expressions, lip-sync, idle life
  (breathing, blinking, glances), quality presets with automatic step-down, a 30/60 fps cap, pausing
  when hidden, sprite or Live2D fallbacks. FBX, PMX/PMD, OBJ and DAE through Blender.
- **Motion**: retargeting through a canonical skeleton; 42 built-in emotes (CC0 Quaternius clips
  plus keyframed ones); story ops, automatic mood and battle emotes, an emote picker, `/emote` and
  `/pose`, script API; a motion importer (GLB, VRMA, FBX, BVH in the browser; VMD and stubborn FBX
  through Blender); dances that keep time with the music; group dances in step.
- **Wardrobe** level 1 (whole outfits), level 2 (parts) and level 3 (garments by body family, in
  layers, with colour and texture variants and covered skin hidden); accessories on bones; the
  dressing room; items linked to outfits, parts and garments; everything rolls back with swipes.
- **Code-made characters**: bodies, faces, hair and clothes built in a worker from a recipe (a few
  KB); filled from a character's description; the editor; NPCs without pictures get one; equipped
  items become garment recipes (rules first, the utility model for anything new, schema-checked);
  fabric patterns (denim, knit, plaid, floral) from generated tiles.
- **Parts maker**: CharacterStudio evaluated (MIT code; sample packs not redistributable) and
  Everloom's own maker built on its pack format; a CC0 "Basics" pack generated by code; pack import
  with clear rejections; items swap parts; GLB and VRM export; an upgrade path from code-made.
- **Realistic characters (MPFB)**: one-button install of MPFB (GPL) and MakeHuman's CC0 assets on
  the owner's server, sliders and assets in a phone-friendly sheet, a rigged character in about
  half a minute, clothes as separate wardrobe garments of the character's own body family (skin
  recessed and skin weights shared so nothing pokes through). Adults only.
- **Creation tools**: the Blender worker (convert, motions, clean-up, turntables, garment fitting,
  MPFB) with a job log; image-to-3D props and experimental garments (Meshy, Hunyuan3D or TRELLIS on
  fal.ai); seamless textures from the owner's image connection; the NanoGPT image presets; the
  Blender add-on (checks against the spec, export, send with a device token);
  `docs/blender-ai-workflow.md`.
- **.blend files**: models (alone with packed textures, or zipped with their texture folders),
  motions and garments to fit import directly through the Blender worker, which opens them with
  scripts off and keeps what would render; the import report names missing textures and libraries.
- **Per-character picker**: automatic, imported, parts-made, realistic, code-made, Live2D or
  pictures, one line each.
- **Integration**: the stage layers with sprites and Live2D side by side; cutscene lines with
  `{emote}` and `{outfit: …}`; group scenes; battle emotes; *Show in 3D* on the character sheet;
  poses as portraits and thumbnails; a 3D shelf in the asset library (models, garments,
  accessories, animations; tags, search, zip export and import); character bundles carry the 3D
  avatar; settings for quality, frame cap, physics, outlines and pictures-only per device.
- **Image keys (§8)**: both keys were set. NanoGPT: 6 images on 2026-10-06 for fabrics (16 that
  day in total against the cap of 95; only the five allowed models in the ledger, each call
  checked as included in the subscription). ElectronHub: not used in Phase 5 (Phase 4 spent
  $0.088 of $2.25). The pre-commit key scan stayed on; the app works with both keys unset (nothing
  in Everloom calls them; the presets use the owner's own connections).

### Partial or not built
- **Starter content**: no good-looking anime base characters exist under a usable license that we
  could fetch here (the Quaternius character packs are CC0 but only on itch.io, whose download
  automation was declined; CharacterStudio's samples forbid redistribution). Shipped instead: the
  CC0 Basics part pack and code-made characters, both made by Everloom's code, plus the CC0
  mannequin and clips. The README points owners to VRoid and CC0 sources.
- **Realistic faces don't move** (MPFB's face-shape packs are separate, and baking the body
  sliders drops shape keys); MakeHuman clothes fit only the body they were made with.
- **Fabrics in the parts maker**: the Basics pack parts have no UVs, so fabrics are code-made only.
- **Garment fitting and AI garments** are experimental (close-fitting clothes work; loose or layered
  ones come out rough). Tripo isn't offered (its API docs couldn't be read from here).
- **Performance on real phones** wasn't measured: the numbers in docs/avatars.md come from
  software WebGL with a throttled CPU (CPU frame time under 12 ms for four characters on high).
- **Motion review** was done with frame sheets and screenshots, not video.

### Phase 5 tests
- **Unit and integration (Vitest): 82 files, 521 passed, 5 skipped** (the skips are the Blender-gated ones; with `EVERLOOM_BLENDER` set they pass too), including bone and expression mapping on fixture
  skeletons, retargeting at odd proportions, garment layering and region hiding, item-to-garment
  matching, installed-only emotes, rollback of outfit and emote ops, pack manifests (bad packs
  rejected with a reason), code-made garments fitting at every slider extreme, model-written
  recipes refused when they fail the schema, the Blender worker (gated on `EVERLOOM_BLENDER`:
  conversion, fitting, clean-up, turntables, a time-limited stuck job) and MPFB (gated on
  `EVERLOOM_MPFB_ZIPS` too: install, make, garments, delete), 3D bundles and the 3D shelf.
- **End to end (Playwright): 446 passed, 6 skipped, 0 failed** across all 8 projects (390×844 111, 360×800 111, 844×390 111, 1280×800 113; each count is dark and light together; the skips are desktop-only or phone-only tests) on 390×844, 360×800, 844×390 and 1280×800 in light and
  dark, zero console errors: import through the wizard; a 3D character on the stage with emotes
  from the picker, `/emote` and the story; a dance keeping time with the music; the story changing
  an outfit and a swipe taking it back; the dressing room; the parts maker on a phone with an
  equipped helmet swapping a part; code-made NPC figures from descriptions; pictures on a device set
  to pictures only; nothing 3D downloaded when 3D is off; motion import; the character sheet's 3D
  and the asset library's 3D shelf.
- **Bugs the full run found and fixed**: story names linked to the wrong library character
  (the first 90% match instead of the best, so "Wren Ashdown" could become "Wren"); a slash command
  an extension provides failed if typed before the extension finished loading, and a message sent
  as a chat opened could fire lorebook-script events before the script listened (both now wait,
  briefly, for scripts that are still starting); DAE sources could not be stored.
- **Rendering**: fixture models, every bundled emote, outfits, code-made and MPFB characters were
  rendered in headless Chromium and looked at; problems found that way (white eyes, skin through
  clothes, z-fighting boots, see-through MPFB skin, a hole at a neckline) were fixed.

## Phase 4

Decisions and reasoning: [docs/PHASE2_DECISIONS.md › Phase 4](docs/PHASE2_DECISIONS.md#phase-4--scripting-sources-feature-switches-privacy-windows-artwork).

### Done ✅
- **Character sources (Part 2)**: Character Tavern and RisuRealm fixed (Tavern's API moved to SvelteKit page data; RisuRealm CHARX cards); CHARX import (also with a picture in front of the zip); one filter language and a filter bar for every site with a final check over each page; Botbooru, Saucepan (account) and AI Character Cards added; site notices; accounts (encrypted, never sent back, Test and Sign out); 429 back-off; server-side thumbnails; tag suggestions; saved searches; all-sources search with duplicates marked; self-test and *Record fixtures*; a rebuilt bridge (per-site readers, single-page aware userscript with Send all, settings panel and install-and-pair; a bookmarklet that opens its window first, with a clipboard fallback and *Paste from bridge*; an Android share target).
- **Feature switches and Classic chat (Part 3)**: Settings › Features with 36 module switches and a memory mode, dependencies explained before they apply; Classic / Story / Full RPG presets (also in first-run setup); per-chat mode and a per-character default; off means off on the server (no tick, tracker, scene block, recall, background jobs; a tracker op list cut to enabled modules, with disabled ops refused) and in the app (no screens, settings pages or downloads). Classic measured at exactly one model call per reply.
- **Name shield (Part 5)**: Settings › Privacy; protected terms with suggested stand-ins, kinds, extra forms and scopes; one outbound choke point (safeFetch) with a leak check and a test that fails if any path skips it; inbound restore for streams (hold-back), reasoning, tracker JSON and utility answers; per-chat collision swaps with a notice; *Send anyway* when the owner chose "ask"; cloud voices get the stand-in by default; inspector *As stored / As sent*; a hint for shortened stand-ins.
- **Vault (Part 4)**: a data key wrapped by a passphrase (scrypt) and by a recovery key; the whole database encrypted (SQLCipher-compatible) and every media and Live2D file sealed (AES-256-GCM); a plain system store for accounts and sessions only; 423 for everything else while locked; Lock now, idle lock, lock on sign-out and on restart; the login password can be the passphrase (password changes rewrap the key); resumable, verified turn-on and turn-off; no content in browser storage and no cached pictures; content-free error logs; encrypted backups; password-sealed exports (`.evlt`) and imports; limits stated on the page and in the README.
- **Scripting and extensions (Part 1)**: sandboxed frames (opaque origin, no network) with a permission-checked bridge and server-side re-checks for model calls, the network and storage; approvals tied to a fingerprint of code and permissions; imported content off until reviewed (Enable / Enable once / Keep disabled / trust the creator); kill switch, `?safe=1`, a loop guard and a watchdog, a limit on running scripts, a console per script; your own scripts, character, preset and lorebook scripts (a lorebook script can run when its entry activates); interactive HTML in messages (lazy, auto-height, themed, show as code); variables at chat, character, global and message level; SillyTavern regex rules (stored, display-only, prompt-only, depth); slash commands with pipes and autocomplete; quick replies; script buttons; panels, dialogs and toasts from scripts; Tavern Helper compatibility (variables, messages, events, generate, lorebooks, toastr, small jQuery and lodash subsets); extensions with panels, screens, settings pages, composer buttons, commands, prompt blocks, message renderers, macros, regex and declarative custom game ops with rollback; install from zip, Git or a hot-reloading dev folder; updates with permission diffs; uninstall keeping or deleting data; error logs; optional server extensions in a child process; TypeScript types (`packages/script-types`), a template (`tools/create-everloom-extension`) and three examples.
- **Windows app (Part 6)**: an Electron shell running the server on a bundled Node (so the SQLite module is its ordinary Windows build); per-user NSIS installer (`Everloom-Setup-x.y.z.exe`, no admin rights, Start-menu and desktop shortcuts, an uninstaller that asks whether to keep your data and keeps it on updates) and a portable zip that keeps its data next to the exe; data in `%APPDATA%\Everloom`; tray menu (Open, Open in browser, Lock vault, Use from my phone on Wi-Fi with a QR code, Check for updates, Open data folder, Quit); one instance; a free port if 8787 is taken; clean shutdown through a token-guarded control route; "No password on this PC" (loopback only, Host-checked; refused while the network is on); updates from GitHub Releases with a backup first. **CI**: `.github/workflows/windows.yml` on `windows-latest` builds the installer and the zip and smoke-tests them (silent install → start → health → set up → connect the mock model → chat → quit → start again and sign in, chat still there → silent uninstall, data kept → portable zip keeps data next to the exe) — **green** (run 3, 2026-10-05). On a `v*` tag it attaches both files to a GitHub Release (not yet exercised: no tag has been pushed). Unsigned; the README explains SmartScreen and the workflow marks where signing goes.
- **Artwork (Part 7)**: research-first prompting notes (`docs/art/PROMPTING.md`, written before any call), a plan, a style guide from a side-by-side model comparison, and a ledger of every call (`docs/art/LEDGER.md`: NanoGPT subscription images: 67 on 2026-10-05 and 10 on 2026-10-06, each day against a cap of 95, $0.088 of ElectronHub against $2.00; nothing charged, checked per call). Shipped: 139 pixel-art item icons on one grid, palette and outline covering every item the app ships, matched by name with the line icon as fallback, in inventory, equipment, shops, crafting and loot, with a per-item picture picker (bundled or asset-library icons); 12 backgrounds and 6 portraits the owner can add to the asset library; Mira Vale, a demo character with an 8-expression set; genre cards and maps in the new-game screens; illustrations on six empty screens; Pip in the helper; six enemy portraits; about 2 MB in total (WebP, AVIF for the larger pictures, lazy-loaded, not precached by the service worker). Everything is optional (Settings › Appearance › Illustrations) and replaceable; licensing is in CREDITS.
- **Key safety**: a pre-commit hook (`scripts/hooks/pre-commit`, set up by `npm install`) refuses commits containing the artwork API keys; it compares hashes, so the keys are stored nowhere.

### Not built (Parts 1–7)
- **Scripting gaps**: STscript closures, loops and `/if`; most of Tavern Helper's API beyond the common functions (presets, character editing, audio, imports); full jQuery/lodash; an extension index or signed packages. A deliberately hostile approved script can still freeze the tab (the docs say how to get out). The Tavern Helper layer was tested with card-style scripts written for the tests, not downloaded cards (the build environment can't reach card sites).
- **Switching a game-less Classic chat to Story or Full RPG** doesn't create a game for it; start a new chat.
- **DataCat direct fetching** — declined: its API is built around recovering definitions creators hid elsewhere. The bridge covers pages the player opens (public fields only).
- **Pygmalion, Wyvern and Character Tavern account features**, and **Chub account features** (favorites, follows, timeline) — their member endpoints need browser sessions or couldn't be checked from here.
- **Chub parameters** beyond the ones Phase 3 verified are sent as documented but unverified; the final page check keeps results right, and the self-test shows what the site honours.

- **Artwork gaps**: no character-creation portrait picker (the six portraits are asset-library pictures to apply by hand); expression sets only for the demo character; the ElectronHub budget was barely used, since nothing generated there could be shipped under its terms.
- **Windows release on a tag** hasn't been exercised (no version tag pushed); the build, installer, zip and smoke test are green in CI.

### Phase 4 tests
- **Unit and integration (Vitest): 433 tests, all passing**, including scripting, extensions, the vault, the name shield, features, the Windows server side and the bundled art.
- **End to end (Playwright): 96 passed, 1 skipped** (the desktop-only floating-panel test on phone) on desktop 1280 dark and phone 360 light, zero console errors. New in Phase 4: scripting, extensions, vault, privacy, features and the art specs.
- **Windows**: the CI smoke test on `windows-latest` (install → chat → restart → uninstall keeping data → portable).

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
- **Item icons from the asset library** — done in Phase 4 (an item's *Picture* button picks any icon asset or a bundled picture).
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
## Custom bases, clothes fitting, physics, skin layers, paired animations (2026-10-08)

Spec: [docs/avatars.md](docs/avatars.md) (Custom bases, Fitting clothes, Physics, Skin layers, Paired
animations) and [docs/base-model-guide.md](docs/base-model-guide.md); decisions in
[docs/PHASE2_DECISIONS.md](docs/PHASE2_DECISIONS.md). Evidence (CC0, Everloom-made bodies and
clothes): `docs/3d-base-evidence/`.

### Done ✅
- **Custom bases**: any rigged GLB; the base model check in plain words with the features it turns
  off; body sliders from morph targets (Body/Face/Other, two-way pairs, linked left/right, editable
  mapping saved with the model, adults-only shapes gated); generated adjusters where morphs are
  missing; body presets shared by characters on the same base.
- **Fitting in the browser**: hand placement (gizmo on desktop, hold buttons on phones, snaps,
  mirror, auto-align, exact numbers), rigging in a worker (normal-checked closest-point weights,
  fill, smoothing, 4 bones, morphs carried over, push-out, swing chains for skirts and hair, covered
  skin hidden), review in poses and at slider extremes, saved as a rigged GLB garment.
- **Physics**: one Verlet solver for VRM springs, file chains, generated chains and the chest;
  colliders from the body; damping, wind, chest strength and off; budgets per quality; off-screen
  pause.
- **Skin layers and colours**: underwear, swimwear, stockings, makeup, paint, tattoos and scars baked
  into the skin texture; tattoos placed by tapping; skin tone, eye and hair colours.
- **Paired animations**: story op, emote picker *Together*, `/pair`, scripts; shared clock,
  placement by height, IK contacts (hands meet, hugs wrap round), step-closer for short arms; four
  built-in CC0 clips; an importer; adult gating.

- **Fixed in the follow-up**: long hair flung out like a cape (chains made touching the shoulders
  and back were pushed fully out of the colliders; contact at rest is now kept), the buttocks
  pushing through the back of a skirt while dancing (skin under the mostly pinned part now hides),
  hair drawn under tops (hair is now the outermost layer), the base check promising chest helper
  bones that aren't made, and a unit test that only passed with the server built.
- **Found by the full e2e re-run**: a message sent while a chat's scripts were still loading never
  told its lorebook scripts which entries activated (the turn kept the script list from when the
  message was typed, and nothing counted as starting while the list or the script layer loaded);
  the chat now counts as starting until its scripts are known and their frames attached, and the
  turn reads the list as it is when it runs. Tests that had drifted or raced: the adult-content
  switch (renamed, now with an 18+ confirmation) and three clicks that could hit a matching button
  outside the sheet that was still opening.

### Checklist (prompt §6)
| # | Check | Result |
|---|---|---|
| 1 | Base with morphs: report, sliders (breast, hips, butt) | ✅ `1-base-check`, `1-sliders-max/min` |
| 2 | Base without morphs: report and fallback | ✅ `2-no-morphs-fallback` |
| 3 | Shirt, trousers, skirt, shoes (and long hair) fitted by hand, poses, sliders | ✅ `3-*` (jeans: a small gap inside the lower leg at slider max) |
| 4 | 20,000-vertex garment in a worker | ✅ 0.47–0.54 s worker time, page responsive (timer ≤ 7 ms late); Node 0.34–0.44 s |
| 5 | Skirt swings and collides; hair; chest motion on/off | ✅ `5-skirt-dance-*`, `5-hair-back-*`; 0 of 4,800 skirt-point checks inside a leg; chest 2.1° on, 0° off (weak spots below) |
| 6 | Underwear layer, tapped tattoo bending with poses and sliders, colours | ✅ `6-*` |
| 7 | Paired animation, different heights, hands meeting | ✅ `paired-*` |
| 8 | Story equips a fitted garment on a custom base; a swipe takes it off | ✅ `8-equipped` |
| 9 | Frame rates, 1–3 dressed characters, phone and desktop, per quality | ✅ table in [docs/avatars.md › Rendering](docs/avatars.md#rendering); `9-three-dancing` |
| 10 | 390×844 flow; existing suite | ✅ base-models.spec passes at 390×844 and 1280×800; unit 594 passed, 5 skipped (97 files); full e2e 451 passed, 54 skipped, 0 failed on all 8 projects |

**Timings** (`docs/3d-base-evidence/timings.json` from one clean run of base-models.spec,
`measurements.json` from `tests/e2e/measure-3d.spec.ts`; headless Chromium with software WebGL):
the test garments (600–3,300 vertices) rig in 20–180 ms of worker time, about 1 s from *Fit* to the
review, and save in 1–3 s. A 20,000-vertex garment on the CC0 base (14,549 vertices, 31 morphs)
rigs in 0.47–0.54 s of worker time with the preview not rendering, and in 0.34–0.44 s in Node on
the same input. (The earlier figures of up to 22 s came from runs where software rendering competed
with the worker for the CPU.)

**Frame rates** (dressed: shirt, skirt and long hair on chains, shoes; dancing, physics on; CPU
time per frame, mean): desktop 1.7–11.3 ms at every quality with one to three characters; phone
profile (4× slower CPU) 7.7–24.1 ms on low and medium, 22.8 ms (one), 35.4 ms (two) and 53.5 ms
(three) on high. The software rasteriser holds the frame rate itself at 1.5–13 fps here, so only
the CPU times carry over to real devices.

### Partial or not built
- **Chest helper bones** for bases without breast bones: not built; such a base has no chest motion
  and the base check says so.
- **Projected decals across UV seams**: not built; a tattoo crossing a seam is cut there.
- **Baking a garment into a skin layer**: not built (paint-on clothes are image layers).
- **Collision between characters** beyond spacing and the paired-clip contacts: not built.
- **Collision between garments**: none; hair fitted on the bare body lets a top's back show through
  it in lively poses, and a skirt fitted over trousers doesn't push out of them.
- **Skirts**: chains hang from the hips, so in a deep squat the thighs come over the front, and a leg
  swung far out can show a strip of thigh through the cloth between two chains near the hem.
- **Jeans at slider max**: a small gap on the inside of the lower leg.
- **Physics budget on medium**: 48 points; a skirt takes 40, so long hair worn with it barely swings.

## Everloom Puppets — run 1 of several (2026-10-08)

Spec: [docs/puppets.md](docs/puppets.md); decisions and research:
[docs/PHASE2_DECISIONS.md › Everloom Puppets](docs/PHASE2_DECISIONS.md); the queue for the next run:
[docs/art/PUPPET_QUEUE.md](docs/art/PUPPET_QUEUE.md).

### Done ✅
- **Research and decision**: Inochi2D (no maintained, phone-ready browser runtime), See-through,
  Stretchy Studio, Anime2.5DRig, easy-live2d, Textoon, flat2rig, Bunraku (no code released), with
  licences; route (B): our own runtime and format, plus Inochi2D import and export.
- **Engine** (`packages/engine/src/puppet/`): the format with validation; keyform evaluation over
  one or two parameters; warp and rotation deformers in a tree; masks, blend modes, opacity and
  draw order by parameter; pendulum physics; automatic life (blinking with natural timing,
  breathing, idle sway, eyes and head toward a target, lip-sync from the voice level and vowels);
  expressions for Everloom's emotions; gestures (nod, shake, tilt, surprise, laugh, wave, flinch,
  lean); meshes from transparency (finer around eyes and mouth); the template rig generator (head
  turns by sphere projection per depth layer, eyes, brows, mouth, breathing, body shape, hair and
  chest physics); `.inp`/`.inx` export and import.
- **Web**: the WebGL 2 player (one canvas for everyone, batching, stencil masks, recolouring in the
  shader, quality by pixel ratio, 30 fps when idle, paused when hidden) and `/lab/puppets`.
- **The placeholder puppet** (simple shapes, 38 parts, rigged by the same generator); a `puppets`
  feature switch (in the Story preset, needs the stage).
- **Art**: both template masters and full edit sets (51 NanoGPT images on 2026-10-08, ledger
  #90–#142, within the 95 cap, allowed models only); the prompting guide's puppet section, written
  before the first call and extended with what the calls taught; `tools/puppets/cut.py`.
- **GPU tooling**: the See-through worker (API, watchdog, Dockerfile) and the RunPod session tool
  with its guards; the GPU ledger. A pre-commit check refuses puppet art outside the placeholder;
  the RunPod key's hash is in the local key scan.

### Not done yet (next runs, in order)
- **The See-through session**: the first start found no free 24 GB community card (nothing ran, $0
  spent); the second start, with wider choices, needs the owner's approval in this environment.
  RunPod balance $5.00, no pods, no volumes (checked through the API).
- Mapping See-through's layers to the schema; the template puppets with real art; tuning by
  looking (sweeps and clips in `docs/puppets-evidence/`); the pack builder and installer; the stage
  integration and story ops; the maker; hairstyles and outfits; the adult layer; in-app layering
  and part creation. SaladCloud: no key given.

### Tests
- Engine: 17 puppet tests (deformation, keyforms, masks and draw order, auto-meshes, the template
  rig's parallax, body shape with the outfit following, eye and mouth crossfades, blinking,
  breathing, expressions, a nod, lip-sync, hair physics, the look target, the Inochi2D container,
  a lossless round trip, edits from Creator coming back, and a plain import).
- Browser (`tests/e2e/puppets.spec.ts`, desktop and 390×844): the placeholder renders, turns its
  head, blinks on its own, talks and nods; three on stage at about 1.1 ms of CPU per frame (software
  WebGL; not yet measured with the CPU slowed 4×). Evidence: `docs/puppets-evidence/placeholder-*`.
  A halo bug (textures not premultiplied when loaded as ImageBitmaps) was found this way and fixed.
- All unit tests: 611 passed, 5 skipped (98 files).

## Browser 3D repair — in progress

The owner's phone picker issue, optional optimization blocking imports, Firefox schema CSP
errors, UTF-8 PMX parsing and scaled-armature retargeting defects have been corrected.
The full unit checkpoint passed 542 tests (5 skipped) across 93 files. Focused real-file phone
checks passed in Chromium and Firefox for GLB, VRM 0.x/1.0, FBX and PMX; screenshots also
revealed animation defects that were fixed instead of accepting ready-state markers alone.

Native MakeHuman, sanitized CC0 packs, browser fitting, donor-part copying, material variants,
adult eligibility checks and protected presets are implemented. Native quality, editor workflows,
wardrobe rollback, exports and the full end-to-end suite are still being verified. The 18-item
acceptance checklist and delivery commit/push are **not complete**. Evidence and baseline:
`docs/3d-fix-evidence/`, `docs/PHASE2_DECISIONS.md`.
