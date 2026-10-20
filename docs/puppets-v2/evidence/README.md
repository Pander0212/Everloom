# Puppets v2 evidence

What is here was made from procedural shapes and the CC0 placeholder (no generated art):

- `runtime-test-*`, `rev2d-test.mjs`, `iki-test.mjs`: the §1 runtime decision (docs/PHASE2_DECISIONS.md).
- `lab-*.png` (desktop and `-phone`): the auto-rigged test figure in the lab, from
  `tests/e2e/puppets2.spec.ts` with `EVIDENCE=1`: rest, wave, arms crossed, arms up, walk in place,
  profile walk, back to front, jump, three on stage, and `lab-story-formal`: a puppet on the story
  stage after the story changed its outfit (the same test swipes and checks it rolls back).

The acceptance run on generated characters ("Ines": front, three-quarter and profile, two outfits,
five expressions, five mouth shapes, a waving hand; "Teo": a second, differently proportioned body;
the migrated v1 placeholder) is recorded by `tools/puppets2/evidence.mjs` into the git-ignored
`samples/gen/puppets2/evidence/` (clips as `.webm`, frames as `.png`, `report.json`), next to each
character's `gates-<view>.json` and `contact-<view>.png`. Generated art never goes into the
repository; the numbers are in [RESULTS.md](RESULTS.md).
