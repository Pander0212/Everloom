# ECHO API

All under the signed-in owner. `:id` is a chat id.

| Method | Path | Purpose |
|---|---|---|
| GET/PATCH | `/api/echo/settings` | Global profile, narration, budget, tunneling, drift, depth, semantic |
| GET/PATCH | `/api/chats/:id/echo` | The chat's settings (override), counts, actors, violations, flagged checks |
| GET | `/api/chats/:id/echo/knowledge/:actor?at=&spoilers=` | Knowledge viewer; `at` = story moment; `all` needs `spoilers=1` |
| GET | `/api/chats/:id/echo/provenance?beliefId=` | Chain "claim → told → believes" and supports |
| GET | `/api/chats/:id/echo/undetermined?spoilers=` | Undecided slots, clues; values only with spoilers |
| POST/DELETE | `/api/chats/:id/echo/ops[/:opId]` | Author edits: `predecide`, `retract-belief`, `suppress`, `forget`, `drift` (optional `messageId`) |
| GET | `/api/chats/:id/echo/audit` | Audit history |
| POST | `/api/chats/:id/echo/events` | Author-written structured events |
| GET | `/api/chats/:id/echo/packets?messageId=` | Leakage debugger |
| POST | `/api/chats/:id/echo/recall` | `search_character_memory` tool: `{query, temporal_hint?, detail_level?, max_tokens?}`; actor bound server-side; 3 calls per turn |
| POST | `/api/chats/:id/echo/prefetch` | Warm the cache for a draft (returns timings only) |
| POST/DELETE | `/api/chats/:id/echo/migrate` | Migrate legacy memories / revert |
