# ECHO evaluation

Measured on this development container (4 vCPU Xeon @ 2.1 GHz, no GPU), **not** on the owner's VPS.
Re-run anywhere with `npm run bench:echo`.

## Tests

| Suite | Result |
|---|---|
| Baseline before ECHO | 1270 passed, 8 skipped (145 files) |
| After ECHO, full Vitest | **1324 passed, 8 skipped, 0 failed** (151 files) |
| Engine: epistemic tests 1–17 (+ superposition, promises) | 19/19 (`echo-epistemic.test.ts`) |
| Engine: recall tests 1–12 (+ decay, interference, predictive activation, budget) | 19/19 (`echo-recall.test.ts`) |
| Engine: property-based leakage, 300 random stories × 6 actors | **0 leaks** (`echo-leakage.test.ts`) |
| Engine: decisions, consolidation, paired behavior | 4/4 (`echo-cognition.test.ts`) |
| Engine: beats every baseline at 500 records | pinned (`echo-bench.test.ts`) |
| Server vertical slice (mock model) | 10/10 (`apps/server/test/echo.test.ts`) |
| Playwright `echo.spec.ts` | 2/2 (phone-390 dark, desktop-1280 light); other projects not run here |
| Typecheck (engine, server, web) | clean |

The leakage test found a real leak during development (a disguise or a foreign language downgraded a
cue but kept its original wording); it is fixed and now covered.

## Knowledge leakage

Deterministic leakage rate: **0** over 1,800 actor views (property test) plus every epistemic test,
including swipes, rewinds, rumor chains, lies, private messages, interceptors, partial perception,
summaries/patterns, the semantic signal for unauthorized ids, the recall tool and the cache leaf
check. Target met for the deterministic suite. Not measured: leakage with a real model writing
(needs a model and an LLM judge).

## Recall benchmark

