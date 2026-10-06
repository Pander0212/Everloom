# Phase 2 decisions

Everloom Phase 2 takes the good ideas from two outside projects and rebuilds them inside Everloom. Nothing was copied from either:

- **World Engine** is the owner's own SillyTavern extension. Its guide lives in `docs/reference/world-engine/ENGINE-GUIDE.md`. Its source is kept locally for reading only and is **not committed**: its NOTICE says it is private and unpublished, and parts of it are derived from AGPL/GPL projects.
- **SillyTavern Character Library** is AGPL-3.0. Only its README and behavior were used as a spec.

Every entry below says whether the idea was **adopted**, **merged** with something Everloom already had, **improved**, or **skipped**, and why.

---

## Part A — World Engine

### A.0 The one-engine rule

Everloom already had a strong core: every state change is an **op**, stored in an op log **anchored to a real message id and swipe**. The live state is rebuilt from a base snapshot plus the active entries, so swipes, edits, deletes and branches roll back exactly. World Engine has the same idea (transactions bound to messages, `world = fold(genesis, log)`). So Phase 2 keeps Everloom's op log as the single state system and adds World Engine's *content* to it (knowledge, bonds, threads, dice and so on). It does not add a second log.

Memory is the one piece that lives **beside** the campaign state instead of inside it. A long campaign has thousands of memories, and the campaign state is saved and sent to every open device on each change. Memories therefore go in their own tables, **anchored to messages in exactly the same way as ops**, and are filtered by the same "is this message and swipe still live?" rule when read. The rollback guarantees are the same; there's no second rollback mechanism to keep in sync.

### A.1 State and rollback

| World Engine | Decision | Why |
| --- | --- | --- |
| Transactions bound to messages (index + swipe id + content hash) | **Merged** | Everloom already binds every op to a message id and swipe. Real ids make the content hash unnecessary for identity. |
| `world = fold(genesis, non-reverted transactions)` | **Merged** | This is Everloom's `rebuild(base_state, active entries)`. Ordering was tightened this phase: for one message, the model's bookkeeping applies first and the player's own edits last, so a manual correction always wins. |
| All-or-nothing application | **Merged, per op** | In Everloom each op is all-or-nothing (the reducer works on a draft and discards it on any error). A whole model reply is **not** rejected because one op in it is bad: that would throw away every good change in the turn over one unknown item name. Rejected ops are reported in the change summary instead. |
| Log compaction (fold the oldest quarter into genesis) | **Skipped, replaced** | Destructive compaction means history older than the cap can no longer be rewound or rebuilt, and World Engine's own notes describe bugs caused by it. Everloom keeps the full log. Rebuild speed is covered by the soak test (see results). |
| Swipe / edit / delete / continue / greeting rules | **Merged** | Swipe and delete were already exact. On **edit**, the model's entries for the old text are removed for good (World Engine "reverts and locks" them; deleting is the same effect) and the new text is tracked again. Continue re-tracks the whole message. The greeting is tracked once. |
| Expiry checks while streaming | **Improved** | The tracker already refused to write if the swipe changed while it ran. It now also refuses if the message **text** changed (an edit during tracking), and every memory writer does the same check. |

### A.2 Spatial world model

| World Engine | Decision | Why |
| --- | --- | --- |
| Containment tree (places inside places) | **Merged** | Everloom's locations already form a tree (`parentId`) across World/Region/Local/Nearby/Area. |
| Characters parented to a location, "only the scene can appear" | **Adopted** | NPCs have `locationId`. The scene block now lists only who is actually here, and the narrator contract says only PRESENT characters exist in the scene. |
| Exits | **Merged** | Everloom derives exits from the tree plus explicit routes; the scene block now shows them as EXITS. |
| Objects and factions as nodes | **Skipped** | Everloom has first-class inventory items and organizations with richer screens; turning them into tree nodes would duplicate them. |

### A.3 Knowledge scoping

| World Engine | Decision | Why |
| --- | --- | --- |
| Events with participants **and** witnesses | **Adopted** | Every memory records who it's about and, separately, who saw it. Participants ≠ witnesses is enforced by tests. |
| Hearsay with distortion | **Adopted** | Co-located characters pass on what they saw (never secrets); each retelling adds distortion and a rumor dies past the limit. Deterministic, no model call. |
| "Does not know" per character | **Adopted** | The scene block tells the narrator what an important present character does **not** know that the player does. |
| Secrets and whispers | **Adopted** | A memory can be private to a subset of witnesses; hearsay never carries it. |

### A.4 The scene block and the narrator contract

| World Engine | Decision | Why |
| --- | --- | --- |
| Authoritative, token-budgeted scene block with sections | **Merged, improved** | Everloom's "Game state" block becomes a scene block with sections (NOW, YOU, LOCATION, PRESENT, PARTY, STORY SO FAR, COMING UP, THE WORLD RIGHT NOW, SOMETHING HAPPENS, THE DICE, EXITS). The drop order is documented in code and tested. |
| Narrator contract in the default preset | **Adopted** | The default preset explains how to read each section. A test checks the contract names every section exactly as the engine writes it. |
| Byte-identical preview | **Adopted** | The World inspector shows the exact block from the last request (one code path). |

### A.5 Movement

| World Engine | Decision | Why |
| --- | --- | --- |
| Pre-generation model read (move, time, dice) | **Adopted as optional** | It adds a model call **before** the reply, which costs latency. It's off in *cheap* and *balanced*, on in *max immersion*, with a hard ceiling. |
| Deterministic intent backstop ("I go to the market") | **Adopted** | Free and fast: the player's own sentence is matched against known places before the reply, so the reply is written in the right place. It never guesses on questions, conditionals or ambiguous names. |
| Companions follow the player | **Adopted** | Party members always come along; people the player names or addresses with "we/let's" come along too. |
| Hop-by-hop travel for NPCs | **Adopted** | NPC goals with a target move one hop along the map every third turn (by turn number, so swipes never shift it), never in front of the player. |

### A.6 Capture and presence

| World Engine | Decision | Why |
| --- | --- | --- |
| Capture new named entities from the text | **Merged** | The tracker pass already creates people and places; no extra call. |
| Dedupe | **Merged** | Everloom's fuzzy NPC dedupe and merge already cover this. |
| "Forgotten names" list | **Adopted** | A person or place the player deletes is not re-created by the model unless the player adds it back. |
| Arrivals and departures | **Merged** | The tracker reports moves; the backstop covers the player. |

### A.7 Clock, schedules and goals

| World Engine | Decision | Why |
| --- | --- | --- |
| Clock anchored to stated times, clamped jumps | **Merged** | Everloom's clock already clamps model time jumps. |
| Schedules | **Merged** | Everloom NPC schedules already exist. |
| Goals with a lifecycle and pursuit | **Adopted** | NPCs can have goals (dormant/acting/resolved/failed, urgency, target place) that are pursued hop by hop off-screen. |

### A.8 Off-screen life

| World Engine | Decision | Why |
| --- | --- | --- |
| Background agency (model decides where off-screen people go) | **Merged** | Everloom schedules and goals already move people for free. The optional social sim below covers "what they do". |
| Social simulation with pair pressure | **Adopted as optional** | Pair selection is deterministic (bonds, tension, shared places, cooldowns); only the beat's prose is written by a model. Off in *cheap*, every 3rd turn in *balanced*, every turn in *max immersion*, always on the background model and never blocking a reply. |
| Hearsay | **Adopted** | See A.3; free. |

### A.9 Relationships

| World Engine | Decision | Why |
| --- | --- | --- |
| Directional bonds (affinity, trust, desire, tension) | **Merged** | Everloom's relationships (how an NPC feels about the player) gain desire and tension, and a new bond map covers NPC ↔ NPC. |
| Capped change per turn | **Merged** | Everloom already capped model changes; the cap is now ±8 per turn per value. |
| Earned labels | **Adopted** | An explicit label must be earned (partner needs affinity ≥ 40, a crush dies when the feeling sours; family needs nothing). |

### A.10 Memory

See **A.18** for the full design and the benchmark. In short: **improved** on every axis. World Engine's recall was purely structural (who is here, grade, recency) and could not tell what the conversation was *about*; its facts could only be appended by hand; its caches forgot things the player had actually witnessed.

### A.11 Deadlines, world facts, threads, the pulse

| World Engine | Decision | Why |
| --- | --- | --- |
| Deadlines (COMING UP, auto-expiring) | **Merged** | Everloom calendar events already hold due dates; the scene block's COMING UP section shows the next ones with the distance computed by code, and past ones drop out. |
| World facts and developments with trends | **Merged** | Everloom's databank facts gain a kind (fact/development), a trend and a status. |
| The evidence firewall | **Adopted** | A world fact written by the model must share evidence words with the turn's text or it's rejected. |
| Threads (off-screen storylines on rung ladders) | **Adopted** | Storylines climb rumor → visible → unmistakable → head on seeded heartbeat rolls; the head surfaces once under SOMETHING HAPPENS. |
| The pulse (random-event pity timer) | **Adopted** | Free and deterministic, seeded by the player's message so a swipe replays the same result. |

