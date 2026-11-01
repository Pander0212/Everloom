# ECHO — Everloom's epistemic memory

ECHO gives every character their own subjective world: what they saw, heard, were told, inferred
or wrongly believe, with sources — and recalls it when a place, person, object or open promise
makes it matter, without growing the prompt with the story.

- **Turn it on:** Memory sheet › ECHO tab (per chat), or `PATCH /api/echo/settings` (all chats).
  It is **off** unless chosen. Profiles: Off, Fast, Balanced, Strict (see [DESIGN.md](DESIGN.md)).
- **Inspect it:** the ECHO tab shows each character's beliefs (with sources), suspicions (with how
  sure they are), what they know they don't know, their memories, undecided details (decide a twist
  behind the spoiler guard) and "What the AI saw" (every reply's packet, with why each line was
  allowed).
- **Measure it:** `npm run bench:echo` (recall vs three baselines at 100/500/1,000/5,000 records),
  `npx vitest run --project engine echo` (epistemic, recall, leakage, cognition tests).

| Document | What it covers |
|---|---|
| [AUDIT.md](AUDIT.md) | The repository before ECHO, integration points, reuse vs replacement, baseline |
| [DESIGN.md](DESIGN.md) | Architecture, every "quantum" term mapped to the code that implements it, profiles, isolation |
| [DECISIONS.md](DECISIONS.md) | Decisions and their reasons |
| [EVAL.md](EVAL.md) | Test results, benchmark, latency, what is not done |
| [API.md](API.md) | HTTP endpoints |
