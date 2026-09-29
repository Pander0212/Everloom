# World Engine — The Complete Guide

**What this document is.** A full explanation of World Engine: the idea, every
system, the data model, the turn lifecycle, the AI calls, the rules that keep it
correct, and a concrete plan for lifting the engine out of SillyTavern into a
standalone app. It is written to be handed to an AI (or a developer) who has the
source code but no history with the project.

Version described: **3.61.1**. Source: `src/` (≈50 ES modules, no build step, no
runtime dependencies), `index.js` (SillyTavern wiring), `tests/` (68 headless
suites, plain `node`).

> If you only read one section, read **§2 (the core idea)** and **§12 (porting)**.
> If something in the code disagrees with this guide, the code wins — and the
> tests (`tests/*.mjs`) are the executable specification.

---

## Table of contents

1. [The problem it solves](#1-the-problem-it-solves)
2. [The core idea](#2-the-core-idea)
3. [Architecture at a glance](#3-architecture-at-a-glance)
4. [The data model](#4-the-data-model)
5. [One turn, end to end](#5-one-turn-end-to-end)
6. [Rewinding: swipes, edits, deletions](#6-rewinding-swipes-edits-deletions)
7. [The scene block — what the narrator is told](#7-the-scene-block--what-the-narrator-is-told)
8. [Every system, in detail](#8-every-system-in-detail)
9. [The AI layer](#9-the-ai-layer)
10. [User interface](#10-user-interface)
11. [Configuration reference](#11-configuration-reference)
12. [Porting to a standalone app](#12-porting-to-a-standalone-app)
13. [Invariants and hard-won rules](#13-invariants-and-hard-won-rules)
14. [The narrator contract (presets)](#14-the-narrator-contract-presets)
15. [Glossary](#15-glossary)

---

## 1. The problem it solves

An LLM role-play has no world. It has a chat log, a character card, and (in
SillyTavern) a lorebook that injects entries by **keyword**. That causes the
classic failures:

- **Teleporting cast.** A passing mention of a character drags their lorebook
  entry into context, and they show up in a scene they are nowhere near.
- **Omniscient NPCs.** Every character "knows" everything in the chat log,
  including things said in rooms they were never in.
- **No off-screen life.** Nothing happens unless the player is watching.
- **Amnesia at length.** Once the chat outgrows the context window, the early
  story is simply gone.
- **Drift.** Time, locations, relationships and injuries are re-improvised every
  message, so they contradict themselves.

World Engine inverts the arrangement: **a world model decides what the narrator
may see.** The narrator (any LLM) writes prose; the engine keeps the state.

## 2. The core idea

### 2.1 A spatial world model

The world is a **containment tree** of nodes: locations inside locations
(`World › Kingdom › Island › Academy › Great Atrium`), and characters, objects and
factions *parented* to a location. "Who is in the scene" is simply "whose
`parent` is the player's location". Locations also carry `exits` (walkable
edges). Movement is validated against that map.

Only what is in the current scene is shown to the narrator, every turn, as one
block of text (§7). A character across the map is not in the block and so cannot
appear — no keyword can drag them in.

### 2.2 Everything is a transaction bound to a message

State is never edited in place. Every change is a **transaction**: a list of
validated mutations, recorded with its `before` and `after` values and — this is
the crucial part — **bound to the chat message that caused it** (message index,
swipe id, content hash).

The live world is always:

```
world = fold(genesis, all non-reverted transactions, in order)
```

So when the player **swipes, edits or deletes** a message, the engine reverts
exactly the transactions that message caused, and the world rewinds with the
story. A character who died in a swiped-away reply is alive again; a place
created by it no longer exists; a memory of it is forgotten. This single property
is what the entire design rests on — every feature must preserve it (§6).

### 2.3 Knowledge is scoped by witnessing

Things that happen are **events** with `witnesses[]`. A character knows an event
only if they witnessed it, or heard about it (hearsay, possibly distorted).
The narrator is told per character what they know, what they have only heard,
and explicitly what they **do not know** — so NPCs stop reading the chat log.

### 2.4 Deterministic core, AI at the edges

Scene resolution, injection, memory selection, dice odds, weather, schedules and
goal pursuit are **pure code with zero AI dependency**. AI is used for reading
narration ("did the player move? who is here? what happened?") and writing short
prose (off-screen social beats, summaries). Every AI feature degrades to
"unavailable" with a logged error; the world keeps working without it.

The guiding rule: **selection is deterministic; only prose is written by a
model.** The engine decides *who* interacts off-screen; the model only writes
*what happened between them*.

---

## 3. Architecture at a glance

### 3.1 Layers (dependency direction points down)

```
 UI (src/ui/*)            panel tabs, cast strip, roll chip, slash commands
   │
 Host wiring (index.js)   SillyTavern events → pipeline; pre-generation hook
   │
 Pipeline (turn.js)       what the world does after each reply
   │
 Systems                  movement, capture, presence, clock, schedule, goals,
                          agent, society, hearsay, relations, vitals, sheet,
                          worldfacts, threads, weather, appearance, deadlines,
                          chronicle, consolidate, briefing, dossier, inquiry …
   │
 Scene (scene.js)         PURE: world → the text block the narrator reads
   │
 Knowledge / recall       events, knows[], heard{}, relevance scoring
   │
 Store (store.js)         THE single write surface: validate → apply → record
   │
 Schema (schema.js)       shapes, validators, mutation-path whitelist
   │
 Persist (persist.js)     where bytes live (ST chat metadata / settings)
 API (api.js)             the ONLY network module
```

### 3.2 Module map

| Module | Role |
| --- | --- |
| `persist.js` | Storage locations + `DEFAULT_CONFIG` (every setting). The only module that knows where bytes live. |
| `schema.js` | Node/event/goal/sheet/deadline/fact/thread validators; the whitelist of mutable paths; v1→v2 migration. |
| `store.js` | The single write surface: `applyTransaction`, fold/refold, compaction of the log, event pruning, the per-chat "blob". |
| `tx.js` | Rollback: message binding, content hashes, swipe/edit/delete reconciliation, `turnNumber`. |
| `turn.js` | The post-reply pipeline (§5). |
| `index.js` | Host wiring: events, the pre-generation read, the backstop movement, init. |
| `narration.js` | PURE `narrationOnly()`: strips reasoning blocks and tracker panels from a reply so only story text is read. |
| `scene.js` / `scene-live.js` | PURE block builder / its impure shell (config, tokenizer, cache). |
| `inject.js` | Puts the block into the prompt (ST `setExtensionPrompt`). |
| `window.js` | The rolling context window: trims the chat history of ONE request. |
| `wi.js` | Suppresses lorebook entries that are linked to world nodes. |
| `resolver.js` / `resolve-live.js` | Name → node: normalise, alias index, exact/fuzzy, text scanning; queue + AI fallback. |
| `movement.js` | Validated moves + THE orchestrator read (both passes). |
| `intent.js` | PURE: reads "I go to (our) X" and "who comes along" from the player's own words. |
| `travel.js` | `nextHop`: one hop per turn along the real map. |
| `presence.js` | Narration ↔ world sync: arrivals, departures, who the turn is about. |
| `capture.js` | Live capture of new named people/places/objects from text; place creation and placement. |
| `clock.js` | World time; anchored to clock times the narration states. |
| `schedule.js` / `goals.js` | NPC timetables; goal lifecycle + pursuit. Zero AI. |
| `agent.js` | Background agency: where off-screen characters go; things that happen to one of them. |
| `society.js` | The social sim: what off-screen characters do to each other. |
| `hearsay.js` | News spreads between co-located characters, with distortion. |
| `relations.js` | Bonds (liking + trust/desire/tension), earned slowly. |
| `knowledge.js` / `recall.js` | Events, `knows[]`, the memory cap; relevance scoring for the scene. |
| `consolidate.js` / `chronicle.js` | Memory fusion; batch reading of the chat for memories and proposed facts. |
| `briefing.js` / `dossier.js` / `inquiry.js` | Optional model-written context: scene briefing, per-character dossier, a research agent. |
| `worldfacts.js` | What is true in the wider world (facts, developments), firewalled against the turn's text. |
| `threads.js` | Off-screen storylines on heartbeat rolls; the pulse (random events). |
| `weather.js` / `appearance.js` | Derived weather; outfits. |
| `deadlines.js` | What has not happened yet (appointments, exams), shown until due. |
| `sheet.js` / `sheetgen.js` / `gamevalue.js` / `vitals.js` | The game layer: character sheets, dice, arithmetic, deaths/knockouts/healing. |
| `health.js` | PURE diagnostics of a world + deterministic repairs. |
| `merge.js` / `delete.js` / `creator.js` / `link.js` | Editing: fold duplicate places, delete with full reference cleanup, create by hand, passages. |
| `goalgen.js` / `author.js` | Owner-pressed generation of goals, routines, descriptions. |
| `extract.js` / `exporter.js` | Bootstrap import from a lorebook/card; export, debug bundle, import from JSON. |
| `api.js` | OpenAI-compatible calls: roles, two concurrency lanes, retries, timeouts, JSON validation, call log. |
| `ui/*` | Panel and views, cast strip, roll chip. |

---

## 4. The data model

### 4.1 Storage: the per-chat blob

Per chat, one object (in ST: `chatMetadata.worldEngine`):

```js
{
  genesis,          // the world snapshot the log starts from (self-contained)
  transactions: [], // the ordered log (see 4.3)
  unresolved: [],   // names the resolver could not place yet
  chronicle,        // the chat reader's watermark + its run history
  clockMarks,       // {messageIndex: worldTime} — survives log compaction
  rolls: [],        // dice results, keyed by player message + text hash
  briefing, dossiers, inquiry   // cached model-written context
}
```

Global settings live separately (ST: `extensionSettings.worldEngine`), see §11.

### 4.2 The world (the folded state)

```js
{
  schemaVersion: 2,
  meta: { worldName, createdAt },
  time: 0,                          // world minutes since Day 1 00:00 + worldStartMinutes
  player: { nodeId: 'npc_player', location: 'loc_x' },
  nodes: { [id]: Node },
  events: { [id]: Event },
  visited: [locationIds],
  deadlines?: { [id]: Deadline },
  facts?: { [id]: Fact },
  threads?: { [id]: Thread },
  pulse?: { surprise?: playerMsgIndex, encounter?: playerMsgIndex },
  forgotten?: [normalizedNames]     // deleted names capture must not re-create
}
```

**Node** (types: `location`, `npc`, `object`, `faction`):

```js
{
  id, type, name, aliases: [], parent,         // parent = containing node id (or null)
  text, shortText,                              // description (injected), one-liner
  flags: { status: 'alive'|'dead'|'missing', present, lastRef, locked,
           unconscious, outfit, outfitAt, weather, weatherUntil, portrait, … }, // JSON scalars only
  sovereign: false,                             // a companion the narrator may not voice
  characterCard, lorebookUid, createdBy: 'authored'|'captured',
  knows: [eventIds],                            // memory cache (bounded)
  // locations only:
  children: [locationIds], exits: [locationIds],
  // npcs only:
  goals: [Goal], schedule?: [{start: minuteOfDay, location}],
  relationships?: { [otherId]: { affinity: -100..100, kind, note?, earnedAt?,
                                 trust?: -100..100, desire?: 0..100, tension?: 0..100 } },
  heard?: { [eventId]: distortion >= 1 },
  sheet?: { resources:[{name,value,max?}], attributes:[{name,value}],
            items:[{name,qty,note?}], statuses:[{name,note?}] }
}
```

Hard structural rules: `children`/`exits` contain **only locations**; an NPC's
containment is its `parent` alone. Relationship `kind` is one of `stranger,
acquaintance, friend, close, rival, enemy, crush, partner, family, mentor,
student`.

**Event** (something that happened):

```js
{ id, type: 'interaction'|'movement'|'state_change'|'authored',
  summary, location, participants: [ids], witnesses: [ids],
  time, secret: bool, distortion: int, milestone?: bool, importance?: 1|2|3 }
```

`participants` (who it is ABOUT) is not `witnesses` (who SAW it). Only witnesses
know it first-hand.

**Goal**: `{ id, summary, state: dormant|blocked|acting|resolved|failed,
visibility, needs:[], urgency 1-5, deadline?, activateAt?, target?: locationId,
createdBy }`.

**Deadline**: `{ id, what, due (world minutes), setAt, who:[ids], done? }`.
**Fact**: `{ id, kind: fact|development, text, trend?, status: active|resolved,
since, updated, note? }` — text only, no node ids.
**Thread**: `{ id, text, stages:[rumour, visible, unmistakable, head], max,
rung, bias -2..2, pace, lastBeat, status: active|head|done, where?: placeName }`.

### 4.3 Transactions

```js
{ txId, timestamp,
  origin: 'message'|'capture'|'system'|'manual',
  messageIndex, swipeId, mesHash,   // the binding (null for manual edits)
  cause: 'human-readable why',
  reverted: false, locked?: bool,
  mutations: [{ nodeId, path, before, after }] }
```

`nodeId` is `'__world__'` for world-level paths. Mutable paths are whitelisted
(`schema.js`): node fields (`parent`, `children`, `exits`, `text`, `knows`,
`goals`, `schedule`, `relationships`, `heard`, `sheet`, `flags.<key>`, …) and
world paths (`events.<id>`, `nodes.<id>` create/delete, `deadlines.<id>`,
`facts.<id>`, `threads.<id>`, `pulse`, `forgotten`, `worldTime`, `visited`,
`playerLocation`).

`applyTransaction` clones the world once, validates and applies each mutation in
order against the clone (so later mutations can reference things earlier ones
created), records `before` values from the in-transaction state, and only then
swaps the clone in — **all or nothing**. Any invalid mutation rejects the whole
transaction.

The log is compacted past `txLogCap` (oldest quarter folded into a new genesis).
That is why anything that must outlive compaction (clock readings) lives outside
the log.

---

## 5. One turn, end to end

### 5.1 Before the reply is generated (awaited, 10-second ceiling)

1. **The pre-generation read** (one model call, `movement.js`) reads the player's
   message and returns: a move to an adjacent exit; or `travel_to` an existing
   place anywhere; or `new_place` (created and walked to); who goes along
   (`with`); elapsed time; and — when the player has a sheet and the action is
   risky — a **dice roll** proposal (§8.13). It sees the known locations *with
   their aliases*, the scene members, and the sheets of the people present.
2. **Backstop** (`intent.js`): if the read gave no destination, failed, or hit the
   ceiling, the player's own sentence is parsed ("I go to our dormitories") and
   resolved against the map (by name, alias, or head noun), refusing to guess.
3. **Companions from the player's words**: "let's", "we", "our", naming someone
   present, or the one other person in the room — computed *before* the move.
4. **The scene is computed and injected**, so the reply is narrated with the
   destination's contents, the roll's decided outcome, and this turn's rolled
   events (§8.16).

### 5.2 After the reply (the pipeline in `turn.js`, in order)

1. `narrationOnly` — strip reasoning and tracker panels; only story text is read.
2. Greeting guard — the chat's opening message gets one turn, ever, and no
   background life.
3. `trackReferences` / `retryUnresolved` — deterministic name tracking (`lastRef`).
4. `runCapture` — new named people/places/objects from the player's message and
   the reply (one call, only when unknown proper nouns appear).
5. **THE post-reply read** (one call) — movement, elapsed time, stated clock
   time, day rollover, where the scene is actually set, who is present, who left,
   what notably happened (`scene_event`, milestone, private), bond changes
   (liking/trust/desire/tension), deadlines, sheet changes, deaths/knockouts/
   wakes, world changes, outfits, weather. **New per-turn signals are added here,
   never as another call.**
6. Scene re-sync — if the narration is set elsewhere, move the player there (and
   the people this turn is about come along). Runs **before** presence.
7. `reconcilePresence` / `reconcileDepartures` — pull in who the narration shows
   here (model list + deterministic "acting in text" backstop), send off who left.
8. Scene memory — `scene_event` becomes an event witnessed by everyone present
   (or only the confidants, for a whisper).
9. Deadlines, bonds, sheet changes, world facts.
10. `tickClock` → vitals (deaths, knockouts) → recovery (healing over time) →
    outfits → weather.
11. `runSchedules` → `runGoals` (lifecycle, then one hop of pursuit).
12. `runThreads` — off-screen storylines take their heartbeats; the pulse is recorded.
13. Background life (not on the greeting): `runAgents` → `runSociety` →
    `runHearsay`.
14. `runChronicle` (gated on its own bookmark) → `runConsolidation` (every N turns).
15. **Fired, not awaited** (their results are for the next turn): briefing,
    dossier, inquiry, thread seeding, sheets for newcomers.

Why "fired": without streaming, SillyTavern awaits the post-reply event *before
rendering the reply*, so every awaited millisecond delays the player. Anything
whose result the current turn does not need must not block.

### 5.3 Streaming and expiry

With streaming, the reply is on screen and the player can swipe or send while the
pipeline is still awaiting a model. So the pipeline captures the message's swipe
id at the start and checks `isExpired()` after **every await**; if the message was
swiped, the turn is abandoned. Every writer that awaits a model takes `isExpired`
and re-checks it before writing.

### 5.4 Model calls per turn (typical)

| Call | When | Role |
| --- | --- | --- |
| pre-generation read | every player message | orchestrator |
| capture | only when unknown proper nouns appear | importer |
| post-reply read | every reply | orchestrator |
| background agency | every `agentEveryNTurns` (default 1) | orchestrator |
| social sim | every `societyEveryNTurns` (default 2) | society |
| consolidation | every `consolidateEveryNTurns` (default 3) | importer (else orchestrator) |
| chronicle | every `chronicleEveryNMessages` unread messages (20) | importer (else orchestrator) |
| thread seeding | when < `threadsMin` threads, at most every 25 turns | importer (else orchestrator) |
| briefing / dossier / inquiry | off by default | briefer / inquirer (else orchestrator) |

Two calls sit on the critical path (the pre- and post-reads); the rest run in a
separate background lane.

---

## 6. Rewinding: swipes, edits, deletions

Identity of a message = **index + swipe id + FNV-1a hash of its text** (chat
messages have no stable UUID). Every message-bound transaction stores all three.

- **Swipe**: transactions of the departed swipe are reverted; those of the
  arrived swipe are re-applied if its text still hashes the same. Idempotent.
- **Edit**: transactions bound to the old text are reverted and **locked** (never
  auto-reapplied).
- **Delete** (the host only reports the new chat length): a full reconciliation —
  find the earliest message whose binding no longer matches, revert everything
  from there on.
- **Continue** (reply extended in place): the earlier turn is taken back, then the
  whole message is processed as one turn.
- **Greeting**: processed once (detected from the log, so a rewind resets it).

Deterministic randomness is keyed so a swipe **replays** instead of re-rolling:
dice results are recorded against the player's message; thread heartbeats are
seeded by thread id + turn number; the pulse by world + player-message index.

`test-soak.mjs` proves the property: 30 turns with 10 swipe cycles fold back to a
byte-identical world.

---

## 7. The scene block — what the narrator is told

Built by the pure `scene.js` from the world, fitted to a token budget
(`tokenCap`), and injected into the prompt every turn (default: in-chat, depth 4).
A real example from a user's world (long character entries trimmed):

```
[WORLD ENGINE — SCENE STATE. This block is authoritative: only the entities listed
below exist in the current scene. Refer to listed places and characters ONLY by
their listed names — do not rename or invent variants. Movement is possible ONLY
to places listed under EXITS.]

## NOW
Monday, Day 1 · 10:05
WEATHER (outside): overcast, mild — spring

## LOCATION
Imported World › Eredane › Vaelmere › Lake Seren › Isle of Candlewright › Aurelion Academy › Great Atrium
(Aurelion Academy: The only great school of magic in Vaelmere, on the Isle of Candlewright)
…
The Great Atrium is the heart of the Academy inside the main keep: a vast domed hall …

## PRESENT
- Tilda Ravensworth (Tilda): A girl in a threadbare coat whose touch on the Kindling
  Stone barely glimmers a dull, dead grey. …
  WANTS: Find belonging at the back of the hall among the grey-ranked students
- Pell Aldous (Pell): A nervous boy who … was ranked 'Umber'.
  KNOWS (was there): During the First-Year Sorting in the Great Atrium, Pell Aldous
  was read as Umber, …
  DOES NOT KNOW: …

## PARTY
[Sovereign party members: the narrator MAY describe world events affecting them …
but MUST NEVER write their dialogue, thoughts, decisions, or voluntary actions.]
- Cassian Aurelle-Dray: Sovereign golden Court President, true believer in the order
  WEARING: a charcoal academy coat over a loosened collar

## THE WORLD RIGHT NOW (private continuity for you, the narrator — NOT automatically
known to the player or anyone present; news needs a plausible way to reach them)
- [developing] Harrow agents are seen watching the Cinderhouse every night.

## SOMETHING HAPPENS (the engine rolled it for this turn — weave it in; never
announce that it was rolled)
- AN ENCOUNTER: something or someone arrives or is noticed that offers a hook …

## EXITS
Refectory, Aetherium, Crucible, Cinderhouse, Sunspire Hall, Embassy Wing, …
```

**All sections**, in order: `NOW` (+ `WEATHER`), `THE DICE (this turn)`, `YOU`
(the player's own description, `SHEET`, `WARNING`, `WEARING`), `LOCATION` (+
`LOCKED`), `LOOKED UP FOR THIS SCENE`, `WHAT MATTERS NOW` or `STORY SO FAR`,
`PRESENT`, `PARTY`, `COMING UP`, `THE WORLD RIGHT NOW`, `SOMETHING HAPPENS`,
`EXITS`.

**Per-character lines** under PRESENT: description, `SHEET`, `WARNING`
(badly hurt, near death, UNCONSCIOUS…), `WEARING` / `LAST SEEN WEARING`, a dossier
paragraph (when enabled), `WANTS`, bond phrases ("counts you a friend — does not
trust you"), `RECENTLY`, `KNOWS (was there)`, `HEARD SECONDHAND` / `HEARD AS
RUMOUR (may be garbled)`, `DOES NOT KNOW`.

**Budget and drop order.** When over `tokenCap`, items are dropped in priority
order: DOES-NOT-KNOW lines → objects → background characters (least recently
referenced first) → THE WORLD RIGHT NOW → ancestor breadcrumbs → the recap.
**Never dropped:** the current location, referenced characters, PARTY, EXITS, the
dice, SOMETHING HAPPENS.

**Sovereignty.** A sovereign companion's full description never appears in the
block — only a one-liner — so the narrator cannot puppet them.

**Byte-exactness.** The injected string is identical to what the Preview tab
shows; there is one code path.

---

## 8. Every system, in detail

### 8.1 Movement (`movement.js`, `travel.js`, `intent.js`)
- The player moves only along `exits`/children, unless the move is one the player
  declared themselves (`travel_to`, `new_place`), which is forced and logged.
- Confidence below `moveConfidence` asks instead of moving.
- `nextHop` walks NPCs one hop per turn along the real map, so journeys take time
  and people can be met in transit; locked places are walls to background movers.
- The deterministic backstop reads the player's sentence for a destination when
  the model gives none (never a question, a conditional, "go to sleep", or an
  ambiguous name).

### 8.2 Capture (`capture.js`)
- Reads the player's message **and** the reply for proper nouns the world does not
  know; asks one model call to classify them (npc/location/object/faction, aliases,
  description, placement).
- Placement: a person **in the scene** is placed here, whatever their home; a
  person only mentioned goes where the text puts them, or to the top of the world
  — never silently into the player's room. Places are filed under the parent the
  model chooses from the real tree, or beside the room being left.
- Dedupe: `knownAs()` answers "does this exist?" (ambiguity counts as yes, so no
  duplicates are minted); sibling-scoped dedupe folds "the dormitory" into
  "Dormitories"; possessives are stripped ("Our Dormitories" → "Dormitories").
- Deleted names (`world.forgotten`) are never re-captured until created by hand.
- Capped per message (`capturePerMessage`).

### 8.3 Presence (`presence.js`)
- Pulls characters the narration shows **acting here** into the scene: the model's
  list plus a deterministic check (name followed by an acting verb, present or past
  tense; cutaways to other places ignored).
- Sends characters the narration shows **leaving** to where they went (creating
  the place if needed, in the same transaction).
- `engagedMembers`: the people this turn is about come along when the story moves
  the player (not on "goodbye/without/alone").

### 8.4 Clock (`clock.js`)
World time in minutes. Advances by the read's `elapsed_minutes` (clamped by
`maxTimeJump`), anchors to a clock time the narration states (within
`clockDriftWindow`), handles day rollover (sleep), weekdays (`worldStartWeekday`).
`clockMarks` record the time at each message outside the log, so memories read
from old chat can be stamped with the time they happened.

### 8.5 Schedules and goals (`schedule.js`, `goals.js`) — zero AI
- Timetables move NPCs to where their day says, never out of the player's scene.
- Goals have a lifecycle (dormant → acting → resolved/failed, blocked by needs,
  activation times, deadlines) and **pursuit**: an acting goal with a target walks
  its owner one hop per turn, deferring while the story is using them.

### 8.6 Background agency (`agent.js`)
For off-screen characters (never those with the player): one model call chooses
one action each — `pursue` (go somewhere, e.g. to find someone), `discover` (find
a new place), `want` (form a new goal), `happen` (something happens to them alone:
find, buy, lose, get hurt, get a letter; private unless public), or `idle`.
Movement is then carried out deterministically, hop by hop.

### 8.7 The social sim (`society.js`)
- `pairPressure` scores every co-located off-screen pair: mutual and one-sided
  feeling, desire and tension, goals naming the other, knowledge one has that the
  other lacks, shared third parties, closeness to the player — scaled by a
  cooldown so quiet corners get turns.
- The top clusters get **one beat each**, written by the model: talk, gossip,
  conflict, fight, kindness, flirtation, romance, intimacy, breakup, trade,
  discovery, scheme. The beat becomes an event witnessed by the room (or only the
  couple, for private kinds), bonds move, sheets change (a fight hurts), couples can
  leave together.
- Adults only, enforced in code: an intimacy beat involving anyone whose own
  description states an age under 18 is refused whole.

### 8.8 Hearsay (`hearsay.js`)
Co-located characters pass on what they know. Each retelling adds distortion; past
`maxDistortion` a rumour dies. Secrets are never passed on. Rendered as
`HEARD SECONDHAND` / `HEARD AS RUMOUR (may be garbled)`.

### 8.9 Relationships (`relations.js`)
Directional bonds `A → B`: `affinity` (liking, −100..100) plus optional `trust`,
`desire`, `tension`. Every interaction moves them by at most ±8. Labels follow the
number unless explicit, and explicit labels must be **earned**: `partner` needs
affinity ≥ 40; a `crush` dies when the feeling curdles; `family` needs nothing. No
label is exclusive. Rendered only when meaningful ("barely knows you, but is drawn
to you").

### 8.10 Memory (`knowledge.js`, `recall.js`, `consolidate.js`, `chronicle.js`)
- Three writers: the per-turn `scene_event`; the **chronicler**, which reads the
  chat itself in batches behind a watermark (never re-reading, never advancing on
  failure) and writes memories stamped with the time they happened; and
  **consolidation**, which fuses a finished scene's beats into one memory.
- Memory is **graded** (`importance` 1–3; 3 = milestone). Durable memories survive
  the per-character cap and appear in the recap regardless of age.
- **Recall** scores memories against the current scene — who is present
  (coverage × intimacy, not headcount), where, grade, recency, names in the text —
  with one guaranteed memory per person in the room. Its pool is every event the
  player witnessed, not the capped cache.
- `STORY SO FAR` is the player's memory; each other character's knowledge is
  rendered under their own name.
- The chronicler also **proposes facts** (standing truths: an ability, a rank, a
  lasting injury) for the owner to approve onto a character's description. Each
  fact cites the message it came from; unverifiable ones are marked.
- Bounded: `memoryPerNpc`, `eventCap`; an event is pruned only when nobody
  remembers it, nobody has heard it, and no surviving transaction references it.

### 8.11 Deadlines (`deadlines.js`)
Commitments with a time ("the exam in four days") are extracted by the post-read,
shown under `COMING UP` with the distance computed by code, and disappear by
themselves once due.

### 8.12 The wider world (`worldfacts.js`)
Facts and developments (with a trend: emerging, rising, stable, falling,
uncertain), created/updated/resolved by the post-read. **Firewall:** a new record,
new wording or a resolution must share evidence words with this turn's text, or it
is refused. Near-duplicates update the existing record. Shown as private
continuity.

### 8.13 The game layer (`sheet.js`, `sheetgen.js`, `gamevalue.js`, `vitals.js`)
- **Sheets**: resources (Health 12/30), attributes, items, statuses. Changes are
  reported by the post-read as deltas ("-2d6") and **computed by code**; dice are
  real randomness. Sheets for characters without one are written on the world's
  own scale (import, health check, inspector, or automatically for newcomers).
- **Dice**: for a risky player action, the pre-read rates the player's skill
  (`actor`) and what opposes it (`against`) on one 0–10 scale plus an `edge`
  (±2). Code turns the gap into odds with a logistic curve (even 50%, +2 76%,
  +4 91%), wounds from the sheet cost −1/−2, and four mirror-symmetric tiers
  (critical failure, failure, success, critical success) are rolled. The narrator
  is told the decided outcome under `THE DICE`, and a swipe replays the same roll.
- **Vitals**: deaths and knockouts reported by the reads become real (the dead
  leave every scene, schedule and plan; the unconscious cannot act); Health 0
  collapses; time heals; the player is never killed by a report (near death
  instead). `WARNING` lines tell the narrator.

### 8.14 The moving world (`threads.js`)
Off-screen storylines seeded by a model (a rivalry heating up, an investigation
closing in) as **rung ladders**. Every `pace` turns a seeded heartbeat roll on the
dice curve moves them (+2/+1/0/−1). They surface through stages — rumour →
visible (an event at their place, so hearsay carries it) → unmistakable → **a
head** (one turn in `SOMETHING HAPPENS`), then done.

### 8.15 Weather and outfits (`weather.js`, `appearance.js`)
Weather is derived from world time, season and climate — seeded, gradual, no call
— and overridden for a few hours when the story states it. Outfits are reported by
the post-read when the narration shows them, shown for people in the scene, and
marked "may have changed" after 12 hours.

### 8.16 The pulse (random events)
A pity timer: each player message has a small chance of a **surprise** (colour) or
an **encounter** (a hook), growing with every quiet message and resetting when it
fires. The narrator is told under `SOMETHING HAPPENS`. No call.

### 8.17 Optional model-written context (off by default)
- **Briefing**: the recall selection composed into prose for the scene, written at
  the end of a turn for the next, cached per scene signature.
- **Dossier**: one standing summary per character from everything they know.
- **Inquiry**: a research agent that asks the world questions in a bounded JSON
  action loop, then reports under `LOOKED UP FOR THIS SCENE`.

### 8.18 The context window (`window.js`)
Trims the chat history of **one request** to a token budget (never below a floor
of recent messages; the opening message kept), dropping in chunks of 10 so the
prompt start stays cache-friendly. Nothing is deleted. The `STORY SO FAR` recap
covers what was cut. Off by default.

### 8.19 Import and export (`extract.js`, `exporter.js`)
Bootstrap a world from a lorebook and character card: chunked extraction →
consolidation → commit, or the whole source in one call for long-context models,
with an AI audit and auto-linking. Export the world, a debug bundle (config with
**API keys removed**, log, call log, last block), or import from JSON.

### 8.20 Editing and diagnostics
Create nodes by hand; delete with full reference cleanup (events, bonds, goals,
schedules, deadlines, the tree, visited — contents move up a level); merge two
places; passages (walkable edges the tree does not imply); lock places. The
**health check** lists what is wrong (unreachable places, split rooms, misfiled
places, unearned labels, empty player description, characters with nothing to
want, missing sheets…) with a button to fix each.

### 8.21 Lorebook suppression (`wi.js`, SillyTavern-specific)
Lorebook entries linked to a node are removed from SillyTavern's keyword scan, so
they reach the prompt only through the scene block.

---

## 9. The AI layer

- **Protocol**: OpenAI-compatible `POST {baseUrl}/chat/completions`, one system and
  one user message, JSON-only answers. Any provider with that endpoint works.
- **Roles** (each `{baseUrl, apiKey, model, temperature, maxTokens, timeout}`):
  `orchestrator` (the two reads, background agency), `importer` (capture, import,
  sheets, goal/routine writing), `resolver` (name fallback), `society`, `briefer`
  (briefing, dossiers), `inquirer`. Fallbacks, exactly as coded: `society`,
  `briefer` and chronicle/consolidation/threads fall back to the orchestrator
  when their own role is blank; `inquirer` falls back to `briefer`, then the
  orchestrator; **capture and the owner-pressed writers need `importer`** and are
  simply unavailable without it. A role counts as configured when it has a base
  URL and a model.
- **`callRoleJson`**: parses the JSON (tolerant of fences and prose around it),
  runs a `validate` function, retries transient failures (429/5xx/foreign aborts)
  with backoff — but **not its own timeouts**, which are deterministic. A reply
  cut off at `max_tokens` is reported as such.
- **Two concurrency lanes**: foreground (what a turn waits on) and background
  (fired work), so background work can never queue the next turn.
- **Call log** of every request (role, model, ms, tokens, purpose) for debugging.
- **Prompts** live next to the code that uses them (`movement.js` holds the two
  reads). They ask for small, grounded decisions with ids chosen from lists the
  engine provides — the model picks, the engine validates.

---

## 10. User interface

- **Panel tabs**: Scene, Preview (the exact injected block), World (tree +
  inspector + create/delete/edit, sheets, portraits), Map (SVG graph), Timeline
  (memories: correct, forget, pin), Chronicle (runs and proposed facts), Bonds,
  Aliases, Unresolved, Import, Transactions (revert any), Calls, Debug. Settings
  for every system.
- **Cast strip**: portrait cards of who is present under the newest reply; tap for
  a dossier (bonds, wants, memories, sheet, outfit).
- **Roll chip**: the dice result on the player's message (title, tier, chance,
  matchup, outcome).
- **Slash commands**: `/we-node`, `/we-flag`, `/we-scene`, `/we-preview`,
  `/we-move`, `/we-resolve`, `/we-rollback`, `/we-event`, `/we-knows`, `/we-merge`,
  `/we-lock`/`/we-unlock`, `/we-roll`, `/we-threads`, `/we-export`,
  `/we-rebuild-index`, `/we-api-test`.

---

## 11. Configuration reference

All settings are in `DEFAULT_CONFIG` (`src/persist.js`), with a comment each. The
main groups:

| Group | Keys |
| --- | --- |
| Scene & injection | `tokenCap`, `injectionPosition`, `injectionDepth`, `unknownsPerNpc`, `relationsPerNpc`, `recentPerNpc`, `knowsPerNpc`, `hearsayPerNpc` |
| Movement & capture | `moveConfidence`, `fuzzyThreshold`, `captureEnabled`, `capturePerMessage`, `presenceEnabled`, `presencePerTurn`, `linkMaxSeparation` |
| Clock | `clockEnabled`, `minutesPerTurn`, `maxTimeJump`, `clockDriftWindow`, `worldStartMinutes`, `worldStartWeekday` |
| Off-screen life | `schedulesEnabled`, `goalsEnabled`, `agentEnabled`, `agentPerTurn`, `agentEveryNTurns`, `societyEnabled`, `societyEveryNTurns`, `societyScenesPerTick`, `hearsayEnabled`, `hearsayPerTurn`, `maxDistortion` |
| Memory | `sceneMemoryEnabled`, `memoryPerNpc`, `eventCap`, `recapEvents`, `consolidate*`, `chronicle*`, `dayGistMinEvents`, `recapMilestonesPerDay` |
| Context window | `historyWindowEnabled`, `historyTokenBudget`, `historyMinMessages`, `historyKeepFirst`, `historyDropChunk` |
| Optional context | `briefing*`, `dossier*`, `inquiry*` |
| World | `deadlines*`, `worldFacts*`, `threads*`, `eventsEnabled`, `surprise*`, `encounter*`, `weather*`, `worldStartSeason`, `seasonLengthDays`, `appearanceEnabled` |
| Game layer | `gameEnabled`, `diceEnabled`, `sheetAutoNew`, `vitalsEnabled`, `healthPerDay`, `fastPerHour`, `wakeAfterMinutes` |
| Import | `importWholeSource`, `importWholeMaxTokens`, `importWholeTimeoutMs` |
| System | `txLogCap`, `apiConcurrency`, `apiTimeoutMs`, `apiRetries`, `roles` |

Two traps when you add settings: a changed default does not reach users who
already saved settings (migrate once, with a marker); and nested objects (`roles`)
must be deep-merged.

---

## 12. Porting to a standalone app

The engine is ~90% host-independent. SillyTavern is touched through a small,
enumerable surface. Port by writing **one host adapter** that provides that
surface, and keep everything else as-is.

### 12.1 Every SillyTavern touch point

| ST dependency | Used for | Where | Standalone replacement |
| --- | --- | --- | --- |
| `SillyTavern.getContext()` | the one accessor | `persist.js ctx()` | return your adapter object |
| `ctx().chat` | messages: `{mes, is_user, is_system, name, swipe_id, swipes[], extra}` | tx, turn, window, chronicle, UI | your message store, same shape (or map to it) |
| `ctx().chatMetadata` + `saveMetadata(Debounced)` | the per-chat blob | `persist.js` | per-conversation JSON storage (DB row / file) |
| `ctx().extensionSettings` + `saveSettingsDebounced` | global config | `persist.js` | app settings storage |
| `ctx().setExtensionPrompt(key, text, position, depth)` | inject the block | `inject.js` | insert the block into YOUR prompt assembly at depth N |
| `manifest.generate_interceptor` → `globalThis.worldEngineIntercept(coreChat, …)` | trim history for one request | `window.js` | call `trimHistory(messages)` in your prompt builder |
| `ctx().getTokenCountAsync` | budget the block | `scene-live.js` | any tokenizer (or the built-in length/4 estimate) |
| `eventSource.on(GENERATION_AFTER_COMMANDS)` | pre-generation read + inject | `index.js` | call before building the prompt, awaited |
| `eventSource.on(MESSAGE_RECEIVED, idx, type)` | the post-reply pipeline | `index.js` → `runMessageTurn(idx, text, {type})` | call after a reply is complete |
| `MESSAGE_SWIPED` / `MESSAGE_EDITED` / `MESSAGE_DELETED` | rollback | `tx.js` | call `onMessageSwiped(i)`, `onMessageEdited(i)`, `reconcile()` from your UI actions |
| `CHAT_CHANGED` | reload state | `index.js` | on opening a conversation: `reloadFromChat()` + `reconcile()` |
| `WORLDINFO_ENTRIES_LOADED`, `loadWorldInfo`, `getWorldInfoNames` | lorebook suppression / import | `wi.js`, `extract.js`, `view-import.js` | drop suppression (you control the prompt); feed import text directly |
| `SlashCommandParser` … | commands | `commands.js` | optional: expose the same callbacks in your UI |
| `globalThis.toastr`, `document`, `MutationObserver` | toasts, panel, chips | `ui/*` | rewrite the UI in your framework; views read the store |
| `globalThis.fetch` | model calls | `api.js` | works as-is (Node 18+/browser), or swap the transport |

### 12.2 The adapter shape

```js
// The object persist.ctx() must return. Keep method names; implement them on your app.
const host = {
  chat,                       // live array of messages in ST shape (see table)
  chatMetadata,               // per-conversation object; the engine uses .worldEngine
  saveMetadata: async () => {}, saveMetadataDebounced: () => {},
  extensionSettings,          // global object; the engine uses .worldEngine
  saveSettingsDebounced: () => {},
  setExtensionPrompt: (key, text, position, depth) => { /* remember it for your prompt builder */ },
  getTokenCountAsync: async (s) => countTokens(s),
  name1: 'PlayerName',        // the user's persona name
};
globalThis.SillyTavern = { getContext: () => host };  // the smallest possible shim
```

The shim above is exactly how the 68 test suites run the engine headlessly — they
are working examples of a standalone host (`tests/test-soak.mjs`,
`tests/test-intent.mjs`, `tests/test-keep-scene.mjs`).

### 12.3 The host loop

```js
// 1. Opening a conversation
store.reloadFromChat();  tx.reconcile('open');

// 2. The player sends a message
chat.push({ is_user: true, mes: text, name: player });
await preGeneration(chat.length - 1);        // port index.js GENERATION_AFTER_COMMANDS body:
                                             // proposeMove(pre) → roll → move/backstop → computeScene
const block = lastInjectedBlock();           // what setExtensionPrompt received
const history = trimHistory(chat.slice());   // optional context window
const reply = await narrator(buildPrompt({ system, character, history, block, depth: 4 }));

// 3. The reply is complete
chat.push({ is_user: false, mes: reply, swipe_id: 0, swipes: [reply] });
await runMessageTurn(chat.length - 1, reply, { type: 'normal' });

// 4. The player swipes / regenerates the reply
msg.swipes.push(newText); msg.swipe_id = msg.swipes.length - 1; msg.mes = newText;
tx.onMessageSwiped(i);                        // BEFORE generating the new swipe
// …generate… then runMessageTurn(i, newText, { type: 'swipe' })

// 5. Edit / delete
tx.onMessageEdited(i);   tx.reconcile('delete');
```

Order matters: rewind (swipe/edit) **before** recomputing the scene for the next
generation; compute the scene **after** any pre-generation move.

### 12.4 Step-by-step migration plan

1. Copy `src/` (minus `ui/`, `wi.js`, `commands.js`) into your app as an ES-module
   package. It has no npm dependencies.
2. Implement the adapter (§12.2) over your storage and message model. Keep the
   message shape, or write a mapping layer — `tx.js` needs `swipe_id`/`swipes` for
   identity.
3. Port `index.js`'s pre-generation handler and `MESSAGE_RECEIVED` handler into your
   send flow (§12.3). Keep the 10-second ceiling and the backstop.
4. Replace `setExtensionPrompt` with your prompt builder inserting the block at a
   fixed depth (the narrator contract, §14, goes in your system prompt).
5. Run the test suite against your adapter (`for t in tests/*.mjs; do node $t; done`)
   — it already uses a shim; it must stay green.
6. Rebuild the UI in your framework: the views only read the store
   (`getWorld()`, `getTransactions()`, `onStoreChange()`) and call engine functions.
7. Decide model roles: a fast/cheap model for the two reads is ideal; the narrator
   can be anything.
8. Keep streaming safety: if your UI lets the user swipe while `runMessageTurn` is
   running, the `isExpired` checks handle it — do not remove them.

### 12.5 What you can drop or simplify outside SillyTavern

- `wi.js` (lorebook suppression): you control the prompt; simply don't inject
  lorebook entries for world nodes.
- The generate interceptor: call `trimHistory` directly.
- `narration.js`'s tracker stripping can be narrowed to your narrator's output
  format (keep reasoning-block stripping).

---

## 13. Invariants and hard-won rules

Each of these cost a real defect. Keep them in the port.

1. **All writes go through `applyTransaction`** — validated, all-or-nothing.
2. **Everything a message causes is bound to it**; a swipe rewinds all of it. A new
   transaction origin must be added to `tx.js messageBound()`.
3. **Scene resolution and injection have zero AI dependency.**
4. Dead nodes never enter the scene. A sovereign's full text never appears.
5. `children`/`exits` hold only locations; NPC containment is `parent` alone.
6. **Deleting anything cleans every reference first** (events, `knows[]`,
   `heard{}`, bonds, goals, schedules, deadlines, the tree). `heard{}` is not a
   subset of `knows[]`.
7. **Genesis is a snapshot; the log is a timeline** — heal the snapshot, never the log.
8. **The context window never destroys anything** — it trims one request.
9. **Participants ≠ witnesses**; **"where they belong" ≠ "where they are"**;
   **"which one is it?" ≠ "does it exist?"** — the most productive bug shape in
   this project is two questions sharing one answer.
10. **Anything the turn does not need must be fired, not awaited** (latency).
11. **Every awaited writer re-checks `isExpired`** (streaming).
12. **Our own timeouts are not retried.**
13. **Deterministic randomness is keyed on something both passes agree on** (the
    player's message index), so swipes replay.
14. **"Every N turns" uses `turnNumber(idx)`**, never the raw index.
15. **Numbers**: `Number(null)` is 0; `??` doesn't catch NaN; `slice(-0)` is the whole
    array; `0` is sometimes a real setting.
16. **Mark, never filter**: de-emphasise by tagging a line, not removing it.
17. **Selection is deterministic; only prose is written by a model.**
18. **Tests must fail when the bug is reintroduced** — verify every new test by
    sabotage.

---

## 14. The narrator contract (presets)

The narrator must be told how to read the block. `presets/World Engine.json` holds
a lean, complete version: the block is ground truth and input only; move only via
EXITS; only PRESENT exists; PARTY is sovereign; obey DOES NOT KNOW; the dice
outcome is final; WARNINGs bind; weave in SOMETHING HAPPENS without announcing it;
THE WORLD RIGHT NOW is private; never re-narrate STORY SO FAR; never echo the
block. `tests/test-narration.mjs` checks that the preset names every section and
line type spelled exactly as the engine emits it — keep that check in a port.

The post-history instruction also asks the narrator to put any reasoning in one
`<think>` block (stripped before the engine reads the reply) and to write only
in-world prose (no status panels, which would otherwise be read as story).

---

## 15. Glossary

- **Blob** — the per-conversation storage object (genesis + log + caches).
- **Genesis** — the self-contained world snapshot the log starts from.
- **Fold** — applying all non-reverted transactions to genesis to get the world.
- **Binding** — `{messageIndex, swipeId, mesHash}` tying a transaction to a message.
- **Scene / scene pool** — the player's location and everything parented to it.
- **Block** — the text the narrator receives each turn (§7).
- **Pre-read / post-read** — the two orchestrator calls around a reply.
- **Sovereign** — a companion the narrator may describe but never voice.
- **Witness** — someone who saw an event; the only way to know it first-hand.
- **Hearsay** — secondhand knowledge, with distortion.
- **Durable memory** — importance ≥ 2; survives caps and appears in the recap.
- **Thread** — an off-screen storyline climbing a rung ladder.
- **Pulse** — the random-event pity timer.
- **Backstop** — deterministic code that covers for a model read that missed.
