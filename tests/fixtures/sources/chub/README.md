# Chub fixtures

Responses for tests of the Chub source (no network is used in tests).

These are **not live recordings**: Chub's API answers "This service is not available in your
country" from the environment Everloom was built in, so nothing could be recorded there, and working
around a regional block is exactly what the source rules forbid. They are built to the response shape
used by established open-source clients of Chub's public endpoints:

- `GET https://api.chub.ai/search?search=&first=&page=&sort=&nsfw=&namespace=characters` →
  `data.nodes[]` with `fullPath`, `name`, `tagline`, `topics`, `nTokens`, `starCount`, `lastActivityAt`,
  `max_res_url`, `avatar_url`, `nsfw_image`.
- `GET https://api.chub.ai/api/characters/{creator}/{name}?full=true` → `node.definition` with
  `personality` (the card description), `tavern_personality`, `scenario`, `first_message`,
  `example_dialogs`, `description` (the creator's notes), `system_prompt`, `post_history_instructions`,
  `alternate_greetings`, `embedded_lorebook`, `extensions`.

To refresh them with real responses, run the requests above from a server where Chub is available
and replace the files (keep a hidden-definition and an adult example).