### A.12 Weather and outfits

| World Engine | Decision | Why |
| --- | --- | --- |
| Derived weather with story overrides | **Merged** | Everloom already simulates weather; the tracker can set it when the story states it. |
| Outfits (WEARING, "may have changed" after 12 h) | **Adopted** | Cheap, and it fixes a common continuity slip. Reported by the existing tracker pass. |

### A.13 Game layer

| World Engine | Decision | Why |
| --- | --- | --- |
| Sheets | **Merged** | Everloom's player sheet, party and battle stats already exist. |
| Dice with logistic odds and swipe-stable rolls | **Adopted** | A skill check turns the gap between skill and difficulty into odds on a logistic curve (even 50%, +2 ≈ 76%, +4 ≈ 91%) with four tiers. The roll is seeded by the player's message, so a swipe replays the same outcome. The narrator gets the decided outcome under THE DICE. |
| Vitals (death, knockouts, healing; the player is never killed by a report) | **Adopted** | NPCs can be knocked out or killed; the model can never kill the player (HP floors at 1 from model changes). |

### A.14 Sovereign party members

**Adopted.** A party member can be marked sovereign: the narrator may describe what happens to them but must never write their words, thoughts or choices. Their full description is kept out of the block.

### A.15 Rolling context window

**Merged.** Everloom already trims the oldest history to fit the model's context. It now trims in chunks of 10 messages, so the start of the prompt stays stable and provider prompt caching keeps working, and the memory summaries cover what was cut. Nothing is ever deleted.

### A.16 Import a world from a lorebook or card

**Adopted.** An owner-pressed action reads a lorebook (and optionally the character card) with the utility model and proposes places, people, organizations and facts, which the owner reviews before they're applied as ops.

### A.17 Tools

| World Engine | Decision | Why |
| --- | --- | --- |
| Health check with one-click repairs | **Adopted** | Deterministic diagnostics: orphaned places, people in places that no longer exist, duplicate names, dead party members and more, each with a fix. |
| Block preview, transactions with revert, call log, unresolved names | **Adopted** | All in the new World inspector. The call log records every model call (role, model, ms, tokens, purpose). |
| Briefing, dossiers, inquiry agent | **Skipped** | Off by default in World Engine and never judged in play. Each is an extra model call per scene; hierarchical summaries and better recall cover the same need. |
| Slash commands | **Skipped** | Everloom's command menu and screens cover them. |

### A.18 Memory (top priority)

