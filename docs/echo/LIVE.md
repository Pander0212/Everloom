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
