# ECHO with real models (NanoGPT subscription, 2026-11-02)

Everloom's real server (in-process), the owner's two cards (**Guildbound: An Isekai RPG**, a
narrator card; **Avatar: The Legend of Korra | RPG**, a world card with many characters), scripted
sessions that plant a promise, a whispered secret, a lie and a hidden object, play on for 10+ turns,
then probe them. Harness: `tests/live/` (key only from `NANO_KEY`; results stay out of git).
About 5.5 M tokens were used, all on subscription models (cost reported by NanoGPT: $0).

Two questions are kept apart:

- **Does ECHO keep the right records?** (deterministic: who knows what, checked on ECHO's own data)
- **Does the writer model respect them?** (behavior of a real model, sampled)

## 1. Model matrix — 6 writer models × 2 cards, ECHO Balanced, narrator = persona

Tracker/extraction: DeepSeek v4.1 Flash 1017 for every run (so writers are comparable).

| Card | Writer | Turns ok | Reply s p50/p95 | Prompt tok/turn | Packet tok avg/max | Writer probes | ECHO records | Swipe rollback |
|---|---|---|---|---|---|---|---|---|
| Guildbound | DeepSeek v4 Pro | 20/20 | 17/19 | 7,816 | 334/537 | 12/13 | ✅✅✅✅ | ✅ |
| Guildbound | DeepSeek v4.1 Flash 1017 | 20/20 | 10/19 | 8,257 | 331/686 | 11/13 | ✅✅✅✅ | ✅ |
| Guildbound | MiniMax M3 | 20/20 | 8/13 | 8,084 | 306/494 | 13/13 | ✅✅✅ ⚠️¹ | ✅ |
| Guildbound | Kimi K2.6 | 20/20 | 15/23 | 9,589 | 353/573 | 11/13 | ✅✅✅✅ | ✅ |
| Guildbound | Qwen 3.5 397B | 20/20 | 14/15 | 10,841 | 347/576 | 12/13 | ✅✅✅✅ | ✅ |
| Guildbound | GLM 5.3 | 20/20 | 16/59 | 9,831 | 361/553 | 13/13 | ✅✅✅✅ | ✅ |
| Korra | DeepSeek v4 Pro | 17/17 | 16/57 | 7,751 | 189/365 | 7/9 | ✅✅✅ | ✅ |
| Korra | DeepSeek v4.1 Flash 1017 | 17/17 | 10/21 | 7,401 | 283/430 | 8/9 | ✅✅✅ | ✅ |
| Korra | MiniMax M3 | 17/17 | — | 8,928 | 263/407 | 7/9 | ✅✅✅✅ | ✅ |
| Korra | Kimi K2.6 | 17/17 | 12/26 | 9,414 | 195/329 | 6/9 | ✅✅✅ | ✅ |
| Korra | Qwen 3.5 397B | 17/17 | 11/17 | 9,977 | 250/402 | 8/9 | ✅✅✅ | ✅ |
| Korra | GLM 5.3 | 15/17 (2 provider errors) | 16/66 | 9,532 | 202/310 | 8/9 | ✅✅✅ ⚠️² | ✅ |

ECHO records checked: Guildbound — Miki doesn't know Earth, Miki doesn't know the key, Miki believes
the lie (Lowmere), the dwarf knows Earth. Korra — Bolin/Mako don't know the cannery, Bolin doesn't
know the pamphlet, Bolin knows the promise.

1. The writer never named the dwarf ("the dwarf"); unnamed characters get no NPC, so the whisper was
   attributed to nobody but the player. Fails safe (no leak) but the dwarf "forgets" it — open gap.
2. Bolin "knows" the cannery only from turn 15 on, because the *writer* had him mention "the cannery
   night"; ECHO recorded what the story then said. ECHO was right before that.

**Records: correct in every run.** Recall of the promise, the class and the lie 15–20 turns later
was right in nearly every run; packets stayed at ~190–360 tokens (max 686) on 7–11 k-token prompts.
Every swipe rolled ECHO back exactly.

## 2. Extraction (the tracker) — same transcript, 7 utility models

| Model | Score | Events | Repairs | s/turn | Notes |
|---|---|---|---|---|---|
| DeepSeek v4.1 Flash 1017 | 8/8 | 36 | 0 | 6.6 | best value |
| GLM 5.3 | 8/8 | 48 | 1 | 11.9 | |
| Kimi K2.6 | 8/8 | 57 | 0 | 25.5 | most detailed, slowest |
| DeepSeek v4 Flash | 7/8 | 41 | 1 | 9.3 | missed the promise as a commitment |
| Qwen 3.5 122B | 7/8 | 51 | 0 | 6.0 | didn't mark the lie |
| GLM 5.3 Flash | 2/7 | 2 | 20 | 42.8 | thinking used the whole budget → empty answers |
| MiniMax M3.1 Flash | 0/4 | 0 | 20 | 21.5 | same |

Checks: promise → commitment, whisper → private, lie → `sincere: false`, hidden object not public,
Miki doesn't know Earth, Miki believes the lie, dwarf knows Earth, Miki doesn't know the key.

**Fix:** when a thinking model returns nothing because thinking used the budget, the tracker now asks
once more with room to finish (4,000 tokens) before the JSON repair. Re-measured below (§6).

## 3. Writer behavior on secrets — A/B, same story state, 3 models × 4 swipes

The story is replayed to just before the probe; the probe is then generated 4× per model.

| Probe | ECHO off | ECHO on, persona packet + "did not see" | ECHO on, addressed character's packet | Strict |
|---|---|---|---|---|
| Guildbound: the dwarf asked whether he noticed the key hidden in Rin's boot (word for word in the chat history 12 turns earlier) | 12/12 leaked | 9/12 | 10/12 | 9/12 |
| Korra: Bolin asked about "trouble at the match" (counting only "lights"/"sabotage"; Equalists are public lore) | 1/12 | 4/12 | 0/12 ³ | — |

3. In that run Bolin wasn't detected as present, so the packet was the same as in the column to its
   left: 4/12 → 0/12 is sampling noise, not the fix. **12 samples are too few for small effects.**

What this shows, plainly:

- When the secret is **in the visible chat history** and the player **asks the character directly
  about it**, every writer model tested lets the character "notice" it most of the time, with or
  without ECHO, in every ECHO variant. ECHO's records stay right; the writer overrides them. This is
  the single-writer limit noted in DESIGN.md, now measured.
- ECHO's persona packet can *surface* a player secret into the writer's view (Korra, v1). Narrator
  cards now use the **addressed character's** knowledge when the player clearly talks to one present
  character (name, alias, role/title, or a descriptor only they fit) — that removes the player's
  secret from the packet; whether it lowers leaks needs a larger sample.

## 4. Other Everloom systems with real models

| System | DeepSeek v4.1 Flash 1017 | GLM 5.3 |
|---|---|---|
| Story reply + tracker | ✅ | ✅ |
| Quickstart draft | ✅ 22 s | ✅ 15 s |
| Story cards (lorebook AI) | ✅ | ✅ |
| Character Studio (create) | ✅ 69 s | ✅ 41 s |
| Helper | ✅ | ✅ |
| Phone text | ✅ | ✅ |
| Diary draft | ✅ | ✅ |
| In-world browser | ✅ | ✅ |
| Social feed | ✅ | ✅ |
| Cutscene | ❌ "no usable cutscene" | ✅ |
| Recipe suggestions | ❌ → **fixed** | ❌ → **fixed** |
| Map expansion | ✅ | ✅ |

- **Recipes (bug, fixed):** both models put an equipment `slot` on a cooked meal; the whole recipe
  was rejected. Invalid optional fields are now dropped and the recipe re-checked
  (`packages/engine/test/recipe-suggest.test.ts`).
- **Tracker accuracy (model quality, not fixed):** after "register (5 coins) and buy a bow for 12
  coins", DeepSeek recorded neither the bow nor the payment; GLM recorded the bow but not the 12 coins.
- **Cutscene:** one model-format failure with DeepSeek; GLM worked. Not investigated further.

## 5. Fixed because of these runs

| Problem seen live | Fix |
|---|---|
| Writer let an NPC know a private moment | Narrator packets mark who present did not perceive it, plus an explicit rule |
| Player secret surfaced by the persona packet | Addressed character's packet for narrator cards |
| Raw ids in packets ("npc_gravitas_hail asked_about") | Rendered as names |
| Duplicate memories of one moment | Shown once |
| `{{obj}}` printed literally (card pronoun macros) | `{{sub}} {{obj}} {{poss}} {{poss_p}} {{ref}}` from the persona |
| Embeddings refused every turn (subscription-only key) | Paused 30 min after a permanent refusal |
| Thinking models answered nothing to the tracker | One retry with room to finish |
| Recipe rejected for a stray field | Invalid optional fields dropped |

## 6. Open

- Secrets visible in the chat history: no prompt-side variant tested stops writers reliably. Next
  step would be validation of the reply (an NPC claiming to have perceived something they have no
  observation of) with an automatic swipe — not built.
- Unnamed characters ("the dwarf") get no knowledge of their own.
- Larger samples for the A/B (n = 12 per cell is too small).
- Re-measurement of the two thinking Flash models after the tracker fix: see the end of this file.

## Recommendation for the owner's server

- **Tracker / utility:** DeepSeek v4.1 Flash 1017 (8/8, fastest). GLM 5.3 or Kimi K2.6 if you prefer.
- **Writer:** GLM 5.3 or MiniMax M3 held secrets best on Guildbound (13/13 probes); DeepSeek v4 Pro
  and Qwen 3.5 397B are close. Avoid GLM 5.3 Flash and MiniMax M3.1 Flash as the tracker.
- **Embeddings:** not available on a subscription-only key; leave semantic recall off.

## Re-measurement after the thinking-model tracker fix

| Model | Before | After | Notes |
|---|---|---|---|
| MiniMax M3.1 Flash | 0/4, 0 events, 20 repairs | 5/8, 8 events, 15 repairs, 52 s/turn | better, still not usable as the tracker (missed promise, lie, hidden object) |
| GLM 5.3 Flash | 2/7, 2 events, 20 repairs | not measured | the run was stopped by the session's time limit |

---

# Round 2 (2026-11-02/03): the fixes, measured

Built from the proposal after round 1 (all on `main`, all with tests):

| | What | Why (round 1) |
|---|---|---|
| A | **History notes** — private moments are marked in the writer's copy of the history, where they happened | secrets in the visible history leaked |
| C | **Reply guard** — a deterministic pre-filter, then a small judge call; `repair` rewrites the same swipe once, without the leaked moment in its history; the rewrite is flag-checked | same |
| B | **Character-first** (Strict) — the addressed character answers first in an isolated call that sees only their own packet and the history minus what they missed | same |
| D | **Provisional actors** — "the one-armed dwarf" is an actor before he has a name; merged into the NPC who fits (head word + stems) | unnamed people knew nothing |
| E | **Ledger check** — a payment or purchase the tracker missed is asked for (English and German) | bow bought, coins never paid |
| F | **Tracker fallback** — the main model reads the turn when the utility model returns no JSON | thinking Flash models |
| — | **Rate-limit retries** — 429/503 "slow down" answers are retried before a reply starts, waiting as asked | 20+ of 138 replies failed |
| — | **Embedding pauses** — refusals and rate limits pause embeddings; inputs cut to 6,000 characters | ElectronHub 429 "try again in 157 s", Gemini 2,048-token limit |
| — | **Packet hygiene** — top memories first; duplicate promises once, max 3; perspective notes only for private moments; unrelated "unsure" lines dropped | 9 promises crowded out the memory asked about |

## Long sessions — the real test of long-term memory

138 turns on the Guildbound card, **8k context** (everything planted in turns 2–9 left the visible
history ~120 turns before it was asked), English, 0 failed replies after the retry fix. Eight
questions: a promise, a pet's name, a scar's origin, a debt, a favourite food, a lie (believed by
Miki), a secret (Miki must not know), a hidden object (nobody saw it). Judged by GLM 5.3.

| Writer | Legacy memory | ECHO before packet hygiene | **ECHO after** |
|---|---|---|---|
| DeepSeek v4.1 Flash 1017 | 4 / 8 | 5 / 8 | **7 / 8** |
| GLM 5.3 | 7 / 8 | 7 / 8 | **8 / 8** |
| Together | 11 / 16 | 12 / 16 | **15 / 16** |

After the fix, every passed question had the memory in the packet (from the addressed character's
view where someone was spoken to); the one miss (DeepSeek, the promise) had it in the packet and
the writer didn't use it. **16 questions is a small sample: a strong signal, not proof.** An earlier
run showing ECHO 8/8 vs legacy 3/8 is discarded: 20+ replies had failed on rate limits.

### German control (DeepSeek v4.1 Flash 1017, 118 turns, 8k context)

| | Legacy memory | ECHO, first run | **ECHO with the language fix** |
|---|---|---|---|
| Questions | 7 / 8 | 5 / 8 | **8 / 8** |
| Language of the replies | German | **switched to English** | German throughout |

ECHO's packet and history notes are English; without a hint they pulled the writer out of German.
Everloom now detects the story's language and adds one line asking to keep writing in it.

Across all clean long sessions after the fixes (English ×2 writers, German ×1): **ECHO 23 / 24,
legacy memory 18 / 24.**

## Secrets in the visible history — A/B, 24 samples per cell (3 models × 8)

Same story state for every variant within a round (replayed once); judged by GLM 5.3.

| Variant | Guildbound, round 1 | Guildbound, round 2 ⁴ | Korra, round 1 |
|---|---|---|---|
| ECHO off | 19/24 (79 %) | — | 3/24 |
| + history notes (A) | 12/24 (50 %) | — | 2/24 |
| + reply guard with repair (C) | 10/24 (42 %) | 11/24 (46 %) | **0/24** |
| Strict: character-first (B) | 7/24 (29 %) | 14/24 (58 %) | **0/24** |

4. After the repair stopped seeing the leaked moment and the pre-filter learned perception words;
   a new replay of the same story.

Plainly: when the secret is **word for word in the visible history** and the player **asks the
character directly about it**, ECHO's measures cut leaks from ~80 % to roughly 30–55 %, and to
~0 % on the Korra probe. The differences *between* the variants are within the noise of 24
samples (the strict cell moved from 29 % to 58 % between two replays of the same story). The guard
catches what it checks; the rewrite still sometimes leaks.

## Still open

- Secrets visible in the history and asked about directly: reduced, not solved.
- Tracker extraction sometimes records a hidden action as public (then an NPC "knows" it).
- Ledger check and tracker fallback are unit-tested; not yet re-measured live.
- Semantic recall through ElectronHub: its rate limit (one request per few minutes) makes it
  unusable per turn; Everloom now pauses instead of failing.

Token use (NanoGPT key, both rounds): 33.8 M of the 40 M limit; $0.
