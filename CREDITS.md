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
| Pushable button (Pixel Quest and Sketchbook primary buttons) | [Voxybuns](https://uiverse.io/Voxybuns) | `lucky-fireant-71` |

The themes' other micro-interactions (per-theme typing indicators, message arrival, the success
burst, scenery) are Everloom's own, written for the themes after looking through the
[uiverse.io galaxy](https://github.com/uiverse-io/galaxy) for the kinds of interaction worth having.

The uiverse.io galaxy is distributed under the MIT License:

> Copyright (c) 2023 Uiverse.io
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions: The above copyright notice and this
> permission notice shall be included in all copies or substantial portions of the Software.
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Themes

The theme system and its eleven themes (colors, scenery, typing indicators) are Everloom's own
design. [Hakawati](https://github.com/rakanssh/hakawati) (GPL-3.0) showed the idea of complete
themes with animated scenery chosen from a gallery of live previews; it was read for ideas only, and
none of its code, CSS or art is in Everloom.

## Fonts and icons

- [Inter](https://rsms.me/inter/) by Rasmus Andersson — SIL Open Font License 1.1
- [Source Serif 4](https://github.com/adobe-fonts/source-serif) by Adobe — SIL Open Font License 1.1
- Theme fonts, self-hosted through [Fontsource](https://fontsource.org) (checked October 2026):
  [EB Garamond](https://github.com/octaviopardo/EBGaramond12) (Georg Duffner, Octavio Pardo),
  [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant) (Christian Thalmann),
  [IBM Plex Mono](https://github.com/IBM/plex) (IBM), [VT323](https://fonts.google.com/specimen/VT323) (Peter Hull),
  [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) (Stefie Justprince),
  [Caveat](https://github.com/googlefonts/caveat) (Impallari Type), [Cinzel](https://github.com/NDISCOVER/Cinzel) (Natanael Gama),
  [IM Fell English](https://fonts.google.com/specimen/IM+Fell+English) (Igino Marini) — all SIL Open Font
  License 1.1; [Special Elite](https://fonts.google.com/specimen/Special+Elite) (Astigmatic) — Apache License 2.0.
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

## Everloom Puppets

The puppet runtime, format, template rig and tools are Everloom's own (MIT). What they build on:

- **Inochi2D** ([SDK](https://github.com/Inochi2D/inochi2d), BSD-2-Clause, © Inochi2D Project and
  Kitsunebi Games): the `.inp`/`.inx` import and export (`packages/engine/src/puppet/inochi.ts`)
  follows the field names and container layout of the SDK's 0.8.7 serializer. No Inochi2D code is
  included. Inochi Creator (BSD-2-Clause) is the editor owners can polish puppets in.
- **See-through** ([shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through),
  Apache-2.0; Lin et al., SIGGRAPH 2026): the layering step, run on the owner's rented GPU by
  `tools/see-through-worker` (it fetches See-through at a pinned commit; nothing of it is in this
  repository). Its weights are fetched at run time: LayerDiff 3D and the fine-tuned Marigold depth
  model under the **CreativeML OpenRAIL++-M** licence (outputs are free to use; its use restrictions
  apply, including no sexual content involving minors), SAM body parsing under Apache-2.0.
- **Ideas** (no code copied): Stretchy Studio (MIT, the See-through tag → role mapping and contour
  meshes), Anime2.5DRig (MIT), Kota-Ohno's seethrough-live2d-pipeline (MIT, re-projecting the
  original's visible pixels over generated layers), the Bunraku paper (arXiv 2607.27348: a fixed
  layer taxonomy, meshes from alpha, per-parameter keypose offsets), Textoon (template approach;
  its Live2D template is not used).
- **The placeholder puppet** (`apps/web/public/puppets/placeholder/`) is simple shapes drawn by
  `tools/puppets/build-placeholder.ts`, CC0. Generated puppet art never enters the repository; it is
  shared as packs under the image services' terms (NanoGPT assigns outputs to the user).

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

### Native 3D repair (2026-10-07)

- Browser FBX/OBJ/glTF conversion uses three.js (MIT). The vendored MMD loader and toon shader
  are from three.js r171 (MIT, Three.js authors); the parser is mmd-parser (MIT, Takahiro).
  Their complete notices are beside the files in `apps/web/src/features/avatar3d/runtime/vendor/`.
  Everloom modifies mmd-parser to honor PMX's UTF-8 encoding flag as well as UTF-16.
- The bundled Draco decoder is from three.js r186's distribution of Google's Draco (Apache-2.0).
  Its license is in `apps/web/public/three/draco/LICENSE.txt`.
- Native MakeHuman installs **data only**, from MPFB commit
  `d0a32e57a7f915cb2f2b95410e2117648c7bbb7e` and the official CC0 system asset pack.
  Base mesh, proxy bindings, targets, rigs, textures and their JSON mesh data are CC0 1.0,
  explicitly distinguished from MPFB's GPL program code in
  [MPFB's license](https://github.com/makehumancommunity/mpfb2/blob/d0a32e57a7f915cb2f2b95410e2117648c7bbb7e/LICENSE.md).
  MakeHuman Team, Data Collection AB, Joel Palmius and Jonas Hauquier are credited for these assets.
  The runtime readers and fitting implementation were written independently for Everloom.
  The small native geometry fixtures in `tests/fixtures/models/makehuman` use the same CC0 data.
  The redistributed packs are modified: explicit target paths are excluded, system textures
  are limited to 1024 pixels, and skin maps keep only head UV detail over a plain body color
  (neutral normals elsewhere). `tools/avatars/package-safe-system.mjs` records the checked
  upstream hash and creates `avatar/makehuman-system.zip`; both packs include CC0 notices
  and provenance. Small test clothing textures are reduced to 256 pixels.
- `tests/fixtures/models/cesium-man.glb` and `rigged-figure.glb`: © 2017 Cesium,
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), obtained from Khronos
  glTF-Sample-Assets. No geometry modifications. CesiumMan contains Cesium's logo; the asset
  license does not grant trademark rights or imply endorsement.
- `tests/fixtures/models/robot-expressive.glb`: Quaternius / Tomás Laulhé, CC0;
  three.js example conversion by Don McCurdy.
  `robot-vrm0.vrm` and `robot.pmx` are modified format fixtures generated independently
  by `tools/avatars/make-format-fixtures.ts`, retaining the original geometry and skeleton.
- `tests/fixtures/models/seed.vrm`: Seed-san, VirtualCast; `twist-vrm1.vrm`: Twist, pixiv.
  Official VRM samples under the [VRM Public License 1.0](https://vrm.dev/licenses/1.0/).
  Redistribution and modification are permitted by each file's embedded metadata; creators
  must be credited. Their embedded metadata remains intact. These are test models, not default
  characters or a general asset license for arbitrary VRoid characters.

The owner's Mura Mura model is used locally for diagnosis and is not redistributed.

`tests/fixtures/st/Seraphina.png` and `tests/fixtures/st/Eldoria.json` are sample content from SillyTavern's default assets (AGPL-3.0). They are used only by the test suite to check format compatibility and are not part of the app.
# Face Units 01 (native expressions)

Mika Suominen's CC0 1.0 facial-action targets, distributed by NAVER's Anny at commit `d6fc027ced5c17b6b0775dee944096ade7a9ef80`. License personally verified in the [Anny README](https://github.com/naver/anny/blob/d6fc027ced5c17b6b0775dee944096ade7a9ef80/README.md#license) and its data CC0 license. Sixteen all-ages targets add GPU blinks, smiles and mouth movement to the native MakeHuman topology; proxies follow through their original bindings. No PyTorch or Anny program code is included. Pack creation and provenance: `tools/avatars/package-human-data.mjs`, `avatar/makehuman-core.zip` (contains CC0 text).

The real FBX test fixture `tests/fixtures/models/knight.fbx` is Quaternius's LowPoly Animated Knight. The author's [OpenGameArt upload](https://opengameart.org/content/lowpoly-animated-knight) explicitly grants CC0 1.0. The FBX is extracted unchanged from the author's archive; no Blender conversion is used.

The bundled studio environment `apps/web/public/avatar/env/studio_small_09_1k.hdr` is
Sergej Majboroda's [Studio Small 09](https://polyhaven.com/a/studio_small_09), obtained
from Poly Haven, 1K HDR, unmodified (1,615,248 bytes; SHA-256
`e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45`).
The [asset license](https://polyhaven.com/license) explicitly permits CC0 redistribution.
It is served locally only when the 3D renderer is used; no CDN call is made by the app.

## 3D import: Unity packages, bone names, formats (October 2026)

Licenses checked by reading each project's LICENSE file; details in
[docs/3d-import/research.md](docs/3d-import/research.md).

- **watari-basis** (MIT, Copyright (c) 2026 yuna0x0), https://github.com/yuna0x0/watari-basis:
  the table of known VRChat, Modular Avatar, Dynamic Bone and VRM script identities in
  `packages/engine/src/unity/vrchat.ts`, and its notes on PhysBone fields and prefab overrides.
  The Unity YAML reader is our own, written with its approach in mind.
- **UniVRMExtensions** (MIT, © 2020 100の人 / esperecyan): the PhysBone → spring formulas
  (stiffness from pull, damping from spring, gravity scaled), adapted to Everloom's solver.
- **unitypackage_extractor** (MIT, Copyright 2018 Peter Fornari / "Cobertos"): the rule that
  package paths never leave the archive; reimplemented in TypeScript.
- Read for ideas only, nothing copied: VRMConverterForVRChat (MPL-2.0), Cats Blender Plugin forks
  by teamneoneko (GPL-3 LICENSE file), Avatar-Toolkit (GPL-3), BoneForge (GPL-2.0+),
  clipdecode (LGPL-2.1), PhysBone-to-DynamicBone and ShinuToki's extractor (no license).
- **ag-psd** (MIT, Copyright (c) 2016 Agamnentzar), https://github.com/Agamnentzar/ag-psd: reads
  Photoshop textures in Unity packages (flattened); loaded only when a package has one.
- **fflate** (MIT, Copyright (c) 2026 Arjun Barrett): unzips extracted Unity folders in the browser.
- **libarchive.js** 2.0.2 (MIT, Copyright (c) 2018 ნიკა / nika-begiashvili),
  https://github.com/nika-begiashvili/libarchivejs, with **libarchive** compiled to WebAssembly
  (BSD-2-Clause, Copyright (c) 2003-2018 Tim Kientzle and contributors): unpacks .zip, .7z and
  .rar archives in the browser. Its worker and WASM are copied to `apps/web/public/archive/`
  with the license.
- **Cats Blender Plugin** (MIT, Copyright (c) 2017 GiveMeAllYourCats),
  https://github.com/absolute-quantum/cats-blender-plugin: its Japanese-to-English dictionary
  (`resources/dictionary.json`) is copied unchanged to `packages/engine/src/rig/data/cats-ja-en.json`
  with its license (`LICENSE.cats.txt`) and used to translate bone names.
