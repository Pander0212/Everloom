# Credits

Everloom is free software (MIT). It stands on the work of these people and projects.

## Inspiration

- Game-feature inspiration (trackers, map, phone, diary, organizations and the idea of a game layer on top of roleplay chat) comes from GetfroggyHoe's reference project: <https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue>. Everloom is a separate implementation written from scratch; no code or visual design was copied.
- [SillyTavern](https://github.com/SillyTavern/SillyTavern) (AGPL-3.0) defined the file formats Everloom reads and writes: character cards (V1/V2/V3, PNG and JSON), World Info / lorebooks, chat-completion presets and JSONL chats, and the World Info activation behavior Everloom reproduces. Everloom implements these formats independently and contains no SillyTavern code.

## Interface details from uiverse.io (MIT)

Each of these was adapted — restyled to Everloom's tokens and limited to transform/opacity animation:

| Element | Author | Original |
| --- | --- | --- |
| Switch | [zanina-yassine](https://uiverse.io/zanina-yassine) | `afraid-eel-50` ("iOS Switch") |
| Checkbox tick | [elijahgummer](https://uiverse.io/elijahgummer) | `foolish-bulldog-87` |
| Typing indicator | [adamgiebl](https://uiverse.io/adamgiebl) | `thin-lionfish-5` |
| Tooltip | [EcheverriaJesus](https://uiverse.io/EcheverriaJesus) | `odd-seahorse-52` |
| Text field focus | [AtharvaMistry](https://uiverse.io/AtharvaMistry) | `kind-treefrog-34` |
| Press state | [Custyyyy](https://uiverse.io/Custyyyy) and [ZiyadOuamna](https://uiverse.io/ZiyadOuamna) | `fuzzy-fireant-2`, `hungry-penguin-18` |
| Toast slide-in | [guilhermeyohan](https://uiverse.io/guilhermeyohan) | `white-cat-52` |

## Fonts and icons

- [Inter](https://rsms.me/inter/) by Rasmus Andersson — SIL Open Font License 1.1
- [Source Serif 4](https://github.com/adobe-fonts/source-serif) by Adobe — SIL Open Font License 1.1
- [Lucide](https://lucide.dev) icons — ISC License

## Libraries

React, React Router, TanStack Query, Zustand, Radix UI primitives, vaul, Motion, Tailwind CSS, Vite and vite-plugin-pwa, marked, DOMPurify, Fastify, better-sqlite3, sharp, zod, immer, js-tiktoken, yazl/yauzl, qrcode — each under its own open-source license (MIT, ISC or Apache-2.0).

## Test fixtures

`tests/fixtures/st/Seraphina.png` and `tests/fixtures/st/Eldoria.json` are sample content from SillyTavern's default assets (AGPL-3.0). They are used only by the test suite to check format compatibility and are not part of the app.