**What a memory is.** An event with participants (who it's *about*) and witnesses (who *saw* it — not the same thing), a place, a game time, an importance (1 ordinary, 2 lasting, 3 milestone), a secret flag and the message+swipe it came from. Standing truths ("Mara is a knight") are separate *facts* with a slot key, versioned: a change the story shows supersedes the old value (history kept, citation kept), a contradiction without a shown change becomes a *conflict* for the player to settle, and a model-proposed fact must pass the evidence firewall. Summaries sit above: finished scenes fold into scene memories, finished days into day summaries, piled-up summaries into chapters; all editable, and milestones are carried up verbatim when prose drops them.

**Who knows what.** Witnesses know first-hand. Off-screen gossip passes non-secret memories between people standing together, deterministically, one retelling at a time (distortion 1 = heard secondhand, 2+ = rumour, dies past 3). Secrets never travel and never go into a summary; when one is recalled for the player it carries "(secret — only you and X know)". Each person present in the scene block gets KNOWS / HEARD / DOES NOT KNOW lines scoped to them.

**Recall.** Hybrid score per memory: BM25 from SQLite FTS5 (squared, relative to the best match, and computed on what the player *just said* with the wider recent text at 60%); embedding similarity when an embeddings connection exists; how much it's about the people here; a place the player named (or, weakly, the current place); people named recently; importance; recency (half-life 3 game days); pinned. Names of people are taken out of the keyword query (they have their own signal, and otherwise every memory about a person outranks the one being asked about); so are the words of a place the player names ("Temple of Dawn" must not match "guard the gate at dawn"). Near-duplicates are collapsed; every person present gets at least one memory they know; someone spoken to gets more room. Each recall keeps its score breakdown for "Why recalled?".

**Writers.** The per-turn tracker pass (same call as before, no extra cost) writes the turn's events and facts. The background *chronicler* reads unread stretches of chat every N turns (N by turn number, so swipes never shift it) with a watermark that only counts runs whose last message is still live, never advances on a failed or garbled call, and never re-reads; it replaces Phase 1's rolling summarizer and is the only writer for chats without a game. *Consolidation* folds with the background model or, when that's off, in plain text.

**Swipe-safe by construction.** Every row is anchored to message+swipe like the op log, and "live" is computed at read time: a swipe hides what the other take wrote, swiping back restores it without a new call, an edit or regenerate deletes what the old text caused, deleting a message deletes what it caused and whatever was built from it (a folded scene, a day summary). Branches copy memory up to the branch point.

**Benchmark** (`tests/memory-bench`, `npm run bench:memory`). A deterministic 320-turn synthetic campaign: 12 people, 8 places, ~11 game days, secrets told in private, facts that change, and 64 questions asked at least 20 turns after the event — by keyword, by person + place, "does the person here remember what they saw", secrets that someone present must not know, and current facts. It runs through the real server pipeline (messages → tracker pass → memory writers → chronicler and consolidation) and reads the scene block exactly as a reply would. Phase 1 is re-created beside it (rolling 250-word summary every 24 messages, 5 facts per rewrite, 12 newest shown, 6 full-text hits); in mock mode its summarizer is an idealized stand-in that never invents anything and keeps important events longest, so the old numbers are, if anything, flattering. A real-model mode sends the prose to a real model (`MEMORY_BENCH_URL`, `MEMORY_BENCH_MODEL`, `MEMORY_BENCH_KEY`).

| Metric (mock mode, balanced, 320 turns) | Phase 1 | Phase 2 |
| --- | --- | --- |
| Recall hit rate | 28% | 86% |
| — by keyword | 7% | 100% |
| — by person + place | 50% | 71% |
| Person present remembers what they saw | 7% | 93% |
| Knowledge-leak rate (lower is better) | 14% | 0% |
| Current fact shown | 57% | 100% |
| Stale-fact rate (lower is better) | 29% | 0% |
| Memory tokens per prompt (avg / max) | 657 / 702 | 790 / 901 |

To check the tuning didn't just fit one campaign, a second campaign that was never used for tuning (`--seed 7`, 69 questions): recall 31% → 100%, person 7% → 100%, leaks 29% → 0%, current fact 42% → 100%, stale facts 17% → 0%, tokens 647 → 782.

How it got there (each step measured on the benchmark): the first version recalled only 45% and leaked 21%. Fixes, in order: BM25-proportional keyword scores instead of rank-flattened ones and more weight on them than on "someone here was involved" (keyword recall 60% → 100%); folded beats stay recallable, with scene summaries moved to the recap layer (details were being lost in folds); secrets kept out of day summaries and marked when recalled (leaks → 0%); people's names out of the keyword query (person recall 29% → 86%); facts about people named but not present shown under STORY SO FAR (current fact 14% → 100%); a place counts as named only when the player names it, and its words leave the keyword query (person + place 57% → 71%). The regression test `apps/server/test/memory-bench.test.ts` runs 200 turns and fails if recall, leaks, facts, token cost or call counts slip. It costs about 20% more prompt tokens than Phase 1's summary, spent on per-person knowledge lines that Phase 1 didn't have at all.

---

## Part B — Character Library

Character Library (the SillyTavern extension, AGPL-3.0) was used as a specification of features and behavior; no code was copied into Everloom. Everloom has a real database, so everything below is rebuilt on top of it rather than on SillyTavern's folders.

| # | Feature | Decision | How it works in Everloom |
| --- | --- | --- | --- |
| 1 | Library view | **Built** | Windowed grid/list (only visible cards are in the DOM; the e2e test opens and filters 2,000 characters within its 5 s / 2 s budgets) with a filter language (`tag:`, `-tag:`, `creator:`, `tokens>1500`, `has:lorebook`, `has:chats`, `fav`, `linked:`, `in:<collection>` …), tri-state tag chips, sorts, saved filter presets and a default preset. Card info on hover/long-press. |
| 2 | Multi-select and batch actions | **Built** | Tag/untag, favorite, add to/remove from a collection, export, delete. Deletes go to a one-day trash and can be undone. |
| 3 | Detail sheet | **Built** | Tabs for details (creator notes in a sandboxed frame, greetings), edit, chats, gallery, lorebook, related, versions, and an Info tab for troubleshooting. Previous/next through the filtered list. |
| 4 | Versions and snapshots | **Built** | A version is saved before every change to a card (plus manual ones with a label), with a word-level diff per field, restore (itself undoable) and a retention setting. Stored in `character_versions`. |
| 5 | Collections | **Built** | Named, ordered virtual folders with icon and color; a character can be in several. |
| 6 | Duplicates and display names | **Built** | Groups by content hash, name similarity and matching fields; merging moves the others' chats to the one you keep and deletes the rest (undoable). A display name is a local nickname that never changes the card. |
| 7 | Character studio | **Built** | `/characters/studio`: brainstorm five concepts, write a full card from a brief, refine the whole card, (re)write one field, or select a passage and revise just that (quick chips or your own words). Built-in styles plus your own system prompts, a choice of connection, undo, start from an existing character, save as new or overwrite (a version is kept). Uses the main model; each call is in the call log. |
| 8 | Related and recommender | **Built** | Related: deterministic score from shared tags (rarer tags count more), same creator and description similarity, each with its reason. "What should I play?": the utility model picks three from a sample of the library (mood matches, favorites, forgotten and never-played ones, random) and says why; picks map back through short numbers, so it can't invent a character. |
| 9 | Chat history browser | **Built** | Every chat across all characters, virtualised, with search inside messages, filters, sorts, presets, and a jump straight to the matching message. |
| 10 | Bundles | **Built** | One zip with cards, chats, gallery media and lorebooks, previewed before import with per-character conflict choices (skip, keep both, replace with a version kept). Reads SillyTavern zips (cards + `chats/<name>/*.jsonl`). Guards against zip bombs. |
| 11 | Lorebook manager with AI entries | **Built into the existing Lore screens** | Search across lorebooks; in a lorebook, "Generate entries" proposes entries on a topic (skipping ones already there) and adds only the ones you tick; each entry has "Write/Improve with AI" with undo. A character's lorebook gives the model that character as context. No second lorebook UI. |
| 12 | Media localization and integrity | **Built** | "Media check" saves the remote images cards link to and points the cards at the copies (a version is kept; the original link is remembered, so a lost file can be downloaded again). The integrity check finds lost files, stray files, unused media and broken avatar/gallery links, and fixes only what you tick. Media counts as used if its id appears anywhere in the database, version history and trash included, so nothing still referenced is ever offered for deletion. Everloom's database ids already avoid SillyTavern's shared-name gallery problem, so no workaround was copied. |
| 13 | Custom CSS and assistant | **Built** | Snippets you can add, enable, reorder, rename, duplicate and delete. The assistant knows the design tokens and stable `ev-*` class hooks, writes and revises snippets, and its output is cleaned like everything else (no `@import`, no remote `url()`, no legacy script-in-CSS). Settings never gets custom CSS, and `?safe-mode` turns it off for the browser session. |
| 14 | Online sources | **Built for Chub; others checked and not built** | See below. |

**Online sources in detail.** One provider interface (search, preview, import, latest version, link recognition), with the server doing all fetching: cached (search 10 min, previews 30 min, update checks always fresh), rate limited per provider (bursts of 5, then 2 a second; pictures 24 then 8), pictures proxied, and everything through the same guard that stops content from making the server call loopback, private or link-local addresses. Imports link the character to its source; search shows "In library" and can hide owned ones; a link scanner finds unlinked cards that name their source page; update checks show field-level diffs and apply the fields you choose, keeping the previous version. Adult content is off by default and enforced on the server whatever the page asks for. An optional Chub API key is stored encrypted like the other secrets and never sent back to the browser.

- **Chub**: built on the openly accessible endpoints established open-source clients use (`/search`, `/api/characters/{creator}/{name}?full=true`). A card whose creator hid its definition is refused, with no fallback to the card image or anything else. **Verification gap:** Chub's API and terms page answer "not available in your country" from the environment Everloom was built in, so the terms couldn't be read there and nothing could be recorded live; tests use fixtures built to the documented response shape (`tests/fixtures/sources/chub/README.md`). Check it from your own server before relying on it.
- **Character Tavern, Wyvern, Pygmalion**: no public, documented catalog API was found, so they weren't built. Adding one is a single provider file once one exists.
- **Not built, on purpose**: Cloudflare or bot-protection bypasses, headless-browser scraping, userscript bridges, and anything that recovers definitions a creator hid.

**Also fixed along the way.** Pictures in creator notes never showed: the app's security policy only allows its own images and the sandboxed notes frame inherits it. They now load through an authenticated image proxy with the same address guard, which also keeps phones from contacting third-party hosts. Character writes now refresh other open devices.

---

## Model calls per turn, by preset

Every model call is logged (Settings → World inspector → Model calls). Measured by `apps/server/test/cost.test.ts`, which plays the same 30 turns under each preset with off-screen characters present and counts calls by purpose; background calls (chronicler, consolidation, off-screen life, seeding, embeddings) run after the reply and never delay it.

Measured over 30 turns with the mock model (apps/server/test/cost.test.ts).

| Call | cheap | balanced | max |
|---|---:|---:|---:|
| chronicler | 0.03 | 0.03 | 0.10 |
| consolidation | 0.00 | 0.10 | 0.23 |
| memory embeddings | 0.00 | 0.50 | 1.00 |
| off-screen life | 0.00 | 0.33 | 1.00 |
| pre-read | 0.00 | 0.00 | 1.00 |
| recall query embedding | 0.00 | 0.97 | 0.97 |
| reply | 1.00 | 1.00 | 1.00 |
| storyline seeding | 0.00 | 0.07 | 0.07 |
| tracker | 1.00 | 1.00 | 1.00 |
| **LLM calls / turn** | **2.03** | **2.53** | **4.40** |
| embedding calls / turn | 0.00 | 1.47 | 1.97 |

- **Cheap** = Phase 1's cost (one reply + one tracker call) plus a chronicler pass every 30 turns. Memory, gossip, dice, intent, threads and the pulse are all deterministic and free.
- **Balanced** (default) adds semantic recall (one small embedding call per turn when an embeddings connection exists), consolidation, off-screen life every 3 turns and storyline seeding every 15.
- **Max** adds the pre-read (a utility call *before* the reply, the only one that adds latency) and runs everything more often.
- On-demand tools (studio, lorebook entries, recommender, CSS assistant) cost nothing until used.

**Latency** (mock model, Send → first streamed token, balanced, median / p90): Phase 1 259 / 323 ms, Phase 2 264 / 327 ms (+2%).

---

# Phase 3 — the remaining gameplay systems

Phase 3 fills in the gameplay systems from the reference app's feature list (used for behavior only; no code or UI was taken from it). Same rules as Phase 2:

- **One engine.** Every new system is a set of ops in the existing reducer (`packages/engine/src/game/ops3.ts`, handled in `handlers3.ts`). Ops are anchored to the message and swipe that caused them, recorded with inverse patches, and replayed in story order, so swiping, editing, deleting and branching roll every system back exactly.
- **The model narrates, code keeps the numbers.** Prices, fares, delivery times, damage, XP, crafting quality and arrival events are all computed by code from seeded randomness (`createRng(seedFrom(seed, key, counter))`), so a replay gives the same result.
- **New AI calls are optional** and on demand (see *Model calls* below); the per-turn cost of every preset is unchanged.

Each entry says what was **built**, **merged** into something Everloom already had, or **deferred**, and why.

## 1. Visual-novel stage

- **Built — scene effects.** `fx.play {effect, intensity, seconds}`: shake, flash, fade, blur, vignette, heartbeat, sparkle, rain, snow, fog, embers, lightning, glitch. The tracker may emit them; the stage has a quick menu. Effects are cues in the state (so they roll back), play once when they first appear, use only transform/opacity/filter, and turn gentle under reduced motion (lightning becomes one soft flash; never a strobe). Each effect can be turned off (*Stage & sound › Scene*).
- **Built — animation layers and a director.** `stage.layer` places a character left/center/right/off with an expression and an entrance (bounce, nod, shake, slide-in, fade-in); `stage.clear` resets. Layers: background → atmosphere → sprites → effects → dialogue/UI. Sprites breathe while idle and bob while their line is spoken; scene-wide motion (shake, blur, glitch) moves the scene container, overlays sit above it, so effects don't fight.
- **Built — speech bubbles** (optional). Quoted lines appear in a bubble anchored to the speaker's position, narration above it (with speech tags such as *she says* folded away). Tapping a bubble opens the full line in the dialogue box.
- **Built — cutscenes.** `cutscene.add/play/stop/remove`. Authored ones use a short script editor (one line per step, `Name: line` for speech) on every screen size; generated ones come from the utility model on request (*Draft*, with an optional idea), are validated against the op schema and only saved when the player confirms. The player is full-screen with Skip, tap/Enter to advance and auto-advance for timed steps; steps can carry an effect, a background and a music mood.
- **Merged — generated cutscenes at milestones.** Rather than a hidden call on every battle victory or thread climax, generation is on demand from the Stage tool. It keeps the new call optional and predictable in cost.
- **Built — Live2D (optional, off by default).** `pixi-live2d-display` with `pixi.js` 6, loaded only when Live2D is on. The **Cubism Core is proprietary and is not bundled**: the owner uploads `live2dcubismcore.min.js` in *Stage & sound › Sprites*; it is stored per owner and served only to them. Models are uploaded per character as a zip (path-checked on unpack). Expressions and motions follow the emotion system; the mouth follows the TTS voice (*lip-sync*: the level comes from a tap on a copy of the playing audio, so playback is never rerouted; browser voices get a gentle made-up movement). Anything missing falls back to the ordinary sprite. The lip-sync level source was verified in Chromium; the full path with a real model could not be run in CI because the Core can't be shipped.

## 2. Maps and travel

- **Built — transit hubs.** Station, dock, airport, portal, stable and taxi stand are location kinds. `transit.add` defines a line (stops, first/last departure, frequency, minutes per stop, fare, fare per stop); departures are computed from the game clock in both directions. Tickets are items (`transit.ticket`), used up by `transit.ride`, or the fare is paid at boarding.
- **Built — travel modes.** 22 modes, offered by genre: walk, run, bicycle, motorcycle, horse, carriage, caravan, boat, ship, airship, portal, bus, taxi, subway, car, train, ferry, flight, shuttle, hovercar, maglev, starship. Each has a speed, a fare, an energy cost and the route kinds it can use.
- **Built — route requirements.** `route.require` and line requirements: discovered, fare, vehicle, item/key, organization standing, reputation, quest, party size, not wanted, opening hours, weather. A failed check gives the reason and a fix (*Move 1 companion to the reserve*, *Opens at 08:00* with a *Wait* button).
- **Built — history and arrival.** A trip log, *Recent places* quick travel, a visited overlay on the map. On arrival code notes who is there (schedules and household presence), the weather, trackers left low, checkpoints when wanted, and (on long overland trips) a seeded encounter; the narrator gets it as `JUST ARRIVED` in the scene block. *Events on the way* can be turned off per campaign (who is there is always noted).
- **Fixed along the way.** The travel-mode choice was nested inside the list of obstacles, so a place with nothing in the way offered no way to travel. Caught by the full e2e matrix.

## 3. Player Home

- **Built.** Homes are tied to map nodes; kinds house, apartment, room, guild quarters, castle, cabin, campsite, cave, vehicle; ownership owned, rented (rent is a bill, §5) or borrowed; one primary home. Rooms with amenities that do something (a better bed restores more sleep, a kitchen or hearth is a cooking station, a forge or workbench enables crafting) and upgrades. Storage containers with capacity; stored items aren't carried.
- **Built — the household**, separate from lineage: head, resident, dependent, guardian, guest; relation text; schedules. Presence ("who is home now") comes from schedules and feeds the scene block at home. The brief's examples (a child living with grandparents, siblings in different homes, a partner who visits, a resident who leaves for work) are unit tests.
- **Built — home actions.** Sleep and rest use room effects; cook and craft need the station; store and retrieve need you there; inviting someone over schedules a visit. Opening the Home screen works anywhere.

## 4. Party and progression

- **Built.** A leader (acts first in battle, and the scene block says who leads), rows (front/back) and an active party of up to N with reserves, roles (tank, healer, damage, support, scout), tactics presets (aggressive, defensive, heal first, conserve) plus simple rules ("heal when an ally is under 30%"), a party bag beside personal inventories, class definitions (built-in per genre plus custom) with stat growth, a skill tree with requirements (level, prerequisite skill, item, quest) and ranks, XP sources that can be switched off, three level curves (the standard one equals Phase 1's formula), stat points, custom vitals per character, and one level-up moment (animation and a summary sheet).
- **Built — proposed skills.** The helper may propose `skillnode.add` and `class.define`; like all its proposals nothing changes until the player accepts.

## 5. Inventory and economy

- **Built.** Currencies per world: fantasy worlds count in gold, silver and copper (`12g 3s 4c`), and any world can add currencies with exchange rates; a wallet and a ledger; containers with capacity (one level of nesting); banking with deposit/withdraw at bank locations or the phone, optional interest and loans with installments; bills on calendar dates with a consequence ladder (a warning, then a late fee and standing loss with the payee, then eviction or repossession), shown in the phone and calendar; owned assets with value, upkeep and income on a schedule (vehicles count for travel); shops linked to places with opening hours, genre stock restocked on a schedule, prices from standing, reputation and the shopkeeper, and a seeded haggle check once per shop per day; trade with a fair-value check.
- **Built — crafting.** One recipe system for cooking, alchemy, forge, enchantment and general crafting: ingredients, a station, a discipline level and time (the clock advances); one seeded roll on the shared dice curve decides quality (poor → masterwork) or, for enchantment, success, with a lost slot on a critical failure. The utility model can suggest a recipe that fits the world; the player confirms it.

## 6. Battle

- **Built.** Break gauges (weakness hits and crits drain them; a broken foe loses turns and takes ×1.5), enemy intents declared a turn ahead by rules (no model call) and carried out on the declared target, target types (single, all, row, random, self, ally, all allies), reserve swaps that cost the turn, and persistent results: HP, resources, statuses, loot, XP shared with active members, injuries (a knocked-out ally comes back at 1 HP with an injury). A summary is posted to the story and the whole battle is bound to its message.

## 7. Communication

- **Built.** One data model with two looks chosen by genre: a phone, or a codex (Letters, Notice board, Archive, Acquaintances) for worlds without email. Group texts with read receipts; turn-based calls (TTS when on) that take game time and are written to memory, witnessed by the two people on the call; letters with delivery time from distance and courier (post rider, hired courier or messenger bird; mail or express; standard or priority relay, by genre), replies scheduled by code and written in the sender's voice when first opened; email; an in-world browser/archive generated on demand and cached per campaign; a social feed driven by the simulation where liking someone's post (+1 affection, taken back on unlike) and your first comment on it (+1 trust) touch relationships you already have; custom apps (name, icon, prompt) powered by the utility model. The home screen shows a "While you were away" digest instead of a stream of notifications.

## 8. Images, sprites and audio

- **Built — asset library.** Sprites, backgrounds, CGs and icons shared across characters and campaigns, with names, tags, search and type filters, zip import (folders become tags; `backgrounds/`, `cgs/`, `icons/` set the type; emotion-named pictures such as `happy.png` form an expression set), and one-tap use: give a set to a character, use a sprite for one expression, set a chat background. Assets are ordinary media rows, so they are served, backed up and checked like any picture.
- **Built — music.** Playlists of the owner's own tracks, chosen by the scene (`music.set` by name or mood), the battle playlist during battles, then a playlist for this place (a location kind or name) and time of day; two decks crossfade (default 2.5 s). Nothing plays until the owner turns music on and touches the page.
- **Built — ambience.** Rain, storm, wind, city, crowd, forest, sea, fire, night: chosen by the scene or, on *Follow the scene*, by weather, place and hour. The owner's own loops if added, otherwise synthesized in the browser with Web Audio (so no sound files ship), with its own volume under the music.
- **Built — creator/reference voices.** Preset voices and custom reference voices are kept apart. A reference voice needs an explicit consent statement (stored with it), and is sent only to OpenAI-compatible voice servers the owner marked *Accepts reference audio* (XTTS, F5 and similar). ElevenLabs voice IDs work as preset voices.
- **Built — local image generation.** ComfyUI (paste an API-format workflow) and AUTOMATIC1111/Forge (`--api`) were already connection types; the README now explains running them on the VPS or another machine.
- **Deferred — music stream URLs.** The app's Content-Security-Policy only allows its own media; streaming arbitrary URLs would need a proxy or a looser policy. Tracks are uploaded instead.
- **Deferred — item icons from the library.** Icons can be stored and tagged, but inventory items still use the built-in icon set.

## 9. Customization and recovery

- **Built.** Floating tool panels on desktop (drag, resize, dock; per device), a floating status bar that drags, snaps to edges and moves with the arrow keys, *Reset layout*; on phones the fixed layout stays, with show/hide for the status bar, reply chips and avatars and a reorderable status bar. Cinematic mode hides all UI. Save slots (a named point in the story) that load by forking a new branch, so nothing is overwritten. A Diagnostics page (health, database size, backups, a Test button per connection, recent errors, failed model calls and a debug bundle with keys removed); the campaign health check stays in the World inspector. Four contrast-checked accent palettes (amber, dusk, sea, rose) and an optional genre theme per world; custom CSS stays the power-user option.
- **Merged — "minimap", "quick bag", Helper Pet.** These are tools in Everloom (the map, the inventory, the helper), so they float through the same panel system rather than as separate widgets. Everloom has no separate cast-strip widget to move.

## 10. Character sources

Phase 2's provider interface was extended, not rebuilt: a capability matrix per site (search, preview, import, updates, supported sorts) drives what the UI shows; "In library" badges, *Hide ones I have*, auto-link on import, the bulk link scanner and card updates with field-level diffs carry over to every provider; each source remembers its sort and filters on the device; infinite scroll is a switch (*Load as I scroll*).

Access was checked site by site (robots.txt, public APIs, bot protection). The server never tries to pass a challenge, never spoofs a browser, and never extracts a definition the creator hid; hidden cards import their public parts with a *definition hidden by creator* label. Requests are cached, rate-limited and identify Everloom in the User-Agent. Tokens are encrypted like API keys. Adult content is off by default and enforced by the server. Provider tests use recorded fixtures only.

| Site | Access | Why |
|---|---|---|
| Chub | Server | Public API; optional API key for account settings. |
| Character Tavern | Server | Public search and character API; robots.txt allows it. |
| RisuRealm | Server | Search reads the public page data; imports use the public download API RisuAI uses. Hidden cards are never downloaded. |
| Pygmalion | Server | Public character API (public characters only). |
| Wyvern | Server | Public explore API; fields the creator marks secret are left out and labelled. |
| Botbooru | Browser bridge | robots.txt disallows automated access to its API and pages. |
| AI Character Cards | Browser bridge | Pages sit behind a browser check. |
| JanitorAI | Browser bridge | Cloudflare. A hidden definition stays hidden. |
| JannyAI | Browser bridge | Cloudflare. |
| DataCat | Browser bridge | robots.txt disallows its API. |
| Saucepan | Not supported | No public catalog or permission to import was found. |
| Any link | Server | A direct card file (PNG, JSON, CHARX) or a page on one of the sites above. |

- **The browser bridge.** A userscript (Tampermonkey/Violentmonkey, including Firefox for Android) and a bookmarklet send what the page shows the user (name, avatar, greetings, public description, tags, creator, and the definition only when public) to `/api/bridge/import` with a per-device token from *Settings › Characters*. Tokens are stored as hashes and can be revoked; a bad token is rejected.
- **Deferred — Chub timeline, favorites, follows, gallery and remote version history.** These need account-scoped endpoints whose response shapes couldn't be recorded as fixtures from this build environment (its network policy blocks the site). Update checks with field-level diffs and embedded lorebooks work.

## Model calls

New calls, all on demand, all in the call log with their purpose:

| Purpose | Role | When |
|---|---|---|
| phone text, group text, phone call | main | You text or call someone |
| letter, email | main | You open an incoming letter whose words aren't written yet |
| feed posts | utility | You refresh the feed |
| in-world browser, archive lookup | utility | You look something up (cached per campaign) |
| app: *name* | utility | You run a custom app |
| recipe idea | utility | You ask for a recipe that fits the world |
| cutscene draft | utility | You ask for a generated cutscene |
| helper | utility | You ask the helper (it may now propose skills) |

Calls per turn under each preset are **unchanged from Phase 2** (re-measured by `apps/server/test/cost.test.ts`: cheap 2.03, balanced 2.53, max 4.40 LLM calls per turn).

## Upgrading from Phase 2

A real Phase 2 database (`tests/fixtures/phase2.db`, written by the Phase 2 release through its own API) upgrades with a backup first, every row kept and Phase 3 systems starting empty. One thing the test caught: battles, sleep healing and travel changed rules, so replaying an old campaign's log under today's rules would quietly give different HP on the first swipe after the upgrade. When an older campaign is first opened, its log is replayed once; anything that comes out differently is pinned to what was recorded by a single *upgrade* entry on the latest message, applied after everything else there. The state stays exactly what the player last saw, and swipes and edits keep working.

## Performance

- **Bundle.** Every new screen and tool is its own chunk. The main script is 76 KB brotli (Phase 2: 82 KB); the first load is 179 KB brotli. Moving one helper out of the module with the op schemas took zod out of the browser entirely and the stage chunk from 133 KB to 12 KB. All assets: 454 KB brotli (Phase 2: 363 KB) plus the 140 KB Live2D renderer, which only downloads when Live2D is on.
- **Frame rate.** 60 fps idle and 59 fps average with rain and shake playing together (95th-percentile frame 16.8 ms), measured in headless Chromium at 1280×800.
- **Crossfade.** A measured 2 s linear crossfade with the summed volume constant and the old deck paused at the end. Audio now unlocks on the first real tap (caught by the measurement: taps before the story finished loading didn't count, and on touch screens `pointerdown` never does).

# Phase 4 — scripting, sources, feature switches, privacy, Windows, artwork

Each part below records what was built, what was deliberately not, and why. Parts were done in the
order the brief suggests (2 → 3 → 5 → 4 → 1 → 6 → 7).

## Part 1 — Scripting and extensions

Guides: [docs/scripting.md](scripting.md) and [docs/extensions.md](extensions.md).

**What existed.** Macros (`{{getvar}}`, `{{setvar}}`, dice, time, game values), chat variables in the
chat's metadata, and a script-less sandboxed frame for creator notes. Nothing ran user code. All of
it was extended, not duplicated: the macro engine gained character, message and script values; the
creator-notes frame is still what message HTML falls back to when its scripts aren't allowed.

**The sandbox.** Each script, panel, screen and HTML block is an `<iframe sandbox="allow-scripts">`
of `/api/sandbox/frame`, a document with its own policy (`connect-src 'none'`, `frame-src 'none'`,
pictures only as `data:`/`blob:`, `frame-ancestors 'self'`; the rest of the app stays `DENY`).
Without `allow-same-origin` the frame's origin is opaque: no cookies, no storage, no access to the
page; the policy blocks every request, so a script can't send anything anywhere on its own. A
separate origin would add little over an opaque one and complicate self-hosting (a second hostname
and certificate), so we didn't require one. The frame's runtime (plain JavaScript, inlined into the
document) receives the code and HTML by `postMessage` after it loads; nothing user-provided is in the
document Everloom serves.

**The bridge.** Every call from a frame is `postMessage` to the app, which looks the frame up by its
`contentWindow` (never by what the message claims), checks the call against a table of permissions,
and only then does the work with the app's own API calls. Calls that cost money (`generate`), reach
the internet (`network`, server-side fetch with a domain list, `https` only, 1 MB) or keep data
(`storage`) are checked again by the server against the script's approval, so a compromised page
script still couldn't use another script's grants. Keys, settings, accounts, backups, the extension
manager and the database have no bridge call at all.

**Approval follows the code.** A grant stores a fingerprint of the code, the permissions and the
domains. Anything changing (an edit, an updated card, an extension update) withdraws the approval
for that script only. Imported cards, presets and lorebooks come in with scripts, regex rules and
message scripts off; the review sheet shows code, permissions in plain words, and Enable / Enable
once (in memory, gone on sign-out or restart) / Keep disabled, plus trusting the creator. Scripts
the owner writes are approved as they're saved.

**Runaway code.** Sandboxed frames can share the page's thread, where a parent-side watchdog can't
interrupt a busy loop. So every loop is rewritten with an `acorn`-parsed guard call (a random name
per frame, defined non-writable before the script runs) that throws once a task exceeds its budget,
and keeps throwing until the task ends, so an inner `try/catch` can't swallow it. The watchdog pings
each frame and removes one that stops answering. Deep recursion ends by itself; a deliberately
hostile script can still freeze the tab, which is stated in the docs with the way out (`?safe=1`).

**Message HTML.** ```` ```html ```` blocks, a configurable tag and whole documents render in
auto-height frames that mount when scrolled near (long chats stay light on a phone); the theme's
CSS variables and a small `ev-*` class kit are passed in. Remote pictures in the HTML are fetched
through the image proxy and inlined. Scripts in messages run with the character's *message
permissions*, once approved (or always with no permissions, or never, by setting).

**Variables at four scopes.** Chat (the chat's metadata, as before), character and global (a
`variables` table), message. Message variables are stored on the swipe that set them, and a
message's value is the merge along each message's current swipe, so they follow swipes, edits and
deletions without any extra transaction bookkeeping.

**Game changes from scripts** go through `validateOps` and the reducer like the AI's, anchored to
the newest message and its swipe with a new `script` source that is removed with its message and on
regeneration (the player's own changes are kept, as before).

**Custom ops are declarative.** Extensions describe arguments and steps (`set`, `add` with clamping,
`push` with a limit, `delete`, `require`) on `state.ext[<id>]`. The reducer runs them, so inverse
patches are recorded like for built-in ops and the rollback suite covers them; no extension code
runs inside the reducer, on the server or anywhere it could see other state. Turned-off or
uninstalled extensions keep their definitions registered for replay, but new changes with them are
refused.

**Regex rules** follow SillyTavern's format and placements (input, output, world info), with
display-only, prompt-only and depth limits, applied in three places: stored text (on the server,
for typed, generated and added messages), the prompt (history by depth; world info), and display
(in the message renderer).

**Slash commands** are a small parser (`|` pipes, `{{pipe}}`, quoted and `key=value` arguments) and
a registry built-in commands, scripts and extensions add to; a command run by a script is checked
against its permissions. Closures, loops and `/if` were left out on purpose.

**Tavern Helper compatibility** is our own implementation of the documented function names over
the bridge (PolyForm Noncommercial forbids using theirs). Synchronous reads are served from a
snapshot kept current by events. It has no extra powers. jQuery and lodash are not bundled; small
subsets of the common calls are.

**Extensions.** Manifest validated with zod; packages from a zip, a Git host's zip download or a
dev folder inside the import roots (watched, reloaded on save). Entry HTML gets its relative
scripts, styles and pictures inlined server-side, since a frame can't load addresses. Files are
sealed by the Vault like media. Server extensions run in a child process started with
`node --input-type=module -e` (the main module arrives over IPC as a `data:` import, so nothing
decrypted touches the disk), get no database handle, keys or session, and only exist when the
server is started with `EVERLOOM_SERVER_EXTENSIONS=1` and the first account installs them.

**Deferred.** A marketplace or index of extensions; signed packages; per-extension resource
quotas beyond the frame limits; STscript closures and `/if`; the rest of Tavern Helper's API
(presets, character editing, audio, imports); running SillyTavern UI extensions (they depend on its
page and are out of scope by design).

## Part 6 — Windows installer

**Electron, with the server on its own Node.** The window and tray are Electron (`desktop/main.js`);
the server is the normal built server, started as a child process on a bundled `node.exe` (the CI
machine's official Node 22). Running the server inside Electron's Node would need native modules
(the SQLite driver with ciphers, sharp) rebuilt for Electron's ABI on every Electron upgrade; with
a plain Node they're the ordinary Windows prebuilds `npm install` fetches. Tauri was considered: a
smaller shell, but it would still need a bundled Node for the server and a Rust toolchain in CI, for
no gain here.

**One copy, any port, clean stop.** A single-instance lock; a second launch shows the window
(`--quit` asks the first to quit). The port starts at 8787 and moves up when taken. Windows has no
SIGTERM, so the shell stops the server over a token-guarded control route (a random token per
launch, passed in the environment), which runs the normal shutdown that closes the database; only if
that fails within 15 s is the process killed.

**Data.** `%APPDATA%\Everloom` (database, media, backups, logs; Electron's own cache in `app\`),
or a `data` folder next to the exe when a `portable.txt` marker is there (the portable zip).

**Local-first security.** It listens on `127.0.0.1`. "No password on this PC" signs in requests
from this computer as the owner, only while the server is bound to loopback, only from a loopback
socket, and only when the `Host` header is a loopback name (so a web page whose domain resolves to
127.0.0.1 can't use it). "Use from my phone on Wi-Fi" restarts the server on `0.0.0.0`, which by
itself switches the password-free mode off, and the shell refuses to turn it on until a password is
set. The QR code and address come from the server.

**Installer.** electron-builder NSIS, per-user (`perMachine: false`, no elevation), Start-menu and
desktop shortcuts; the uninstaller asks whether to delete `%APPDATA%\Everloom` (default: keep;
always kept on silent uninstall and on updates). Updates: the shell checks GitHub Releases, asks,
makes a backup through the control route (refusing to update if it fails), downloads the setup exe
and runs it silently with `--force-run`; migrations run on the next start as on a VPS.

**CI.** `.github/workflows/windows.yml` on `windows-latest`: build, stage Node + server
dependencies (Windows prebuilds) + web, build the installer, zip the portable folder, then smoke
test: silent install, start headless, `/api/health`, set up, connect the mock model, chat, quit,
start again and find the chat, silent uninstall keeping the data, and the portable zip keeping its
data next to the exe. Tags (`v1.2.3`) attach both files to a release. Unsigned; the workflow has a
commented place for a certificate.

**What CI found.** The first run failed in `npm ci`: npm runs `node-gyp rebuild` for the SQLite
driver even though the package ships a Windows N-API prebuild (its `binding.gyp` only skips the
build after node-gyp has found Visual Studio, and node-gyp 11 doesn't recognise the runner's VS
2026). Installing with `--ignore-scripts` and loading the module as the next step proves the
prebuild works. The second run failed in the smoke test: the mock model's "am I the main module?"
check compared `file://` plus a Windows path with `import.meta.url` and never matched, so it never
listened; it now uses `pathToFileURL`. The third run was green.

## Part 7 — Artwork

**Research first.** `docs/art/PROMPTING.md` was written from the services' model lists and docs
and each model's card and guides before any image was generated. It records the exact model ids
(and the look-alikes not to use), what the API exposes (prompt, resolution and count only: no
steps, guidance or negative prompt), and per model how to phrase prompts.

**Budgets that can't be broken by accident.** `tools/art/gen.mjs` is the only way calls were made.
It allows only the five NanoGPT models, refuses past 95 NanoGPT images per UTC day, refuses
unless the key reports subscription-only billing, and reads the subscription counter and the cash
balance before and after every call: a call is accepted only if the counter went up and the
balance didn't move. A charge, a quota or payment error, or a counter that didn't move stops
everything until a person looks. One transient outage (a 503 from NanoGPT's rate limiter) tripped
the stop; it was checked (counter and balance unchanged), recorded, and the rule narrowed. For
ElectronHub it allows standard (non-premium) models only, reads the price from the model list, and
counts it before the call, so a timeout still counts. The key couldn't read the account balance
there, so the ledger's count is the authority. Every call is in `docs/art/LEDGER.md`.

**Comparison, then choices.** The same three briefs (an icon sheet, a character bust, a
background) went to each candidate; see `docs/art/STYLE.md`. Z Image Turbo made the cleanest
pixel-art sheets and the best-composed backgrounds; Qwen Image the cleanest anime characters;
HiDream repeated items on the sheet and over-saturated; Chroma painted a signature. ElectronHub's
anime SDXL fine-tune drew the best face, but ElectronHub's terms say nothing about who owns
output, so nothing from there ships. Everything shipped comes from NanoGPT, whose terms assign
the output to the user.

**Item icons as sheets.** 9 calls made 139 icons: 4×4 sheets, cut by a gap-closing flood fill
(the icon is grown a few pixels first so light highlights and outline gaps don't let the
background in), put on one 32×32 grid, mapped to one 64-colour palette (octree, which keeps the
few blues that median cut lost to the browns), and given a 1-pixel outline. Rejected and redrawn:
two icons with brand-like marks (an energy-drink claw, a fries "M"), a "flower" that came out as
an orb, a map that came out as a letter, a plasma cutter that came out as a second pistol.

**Icons in the app.** An item shows the owner's own picture, else a bundled picture they picked,
else one matched by its name (about 150 rules, specific before general: "Mana Draught" is a blue
potion, "Shield Cell" a power cell, "Herbalist Primer" a book), else by the engine's icon key,
else the line icon. Inventory, equipment, shops, crafting results and battle loot use it; the
item sheet has a picker with the bundled pictures and the owner's icon assets.

**Optional everywhere.** Settings › Appearance › Illustrations (on by default) turns all bundled
art off; every picture component has the old icon or nothing as its fallback, also when a file is
missing. Backgrounds and Mira's expressions aren't forced on anyone: "Add Everloom's art" in the
asset library and "Try the demo character" in the empty library add them as ordinary assets the
owner can rename, replace or delete; adding again skips what's already there.

**Edits.** Expressions come from one neutral portrait through Step Image Edit 2, each from the
original rather than from the previous edit. The normalized image endpoint accepted the picture
for this model but didn't pass it on (four edits drew a stranger at 1024×1024 before this was
caught). Edits now go through the edits endpoint, which refuses a request without a picture, and
the tool flags any edit whose size differs from its input.

**All-ages, checked by eye.** Every picture was looked at before it was kept. Rejected: a
signature (Chroma), brand-like marks on two icons, blood on four enemy portraits (twice, despite
the prompt; removed with an edit instead), a muddled drone, and expressions that didn't match
their label (Mira's "curious" face ships as *nervousness*, which it shows). About 2 MB in all.

## Part 2 — Character sources

**What was actually broken.** Checked live on 2026-10-05 before changing anything:

| Site | Phase 3 state | Cause | Now |
| --- | --- | --- | --- |
| Character Tavern | search and import failed | `/api/search/cards` no longer exists (404) | reads the site's SvelteKit page data (`/search/cards/__data.json`, `/character/{author}/{slug}/__data.json`), including streamed greetings and lorebooks, and its tag catalogue (6,000+ tags) |
| RisuRealm | some imports failed | cards stored as CHARX answer **400** to the JSON download | falls back to the CHARX download |
| CHARX import | claimed, not implemented | `readCardFile` only knew PNG, WebP and JSON | CHARX (zip with `card.json` and the icon asset) imports everywhere cards import; CHARX files with a picture in front of the zip (offsets relative to the zip) are handled |
| Pygmalion, Wyvern | working | — | unchanged |
| Chub | can't be checked from the build environment (regional block) | — | built to its documented parameters; the self-test tells an owner which work |

**One query language.** `SourceQuery` (engine) is what every site gets: text, include and exclude
tags, creator, sort, time range, token range, has lorebook, has other greetings, language, adult,
page. The search box takes the library's filter syntax plus `sort:`, `time:`, `lang:` and `nsfw:`;
unknown keys and bad values are reported, never silently dropped. Each site declares what it filters
itself (`onSite`); the server then runs `applyLocalFilters` over **every** returned page, so a site
that quietly ignores a parameter still gives correct results, and the UI names the filters that were
page-only. Adult content is always enforced here, whatever the site did.

**New sites, with the reasoning for each.**

- **Botbooru** — open JSON API with full public definitions (`/posts/`, `/post/{id}`, `/tags/`).
  Its robots.txt disallows `/post/` and the API, so it is behind a **site notice** accepted once:
  Everloom isn't a crawler (only owner-initiated requests, one at a time, slow bucket), and the owner
  takes responsibility for the site's terms. Optional sign-in (`/auth/token`).
- **Saucepan** — no public catalogue API; the app's own same-origin API is used, only on demand,
  after a notice. Tag browsing works signed out; free-text search and definitions need the owner's
  account. Only what its definition endpoint returns to a member is imported; a creator's hidden
  fields stay hidden and the card is labelled.
- **AI Character Cards** — public JSON API (robots.txt allows reference use). Tags go by id and the
  site treats several as "any of", so the final pass makes them "all of". Imports the *current*
  version's card file.
- **DataCat — not fetched directly.** Its session token comes from its "liberator" endpoint, and its
  API is built around recovering definitions that creators hid on other sites. That conflicts with
  the hard rule against extracting hidden definitions, so the server never talks to it; the bridge
  can still send a page the player opened (public fields only).
- **JanitorAI / JannyAI** — bridge only (Cloudflare). Unchanged rule: `showdefinition === false`
  means public profile only.

**Accounts.** Settings › Character sources › Accounts: API key (Chub) or username and password
(Botbooru, Saucepan). Credentials and session tokens are encrypted with the server key; the
password is kept (also encrypted) only if the owner ticks the box, so an expired session can sign in
again once. Nothing secret is ever returned to the browser; responses fetched with an account are
cached under a key that includes a hash of the session, and signing out clears the cache. *Test*
re-signs in and runs one search. Pygmalion, Wyvern and Character Tavern account features were not
built: their member features need browser sessions Everloom can't create without a browser.

**Pacing.** Per-site token buckets (Botbooru and Saucepan 1 request/s), a separate one for
pictures, and **429 back-off**: Retry-After is honoured (capped at an hour), otherwise 2 s doubling
to 5 minutes; while cooling down nothing is sent and the UI says so.

**Thumbnails** are resized on the server (`?w=`, WebP, small memory cache), so a phone grid loads
~20 KB per card instead of full card PNGs.

**Cross-source search** runs the query on every site whose notice is accepted, interleaves by rank,
and folds duplicates (same name and creator) into one card with "also on".

**Self-test and fixtures.** Settings › Character sources › Diagnostics runs search → tags → a
filtered search → one character, signed out, and shows each step. *Record fixtures* packs the raw
answers in the test fixture layout (`routes.json` + files), so a broken site can be reproduced. Site
responses are parsed with tolerant zod schemas; a shape change is a clear "site changed" error
pointing at that button, never a crash. Test fixtures for the new sites are synthetic content in
the recorded shapes (`tests/fixtures/sources/make-fixtures.mts` builds them).

**The bridge, rebuilt.** The Phase 3 bridge had real faults: the bookmarklet opened its window after
an `await` (popup blockers refuse that), page security policies blocked its cross-origin requests,
the userscript only matched `/characters/*` URLs so single-page navigation never loaded it, and the
generic fallback sent only the page title. Now:

- per-site readers (JanitorAI, Botbooru, AI Character Cards, Chub, Character Tavern, RisuRealm, and a
  generic one that prefers a linked card file) shared by the userscript, the bookmarklet and the
  tests (page fixtures in `tests/fixtures/bridge`);
- the userscript runs on whole sites, follows address changes, makes requests with
  GM_xmlhttpRequest (no page CSP in the way), offers **Send all** on listing pages (one at a time,
  1.5 s apart, at most 50), has a settings panel (address, token, debug preview) and **install and
  pair**: a one-time code (10 minutes, single use, kept hashed in memory) in the download link that
  the script trades for its own device token;
- the bookmarklet opens Everloom first, then reads the page and hands over the card when the receive
  page answers; if the window is blocked it copies the card for **Paste from bridge**;
- Android: Everloom's manifest registers a **share target**, so sharing a character page to
  Everloom imports it (or explains the bridge for bridge-only sites).

## Part 3 — Feature switches and Classic chat

**One list of modules** (`packages/engine/src/features.ts`): 20 game modules under a master *Game
layer* switch, 6 story-presentation switches, 4 AI helpers, 6 tools, and memory as *full / rolling
summary / off*. Each module declares what it needs (travel needs map and time; crafting needs
inventory; battle needs party; off-screen life needs NPC simulation…), so turning one off turns off
its dependents, and turning one on turns on its requirements. The Features page says which before
applying ("This also turns off: Travel, Player home").

**Presets.** *Classic chat* turns every game module, helper and memory off (tools such as sources,
voice and images stay on). *Story* keeps memory, the status bar and trackers, time and weather,
diary, journal, databank, the stage and its effects, and the tracker pass and scene block; no
economy, map, battle, party, phone or NPC simulation. *Full RPG* is everything, and stays the
default for existing installs so nothing changes for them. First-run setup now asks which one.

**Per-chat override.** A chat stores its own preset (`metadata.features`) and then ignores the
global switches; new chats take the character's default (`chatMode`) or ask. Fine-grained switches
are global only: a per-chat mix of 37 switches would be hard to reason about.

**What "off" does, concretely.**
- *Server:* `settingsFor(chat)` combines the switches with the world settings (`effectiveWorld`), and
  everything downstream reads that: no realtime tick or turn tick, no pre-read, no tracker pass, no
  scene block, no game macros (the prompt context's state is null when the game is off), no
  off-screen life, storyline seeding, chronicler or consolidation according to the switches. Memory
  off skips recall entirely, so no embedding call either.
- *Prompt:* with the game off, the default preset's world-rules block drops out (it only appears
  with game state), so the prompt is character, persona, world info, examples, history and the
  author's note, the way SillyTavern builds it. Measured: Classic makes **exactly one model call per
  reply** (`apps/server/test/features.test.ts`, with every helper's world switch on underneath).
- *Tracker:* the op reference sent to the model is cut to the enabled modules' op types
  (`allowedOpTypes`, `opReferenceFor`), and ops for disabled modules are refused even if the model
  sends them. The Story preset's tracker prompt is under 75 % of the full one.
- *Web:* no tools, status bar, cast strip, composer chips, level-up moment, stage effects,
  cutscenes, audio, atmosphere or Live2D for disabled modules; settings pages for the game, voice,
  images and sources disappear; "Browse online" is hidden with sources off. The game pieces are
  lazy-loaded, so a Classic chat doesn't download them.
- *Data:* nothing is deleted. A chat's campaign stays attached; switching back shows it again, and
  swipes and edits still rebuild it (ops roll back as before, whatever is switched on).

**Not done:** new Classic chats are created without a game; switching such a chat to Story or Full
RPG later doesn't create one (the chat menu says to start a new chat for that).

## Part 4 — Vault

**Keys.** A random 256-bit data key does the work. It is stored only wrapped: once by a key derived
from the passphrase (scrypt, N = 2^17, r = 8, p = 1, 16-byte salt) and once by a recovery key (240
random bits as 48 characters in groups of four, shown once; the alphabet leaves out 0, 1, O and I,
and case, spaces and dashes don't matter when it's typed back). Both
wraps are AES-256-GCM, so a wrong secret is detected, never "decrypted" into garbage. The wrapped
keys, salts and the vault's state live in `vault.json`. Separate subkeys (HKDF) are used for the
database, the files and nothing else, so one key never does two jobs.

**The database.** `better-sqlite3` became `better-sqlite3-multiple-ciphers` (same API, SQLCipher-
compatible page encryption). The whole content database is encrypted: chats, characters, memories,
the search index, settings, the game state. We checked the obvious traps: `VACUUM INTO` from an
encrypted database writes an encrypted copy with the same key (good, backups use it), while the
online `backup()` API refuses a cipher mismatch (so it isn't used). WAL and the shared-memory file
are encrypted pages too.

**What has to be readable before unlocking.** Accounts, sessions, the login lockout counters and
two-factor secrets (encrypted with the server key, as before) move to a small **system store** (`system.db`) that stays plain: the server has
to check a sign-in before anything can be decrypted. It holds no story content. Everything else
answers **423 Locked** until the vault is unlocked; only health, sign-in, the vault's own routes and
the event stream (so the app learns it locked) stay open.

**Files.** Pictures, voices, sprites, music, Live2D models: every file under `media/` and `live2d/`
is sealed individually (AES-256-GCM, magic `EVLTENC1`, a fresh nonce per file). Reads go through one
helper that accepts both states, so an interrupted seal never breaks a page. Served files are
`Cache-Control: no-store`, and the service worker only caches responses the server marks
cacheable, which it never does with the vault on.

**Turning it on, resumably.** Backup first (plain, and reported afterwards with a *Delete* button),
then the keys are written (state `enabling`), the system store is built, an encrypted copy of the
database is made with `VACUUM INTO` + rekey and **verified** (integrity check and row counts of every
table against the original) before it's swapped in by rename. The old plain file is overwritten and
deleted, then the files are sealed one by one (each via a temporary file and a rename). If anything
fails before the swap, the plain database is still in charge and nothing changed; if the server
stops after the keys were written, the settings page shows *Finish turning on*. Turning it off is
the mirror image, with the accounts merged back into the main database.

**Locking.** *Lock now*, an idle timer (1 minute to a day; default 30 minutes), signing out, and
every restart lock it: the database is closed and the key bytes are zeroed. Unlock with the
passphrase or the recovery key. The owner can choose to use the login password as the passphrase;
then signing in unlocks it, and changing the password rewraps the key (the data isn't re-encrypted).

**Nothing readable on the device.** With the vault on, the app stops saving drafts, searches, the
Studio's work, view choices and similar in browser storage, clears what was there, drops everything
it has in memory when the vault locks (the live event or any 423), and the service worker caches no
pictures.

**Logs, backups, exports.** With the vault on, error logs keep the error's type and route, not its
message (messages can quote content). Backups include `vault.json` and `system.db` and stay
encrypted (a locked vault can't be backed up: there is nothing consistent to copy without the
key). Any export can be sealed with a password (scrypt + AES-256-GCM, `.evlt`); with the vault on,
every export offers it, and every import screen recognises a sealed file and asks for its password.

**Limits (stated in the app and the README).**
- Lose both the passphrase and the recovery key and the data is gone.
- While unlocked, the key is in the server's memory: anyone in full control of the running server
  (root, a memory dump) could reach it. The vault protects the disk, stolen backups and a stopped
  server, not a compromised live one.
- Overwriting before deleting is best effort: SSDs, copy-on-write file systems and snapshots can
  keep old blocks. Backups made before the vault was on are readable until you delete them.
- What the browser shows is in the browser's memory while it's open; screenshots and the operating
  system's own swap are outside Everloom's reach.
- File sizes and counts, timestamps and the accounts list (user names) aren't hidden.

## Part 5 — Name shield

**One choke point.** Every request Everloom makes to an outside AI service goes through
`util/fetch.ts › safeFetch` (models, embeddings, voices, image generation). `safeFetch` hands every
string body to `privacy/shield.ts › shieldOutbound`, which rewrites the strings inside the JSON (keys
untouched) and then runs a **leak check** on the result as the provider will read it. Replies come
back through `llm/providers.ts › streamChat`, which is wrapped in `shieldStream`; `completeChat`
(tracker JSON, utility answers, memory work) is built on it, so it is restored too. A test fails if
any server file talks to the network another way (`apps/server/test/shield.test.ts`), and a second
test plays three turns with every helper on and checks that **no** request body the mock provider
received contains a real name, while what was streamed and stored has them.

**Whose terms.** Each HTTP request runs inside an AsyncLocalStorage store with its owner (and the
chat, when the address names one); generation adds the persona and characters. Background work
started by a request inherits it. Terms can be scoped to a persona, a character or a chat; with no
chat context at all, scoped terms apply anyway (hide more, never less), and with no owner every
owner's terms apply.

**Matching.** Case-insensitive, whole words, Unicode-aware; possessives and plural endings stay
("Lena's" → "Mira's"), the capitalization pattern is copied (LENA → MIRA). A full name's parts map
to the stand-in's parts, so "Lena" alone becomes "Mira", not "Mira Hollis"; one-word nicknames map to
the stand-in's first name.

**Streaming.** The restorer holds back text from the earliest word start that could still grow
into a stand-in, so a stand-in split across chunks is caught and never flashes on screen (tested
with every chunk size from 1 to 7). Reasoning is restored on its own channel.

**Stable and collision-free.** Stand-ins are stored with the term, so the same name always maps the
same way. Two terms can never share a stand-in (fixed on save). Before a chat's request, stand-ins
are checked against the chat's characters, persona and the game's people and places (whole names
and their words); a clash gets a different stand-in for that chat, remembered in the chat, with a
notice.

**Leak check, voices, pictures.** If a protected term survives (for example in a key, or through a
path that bypasses the rewrite), the request is refused with the name; with "ask", the app offers
*Send anyway* for that one request. Cloud voices receive the stand-in unless the owner allows real
names; the browser's own voice is local. Uploaded pictures aren't analyzed, and the page says so.
Scripts and extensions (Part 1) call models through the same providers, so they are covered.

**Inspector.** The prompt inspector has *As stored / As sent* when the shield changes anything.

**Limits (stated in the app).** Context can still identify someone; misspellings need extra forms; a
model may shorten a stand-in ("Marc"), which is flagged on the message when it looks like a
truncation but not swapped (that would be guessing).

# Phase 5 — 3D characters

## Parts maker: CharacterStudio evaluated

[CharacterStudio](https://github.com/M3-org/CharacterStudio) (cloned and read, October 2026):

- **License of the code:** MIT (Atlas Foundation, 2022). Reuse would be allowed.
- **Licenses of the part packs:** its sample characters (Anata, Loot, 0N1, Tubby Cats) live in
  [M3-org/loot-assets](https://github.com/M3-org/loot-assets), which has **no license file or
  statement**, and the VRM files themselves say `licenseName: Redistribution_Prohibited`,
  `commercialUssageName: Disallow` in their own metadata. The other example pack linked from its
  docs ([memelotsqui/character-assets](https://github.com/memelotsqui/character-assets)) also has
  no license. **None of them can ship with Everloom**, and we don't download them for the owner
  either. The owner can import packs they have the rights to.
- **Pack format:** a `manifest.json` with `assetsLocation`, `traitsDirectory`,
  `thumbnailsDirectory`, `initialTraits`, `requiredTraits`, `randomTraits`, restrictions, culling
  defaults, `downloadOptions`, `vrmMeta`; then `traits`: groups (`trait` id, `name`, `iconSvg`,
  `cameraTarget`, `cullingLayer`, `cullingDistance`) each with a `collection` of parts (`id`, `name`,
  `directory` → a VRM or GLB, `thumbnail`, `type` tags, `cullingLayer`, `textureCollection` or
  `colorCollection`, `blendshapeTraits`); plus `textureCollections` and `colorCollections`. Every
  part is a full rigged model on the same skeleton.
- **How it combines parts:** each trait model is loaded and its skinned meshes rebound to the body's
  skeleton. Hidden skin is removed by **culling layers**: for every vertex of a lower layer it casts
  a ray outward (`three-mesh-bvh`) and drops faces that hit a higher layer within
  `cullingDistance`. Export merges geometry (`merge-geometry.js`), packs textures into an atlas
  (`create-texture-atlas.js`, MToon and standard) and writes VRM 0 or 1 (`VRMExporter*.js`).
- **How the parts look:** rendered in the 3D lab (screenshot kept out of the repo): the Loot body is
  a stylised white mannequin with black panel lines; the clothes are reasonable low-poly game
  assets. Fine quality, but unusable for licensing reasons anyway.
- **Code shape:** a React app (16,500 lines in `src/library`) whose character manager is tied to its
  own UI state, wallets and NFT minting (Solana, Ethereum, `ownedNFTTraitIDs`), lora and sprite
  generators. The useful pieces (culling, merging, atlas, export) are entangled with that state.

**Decision: Everloom's own maker that reads the same pack format.** Packs made for CharacterStudio
import unchanged (zip with `manifest.json`). Reasons: the UI must be Everloom's (mobile-first, the
design system), the reusable code would drag in wallet and React state, and Everloom already has
the hard parts: skeleton mapping, binding parts to one skeleton by bone name (wardrobe level 3),
hiding covered skin, optimization and KTX2. What we take from CharacterStudio is the format and the
culling-layer idea; no code is copied.

**The starter pack** is generated by Everloom's own code-made generator (bodies, hair, tops,
bottoms, shoes, hats exported as separate rigged GLBs in the CharacterStudio layout), so its license
is ours (CC0) and it doubles as a template for pack makers.

**One system with the wardrobe:** a pack is a body family; its clothing parts are garments of that
family. A parts-made character is stored as its body model plus garments (the chosen parts, worn by
default); the rest of the pack's clothing is in the family's garment library, so equipping an item
linked to a part swaps it on the stage (and rolls back with swipes). The merged GLB/VRM is made on
demand for download.

## Realistic characters: MPFB

- **Why MPFB:** the only maintained, scriptable generator of realistic, rigged, clothed humans with
  freely usable output. MakeHuman's system assets are CC0 and characters made with it are the
  owner's to use. MPFB itself is GPL-3.0, so it is never bundled: the owner installs it (one button,
  official download URLs, pinned hashes) and it runs only inside Blender on their server, like any
  other Blender add-on. Everloom talks to it only through the worker script's job file.
- **Where it lives:** its own Blender extensions folder under the data folder
  (`BLENDER_USER_EXTENSIONS` for MPFB jobs only), so the owner's Blender profile and their other
  add-ons (MMD Tools) are left alone. An MPFB the owner installed themselves also works.
- **Export fixes found by rendering:** the glTF exporter marks every material with a linked alpha as
  `BLEND`, which made skin show through clothes and textures look patchy. Skin, eyes and clothes are
  now opaque and hair cards are `MASK`. Shape keys are baked before the hide-under-clothes masks are
  applied (Blender can't apply modifiers to meshes with shape keys), which also means no face shapes
  for now.
- **Adults only:** the age slider is clamped to 18 years and over on the server.
- **Tested:** a gated server test (`EVERLOOM_BLENDER` and `EVERLOOM_MPFB_ZIPS`) installs from the
  real zips, makes a clothed character and imports it with every bone mapped; the installer's
  checksum refusal and zip-path checks run in every test run.
