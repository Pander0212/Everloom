/**
 * Picture icons for items (Everloom's bundled pixel art in /art/items/<key>.png).
 *
 * An item shows, in order: the owner's own picture ("media:<id>"), a bundled picture the owner
 * chose ("art:<key>"), the bundled picture its name matches, the one its icon key maps to, and
 * finally the line icon. With Settings › Appearance › Illustrations off, only the owner's own
 * pictures and the line icons are used.
 */

/** Every bundled picture (keep in step with apps/web/public/art/items). */
export const ITEM_ART = [
  'bread', 'cheese', 'apples', 'fish', 'flour', 'herbs', 'stew', 'ale', 'wine', 'roast-chicken', 'rations', 'waterskin', 'honey', 'carrots', 'herb-bread', 'cake',
  'sword', 'dagger', 'axe', 'leather-armor', 'shield', 'helmet', 'whetstone', 'ingot', 'rope', 'torch', 'bedroll', 'backpack', 'cloak', 'shirt', 'boots', 'hat',
  'potion-red', 'potion-blue', 'antidote', 'moonpetal', 'vial', 'arcane-dust', 'rune-stone', 'scroll', 'map', 'book', 'herbal-book', 'bandage', 'saddle', 'grain-sack', 'clay-pot', 'wool',
  'sandwich', 'coffee', 'noodles', 'eggs', 'rice', 'vegetables', 'burger', 'beer', 'cocktail', 'fries', 'water-bottle', 'energy-drink', 'fruit', 'flowers', 'fried-rice', 'omelette',
  'flashlight', 'charger', 'umbrella', 'school-bag', 'hoodie', 'jeans', 'sneakers', 'rain-jacket', 'novel', 'city-guide', 'cookbook', 'earbuds', 'power-bank', 'laptop', 'sim-card', 'pills',
  'bandage-roll', 'vitamins', 'first-aid-kit', 'baton', 'smartphone', 'key', 'coins', 'gem', 'ring', 'necklace', 'chest', 'star', 'crate', 'parcel', 'bow', 'staff',
  'ration-pack', 'hydration-pouch', 'multitool', 'beacon', 'synth-noodles', 'protein-bar', 'thermos', 'algae-flour', 'station-stew', 'fizz-drink', 'whisky', 'datapad', 'stim-injector', 'energy-cell', 'pistol',
  'armored-vest', 'alloy-plate', 'medgel', 'rad-canister', 'flight-jacket', 'mag-boots', 'algae-loaf', 'combat-stim', 'combat-knife', 'patch-kit', 'keycard', 'credit-chip', 'ore', 'logs', 'cloth', 'leather',
  'plasma-cutter', 'lantern', 'hammer', 'pickaxe', 'fishing-rod', 'shovel', 'candle', 'envelope', 'crown', 'teacup', 'mushroom', 'dice',
] as const;
export type ItemArt = (typeof ITEM_ART)[number];
const KNOWN = new Set<string>(ITEM_ART);

