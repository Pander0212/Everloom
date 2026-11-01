# ECHO decisions

1. **Off unless chosen.** The default install is Full RPG; turning ECHO on everywhere would change
   every existing chat's prompt. Presets *suggest* a profile; the owner picks it per chat or globally.
   Existing chats keep working unchanged.
2. **Extend the tracker call instead of adding one.** The structured `events` key rides on the call
   that already reads every turn, only when ECHO is on. Chats without the game layer (no tracker)
   get one extraction call — the same cost Story mode already pays for its tracker.
3. **Replay over mutation.** The projection is a pure fold over live events. Swipes and deletes need
   no undo logic and cannot leak; incremental append (~0.05 ms/event) keeps it cheap; anything else
   rebuilds (≈ 0.3 s at 5,000 events on this container).
4. **Per-chat story id.** ECHO's scope is the chat (branches are chats with copied logs). Campaign-wide
   ECHO across chats is not built.
5. **Engine BM25 over the view, not FTS5.** FTS over a shared index would rank across actors before
   authorization. BM25 over the authorized view is authorization-first by construction and fast
   enough (recall p95 ≈ 41 ms at 10,000 units here).
6. **Embeddings: provider endpoint, vectors in memory.** No ONNX model is downloadable in this
   environment, so the semantic path uses the configured embeddings connection (behind the name
   shield) and keeps vectors in process memory (nothing new on disk, so the Vault question doesn't
   arise). A CPU ONNX model is the planned next step; it was **not** built or compared.
7. **Author ops without a message are always live.** A pre-decided twist shouldn't vanish because
   the message it was typed after was swiped. Ops can still be message-bound by passing `messageId`.
8. **Legacy migration = witnesses only.** Legacy rows carry explicit witness lists; those are the
   only observers. With none recorded, the memory is unresolved and granted to nobody. Summaries
   are not migrated (they are derived from the rows). Reversible: migration events have their own
   source and are removed as a set.
9. **Adjudication only for narrator builders.** Undecided details and pre-decided twists reach the
   persona or omniscient narrator when the scene touches them, never an NPC packet; in character
   narration, collapses are still validated after the fact.
10. **Belief rank, not probability.** observed > common > told = reflection > inferred > rumor.
    A stronger source revises a weaker one (and costs the liar trust when it was observed);
    equal-rank disagreements stay as two contested beliefs.
11. **Graphiti** was considered as a temporal-graph adapter and not used: it needs Neo4j (or a hosted
    graph), and it provides no actor-level authorization, which is the point of ECHO. SQLite + replay
    covers bitemporal queries for this scale.
12. **Name words are entity cues, not lexical cues** (found by the benchmark: with names in the
    lexical path, every memory mentioning a person won agreement it hadn't earned).