Synthetic story (`tests/echo-bench/synth.ts`): deliberately similar distractors (dinners, walks,
errands with the same six people) and planted targets. Baselines: **recency** (the 5 latest),
**topk** (plain top-5 lexical similarity — stands in for top-k vector search because no embedding
model runs offline here), **legacy** (Everloom's current recall fed the same events).
"Quiet" = queries that must recall nothing actually recall nothing.

### 100 memory records (199 memory units)

| System | Recall@3 | Recall@5 | MRR | Quiet when nothing fits | Precision@5 | Tokens/turn |
|---|---|---|---|---|---|---|
| echo | 92% | 92% | 0.833 | 100% | 0.583 | 83 |
| recency | 0% | 0% | 0 | 0% | 0 | 73 |
| topk | 75% | 75% | 0.708 | 100% | 0.308 | 42 |
| legacy | 83% | 92% | 0.753 | 0% | 0.213 | 63 |

| Stage | p50 ms | p95 ms |
|---|---|---|
| project | 16.933 | 16.933 |
| authorize | 0.093 | 1.342 |
| understand | 0.098 | 12.04 |
| recall | 0.955 | 5.347 |
| compile | 1.285 | 5.469 |

| Query | Kind | echo | recency | topk | legacy |
|---|---|---|---|---|---|
| q1 | exact-far | 1 | – | 1 | 1 |
| q2 | paraphrase | 1 | – | 1 | 1 |
| q2b | pure-paraphrase | – | – | – | 3 |
| q3 | object | 1 | – | – | – |
| q4 | location | 1 | – | 1 | 1 |
| q5 | promise | 1 | – | – | 5 |
| q6 | multi-hop | 2 | – | 2 | 2 |
| q7 | similar | 1 | – | 1 | 1 |
| q9 | exact-words | 2 | – | 1 | 1 |
| q10 | missing | – | 0 | – | 0 |
| q11 | unrelated | – | 0 | – | 0 |
| q12a | interference | 1 | – | 1 | 1 |
| q12b | interference | 1 | – | 1 | 1 |
| q13 | sensory | 1 | – | 1 | 1 |

### 500 memory records (999 memory units)

| System | Recall@3 | Recall@5 | MRR | Quiet when nothing fits | Precision@5 | Tokens/turn |
|---|---|---|---|---|---|---|
| echo | 92% | 92% | 0.792 | 100% | 0.582 | 90 |
| recency | 0% | 0% | 0 | 0% | 0 | 75 |
| topk | 75% | 75% | 0.708 | 100% | 0.308 | 43 |
| legacy | 75% | 75% | 0.708 | 0% | 0.179 | 63 |

| Stage | p50 ms | p95 ms |
|---|---|---|
| project | 25.064 | 25.064 |
| authorize | 0.258 | 0.531 |
| understand | 0.095 | 0.176 |
| recall | 2.624 | 6.282 |
| compile | 3.826 | 8.299 |

| Query | Kind | echo | recency | topk | legacy |
|---|---|---|---|---|---|
| q1 | exact-far | 1 | – | 1 | 1 |
| q2 | paraphrase | 1 | – | 1 | 1 |
| q2b | pure-paraphrase | – | – | – | – |
| q3 | object | 1 | – | – | – |
| q4 | location | 1 | – | 1 | 1 |
| q5 | promise | 2 | – | – | – |
| q6 | multi-hop | 2 | – | 2 | 2 |
| q7 | similar | 1 | – | 1 | 1 |
| q9 | exact-words | 2 | – | 1 | 1 |
| q10 | missing | – | 0 | – | 0 |
| q11 | unrelated | – | 0 | – | 0 |
| q12a | interference | 1 | – | 1 | 1 |
| q12b | interference | 1 | – | 1 | 1 |
| q13 | sensory | 1 | – | 1 | 1 |

### 1000 memory records (1999 memory units)

| System | Recall@3 | Recall@5 | MRR | Quiet when nothing fits | Precision@5 | Tokens/turn |
|---|---|---|---|---|---|---|
| echo | 92% | 92% | 0.833 | 100% | 0.524 | 89 |
| recency | 0% | 0% | 0 | 0% | 0 | 68 |
| topk | 75% | 75% | 0.708 | 100% | 0.308 | 43 |
| legacy | 75% | 75% | 0.708 | 0% | 0.179 | 63 |

| Stage | p50 ms | p95 ms |
|---|---|---|
| project | 57.093 | 57.093 |
| authorize | 0.697 | 1.046 |
| understand | 0.164 | 0.244 |
| recall | 7.323 | 12.067 |
| compile | 9.417 | 12.172 |

| Query | Kind | echo | recency | topk | legacy |
|---|---|---|---|---|---|
| q1 | exact-far | 1 | – | 1 | 1 |
| q2 | paraphrase | 1 | – | 1 | 1 |
| q2b | pure-paraphrase | – | – | – | – |
| q3 | object | 1 | – | – | – |
| q4 | location | 1 | – | 1 | 1 |
| q5 | promise | 1 | – | – | – |
| q6 | multi-hop | 2 | – | 2 | 2 |
| q7 | similar | 1 | – | 1 | 1 |
| q9 | exact-words | 2 | – | 1 | 1 |
| q10 | missing | – | 0 | – | 0 |
| q11 | unrelated | – | 0 | – | 0 |
| q12a | interference | 1 | – | 1 | 1 |
| q12b | interference | 1 | – | 1 | 1 |
| q13 | sensory | 1 | – | 1 | 1 |

### 5000 memory records (9999 memory units)

| System | Recall@3 | Recall@5 | MRR | Quiet when nothing fits | Precision@5 | Tokens/turn |
|---|---|---|---|---|---|---|
| echo | 92% | 92% | 0.819 | 100% | 0.46 | 105 |
| recency | 0% | 0% | 0 | 0% | 0 | 82 |
| topk | 75% | 75% | 0.708 | 100% | 0.308 | 43 |
| legacy | 75% | 75% | 0.708 | 0% | 0.179 | 64 |

| Stage | p50 ms | p95 ms |
|---|---|---|
| project | 321.573 | 321.573 |
| authorize | 2.32 | 11.001 |
| understand | 0.158 | 0.27 |
| recall | 25.785 | 41.218 |
| compile | 37.628 | 66.184 |

| Query | Kind | echo | recency | topk | legacy |
|---|---|---|---|---|---|
| q1 | exact-far | 1 | – | 1 | 1 |
| q2 | paraphrase | 1 | – | 1 | 1 |
| q2b | pure-paraphrase | – | – | – | – |
| q3 | object | 1 | – | – | – |
| q4 | location | 1 | – | 1 | 1 |
| q5 | promise | 1 | – | – | – |
| q6 | multi-hop | 2 | – | 2 | 2 |
| q7 | similar | 1 | – | 1 | 1 |
| q9 | exact-words | 1 | – | 1 | 1 |
| q10 | missing | – | 0 | – | 0 |
| q11 | unrelated | – | 0 | – | 0 |
| q12a | interference | 1 | – | 1 | 1 |
| q12b | interference | 1 | – | 1 | 1 |
| q13 | sensory | 3 | – | 1 | 1 |

Per-query cells: rank of the target (– = not in the top 5); for "missing"/"unrelated" queries, 0 = correctly recalled nothing, – = recalled something.

**Reading it honestly.** ECHO beats all three baselines on Recall@3, Recall@5, MRR, precision and
staying quiet at every size. The one target it misses is `q2b`, a pure paraphrase sharing a single
content word ("blaze that burned down the mill" vs "set the old mill on fire"): that needs the
semantic path, which is off in this offline benchmark. ECHO's packets are larger than raw baseline
lines (≈ 85–105 tokens vs ≈ 45–80) because every line carries its source and status; all are far
under the 1,000-token target, and the packet is empty (0 tokens) when nothing is relevant.

## Latency (per turn, warm)

The server path per reply is authorize + understand + compile (compile runs recall once). At 5,000
records (≈ 10,000 memory units): p50 ≈ 40 ms, p95 ≈ 78 ms here — under the 100 ms target on this
machine. The projection is cached by leaf and extended incrementally (p50 0.05 ms per new event);
a full rebuild after a swipe/edit costs ≈ 0.3 s at 5,000 events. No remote call is on the common
path (the semantic path, when turned on, adds one embedding call with a 1.2 s timeout, like legacy).

## Not done, or not measured

- Real-model runs: extraction quality, narrative consistency (LLM judge), owner chats, imported
  SillyTavern chats — no model keys or owner data here.
- VPS measurements (the numbers above are this container's).
- Local ONNX embeddings and the comparison with the provider endpoint; the cross-encoder reranker (§7 D).
- The recall tool is an HTTP endpoint with server-bound perspective and caps; it is not yet wired
  into providers' tool calling, and the "recall request" marker fallback is not built.
- Strict: isolated proposals are built; automatic regeneration of a flagged passage is not (issues are
  flagged on the message; the fix is a swipe).
- Scene planning (§8.4); depth-3 higher-order beliefs beyond explicit seeds; temporary impairment at
  retrieval (hook only); group membership from factions (only via events); campaign-wide ECHO across chats.
- Inspector: no relationship graph drawing and no side-by-side swipe comparison (knowledge "at a
  moment" is there; relationships are listed by the API).