/** Name rules, most specific first. */
const NAME_RULES: Array<[RegExp, ItemArt]> = [
  // drinks and medicine that share words with other things
  [/\b(mana|ether|blue potion)\b/i, 'potion-blue'],
  [/\b(antidote|green potion|cure poison)\b/i, 'antidote'],
  [/\benergy (drink|tonic)\b/i, 'energy-drink'],
  [/\b(real coffee|thermos)\b/i, 'thermos'],
  [/\b(healing|health|red) (potion|draught|elixir)\b|\b(potion|draught|elixir|tonic)\b/i, 'potion-red'],
  [/\bcombat stim\b/i, 'combat-stim'],
  [/\b(stim|injector|syringe|adrenaline)\b/i, 'stim-injector'],
  [/\b(medgel|med-gel|gel)\b/i, 'medgel'],
  [/\b(rad-?away|anti-?rad)\b/i, 'rad-canister'],
  [/\b(first[- ]aid|medkit|med kit)\b/i, 'first-aid-kit'],
  [/\b(patch kit|repair kit)\b/i, 'patch-kit'],
  [/\blinen bandage\b/i, 'bandage'],
  [/\b(bandages?|gauze)\b/i, 'bandage-roll'],
  [/\b(painkillers?|pills?|aspirin|medicine)\b/i, 'pills'],
  [/\bvitamins?\b/i, 'vitamins'],
  // books before the herbs and maps they mention
  [/\b(herbalist|herbal|primer)\b/i, 'herbal-book'],
  [/\b(cookbook|recipe book)\b/i, 'cookbook'],
  [/\b(city guide|guidebook)\b/i, 'city-guide'],
  [/\b(novel|paperback)\b/i, 'novel'],
  [/\b(map|atlas|chart)\b/i, 'map'],
  [/\b(letter|envelope|invitation)\b/i, 'envelope'],
  [/\b(scroll|note)\b/i, 'scroll'],
  [/\b(book|tome|journal|diary|notebook)\b/i, 'book'],
  // food
  [/\bherb bread\b/i, 'herb-bread'],
  [/\balgae (loaf|bread)\b/i, 'algae-loaf'],
  [/\balgae flour\b/i, 'algae-flour'],
  [/\bfried rice\b/i, 'fried-rice'],
  [/\bsynth-?noodles\b/i, 'synth-noodles'],
  [/\bstation stew\b/i, 'station-stew'],
  [/\bration pack\b/i, 'ration-pack'],
  [/\brations?\b/i, 'rations'],
  [/\bomelet(te)?\b/i, 'omelette'],
  [/\b(stew|soup|broth|porridge)\b/i, 'stew'],
  [/\b(fish|salmon|trout|herring)\b/i, 'fish'],
  [/\b(chicken|drumstick|meat|steak|jerky|sausage|ham|bacon|pork|beef|lamb)\b/i, 'roast-chicken'],
  [/\bcheese\b/i, 'cheese'],
  [/\bapples?\b/i, 'apples'],
  [/\bcarrots?\b/i, 'carrots'],
  [/\bhoney\b/i, 'honey'],
  [/\bflour\b/i, 'flour'],
  [/\b(sandwich|sub|wrap)\b/i, 'sandwich'],
  [/\b(burger|hamburger)\b/i, 'burger'],
  [/\b(fries|chips)\b/i, 'fries'],
  [/\b(noodles|ramen|udon)\b/i, 'noodles'],
  [/\beggs?\b/i, 'eggs'],
  [/\brice\b/i, 'rice'],
  [/\b(vegetables?|veg|tomato|broccoli|cabbage|potato(es)?)\b/i, 'vegetables'],
  [/\b(fruit|banana|orange|grapes?|berr(y|ies)|pear|peach)\b/i, 'fruit'],
  [/\b(protein bar|energy bar|granola)\b/i, 'protein-bar'],
  [/\b(bread|loaf|bun|roll|baguette|croissant)\b/i, 'bread'],
  [/\b(cake|pie|cookie|candy|chocolate|donut|pastry|sweet)\b/i, 'cake'],
  [/\bherbs?\b/i, 'herbs'],
  // drinks
  [/\bhydration\b/i, 'hydration-pouch'],
  [/\bwaterskin\b/i, 'waterskin'],
  [/\b(water|water bottle)\b/i, 'water-bottle'],
  [/\b(tea|teacup|teapot)\b/i, 'teacup'],
  [/\b(coffee|latte|espresso|cocoa)\b/i, 'coffee'],
  [/\b(fizz|soda|cola|lemonade|juice)\b/i, 'fizz-drink'],
  [/\b(whisky|whiskey|rum|vodka|brandy|gin)\b/i, 'whisky'],
  [/\bcocktail\b/i, 'cocktail'],
  [/\bbeer\b/i, 'beer'],
  [/\b(ale|mead|cider)\b/i, 'ale'],
  [/\b(wine|mulled)\b/i, 'wine'],
  // weapons and armour
  [/\bplasma cutter\b/i, 'plasma-cutter'],
  [/\b(alloy|combat) knife\b/i, 'combat-knife'],
  [/\b(sword|blade|katana|saber|sabre|rapier|longsword)\b/i, 'sword'],
  [/\b(dagger|knife|dirk)\b/i, 'dagger'],
  [/\b(axe|hatchet)\b/i, 'axe'],
  [/\b(bow|crossbow|arrows?)\b/i, 'bow'],
  [/\bfishing rod\b/i, 'fishing-rod'],
  [/\b(staff|wand|rod|scepter|sceptre)\b/i, 'staff'],
  [/\b(pistol|gun|blaster|revolver|rifle)\b/i, 'pistol'],
  [/\b(baton|club|cudgel|bat)\b/i, 'baton'],
  [/\b(shield cell|energy cell|power cell|battery)\b/i, 'energy-cell'],
  [/\b(shield|buckler)\b/i, 'shield'],
  [/\b(crown|tiara|circlet|diadem)\b/i, 'crown'],
  [/\b(helm|helmet)\b/i, 'helmet'],
  [/\b(hat|cap|hood|beret)\b/i, 'hat'],
  [/\b(composite|armou?red|ballistic) vest\b|\bbody armou?r\b/i, 'armored-vest'],
  [/\b(armou?r|mail|cuirass|breastplate|vest)\b/i, 'leather-armor'],
  [/\bflight jacket\b/i, 'flight-jacket'],
  [/\b(rain ?jacket|raincoat|anorak)\b/i, 'rain-jacket'],
  [/\bhoodie\b/i, 'hoodie'],
  [/\b(jeans|pants|trousers)\b/i, 'jeans'],
  [/\b(cloak|cape|robe|coat)\b/i, 'cloak'],
  [/\bjacket\b/i, 'flight-jacket'],
  [/\b(shirt|tee|t-shirt|blouse|dress|tunic)\b/i, 'shirt'],
  [/\bmag(netic)? boots\b/i, 'mag-boots'],
  [/\b(sneakers|trainers|shoes)\b/i, 'sneakers'],
  [/\b(boots|sandals)\b/i, 'boots'],
  // tools, materials, valuables
  [/\bwhetstone\b/i, 'whetstone'],
  [/\b(ingot|iron bar|metal bar)\b/i, 'ingot'],
  [/\b(alloy plate|metal plate|plating)\b/i, 'alloy-plate'],
  [/\brope\b/i, 'rope'],
  [/\b(lantern|lamp)\b/i, 'lantern'],
  [/\bcandles?\b/i, 'candle'],
  [/\btorch\b/i, 'torch'],
  [/\b(pickaxe|pick)\b/i, 'pickaxe'],
  [/\b(shovel|spade)\b/i, 'shovel'],
  [/\b(hammer|mallet)\b/i, 'hammer'],
  [/\bflashlight\b/i, 'flashlight'],
  [/\b(bedroll|sleeping bag|blanket)\b/i, 'bedroll'],
  [/\bschool bag\b/i, 'school-bag'],
  [/\b(backpack|rucksack|bag|pouch|satchel)\b/i, 'backpack'],
  [/\bsaddle\b/i, 'saddle'],
  [/\b(feed|grain|oats|seed)\b/i, 'grain-sack'],
  [/\b(clay pot|pot|jar|urn|jug)\b/i, 'clay-pot'],
  [/\bwool\b/i, 'wool'],
  [/\b(hide|pelt|leather hide)\b/i, 'leather'],
  [/\b(cloth|fabric|silk|linen)\b/i, 'cloth'],
  [/\b(ore|crystal)\b/i, 'ore'],
  [/\b(wood|logs?|lumber|timber|firewood)\b/i, 'logs'],
  [/\bmoonpetal\b/i, 'moonpetal'],
  [/\b(mushrooms?|toadstool|fungus)\b/i, 'mushroom'],
  [/\b(dice|die)\b/i, 'dice'],
  [/\b(flowers?|bouquet|rose|lily|tulip)\b/i, 'flowers'],
  [/\b(dust|powder)\b/i, 'arcane-dust'],
  [/\b(rune|runestone)\b/i, 'rune-stone'],
  [/\bvial\b/i, 'vial'],
  [/\bcharger\b/i, 'charger'],
  [/\b(smartphone|phone|mobile)\b/i, 'smartphone'],
  [/\bumbrella\b/i, 'umbrella'],
  [/\b(earbuds|headphones|earphones)\b/i, 'earbuds'],
  [/\b(power bank|battery pack)\b/i, 'power-bank'],
  [/\b(laptop|computer|notebook pc)\b/i, 'laptop'],
  [/\bsim\b/i, 'sim-card'],
  [/\b(datapad|tablet)\b/i, 'datapad'],
  [/\b(multitool|toolkit|tool kit|wrench|tools?)\b/i, 'multitool'],
  [/\b(beacon|transmitter|radio)\b/i, 'beacon'],
  [/\b(keycard|access card|pass)\b/i, 'keycard'],
  [/\bkey\b/i, 'key'],
  [/\b(credit chip|chip)\b/i, 'credit-chip'],
  [/\b(coins?|gold|silver|copper|money|cash)\b/i, 'coins'],
  [/\b(gem|jewel|diamond|ruby|sapphire|emerald|pearl)\b/i, 'gem'],
  [/\bring\b/i, 'ring'],
  [/\b(necklace|amulet|pendant|locket|bracelet|earring)\b/i, 'necklace'],
  [/\b(chest|strongbox|lockbox|coffer)\b/i, 'chest'],
  [/\b(crate|box|barrel)\b/i, 'crate'],
  [/\b(parcel|package)\b/i, 'parcel'],
  [/\b(star|token|medal|trophy)\b/i, 'star'],
];

