# ECHO design

## Data flow

```
reply stored ──► tracker call (same call, + "events")  ──► parseEchoEvents ──► validateTurn ──► echo_events
   (no game layer: one small "echo extraction" call)        (names → ids,       (vs projection    (message + swipe
                                                             observers from      before the msg)   anchored)
                                                             the world state)
next turn ──► active path (message → swipe) ──► onBranch(events) ──► Projector (cached by leaf, incremental)
          ──► authorize(perspective)  ◄── perspective from the server: speaker card / persona / omniscient
          ──► understand(query) ──► recallMemories (paths → RRF → interference → accessibility → gate)
          ──► compilePacket (sections, L0/L1/L2, affordances, budget) ──► prompt (bounded [ECHO] block)
          ──► recordPacket (leakage debugger) + echo_recalls (reconsolidation), both message-bound
```

Code: engine `packages/engine/src/echo/*` (pure, deterministic), server `apps/server/src/services/echo.ts`
and `routes/echo.ts`, web `apps/web/src/features/memory/EchoPanel.tsx`.

## The quantum layer, in plain code

Nothing here is quantum computing. Each term names one concrete mechanism.

| Term | Mechanism | Code |
|---|---|---|
| Superposition | A character holds several explanations with subjective weights ("amplitudes"), biased by personality (paranoia raises sinister options). Evidence multiplies weights by source credibility; contradicting evidence divides. Weights are recomputed from the prior and the evidence still standing, so a retracted support un-does its effect. Resolved only by first-hand evidence and a clear winner, and **never written to canon**. | `projector.ts` `openHypothesis`, `updateHypotheses`, `recompute` |
| Lazy canon / collapse | An `undetermined` slot with candidates and constraints from clues. The first time the story states a value it is checked: a violation is recorded (and flagged for regeneration) instead of committed. The narrator's packet can carry a seeded suggestion (seed = message + swipe) so a swipe re-rolls it. The author can pre-decide. NPC packets never carry it. | `projector.ts` `commitFact`, `satisfies`, `possible`; `compiler.ts` adjudication section |
| Entanglement | Justification-based truth maintenance: every belief lists its supports. When one goes out (lie exposed, correction, author retraction) every dependent belief goes out recursively with its interval closed. Promises link trust both ways; testimony creates "A thinks B believes" records on both sides; rumor chains keep their `via` list. | `projector.ts` `addBelief`, `withdraw`, `depend` |
| Interference | Independent recall paths (lexical, semantic, entity graph with one-hop association, temporal, commitment, trigger signatures, predictive activation, causal hop, weak recency) fused by strength-weighted Reciprocal Rank Fusion; agreement between paths amplifies, opposed attributes (winter/summer, night/morning) dampen. | `recall.ts` |
| Measurement changes the state | Each recalled unit is recorded per reply (`echo_recalls`, message-bound); recall count raises stability. Optional drift overlays (author ops) colour a recollection without touching the event. | `recall.ts` `accessibility`; `access.ts` drift |
| Decoherence | Accessibility = exp(−age / stability), stability from importance, emotion and rehearsal. It only tilts ranking (×0.8–1.0): storage is never deleted, a strong cue still reaches an old memory. Suppression and forgetting are reversible author ops. | `recall.ts` `accessibility` |
| Tunneling | One seeded roll per message + swipe decides whether a faded memory surfaces through its own sensory signature (`sense:` triggers) — rare (3 %), at most one, marked "involuntary". A faded memory can't surface through a sensory cue any other way. | `recall.ts` tunneling block |

## Isolation (§5)

- `authorize()` is the only constructor of an `AuthorizedView` (a branded type); `recallMemories`
  and `compilePacket` accept nothing else. Authorization happens before ranking.
- A unit's text is what that observer perceived. Partial perception keeps the cue's onlooker text;
  a cue downgraded by language or disguise is replaced by a generic line (never the original).
- Exact quotes (L2) only when the observer perceived the event completely.
- Truth markers (`truth`, `sincere`) exist only in omniscient/adjudicator views.
- The view checks the projection was built for the perspective's leaf (`AccessError`).
- Semantic scores are computed only for ids in the view; lexical scores are BM25 over the view.
- The recall tool's schema is `.strict()`: an `actor` argument is a 400.
- Builders: `buildNpcContext`, `buildNarratorContext`, `buildOmniscientContext`,
  `buildAdjudicatorContext`. The NPC builder drops adjudication input.
- Proven by the property test (300 random stories × 6 actors, every token traced to its
  perception) and §12 epistemic tests 1–17.

**Limit, stated plainly:** in Fast and Balanced the writer is one model call that also sees the
recent chat history, which is what was on screen. ECHO isolates what *memory* adds; it cannot hide
the visible conversation from the writer. Strict narrows this further by giving the writer other
characters' isolated proposals instead of their knowledge.

## Profiles

| Profile | Writes | Reads | Extra calls per turn |
|---|---|---|---|
| Off / Light | legacy memory only | legacy | 0 |
| Fast | events from the tracker call | speaker's packet (legacy per-person lines kept) | 0 (no game layer: 1 extraction call, like the tracker) |
| Balanced | + validation | + suspicions, adjudication for narrators, involuntary recall; omniscient per-person lines removed | 0 |
| Strict | same | + up to 2 isolated proposal calls for other characters present | ≤ 2 |

Presets suggest Classic → Off, Story → Fast, Full RPG → Balanced; the choice is the owner's.

## Write path details

- Observers: everyone present (`presentIds`) at commit, here/awake; NPCs not alive can't perceive.
- `seq` = message seq + index/100, so replay order is story order regardless of when swipes were made.
- Rewrites (edit, regenerate) delete `turn` events of that message + swipe; deleting a swipe shifts
  later swipes' rows down (like `op_log`); branching copies the log with ids remapped.
- Validation runs against the projection *without* the new message.
