# Credits

Everloom is free software (MIT). It stands on the work of these people and projects.

## Inspiration

- Game-feature inspiration (trackers, map, phone, diary, organizations and the idea of a game layer on top of roleplay chat) (and, in Phase 3, the feature list for homes, economy, crafting, travel, party, battle, communication and the stage) comes from GetfroggyHoe's reference project: <https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue>. Everloom is a separate implementation written from scratch; no code or visual design was copied.
- **World Engine**, the owner's own SillyTavern extension, inspired Phase 2's memory (who saw what, gossip, facts that change, hierarchical summaries), the living world (schedules, goals, off-screen life, storylines, dice, the pulse) and the World inspector. Everloom rebuilt these ideas from its guide and behavior; no code was copied, and World Engine's source is not part of this repository.
- [SillyTavern Character Library](https://github.com/Sillyanonymous/SillyTavern-CharacterLibrary) (AGPL-3.0) inspired the character library features: the library view, batch actions, versions, collections, duplicates, bundles, the chat history browser, the studio, media localization, custom CSS snippets and online sources. It served as a feature and behavior spec only; no code was copied.
- [Chub](https://chub.ai), [Character Tavern](https://character-tavern.com), [RisuRealm](https://realm.risuai.net), [Pygmalion](https://pygmalion.chat) and [Wyvern](https://app.wyvern.chat) host the characters the online-sources feature can browse, through their public APIs. Characters belong to their creators. The test fixtures for these sources are synthetic cards in the sites' response shapes, not copies of anyone's characters.
- [JS-Slash-Runner / Tavern Helper](https://github.com/N0VI028/JS-Slash-Runner) (PolyForm Noncommercial) inspired Phase 4's scripting: scripts in cards, interactive HTML in messages, and the script API. Everloom's compatibility layer is an independent implementation of its most used documented function names, written from the public documentation; no code was copied.
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

React, React Router, TanStack Query, Zustand, Radix UI primitives, vaul, Motion, Tailwind CSS, Vite and vite-plugin-pwa, marked, DOMPurify, Fastify, better-sqlite3 (and better-sqlite3-multiple-ciphers for the Vault), sharp, acorn (the script loop guard), zod, immer, js-tiktoken, yazl/yauzl, fflate, qrcode, [PixiJS](https://pixijs.com) 6 and [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display), [three.js](https://threejs.org) and [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) (3D rendering and VRM), [glTF Transform](https://gltf-transform.dev) and [meshoptimizer](https://github.com/zeux/meshoptimizer) (model optimization), ktx2-encoder with the [Basis Universal](https://github.com/BinomialLLC/basis_universal) transcoder (Apache-2.0; KTX2 textures) — each under its own open-source license (MIT, ISC or Apache-2.0; PixiJS and pixi-live2d-display are MIT).

## 3D characters

Everything 3D that ships, with its source and license (checked October 2026):

| What | Where | Source | License |
|---|---|---|---|
| Motion clips (idle, talk, dance, sit, walk, attack, cast, hit and more; the `source` field of each clip names its animation) | `apps/web/public/avatar/clips/` | [Universal Animation Library](https://opengameart.org/content/universal-animation-library) and [Universal Animation Library 2](https://opengameart.org/content/universal-animation-library-2) by Quaternius, converted by `tools/avatars/build-clips.ts` | CC0 |
| The other clips (wave, bow, clap, laugh, the extra dances…) | same folder, `"source": "Everloom (authored)"` | keyframed for Everloom (`tools/avatars/emotes.ts`) | MIT (Everloom's) |
| The preview mannequin and the test mannequins | `apps/web/public/avatar/mannequin.glb`, `tests/fixtures/avatars/models/` | Quaternius base characters | CC0 |
| The "Basics" part pack (two bodies, hair, tops, bottoms, shoes, hats, extras, thumbnails) | `apps/web/public/avatar/packs/basics/` | generated by Everloom's own code-made generator (`tools/avatars/build-starter-pack.ts`) | CC0 (dedicated by Everloom; `LICENSE.txt` in the pack) |
| Fabric detail maps (denim, knit, plaid, floral) | `apps/web/public/avatar/fabrics/` | generated through NanoGPT (Z Image Turbo, Qwen Image; ledger entries 85–88), processed by `tools/avatars/build-fabrics.ts` | as for the artwork below |
| The Blender add-on | `tools/blender-addon/everloom/` | written for Everloom | GPL-3.0-or-later (Blender add-ons use Blender's GPL API) |

**Not shipped, never downloaded for the owner:** the CharacterStudio sample packs (M3-org
loot-assets and others) say *Redistribution_Prohibited* in their own metadata; see
`docs/PHASE2_DECISIONS.md`. Packs the owner imports carry their own license, shown in Settings.

**Downloaded on the owner's server, only when they ask:**

- [Blender](https://www.blender.org) 4.2 LTS (GPL-2.0-or-later), by `install.sh` if wanted.
- [MPFB](https://static.makehumancommunity.org/mpfb.html) 2.0.17, the MakeHuman add-on for
  Blender (GPL-3.0-or-later), from extensions.blender.org, and MakeHuman's
  [system assets](https://static.makehumancommunity.org/assets/assetpacks.html) (CC0), from
  makehumancommunity.org; both checked against pinned SHA-256 hashes. Characters made with them are
  the owner's.
- Image-to-3D results from the owner's own Meshy or fal.ai account, under that service's terms.

## Live2D

Live2D support is optional and off by default. Two Live2D components are involved, under Live2D's own licenses rather than Everloom's MIT license:

- **Cubism Core for Web** (`live2dcubismcore.min.js`) is proprietary (Live2D Proprietary Software License). **It is not included in Everloom.** Owners who want Live2D download it from Live2D and upload it to their own server.
- **Cubism Framework for Web** is part of pixi-live2d-display's Cubism 4 build, so it is inside Everloom's Live2D renderer chunk (downloaded only when Live2D is turned on). It is distributed under the [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html), which allows redistribution; commercial publishers above Live2D's revenue threshold need their own agreement with Live2D.

Live2D models belong to their creators and carry their own terms (for Live2D's sample models, the Free Material License).

## Artwork

Everloom's bundled pictures (item icons, backgrounds, genre cards, map thumbnails, the demo
character Mira Vale and her expressions, portraits, empty-state illustrations, Pip, enemy
portraits, and the fabric maps for code-made clothes) were generated for Everloom in October 2026 through [NanoGPT](https://nano-gpt.com)
with Z Image Turbo, Qwen Image and Step Image Edit 2 (HiDream, Chroma and two ElectronHub models
were used only for comparisons; none of their pictures ship). Every call, prompt and keep/reject decision
is in [docs/art/LEDGER.md](docs/art/LEDGER.md); the prompts and style rules are in
[docs/art](docs/art/).

Licensing:

- **NanoGPT's Terms of Service** (read 2026-10-05): "As between you and NanoGPT … you own the
  Output", NanoGPT assigns its rights in the output to the user, and commercial use is allowed,
  subject to the model providers' terms.
- **Model licenses**: Z Image Turbo (Apache-2.0) and Qwen Image (Apache-2.0);
  Step Image Edit 2 is StepFun's hosted model, used through NanoGPT under the terms above. None
  of these licenses claims rights in generated images.
- **ElectronHub's Terms of Service** has content rules but no clause on who owns generated images,
  which is why nothing generated there is shipped.
- AI-generated images may have little or no copyright protection in some countries. Everloom
  therefore offers them under the same terms as its code (MIT) as far as any rights exist, with
  no claim beyond that.

The pictures contain no real people, franchise characters, logos or text; two icons with
brand-like marks were rejected and redrawn. Every picture is optional and replaceable:
Settings › Appearance › Illustrations turns the bundled art off, items can use any picture, and
backgrounds and Mira's expressions are ordinary assets once added to the library.

## Sound

Everloom ships no music or sound files. Ambience without the owner's own loops is synthesized in the browser with the Web Audio API.

## Test fixtures

`tests/fixtures/st/Seraphina.png` and `tests/fixtures/st/Eldoria.json` are sample content from SillyTavern's default assets (AGPL-3.0). They are used only by the test suite to check format compatibility and are not part of the app.