/** The line-icon keys from the engine's iconForItem, mapped to a picture. */
const ICON_TO_ART: Record<string, ItemArt> = {
  cup: 'coffee', bottle: 'water-bottle', wine: 'wine', apple: 'apples', bread: 'bread', drumstick: 'roast-chicken', cake: 'cake', soup: 'stew',
  sword: 'sword', axe: 'axe', bow: 'bow', wand: 'staff', crosshair: 'pistol', shield: 'shield', crown: 'helmet', shirt: 'shirt', footprints: 'boots',
  gem: 'gem', key: 'key', flask: 'potion-red', cross: 'first-aid-kit', book: 'book', smartphone: 'smartphone', coins: 'coins', backpack: 'backpack',
  wrench: 'multitool', boxes: 'crate', flower: 'flowers', star: 'star', package: 'parcel', sparkles: 'arcane-dust',
};

/** The bundled picture for an item, or null for the line icon. */
export function itemArtFor(icon: string | undefined, name?: string): ItemArt | null {
  if (icon?.startsWith('art:')) {
    const k = icon.slice(4);
    return KNOWN.has(k) ? (k as ItemArt) : null;
  }
  if (icon?.startsWith('media:')) return null;
  if (name) for (const [re, art] of NAME_RULES) if (re.test(name)) return art;
  return (icon && ICON_TO_ART[icon]) || null;
}

export const itemArtUrl = (k: ItemArt) => `/art/items/${k}.png`;
export const itemArtLabel = (k: string) => k.replace(/-/g, ' ');
