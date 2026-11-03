# ECHO — next steps (plan, not started)

Proposed on 2026-11-03 after two rounds of live tests ([LIVE.md](LIVE.md)). Goal: as close to
**0 % leaks and 100 % memory** as can be measured. Honest limit: with probabilistic writer models
neither can be guaranteed; the aim is to make leaks impossible *by construction* where the model
never sees the secret, and to *detect and correct* memory misses. Realistic, measurable targets:
**under 2 % leaks, over 97 % memory**, shown with large samples.

## Where we stand

| Measure | Legacy memory | ECHO today |
|---|---|---|
| Long sessions, 118–138 turns, 8k context (24 questions) | 18 / 24 | 23 / 24 |
| Secret word for word in the visible history, asked directly | ~80 % leaked | ~30–55 % leaked |
| Secret on the Korra card (guard or Strict) | 3 / 24 leaked | 0 / 24 |

## The three causes left

1. **The writer sees the secret.** It is in the chat history, and one model voices every character.
   Notes and checks reduce leaks; they cannot remove them.
2. **ECHO records it wrong.** The tracker sometimes logs a hidden action ("while nobody is looking")
   as public, and an NPC then knows it officially.
3. **The writer ignores a memory in the packet.** The only ECHO miss in the long sessions.

## Plan

### Leaks: what a character never sees, it cannot reveal

1. **Sealed dialogue (the core).** When a character speaks, a separate call writes their words, seeing
   only what that character perceived (their packet + the history minus what they missed). The main
   writer gets placeholders (`[[GRAVITAS]]`) and writes only the narration around them; Everloom
   inserts the sealed lines unchanged. A character's *words* then cannot leak a secret, except by a
   genuine lucky guess. Cost: one small extra call per speaking character per turn.
2. **Check the narration.** What remains is narration around the dialogue ("the dwarf glances at her
   boot knowingly") — the existing reply guard, on a much smaller surface.
3. **Hidden actions detected by rule.** Phrases in the player's own text ("while nobody is looking",
   "whisper", "secretly", "unobserved"; German "heimlich", "unbemerkt", "flüstert") force the moment
   private; when unsure, private wins. Deterministic, not the model's call.
4. **Quarantine leaks.** If a leak slips through, the knowledge it gives a character is not recorded
   from that reply, so one mistake doesn't become canon.

### Memory: recall is checked, not hoped for

5. **A dossier per character.** Durable facts (names, promises, debts, origin stories, preferences)
   in a small fixed dossier (~100 tokens) that is always in the prompt when the character is present,
   independent of retrieval — each character's own knowledge only.
6. **Recall check after the reply.** When a turn asks about the past ("do you remember …") and the
   answer was in the packet, a short call checks the reply uses it; if not, one rewrite with
   "Miki remembers: …". The reply guard in reverse.
7. **Local embeddings on the server.** A small multilingual model on the CPU: no rate limit, no key;
   finds paraphrases ("the blaze at the mill" ↔ "set the mill on fire").
8. **Close promises.** Kept or broken promises are marked done instead of staying open in the packet.

### Prove it

9. **A large, hard test:** 3 cards × 300 turns, 30 facts and 10 secrets per story, ≥100 secret probes
   per variant with confidence intervals — the size needed to tell 2 % from 10 %.
10. **Recorded cassettes:** real model answers recorded once, replayed for free in regression tests,
    so later changes can't silently make things worse.

## Order and budget (NanoGPT tokens)

| Step | Content | Tokens |
|---|---|---|
| 1 | 3, 4, 8 | ~0.3 M |
| 2 | 1 + 2, leak measurement with 100 probes per variant | ~6 M |
| 3 | 5 + 6, long-session measurement | ~6 M |
| 4 | 7 (local, no NanoGPT tokens) | 0 |
| 5 | 9, final test on 3 cards | ~12 M |
| 6 | 10, then free | ~0 |
| **Total** | | **~24 M** |

At the time of writing the test key had used 33.8 M of its 40 M limit (the subscription allows 60 M
input tokens a week). The full plan needs the key limit at ~65 M, or the measurements spread over
two weeks; the remaining ~6 M cover steps 1, 4 and a smaller step 2.

## Open decisions (owner)

1. Raise the key limit, or start with the remaining budget and measure the rest next week?
2. Sealed dialogue changes how replies are made (character lines from their own call, narration from
   another), adding ~3–6 s per speaking character: Strict only, or also Balanced?
