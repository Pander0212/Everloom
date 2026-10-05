# Art plan (Phase 4, part 7)

Budget: NanoGPT 95 images per UTC day (subscription), ElectronHub $2.00 (standard models). Order
follows the brief's priorities; if the day's images run out, the rest waits for the next day or is
left to the vector fallbacks. Nothing in the app depends on a picture being present.

## 0. Compare models (about 12 NanoGPT calls, about $0.15 ElectronHub)

The same three briefs on each text-to-image model:

1. a 4×4 pixel-art item icon sheet (8 fantasy items, to judge layout and pixel quality),
2. an anime character bust (all-ages, plain background),
3. a 16:9 empty scene background (a fantasy tavern).

Models: `qwen-image`, `hidream`, `z-image-turbo`, `chroma` (NanoGPT); one or two anime SDXL / Neta
Lumina calls on ElectronHub for the character brief. Then one `step-image-edit-2` expression edit
of the best bust. Results and the choice per category go to `STYLE.md`.

## 1. Item icons (8 sheets × 16 = 128 icons, about 12 calls with retries)

Pixel-art icons, one grid (32×32, shown at 2× or 3×), one palette (`STYLE.md`), 1 px dark outline.
Sheets are cut by finding each icon on the flat background, not by fixed cells; then snapped to
the pixel grid, quantised to the palette, and given a transparent background.

The sheets cover every item the app ships (shop catalogues, crafting results and ingredients, in
all three genres) and the 31 generic icon keys of `iconForItem`:

- **A, fantasy food:** bread loaf, cheese wedge, red apples, salted fish, flour sack, herb bundle,
  bowl of stew, mug of ale, goblet of wine, roast chicken, travel rations, waterskin, honey jar,
  carrots, herb bread, slice of cake
- **B, fantasy gear:** iron sword, iron dagger, hand axe, leather armour, iron shield, iron helm,
  whetstone, iron ingot, coil of rope, torch, bedroll, backpack, wool cloak, linen shirt, leather
  boots, travel hat
- **C, fantasy magic, medicine and books:** red potion, blue potion, green antidote, moonpetal
  flower, empty vial, pouch of arcane dust, rune stone, scroll, map, closed book, herbal book, linen
  bandage, saddle, feed sack, clay pot, wool bundle
- **D, modern food:** sandwich, coffee cup, instant noodles, egg carton, rice bag, vegetables,
  burger, beer bottle, cocktail, fries, water bottle, energy drink, fruit, flower bouquet, fried
  rice, omelette
- **E, modern things:** flashlight, phone charger, umbrella, modern backpack, hoodie, jeans,
  sneakers, rain jacket, paperback, city guide, cookbook, earbuds, power bank, laptop, SIM card,
  pill bottle
- **F, modern medicine and generic:** bandage roll, vitamins, first-aid kit, baton, smartphone, key,
  gold coins, gem, ring, necklace, treasure chest, quest star, wooden crate, parcel, wooden bow,
  magic staff
- **G, sci-fi 1:** ration pack, hydration pouch, multitool, emergency beacon, synth noodles,
  protein bar, coffee flask, algae flour, station stew, fizzy drink, whisky, datapad, stim injector,
  shield cell, plasma cutter, pulse pistol
- **H, sci-fi 2:** composite vest, alloy plate, medgel, rad-away, flight jacket, mag boots, algae
  loaf, combat stim, alloy knife, patch kit, keycard, credit chip, ore chunk, wood logs, cloth bolt,
  leather hide

Wiring: a picture is chosen by item name (specific rules), then category, then the generic icon
key; the Lucide line icon stays the fallback. The owner can pick any icon (bundled or uploaded to
the asset library) per item.

## 2. Backgrounds (12–15 calls)

16:9 empty scenes, anime-illustrated, no people: fantasy (tavern, forest road, town square, castle
hall, cottage interior), modern (café, city street at dusk, apartment, park), sci-fi (station
corridor, ship bridge, market deck). The owner adds them to the asset library with one button
("Add Everloom's starter art"). From there they're ordinary assets: usable on the stage, replaceable,
deletable.

## 3. Avatars (8–10 calls)

Default portraits for new characters and personas (all-ages, varied, original): four or so in each
broad look, as the character and persona pickers' suggestions.

## 4. Demo character with expressions (1 base + about 8 edits)

An original all-ages character ("Mira", a cartographer), shipped as an importable demo card with
an expression set made by `step-image-edit-2` from one neutral base: neutral, joy, amusement,
surprise, sadness, anger, embarrassment, curiosity (others fall back to the closest).

## 5. Genre cards and empty states (3 + about 6 calls)

Genre cards for the new-game picker (fantasy, modern, sci-fi). Small spot illustrations for the
main empty states (no characters, no chats, no lore, empty inventory, no memories, search with no
results).

## 6. Helper, enemies, map thumbnails (if images remain)

Helper sprites for Pip (idle, thinking, cheering); a few enemy portraits by keyword (wolf, bandit,
slime, drone, security bot, wyvern); map thumbnails per genre.

## Processing and size

WebP (quality about 80) plus AVIF for the large pictures, served through `<picture>` with WebP as
the fallback `<img>`. Everything lazy-loaded with explicit sizes. Target is about 15 MB in total; icons
are tiny PNG/WebP sprites. A setting, Appearance › "Show illustrations", turns all bundled art off;
the app then shows the vector icons and plain surfaces it had before.
