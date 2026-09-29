/** Item defaults: icons and deterministic effects by category/keywords. */
import type { ItemCategory, ItemEffects, EquipSlot } from './state.js';

const ICON_RULES: Array<[RegExp, string]> = [
  [/\b(tea|coffee|latte|espresso|cocoa)\b/i, 'cup'],
  [/\b(juice|soda|cola|lemonade|milk|water|drink)\b/i, 'bottle'],
  [/\b(wine|ale|beer|mead|whiskey|rum|vodka|sake)\b/i, 'wine'],
  [/\b(apple|pear|banana|orange|berry|berries|fruit|grape)\b/i, 'apple'],
  [/\b(bread|loaf|bun|roll|baguette|croissant)\b/i, 'bread'],
  [/\b(meat|steak|jerky|sausage|pork|beef|lamb|ham|bacon|chicken|drumstick|fish|salmon)\b/i, 'drumstick'],
  [/\b(cake|pie|cookie|candy|chocolate|sweet|donut)\b/i, 'cake'],
  [/\b(soup|stew|meal|dish|rice|noodle|ramen|bowl)\b/i, 'soup'],
  [/\b(sword|blade|dagger|knife|katana|saber|rapier)\b/i, 'sword'],
  [/\b(axe|hatchet)\b/i, 'axe'],
  [/\b(bow|crossbow|arrow)\b/i, 'bow'],
  [/\b(staff|wand|rod|scepter)\b/i, 'wand'],
  [/\b(gun|pistol|rifle|blaster|revolver)\b/i, 'crosshair'],
  [/\b(shield|buckler)\b/i, 'shield'],
  [/\b(helmet|helm|hat|cap|hood|crown)\b/i, 'crown'],
  [/\b(armor|armour|mail|plate|vest|cuirass)\b/i, 'shield'],
  [/\b(shirt|tee|jacket|coat|hoodie|dress|robe|cloak|pants|jeans|skirt)\b/i, 'shirt'],
  [/\b(boots|shoes|sneakers|sandals)\b/i, 'footprints'],
  [/\b(ring|necklace|amulet|pendant|earring|bracelet)\b/i, 'gem'],
  [/\b(key|keycard|pass)\b/i, 'key'],
  [/\b(potion|elixir|tonic|vial|flask)\b/i, 'flask'],
  [/\b(bandage|medkit|pill|medicine|salve|herb)\b/i, 'cross'],
  [/\b(book|tome|journal|scroll|letter|note|map)\b/i, 'book'],
  [/\b(phone|laptop|tablet|radio|device)\b/i, 'smartphone'],
  [/\b(coin|gold|gem|jewel|diamond|ruby|pearl)\b/i, 'coins'],
  [/\b(bag|backpack|pouch|chest|box|crate|satchel)\b/i, 'backpack'],
  [/\b(rope|torch|lantern|lamp|flashlight|hammer|pick|shovel|tool)\b/i, 'wrench'],
  [/\b(ore|wood|log|stone|iron|cloth|leather|thread|ingredient)\b/i, 'boxes'],
  [/\b(flower|rose|lily|bouquet)\b/i, 'flower'],
];

const CATEGORY_ICON: Record<ItemCategory, string> = {
  food: 'soup',
  drink: 'cup',
  weapon: 'sword',
  armor: 'shield',
  clothing: 'shirt',
  accessory: 'gem',
  key: 'key',
  tool: 'wrench',
  material: 'boxes',
  consumable: 'flask',
  medicine: 'cross',
  book: 'book',
  container: 'backpack',
  quest: 'star',
  valuable: 'coins',
  misc: 'package',
};

export function iconForItem(name: string, category: ItemCategory): string {
  for (const [re, icon] of ICON_RULES) if (re.test(name)) return icon;
  return CATEGORY_ICON[category] ?? 'package';
}

const CATEGORY_RULES: Array<[RegExp, ItemCategory]> = [
  [/\b(tea|coffee|juice|soda|cola|lemonade|milk|water|wine|ale|beer|mead|drink|latte|smoothie)\b/i, 'drink'],
  [/\b(bread|apple|meat|steak|cake|soup|stew|meal|rice|fish|cheese|sandwich|berries|fruit|cookie|pie|egg)\b/i, 'food'],
  [/\b(sword|dagger|axe|bow|staff|spear|gun|pistol|rifle|blade|mace|hammer of war)\b/i, 'weapon'],
  [/\b(armor|armour|shield|helmet|helm|gauntlets|mail)\b/i, 'armor'],
  [/\b(shirt|tee|jacket|coat|hoodie|dress|robe|cloak|pants|jeans|skirt|boots|shoes)\b/i, 'clothing'],
  [/\b(ring|necklace|amulet|pendant|earring|bracelet)\b/i, 'accessory'],
  [/\b(key|keycard)\b/i, 'key'],
  [/\b(potion|elixir|tonic)\b/i, 'consumable'],
  [/\b(bandage|medkit|pill|medicine|salve)\b/i, 'medicine'],
  [/\b(book|tome|journal|scroll|letter|map)\b/i, 'book'],
  [/\b(backpack|bag|pouch|chest|satchel)\b/i, 'container'],
];

export function guessCategory(name: string): ItemCategory {
  for (const [re, c] of CATEGORY_RULES) if (re.test(name)) return c;
  return 'misc';
}

export function defaultSlot(name: string, category: ItemCategory): EquipSlot | null {
  if (category === 'weapon') return 'weapon';
  if (category === 'armor') {
    if (/shield|buckler/i.test(name)) return 'offhand';
    if (/helm|hat|hood|crown/i.test(name)) return 'head';
    return 'body';
  }
  if (category === 'clothing') {
    if (/boots|shoes|sneakers|sandals/i.test(name)) return 'feet';
    if (/pants|jeans|skirt|trousers|shorts/i.test(name)) return 'legs';
    if (/hat|cap|hood/i.test(name)) return 'head';
    if (/gloves|gauntlets/i.test(name)) return 'hands';
    return 'body';
  }
  if (category === 'accessory') return 'accessory';
  return null;
}

/** Effects of using an item when none are specified explicitly. */
export function defaultEffects(name: string, category: ItemCategory): ItemEffects {
  switch (category) {
    case 'food':
      return /\b(snack|cookie|candy|apple|fruit|berries)\b/i.test(name) ? { trackers: { hunger: -12, energy: 2 } } : { trackers: { hunger: -28, energy: 4 } };
    case 'drink':
      if (/\b(coffee|espresso|energy)\b/i.test(name)) return { trackers: { hunger: -3, energy: 12 } };
      if (/\b(wine|ale|beer|mead|whiskey|rum|vodka)\b/i.test(name)) return { trackers: { hunger: -5, energy: -3 } };
      return { trackers: { hunger: -8, energy: 3 } };
    case 'medicine':
      return { bars: { hp: 25 } };
    case 'consumable':
      if (/\b(mana|ether|mp)\b/i.test(name)) return { bars: { mp: 30 } };
      if (/\b(stamina|ap)\b/i.test(name)) return { bars: { ap: 30 } };
      return { bars: { hp: 35 } };
    default:
      return {};
  }
}

export function isUsable(category: ItemCategory): boolean {
  return ['food', 'drink', 'medicine', 'consumable'].includes(category);
}
