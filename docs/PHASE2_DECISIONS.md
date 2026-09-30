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
