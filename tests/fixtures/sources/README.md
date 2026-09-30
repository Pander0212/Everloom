# Source fixtures

Recorded response **shapes** for the online character sources, so tests never touch the network.

`ctavern/`, `risu/`, `pygmalion/` and `wyvern/` follow responses recorded from each site's public
endpoints on 2026-09-30. The field names and structure are the real ones; the text, names and ids
are synthetic, because the recorded characters belong to their creators and aren't ours to
redistribute. Each folder keeps one hidden-definition example and one adult example.

| Folder | Endpoints |
| --- | --- |
| `chub/` | see `chub/README.md` |
| `ctavern/` | `GET character-tavern.com/api/search/cards?query=` → `search.json`; `GET /api/character/{author}/{slug}` → `{author}__{slug}.json` |
| `risu/` | `GET realm.risuai.net/__data.json?q=` (SvelteKit page data, devalue-flattened) → `search.json`; `GET /character/{id}/__data.json` → `meta-{id}.json`; `GET /api/v1/download/json-v2/{id}` → `card-{id}.json` |
| `pygmalion/` | `POST server.pygmalion.chat/galatea.v1.PublicCharacterService/CharacterSearch` → `search.json`; `…/Character {characterMetaId}` → `{id}.json` |
| `wyvern/` | `GET api.wyvern.chat/exploreSearch/characters?q=` → `search.json`; `GET /characters/{id}` → `{id}.json` (`secretFields` lists what the creator hid) |

`EVERLOOM_SOURCE_FIXTURES` may point at this folder (or, as before, at `chub/`).
