# Unity packages and Unity files

Everloom reads Unity avatars and outfits **without Unity**: a `.unitypackage` (as sold on BOOTH and
Gumroad), a zip of an extracted folder, or the loose files. Everything runs in the browser (the
unpacking in a worker); the result is a GLB with Everloom settings, stored encrypted like any other
model. Code: `packages/engine/src/unity/` (reading and planning) and
`apps/web/src/features/avatar3d/runtime/unity/` (building the model). Research and licenses:
[research.md](research.md).

## How to import

- **An avatar:** 3D avatars › Import (or drop the files) › choose the `.unitypackage`. The sheet lists
  the avatars and outfits it found and the package's license or readme; pick one and import.
- **An outfit for it:** import the clothing package the same way and choose the avatar it's for, or
  open the avatar › Wardrobe and drop the package (or the outfit's `.prefab` with its FBX, materials
  and textures) there. It becomes a garment and an outfit linked to an inventory item of the same
  name, so the story can put it on (and a swipe takes it off again).
- **Extracted files:** a zip of the folder, a folder, or the files picked together. With their
  `.meta` files every link is exact; without them, links are made by name and folder and the sheet's
  **Link missing files** lets you check and change each one.
- **A single `.mat`:** avatar › Materials: drop it (with its texture) to apply its texture, colour and
  transparency to the material slot of the same name.

## What is read

| Unity | Everloom |
|---|---|
| `.unitypackage` (gzip + tar of GUID folders) | unpacked in a worker; at most 100 000 files, 512 MB per file, 2 GB in all; paths are names only |
| Prefabs, variants, nested prefabs, scenes | one resolved object tree with every modification applied |
| Inactive objects in the prefab | wardrobe parts, off |
| `m_BlendShapeWeights` set in the prefab | the model's default shape **and** the body slider values (garments with the same shapes follow) |
| Materials on each renderer, or the FBX's remapped materials (`externalObjects`), or by name | GLB materials + Everloom toon details |
| `.fbx.meta` `humanDescription.human` | the bone map (it beats the automatic mapping) |
| `.fbx.meta` `internalIDToNameTable` / `fileIDToRecycleName` | which FBX node each prefab reference means |
| VRChat avatar descriptor: visemes | `aa`, `ih`, `ou`, `ee` (`E`), `oh` lip-sync shapes |
| VRChat descriptor: eyelids (`eyelidsBlendshapes`) | blink |
| VRChat descriptor: view position, animation layers | eye height in the report; FX/Gesture states listed |
| VRCPhysBone, Dynamic Bone | spring chains (see below) |
| VRCPhysBoneCollider, Dynamic Bone colliders | replaced by colliders made from the body (reported) |
| VRChat contacts | skipped (reported) |
| Modular Avatar Merge Armature | outfit bones renamed to the avatar's (prefix and suffix removed) |
| Modular Avatar Object Toggle (+ Menu Item label) | a wardrobe part with that name |
| Modular Avatar Blendshape Sync | the outfit follows the body's shapes |
| Other Modular Avatar components (menus, animators, parameters) | skipped (reported) |
| `.anim` with only blendshape curves | an expression (by the clip's or gesture state's name: smile → joy, angry → anger, …) |
| `.anim` with transform curves | an Everloom motion (retargeted on the model's own skeleton) |
| `.anim` with humanoid muscle curves | listed as "needs retarget" |
| `.controller` states | listed as emotes and gestures |
| C# scripts, DLLs, shaders, sounds, scenes | listed and skipped |
| PNG, JPEG, WebP, TGA, PSD (flattened) textures, with sRGB/normal-map settings from `.meta` | textures |

Components are recognised by known script GUIDs (VRChat SDK, Modular Avatar, Dynamic Bone, VRM) and,
for anything else, by the fields they serialize, so newer SDK versions still import.

## Materials

| Shader | Carried over |
|---|---|
| lilToon | main texture and colour, cutout/transparent (`_TransparentMode`), cull, normal map, emission, shadow colour and border, rim, matcap, outline colour and width |
| Poiyomi | main texture and colour, alpha mode, normal map, emission, shadow colour, rim, outline |
| MToon | main texture and colour, alpha mode, shade colour and shift, outline |
| UTS | base and first shade colour, step |
| Standard | albedo and colour, rendering mode, normal map, emission |
| Anything else | main texture and colour with Everloom's toon shading (noted in the report) |

Colours are stored as authored (sRGB) and converted to linear for three.js. The toon look reads the
imported shadow, rim and outline colours from the GLB's material extras.

## PhysBones → springs

| PhysBone | Everloom spring |
|---|---|
| `pull` × 4 + `stiffness` × 2 | stiffness (0–8) |
| 1 − `spring` × 0.8 | damping |
| `gravity` × 2 | gravity (0–4) |
| `radius` | collision radius |
| root's name | kind: chest (breast, 胸, おっぱい…), tail, hair, cloth (skirt, スカート…), accessory |
| `ignoreTransforms` | left out of the chain |
| angle limits, curves | approximated (noted) |

Dynamic Bone: elasticity × 4 + stiffness × 2 → stiffness; damping → damping; −gravity.y × 4 → gravity.

## Licenses of what you import

Bought and downloaded avatars and outfits are marked **third-party asset, personal use**. The import
report and the package's own license or readme are saved with the avatar (avatar › Export). They stay
out of bundles, library exports and packs unless you switch on "I have the right to share this
avatar" there; exporting a GLB or VRM for yourself keeps the original license and shows a warning.
The rule is in `apps/server/src/services/avatars/third-party.ts`.

## Test packages

`tests/fixtures/unity/` holds Everloom's own packages (CC0, made from Everloom's test models by
`tools/avatars/unity-fixture.py` and `tools/avatars/make-unity-fixture.ts`): an avatar laid out like a
VRChat one and a shirt made for it, plus the avatar as extracted files with and without `.meta` files.
