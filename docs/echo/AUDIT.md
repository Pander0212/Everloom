# ECHO audit (phase 1)

What Everloom already had, where ECHO plugs in, what it reuses and what it replaces. Written
before any ECHO code, from reading the repository on 2026-11-01.

## Baseline

| Check | Result |
|---|---|
| `npm run typecheck` (engine, server, web) | clean |
| `npx vitest run` | 145 files passed, 1 skipped; **1270 tests passed, 8 skipped**, 0 failed (162 s) |
| Playwright e2e | not run here (1.5 h suite; ECHO touches no web screen in phase 1) |

## The pieces ECHO builds on

| System | Where | What matters for ECHO |
|---|---|---|
| Message tree | `messages` table (`chat_id`, `seq`, `swipe_id`, `swipes` JSON); branches are new chats (`parent_chat_id`, `branch_message_id`) | A chat is a linear list of messages, each with swipes and one active swipe. **The active leaf = for every message, its active swipe.** A rewind is a delete; a branch is a copied chat. |
| Op/transaction engine | `op_log` (anchored `message_id` + `swipe_id`), `services/campaigns.ts` (`appendOps`, `rebuildCampaign`, `deleteEntriesFor`), `engine/game/reducer.ts` | State is a fold over live ops; swipe/edit/delete re-fold. ECHO uses the same anchoring rule. |
| Memory v2 | `engine/memory/*` (knowledge scoping, hearsay, versioned facts, hybrid recall, summaries), `server/services/mem.ts` (tables `mem_items`, `mem_heard`, `mem_facts`, `mem_summaries`, `mem_vectors`, `mem_fts`) | Rows are **live only while their message exists with the same swipe** (`liveSql`), so swipes need no rebuild. Witnesses vs participants, secrets, hearsay with distortion, an evidence firewall for facts, "Why recalled?" via `lastRecall`. |
| Write path | `services/tracker.ts` → `writeTurnWorld` → `writeTurnMemory` (one utility-model call per reply returns ops + `memories` + `facts`) | ECHO's extraction rides on this **same call** (an extra `events` key) — no new model call per turn. |
| Read path | `services/prompt.ts` › `buildPrompt` → `recallForScene` → `buildSceneBlock` (game on) or a `[Story so far]` memory block (game off) | ECHO's packet is injected here, in its own bounded section. |
| Lifecycle hooks | `chats.ts`: `deleteAnchored` on edit/regenerate, `memOnSwipeDeleted`, `memOnMessagesDeleted`, `forkMemory` on branch | ECHO adds its tables to the same hooks. |
| Feature switches | `engine/features.ts` (`FeatureSet.memory: full/summary/off`, presets classic/story/full), `effectiveWorld`, per-chat preset | ECHO gets a profile (off/light/fast/balanced/strict) mapped from the preset, overridable per chat. |
| Vault | `server/vault/vault.ts`: the whole content database is SQLCipher (`everloom.db`), media AES-GCM | **Every table in `everloom.db` is encrypted at rest, including FTS and vector tables.** New ECHO tables are covered automatically; nothing ECHO writes goes elsewhere. |
| Name shield | `server/privacy/shield.ts`: `safeFetch` → `shieldOutbound` is the single choke point for every outside request (LLM, embeddings, TTS, images) | ECHO's extraction (tracker call) and embeddings go through `completeChat` / `embed`, i.e. through the shield, with no extra work. |
| Providers | `server/llm/providers.ts` (`streamChat`, `completeChat`, `embed`), roles main/utility/embeddings | ECHO uses the utility role for extraction; streaming of the reply is untouched. |
| Lorebooks | `engine/lore/*`, `services/lorebooks.ts`, `checkWorldInfo` in `buildPrompt` | Entries can get a knowledge scope (`extensions.echo_scope`); default "common" changes nothing. |
| World state | `engine/game/state.ts` (`npcs[].locationId`, `currentLocationId`, `time.minutes`, `locations`) | Observers for each event are taken from here at commit (who is where), never from the model. |
| Benchmarks | `tests/memory-bench` (recall/leak/fact/stale over 320 turns) | Stays as the legacy baseline; ECHO gets its own synthetic benchmark (`tests/echo-bench`). |

## What ECHO reuses

- The anchoring rule (message + swipe, live while the message's active swipe matches) — as the
  definition of the active branch. ECHO stores an append-only event log anchored the same way and
  **replays only the live events**, so nothing from an abandoned swipe can survive in a derived
  record, a cache (keyed by the leaf) or an embedding (scored only for authorized ids).
- The tracker call (one call, extended), the provider abstraction, the shield, the vault.
- SQLite FTS5 for lexical scores, `embed()` for optional semantic scores.
- The lifecycle hooks (swipe delete, message delete, edit, regenerate, branch fork).
- The feature presets.

## What ECHO replaces (only when switched on for a chat)

| Today | With ECHO | Why |
|---|---|---|
| Memory = a line of text + witnesses list | Event with observers, cues per sense and salience, claims, canonical changes, outcome | "Present ≠ noticed", "saw the motion ≠ knows it was a letter", lies, attempts |
| Knowledge = witnessed / heard (distortion count) | Observations, beliefs with justification (JTMS), testimony records, rumor chains with provenance, higher-order beliefs, hypotheses, group knowledge | Characters can believe lies, suspect, and revise; exposed lies retract what rests on them |
| Facts = versioned slots with conflicts | Bitemporal facts (valid-from/to, story and world time) + undetermined slots with constraints (lazy canon) | Historical queries; mysteries that stay solvable |
| Recall = one weighted sum | Multi-path retrieval fused by RRF with agreement bonus, attribute interference, forgetting curve, involuntary recall | Relevant-but-old beats recent-but-unrelated; zero recall when nothing fits |
| Scene block people section | Per-perspective context packet with epistemic status and sources | Separate builders: NPC, persona narrator, omniscient, adjudicator |

The legacy memory keeps running underneath (and alone when ECHO is off). Nothing legacy is deleted;
migration converts `mem_items` into migration events marked `unresolved` where witnesses are
unknown, and is reversible (drop the migration events).

## Risks found

- Branches are copied chats; ECHO must fork its log with message ids remapped (like `forkMemory`).
- Message `seq` is per chat and monotonic; ECHO event `seq` = message seq + index/100, so replay
  order follows story order even when a swipe adds events later in wall-clock time.
- Default feature preset is Full RPG; turning ECHO on by default would change every existing test's
  prompts. Decision: ECHO is **off unless a chat or the global setting turns it on** (see
  `DECISIONS.md`); presets only suggest the profile.
