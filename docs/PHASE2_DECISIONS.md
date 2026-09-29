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
| Hop-by-hop travel for NPCs | **Adopted** | NPC goals with a target move one hop per game hour along the map. |

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

MEMORY_DESIGN_PLACEHOLDER

---

## Part B — Character Library

PART_B_PLACEHOLDER

---

## Model calls per turn, by preset

CALLS_PLACEHOLDER
