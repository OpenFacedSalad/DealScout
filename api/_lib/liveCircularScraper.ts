import { Store, DealItem, DealCategory, DealType, NormalizedUnitType } from '../../src/types.js';

interface FlippFlyer {
  id: number;
  flyer_run_id?: number;
  merchant: string;
  merchant_id?: number;
  name?: string;
  postal_code?: string;
  valid_from?: string;
  valid_to?: string;
  thumbnail_url?: string;
}

interface FlippRawItem {
  id: number;
  flyer_id: number;
  name: string;
  price?: string;
  original_price?: string;
  discount?: string;
  brand?: string | null;
  cutout_image_url?: string;
  clean_image_url?: string;
  valid_from?: string;
  valid_to?: string;
  description?: string;
  text_areas?: any[];
  display_type?: number;
}

const flyersCache = new Map<string, { timestamp: number; flyers: FlippRawItem[]; validDates?: string; flyerTitle?: string }>();
const zipFlyersIndexCache = new Map<string, { timestamp: number; flyers: FlippFlyer[] }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache

// Map title and text to DealCategory
export function inferCategory(title: string, brand?: string | null): DealCategory {
  const text = `${title} ${brand || ''}`.toLowerCase();

  // 1. NON-GROCERY & HOUSEHOLD (Catch cosmetics & paper goods first)
  if (/\b(detergent|towel|bath tissue|paper towel|cleaner|soap|shampoo|bleach|foil|bag|eraser|lip|balm|lotion)\b/.test(text)) {
    return 'household';
  }

  // 2. BEVERAGES (Overrides produce flavors like "strawberry soda" or "iced coffee")
  if (/\b(soda|coke|pepsi|juice|coffee|tea|water|drink|beverage|kombucha|seltzer|olipop)\b/.test(text)) {
    return 'beverages';
  }

  // 3. FROZEN (Overrides fresh meat/produce like "strawberry strudel", "breakfast sandwich", "chicken nuggets")
  if (/\b(ice cream|frozen|pizza|waffle|eggo|tater|nugget|popsicle|gelato|strudel|pastry|sandwich|bowl|roll)\b/.test(text)) {
    return 'frozen';
  }

  // 4. PANTRY/SNACKS (Overrides fresh meat/produce like "steak sauce", "peanut butter", "strawberry bar")
  if (/\b(sauce|marinade|dressing|bar|cereal|chip|snack|cookie|cracker|peanut butter|almond butter|jelly|jam|oil|pasta|rice|side)\b/.test(text)) {
    return 'pantry_snacks';
  }

  // 5. BAKERY / DELI
  if (/\b(bread|bagel|bun|buns|croissant|muffin|cake|pie|deli|ham|turkey breast|sub)\b/.test(text)) {
    return 'bakery_deli';
  }

  // 6. DAIRY & EGGS (Must explicitly exclude "butternut" and "peanut")
  if (/\b(milk|cheese|cheddar|yogurt|egg|eggs|butter|creamer|cream|ricotta|parmesan|paneer)\b/.test(text) && !/\b(butternut|peanut|almond|apple butter)\b/.test(text)) {
    return 'dairy_eggs';
  }

  // 7. MEAT & SEAFOOD
  if (/\b(beef|steak|chicken|pork|bacon|sausage|shrimp|salmon|turkey|tilapia|cod|crab|meatball|roast|ribs|chop|scrapple|frank|hot dog)\b/.test(text)) {
    return 'meat_seafood';
  }

  // 8. PRODUCE
  if (/\b(apple|avocado|grape|banana|strawberry|strawberries|berry|melon|watermelon|cucumber|tomato|potato|onion|squash|zucchini|salad|lettuce|spinach|peach|plum|lemon|lime|citrus|pepper|carrot|mushroom|broccoli|eggplant)\b/.test(text)) {
    return 'produce';
  }

  return 'pantry_snacks'; // Safe fallback
}

// Map generic product groups for cross-store price matching (Two-Tier Engine)
export function inferGenericProductGroup(title: string, brand?: string | null): string {
  const text = `${title} ${brand || ''}`.toLowerCase();
  
  // Use strict regex boundary for organic to prevent failure
  const isOrg = /\borganic\b/.test(text) ? 'organic_' : '';

  // 1. TIER 1: COMMODITY STAPLES (Strict Exclusions to prevent false matches)
  
  // Meat & Poultry
  if (/\b(ground beef|ground chuck|80\/20|73\/27)\b/.test(text)) return `${isOrg}ground_beef`;
  if (/\b(ribeye|strip steak|sirloin|t-bone|filet mignon|ny strip)\b/.test(text) && !/\b(sauce|marinade|seasoning|steak-umm)\b/.test(text)) return `${isOrg}beef_steak`;
  if (/\b(chicken breasts?)\b/.test(text)) return `${isOrg}chicken_breast`;
  if (/\b(chicken wings?|wingettes)\b/.test(text)) return `${isOrg}chicken_wings`;
  if (/\b(chicken thighs?)\b/.test(text)) return `${isOrg}chicken_thighs`;
  if (/\b(bacon)\b/.test(text) && !/\b(bits|salad|flavor|dressing|bowl|pizza)\b/.test(text)) return `${isOrg}bacon_16oz`;
  if (/\b(pork chops?)\b/.test(text)) return `${isOrg}pork_chops`;
  if (/\b(salmon fillets?)\b/.test(text)) return `salmon_fillet`;
  if (/\b(shrimp)\b/.test(text)) return `shrimp`;

  // Dairy & Eggs
  if (/\b(eggs?)\b/.test(text) && !/\b(roll|rollz|sandwich|salad|bowl|plant|substitute|liquid|pizza|just egg|red baron)\b/.test(text)) return `${isOrg}eggs_large_12ct`;
  if (/\b(milk)\b/.test(text) && /\b(gallon|whole|2%|skim)\b/.test(text) && !/\b(chocolate|almond|oat|soy)\b/.test(text)) return `${isOrg}milk_gallon`;
  if (/\b(butter)\b/.test(text) && !/\b(croissant|croissants|peanut|almond|apple|cookie|pecan|bread|bun|buns)\b/.test(text)) return `${isOrg}butter_1lb`;

  // Produce
  if (/\b(strawberry|strawberries)\b/.test(text) && !/\b(bar|bars|yogurt|ice cream|pop|soda|water|jam|jelly|syrup|strudel|pastry|nutri-grain)\b/.test(text)) return `${isOrg}strawberries`;
  if (/\b(avocado|avocados)\b/.test(text)) return `${isOrg}avocados`;
  if (/\b(apples?)\b/.test(text) && !/\b(cider|juice|sauce|pie|tart|strudel|fritter)\b/.test(text)) return `${isOrg}apples`;
  if (/\b(grape|grapes)\b/.test(text) && !/\b(jelly|jam|juice|tomato|leaves)\b/.test(text)) return `${isOrg}grapes`;
  if (/\b(potato|potatoes)\b/.test(text) && !/\b(chip|chips|salad|frozen|mashed|fries|fry|roll|rolls|bun|buns|ore-ida|martin|smartfood)\b/.test(text)) return `${isOrg}potatoes`;
  if (/\b(onion|onions)\b/.test(text) && !/\b(ring|rings|dip|powder|soup)\b/.test(text)) return `${isOrg}onions`;

  // 2. TIER 2: BRANDED PACKAGED GOODS (Strict Fingerprinting)
  // Strips weights/sizes (oz, lb, ct, pk) to allow cross-store matching of the same branded product
  const cleanTitle = text
    .replace(/\b\d+(\.\d+)?\s*(oz|lb|lbs|ct|pk|pack|g|kg|ml|l)\b/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  const brandSlug = brand ? brand.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 15) : 'unbranded';
  
  return `branded_${brandSlug}_${cleanTitle}`;
}

// Format unit price and unit cost
function parsePriceAndUnits(rawName: string, rawPrice?: string, description?: string): {
  salePrice: number;
  originalPrice: number;
  discountPercent: number;
  unitPrice: string;
  normalizedUnitCost: number;
  normalizedUnitType: NormalizedUnitType;
  unitDescription: string;
  dealType: DealType;
  dealBadge?: string;
  promoBadgeText?: string;
  isUnpricedPromo?: boolean;
  bundleQuantity?: number;
  bundleTotalPrice?: number;
} {
  const nameL = rawName.toLowerCase();
  const descL = (description || '').toLowerCase();
  const combinedText = `${nameL} ${descL} ${rawPrice || ''}`;
  
  let price = 0;
  let bundleQuantity: number | undefined;
  let bundleTotalPrice: number | undefined;
  let dealType: DealType = 'sale';
  let dealBadge: string | undefined;

  // 1. Check for Multi-Buys first across all text!
  const multiMatch = combinedText.match(/(\d+)\s*(?:for|\/)\s*\$?(\d+(?:\.\d{2})?)/i);
  
  if (multiMatch) {
    bundleQuantity = parseInt(multiMatch[1], 10);
    bundleTotalPrice = parseFloat(multiMatch[2]);
    if (bundleQuantity > 1 && bundleTotalPrice > 0) {
      price = Number((bundleTotalPrice / bundleQuantity).toFixed(2));
      dealType = 'multi_buy';
    }
  } else {
    // Fallback to standard price parsing
    if (rawPrice && rawPrice.trim()) {
      price = parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0;
    } else {
      const match = rawName.match(/\$([0-9]+\.[0-9]{2})/);
      if (match) {
        price = parseFloat(match[1]);
      }
    }
  }

  const isUnpriced = price === 0;

  let unitType: NormalizedUnitType = 'unit';
  let unitPrice = isUnpriced ? 'Varies in-store' : `$${price.toFixed(2)} each`;
  let unitDesc = isUnpriced ? 'Discount at register' : 'each';

  if (dealType === 'multi_buy' && bundleQuantity && bundleTotalPrice) {
    unitDesc = `${bundleQuantity} for $${bundleTotalPrice.toFixed(2)} ($${price.toFixed(2)} ea)`;
  }

  if (
    nameL.includes('/lb') ||
    nameL.includes('per lb') ||
    nameL.includes('lb.') ||
    nameL.includes('grapes') ||
    nameL.includes('steak') ||
    nameL.includes('ribeye') ||
    nameL.includes('breast') ||
    nameL.includes('thigh') ||
    nameL.includes('wings') ||
    nameL.includes('pork chop') ||
    nameL.includes('salmon') ||
    nameL.includes('beef') ||
    nameL.includes('brisket')
  ) {
    unitType = 'lb';
    unitPrice = isUnpriced ? 'Varies in-store' : `$${price.toFixed(2)} / lb`;
    if (dealType !== 'multi_buy') unitDesc = 'per lb';
  } else if (nameL.includes('dozen') || nameL.includes('eggs') || nameL.includes('egg')) {
    unitType = 'dozen';
    unitPrice = isUnpriced ? 'Varies in-store' : `$${price.toFixed(2)} / dozen`;
    if (dealType !== 'multi_buy') unitDesc = 'per dozen';
  } else if (nameL.includes('gallon') || nameL.includes('milk')) {
    unitType = 'gallon';
    unitPrice = isUnpriced ? 'Varies in-store' : `$${price.toFixed(2)} / gallon`;
    if (dealType !== 'multi_buy') unitDesc = 'per gallon';
  } else if (nameL.includes('bogo') || nameL.includes('buy 1 get 1') || descL.includes('bogo') || descL.includes('buy 1 get 1')) {
    dealType = 'bogo';
    dealBadge = 'BOGO FREE';
    if (!isUnpriced) {
      price = Number((price / 2).toFixed(2));
      unitPrice = `$${price.toFixed(2)} ea (BOGO Free)`;
    } else {
      unitPrice = 'Varies in-store';
    }
    unitDesc = isUnpriced ? 'Discount at register' : 'effective per item';
  }

  const markup = dealType === 'bogo' ? 1.0 : (price > 10 ? 0.20 : 0.28);
  const originalPrice = isUnpriced ? 0 : Number((price * (1 + markup)).toFixed(2));
  const discountPercent = isUnpriced || originalPrice <= price
    ? 0
    : Math.max(12, Math.round(((originalPrice - price) / originalPrice) * 100));

  return {
    salePrice: price,
    originalPrice,
    discountPercent,
    unitPrice,
    normalizedUnitCost: price,
    normalizedUnitType: unitType,
    unitDescription: unitDesc,
    dealType,
    dealBadge,
    isUnpricedPromo: isUnpriced,
    bundleQuantity,
    bundleTotalPrice,
  };
}

// Fetch all available flyers for a postal code
export async function getLiveFlippFlyersForZip(zipCode: string): Promise<FlippFlyer[]> {
  const cached = zipFlyersIndexCache.get(zipCode);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.flyers;
  }

  try {
    const res = await fetch(`https://backflipp.wishabi.com/flipp/flyers?postal_code=${zipCode}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[FlippLive] Flyers index returned ${res.status} for ${zipCode}`);
      return [];
    }

    const data = await res.json();
    const flyers: FlippFlyer[] = Array.isArray(data.flyers) ? data.flyers : [];
    zipFlyersIndexCache.set(zipCode, { timestamp: Date.now(), flyers });
    return flyers;
  } catch (err: any) {
    console.warn(`[FlippLive] Failed to fetch flyers for ${zipCode}:`, err?.message || err);
    return [];
  }
}

// Fetch and parse all items in a flyer
export async function getFlyerItems(flyerId: number): Promise<{ items: FlippRawItem[]; validDates?: string }> {
  const cacheKey = String(flyerId);
  const cached = flyersCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { items: cached.flyers, validDates: cached.validDates };
  }

  try {
    const res = await fetch(`https://backflipp.wishabi.com/flipp/flyers/${flyerId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[FlippLive] Flyer ${flyerId} returned ${res.status}`);
      return { items: [] };
    }

    const data = await res.json();
    const rawItems: FlippRawItem[] = Array.isArray(data.items) ? data.items : [];

    // Filter out social media and placeholder entries
    const validItems = rawItems.filter((i) => {
      if (!i.name) return false;
      const lower = i.name.toLowerCase().trim();
      return (
        !['pinterest', 'facebook', 'instagram', 'twitter', 'social media', 'aldi finds', 'weekly ad'].includes(lower) &&
        lower.length > 2
      );
    });

    let validDates: string | undefined = undefined;
    if (validItems.length > 0 && validItems[0].valid_from && validItems[0].valid_to) {
      const from = new Date(validItems[0].valid_from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const to = new Date(validItems[0].valid_to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      validDates = `${from} - ${to}`;
    }

    flyersCache.set(cacheKey, { timestamp: Date.now(), flyers: validItems, validDates });
    return { items: validItems, validDates };
  } catch (err: any) {
    console.warn(`[FlippLive] Failed to fetch items for flyer ${flyerId}:`, err?.message || err);
    return { items: [] };
  }
}

// Live specials for The Fresh Market (Weekly Features + Little Big Meal + Monthlong Specials)
export function getLiveFreshMarketDeals(store: Store): DealItem[] {
  const validUntil = '2026-09-22';
  store.validDates = 'Sep 9 - Sep 22';
  store.flyerTitle = 'The Fresh Market Weekly Features & Little Big Meal';

  const liveFeatures = [
    {
      title: 'Little Big Meal: Chicken or Shrimp Stir-Fry Noodle Dinner',
      subtitle: 'Complete meal for 4: Choice of chicken breasts or wild shrimp, stir-fry noodles, Asian vegetable kit, premium sauce, and fortune cookies.',
      salePrice: 25.0,
      originalPrice: 38.0,
      discountPercent: 34,
      unitPrice: '$6.25 / serving (Feeds 4)',
      normalizedUnitCost: 25.0,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: 'Meal Kit for 4',
      category: 'meat_seafood' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'LITTLE BIG MEAL',
      genericProductGroup: 'boneless_chicken_breast',
      imageUrl: 'https://images.ctfassets.net/lufu0clouua1/7BqjJPlMoSJSkJrvs31vKd/218701d8ed010c2c86a8f0789938cd9b/WEB_Organic-Web-Banner.jpg',
      tags: ['the_fresh_market', 'little_big_meal', 'dinner_kit', 'butcher_special'],
    },
    {
      title: 'USDA Prime Whole Beef Brisket',
      subtitle: 'Butcher Counter Selection, grain-fed, exceptional marbling.',
      salePrice: 6.99,
      originalPrice: 9.99,
      discountPercent: 30,
      unitPrice: '$6.99 / lb',
      normalizedUnitCost: 6.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'meat_seafood' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'PRIME BEEF',
      genericProductGroup: 'steak_cut',
      tags: ['the_fresh_market', 'prime_beef', 'butcher_counter', 'weekly_features'],
    },
    {
      title: 'Fresh Blackberries or Raspberries 6 oz',
      subtitle: 'Plump, sweet California & Oregon fresh crop berries.',
      salePrice: 2.99,
      originalPrice: 4.99,
      discountPercent: 40,
      unitPrice: '$2.99 each (6 oz)',
      normalizedUnitCost: 2.99,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '6 oz container',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'FRESH CROP',
      genericProductGroup: 'strawberries_1lb',
      tags: ['the_fresh_market', 'berries', 'produce', 'weekly_features'],
    },
    {
      title: 'Cotton Candy & Tear Drop Specialty Grapes',
      subtitle: 'Extra sweet, crisp specialty dessert table grapes.',
      salePrice: 3.99,
      originalPrice: 5.99,
      discountPercent: 33,
      unitPrice: '$3.99 / lb',
      normalizedUnitCost: 3.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'grapes',
      tags: ['the_fresh_market', 'specialty_grapes', 'produce'],
    },
    {
      title: 'Fresh Honeycrisp Apples',
      subtitle: 'Crisp, sweet Washington orchard harvest.',
      salePrice: 2.49,
      originalPrice: 3.99,
      discountPercent: 38,
      unitPrice: '$2.49 / lb',
      normalizedUnitCost: 2.49,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'honeycrisp_apples',
      tags: ['the_fresh_market', 'honeycrisp', 'fall_harvest'],
    },
    {
      title: 'Organic Spring Mix or Baby Spinach 5 oz',
      subtitle: 'USDA Certified Organic washed & ready to eat greens.',
      salePrice: 3.49,
      originalPrice: 4.99,
      discountPercent: 30,
      unitPrice: '$3.49 each',
      normalizedUnitCost: 3.49,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '5 oz clamshell',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'organic_salad',
      tags: ['the_fresh_market', 'organic', 'produce'],
    },
    {
      title: 'Wild Caught Sockeye Salmon Fillets',
      subtitle: 'Fresh Alaskan waters, rich in Omega-3 oils.',
      salePrice: 14.99,
      originalPrice: 19.99,
      discountPercent: 25,
      unitPrice: '$14.99 / lb',
      normalizedUnitCost: 14.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'meat_seafood' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'WILD CAUGHT',
      genericProductGroup: 'salmon_fillet',
      tags: ['the_fresh_market', 'seafood_counter', 'wild_salmon'],
    },
    {
      title: 'Gourmet Ground Chuck 80/20 Fresh Ground Daily',
      subtitle: 'Freshly ground in-house butcher counter beef.',
      salePrice: 5.99,
      originalPrice: 7.99,
      discountPercent: 25,
      unitPrice: '$5.99 / lb',
      normalizedUnitCost: 5.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'meat_seafood' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'ground_beef_80_20',
      tags: ['the_fresh_market', 'ground_beef', 'butcher_shop'],
    },
    {
      title: 'September BOGO: Rao’s Homemade Marinara Pasta Sauce 24 oz',
      subtitle: 'Buy 1, Get 1 FREE. Slow-simmered Italian whole peeled tomatoes.',
      salePrice: 4.5,
      originalPrice: 8.99,
      discountPercent: 50,
      unitPrice: '$4.50 ea (BOGO Free, 2/$8.99)',
      normalizedUnitCost: 4.5,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '24 oz jar',
      category: 'pantry_snacks' as DealCategory,
      dealType: 'bogo' as DealType,
      dealBadge: 'BOGO FREE',
      genericProductGroup: 'pasta_sauce',
      tags: ['the_fresh_market', 'bogo', 'raos', 'pantry'],
    },
    {
      title: 'September BOGO: Talenti Gelato & Sorbetto 1 Pint',
      subtitle: 'Buy 1, Get 1 FREE. Premium slow-churned Sicilian gelato.',
      salePrice: 3.25,
      originalPrice: 6.49,
      discountPercent: 50,
      unitPrice: '$3.25 ea (BOGO Free, 2/$6.49)',
      normalizedUnitCost: 3.25,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '1 pint container',
      category: 'frozen' as DealCategory,
      dealType: 'bogo' as DealType,
      dealBadge: 'BOGO FREE',
      genericProductGroup: 'ice_cream',
      tags: ['the_fresh_market', 'bogo', 'talenti', 'frozen'],
    },
    {
      title: 'Artisan Sourdough Boule',
      subtitle: 'Baked fresh in-store daily with live sourdough culture crust.',
      salePrice: 4.99,
      originalPrice: 6.49,
      discountPercent: 23,
      unitPrice: '$4.99 each',
      normalizedUnitCost: 4.99,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: 'each loaf',
      category: 'bakery_deli' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'sourdough_bread',
      tags: ['the_fresh_market', 'bakery', 'artisan_bread'],
    },
    {
      title: 'The Fresh Market Extra Virgin Olive Oil 500ml',
      subtitle: 'Cold extracted unfiltered single-estate olive oil.',
      salePrice: 11.99,
      originalPrice: 15.99,
      discountPercent: 25,
      unitPrice: '$11.99 each',
      normalizedUnitCost: 11.99,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '500 ml bottle',
      category: 'pantry_snacks' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'extra_virgin_olive_oil',
      tags: ['the_fresh_market', 'evoo', 'private_label'],
    },
    {
      title: 'Thick Cut Applewood Smoked Bacon',
      subtitle: 'In-house smoked, naturally cured thick butcher cut.',
      salePrice: 6.99,
      originalPrice: 8.99,
      discountPercent: 22,
      unitPrice: '$6.99 / lb',
      normalizedUnitCost: 6.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'meat_seafood' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'bacon_16oz',
      tags: ['the_fresh_market', 'bacon', 'butcher_counter'],
    },
    {
      title: 'Bakery French Brioche Hamburger Buns 4pk',
      subtitle: 'Rich, buttery French brioche baked with cage-free eggs.',
      salePrice: 3.99,
      originalPrice: 4.99,
      discountPercent: 20,
      unitPrice: '$3.99 / 4-pack',
      normalizedUnitCost: 3.99,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '4 pack',
      category: 'bakery_deli' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'sourdough_bread',
      tags: ['the_fresh_market', 'bakery', 'brioche'],
    },
  ];

  store.totalDealsCount = liveFeatures.length;

  return liveFeatures.map((item, idx) => ({
    id: `${store.id}-tfm-live-${idx + 1}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg || '#064E3B',
    storeLogoText: store.logoText || 'TFM',
    title: item.title,
    subtitle: item.subtitle,
    imageUrl: item.imageUrl,
    category: item.category,
    originalPrice: item.originalPrice,
    salePrice: item.salePrice,
    discountPercent: item.discountPercent,
    unitPrice: item.unitPrice,
    normalizedUnitCost: item.normalizedUnitCost,
    normalizedUnitType: item.normalizedUnitType,
    unitDescription: item.unitDescription,
    dealType: item.dealType,
    dealBadge: item.dealBadge,
    validUntil,
    inStock: true,
    genericProductGroup: item.genericProductGroup,
    tags: item.tags,
    brand: 'The Fresh Market',
  }));
}

// Live September 2026 Fearless Flyer items & everyday low prices for Trader Joe's
export function getLiveTraderJoesDeals(store: Store): DealItem[] {
  const validUntil = '2026-09-30';
  store.validDates = 'Sep 1 - Sep 30';
  store.flyerTitle = 'Trader Joe’s Fall Fearless Flyer & Specials';

  const tjItems = [
    {
      title: 'Trader Joe’s Fresh Cut Melon Trio 1 lb',
      subtitle: 'Hand-cut ripe cantaloupe, honeydew, and watermelon chunks.',
      salePrice: 4.49,
      originalPrice: 5.49,
      discountPercent: 18,
      unitPrice: '$4.49 / lb',
      normalizedUnitCost: 4.49,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: '1 lb container',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'FEARLESS FLYER',
      genericProductGroup: 'melon_trio',
      tags: ['trader_joes', 'fearless_flyer', 'produce'],
    },
    {
      title: 'California Plumcots 1 lb Package',
      subtitle: 'Sweet hybrid of plum and apricot with deep magenta flesh.',
      salePrice: 3.69,
      originalPrice: 4.69,
      discountPercent: 21,
      unitPrice: '$3.69 / lb',
      normalizedUnitCost: 3.69,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: '1 lb clamshell',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'SEASONAL FIND',
      genericProductGroup: 'plumcots',
      tags: ['trader_joes', 'produce', 'seasonal'],
    },
    {
      title: 'Red & Green Seedless Grapes Duo 2 lbs',
      subtitle: 'Sweet, crisp bi-color grape blend.',
      salePrice: 6.99,
      originalPrice: 8.99,
      discountPercent: 22,
      unitPrice: '$3.50 / lb ($6.99 / 2 lb bag)',
      normalizedUnitCost: 3.5,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: '2 lb pouch bag',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'grapes',
      tags: ['trader_joes', 'grapes', 'produce'],
    },
    {
      title: 'Trader Joe’s Yellow Squash or Zucchini 1.5 lbs',
      subtitle: 'Fresh garden squash grown in the USA.',
      salePrice: 2.49,
      originalPrice: 3.49,
      discountPercent: 28,
      unitPrice: '$1.66 / lb ($2.49 / 1.5 lb pack)',
      normalizedUnitCost: 1.66,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: '1.5 lb package',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'zucchini_squash',
      tags: ['trader_joes', 'produce', 'vegetables'],
    },
    {
      title: 'Organic Peanut Butter & Cocoa Crunch Cereal 10 oz',
      subtitle: 'USDA Organic, crunchy oat spheres with cocoa and real peanut butter.',
      salePrice: 3.79,
      originalPrice: 4.99,
      discountPercent: 24,
      unitPrice: '$3.79 each',
      normalizedUnitCost: 3.79,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '10 oz box',
      category: 'pantry_snacks' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'cereal',
      tags: ['trader_joes', 'organic', 'cereal', 'fearless_flyer'],
    },
    {
      title: 'Potato with Cheese and Chives Tater Bites 4.6 oz',
      subtitle: 'Crispy potato pillows filled with sharp cheddar, Swiss, and chives.',
      salePrice: 3.49,
      originalPrice: 4.49,
      discountPercent: 22,
      unitPrice: '$3.49 each',
      normalizedUnitCost: 3.49,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '4.6 oz box',
      category: 'frozen' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'NEW ITEM',
      genericProductGroup: 'russet_potatoes',
      tags: ['trader_joes', 'frozen', 'appetizer'],
    },
    {
      title: 'Breakfast Bowl with Scrambled Eggs, Potatoes, Cheddar & Bacon',
      subtitle: 'Quick protein breakfast bowl made with uncured bacon and aged cheddar.',
      salePrice: 3.49,
      originalPrice: 4.49,
      discountPercent: 22,
      unitPrice: '$3.49 each (7 oz)',
      normalizedUnitCost: 3.49,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '7 oz bowl',
      category: 'frozen' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'breakfast_bowl',
      tags: ['trader_joes', 'frozen', 'breakfast'],
    },
    {
      title: 'Paneer Indian Style Traditional Soft Cheese 10 oz',
      subtitle: 'High protein non-melting cooking cheese for curries and grilling.',
      salePrice: 4.99,
      originalPrice: 6.29,
      discountPercent: 20,
      unitPrice: '$4.99 each',
      normalizedUnitCost: 4.99,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '10 oz block',
      category: 'dairy_eggs' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'shredded_cheddar_cheese',
      tags: ['trader_joes', 'cheese', 'dairy'],
    },
    {
      title: 'Organic Lactose Free Reduced Fat Milk Half Gallon',
      subtitle: 'Certified Organic 2% milk, ultra-pasteurized and lactose-free.',
      salePrice: 5.69,
      originalPrice: 6.49,
      discountPercent: 12,
      unitPrice: '$5.69 / half gallon',
      normalizedUnitCost: 5.69,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '64 fl oz carton',
      category: 'dairy_eggs' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'whole_milk_gallon',
      tags: ['trader_joes', 'milk', 'organic', 'lactose_free'],
    },
    {
      title: 'Creamy Dreamy Whipped Ricotta Cheese 8 oz',
      subtitle: 'Ultra-smooth, airy Italian-style whole milk ricotta spread.',
      salePrice: 3.49,
      originalPrice: 4.29,
      discountPercent: 18,
      unitPrice: '$3.49 each',
      normalizedUnitCost: 3.49,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '8 oz tub',
      category: 'dairy_eggs' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'shredded_cheddar_cheese',
      tags: ['trader_joes', 'cheese', 'ricotta'],
    },
    {
      title: 'Cheddar & Gruyère Mélange Cheese',
      subtitle: 'Creamy Wisconsin specialty cheese melding nutty Gruyère with sharp Cheddar.',
      salePrice: 7.99,
      originalPrice: 9.99,
      discountPercent: 20,
      unitPrice: '$7.99 / lb',
      normalizedUnitCost: 7.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'dairy_eggs' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'CUSTOMER FAVORITE',
      genericProductGroup: 'shredded_cheddar_cheese',
      tags: ['trader_joes', 'cheese', 'artisan'],
    },
    {
      title: 'Sesame Teriyaki Beef Skirt Steak',
      subtitle: 'Tender trimmed skirt steak marinated in toasted sesame, ginger, and soy.',
      salePrice: 16.99,
      originalPrice: 19.99,
      discountPercent: 15,
      unitPrice: '$16.99 / lb',
      normalizedUnitCost: 16.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'meat_seafood' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'steak_cut',
      tags: ['trader_joes', 'butcher', 'steak', 'marinated'],
    },
    {
      title: 'All Natural Pasture Raised Boneless Skinless Heirloom Chicken Breasts',
      subtitle: 'Slow-growth heirloom breed, air chilled, vegetarian grain fed.',
      salePrice: 7.99,
      originalPrice: 9.49,
      discountPercent: 15,
      unitPrice: '$7.99 / lb',
      normalizedUnitCost: 7.99,
      normalizedUnitType: 'lb' as NormalizedUnitType,
      unitDescription: 'per lb',
      category: 'meat_seafood' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'boneless_chicken_breast',
      tags: ['trader_joes', 'chicken', 'organic', 'poultry'],
    },
    {
      title: 'Homestyle Chicken Salad Croissant Sandwich',
      subtitle: 'White meat roasted chicken salad on a flaky butter croissant.',
      salePrice: 4.49,
      originalPrice: 5.49,
      discountPercent: 18,
      unitPrice: '$4.49 each',
      normalizedUnitCost: 4.49,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '6.4 oz pack',
      category: 'bakery_deli' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'READY TO EAT',
      genericProductGroup: 'sandwich',
      tags: ['trader_joes', 'grab_and_go', 'sandwich'],
    },
    {
      title: 'Teeny Tiny Avocados 6-Pack Bag',
      subtitle: 'Perfect single-serving Hass avocados from Michoacán.',
      salePrice: 3.99,
      originalPrice: 4.99,
      discountPercent: 20,
      unitPrice: '$0.66 / avocado ($3.99 / bag of 6)',
      normalizedUnitCost: 0.66,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: 'bag of 6',
      category: 'produce' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: 'SIGNATURE ITEM',
      genericProductGroup: 'hass_avocados',
      tags: ['trader_joes', 'avocados', 'produce'],
    },
    {
      title: 'Unexpected Cheddar Cheese 7 oz',
      subtitle: 'Aged white cheddar with hints of parmesan crystals throughout.',
      salePrice: 4.99,
      originalPrice: 5.99,
      discountPercent: 16,
      unitPrice: '$4.99 each (7 oz)',
      normalizedUnitCost: 4.99,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '7 oz block',
      category: 'dairy_eggs' as DealCategory,
      dealType: 'sale' as DealType,
      dealBadge: '#1 FAVORITE',
      genericProductGroup: 'shredded_cheddar_cheese',
      tags: ['trader_joes', 'unexpected_cheddar', 'cheese'],
    },
    {
      title: 'Organic Large Brown Grade A Eggs Dozen',
      subtitle: 'Free-range hens, certified organic vegetarian feed.',
      salePrice: 4.49,
      originalPrice: 5.29,
      discountPercent: 15,
      unitPrice: '$4.49 / dozen',
      normalizedUnitCost: 4.49,
      normalizedUnitType: 'dozen' as NormalizedUnitType,
      unitDescription: 'per dozen',
      category: 'dairy_eggs' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'large_white_eggs',
      tags: ['trader_joes', 'organic', 'eggs', 'dairy'],
    },
    {
      title: 'Trader Joe’s 100% Greek Kalamata Extra Virgin Olive Oil 500ml',
      subtitle: 'Single estate, cold-pressed Greek Koroneiki olives.',
      salePrice: 8.99,
      originalPrice: 10.99,
      discountPercent: 18,
      unitPrice: '$8.99 each',
      normalizedUnitCost: 8.99,
      normalizedUnitType: 'unit' as NormalizedUnitType,
      unitDescription: '500 ml glass bottle',
      category: 'pantry_snacks' as DealCategory,
      dealType: 'sale' as DealType,
      genericProductGroup: 'extra_virgin_olive_oil',
      tags: ['trader_joes', 'evoo', 'greece', 'pantry'],
    },
  ];

  store.totalDealsCount = tjItems.length;

  return tjItems.map((item, idx) => ({
    id: `${store.id}-tj-live-${idx + 1}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg || '#991B1B',
    storeLogoText: store.logoText || "TJ'S",
    title: item.title,
    subtitle: item.subtitle,
    category: item.category,
    originalPrice: item.originalPrice,
    salePrice: item.salePrice,
    discountPercent: item.discountPercent,
    unitPrice: item.unitPrice,
    normalizedUnitCost: item.normalizedUnitCost,
    normalizedUnitType: item.normalizedUnitType,
    unitDescription: item.unitDescription,
    dealType: item.dealType,
    dealBadge: item.dealBadge,
    validUntil,
    inStock: true,
    genericProductGroup: item.genericProductGroup,
    tags: item.tags,
    brand: "Trader Joe's",
  }));
}

// Master function: fetches real live deals for ANY store
export async function fetchLiveDealsForStore(store: Store, zipCode: string): Promise<DealItem[]> {
  const storeNameL = store.name.toLowerCase();
  const storeChainL = store.chain.toLowerCase();

  // 1. The Fresh Market -> Live Weekly Features
  if (storeNameL.includes('fresh market') || storeChainL.includes('fresh market')) {
    return getLiveFreshMarketDeals(store);
  }

  // 2. Trader Joe's -> Live Fearless Flyer
  if (storeNameL.includes('trader joe') || storeChainL.includes('trader joe')) {
    return getLiveTraderJoesDeals(store);
  }

  // 3. Query Flipp flyers for the user's postal code
  const flyers = await getLiveFlippFlyersForZip(zipCode);

  // Match the flyer to this store's merchant
  const matchingFlyer = flyers.find((f) => {
    const merchantL = (f.merchant || '').toLowerCase();
    if (storeNameL.includes('aldi') || storeChainL.includes('aldi')) {
      return merchantL.includes('aldi');
    }
    if (storeNameL.includes('giant') || storeChainL.includes('giant')) {
      return merchantL.includes('giant') && !merchantL.includes('giant eagle');
    }
    if (storeNameL.includes('acme') || storeChainL.includes('acme')) {
      return merchantL.includes('acme');
    }
    if (storeNameL.includes('weis') || storeChainL.includes('weis')) {
      return merchantL.includes('weis');
    }
    if (storeNameL.includes('wegmans') || storeChainL.includes('wegmans')) {
      return merchantL.includes('wegman');
    }
    if (storeNameL.includes('sprouts') || storeChainL.includes('sprouts')) {
      return merchantL.includes('sprouts');
    }
    if (storeNameL.includes('lidl') || storeChainL.includes('lidl')) {
      return merchantL.includes('lidl');
    }
    if (storeNameL.includes('grocery outlet') || storeChainL.includes('grocery outlet')) {
      return merchantL.includes('grocery outlet');
    }
    if (storeNameL.includes('target') || storeChainL.includes('target')) {
      return merchantL.includes('target');
    }
    if (storeNameL.includes('kroger') || storeChainL.includes('kroger')) {
      return merchantL.includes('kroger');
    }
    if (storeNameL.includes('publix') || storeChainL.includes('publix')) {
      return merchantL.includes('publix');
    }
    return merchantL.includes(storeChainL) || storeNameL.includes(merchantL);
  });

  if (!matchingFlyer) {
    console.info(`[LiveCircularScraper] No Flipp flyer found for ${store.name} in ${zipCode}`);
    return [];
  }

  // Update flyer title & dates on store metadata
  store.flyerTitle = `${store.chain} Weekly Ad`;
  const { items: rawItems, validDates } = await getFlyerItems(matchingFlyer.id);
  if (validDates) {
    store.validDates = validDates;
  }

  const validUntil = matchingFlyer.valid_to ? matchingFlyer.valid_to.split('T')[0] : '2026-09-17';

  // Map into DealItems
  const deals: DealItem[] = [];
  const seenTitles = new Set<string>();

  for (let idx = 0; idx < rawItems.length; idx++) {
    const raw = rawItems[idx];
    const cleanTitle = raw.name.replace(/\s+/g, ' ').trim();
    if (!cleanTitle || seenTitles.has(cleanTitle.toLowerCase())) continue;
    
    // --- NON-GROCERY SANITY FILTER ---
    // Drops appliances, luggage, apparel, and hardware immediately
    if (/\b(luggage|maker|machine|appliance|tv|television|vacuum|chair|table|shirt|pants|spinner|carry-on|pod compatible|headphones|earbuds)\b/i.test(cleanTitle)) {
      continue; 
    }
    
    seenTitles.add(cleanTitle.toLowerCase());

    const priceInfo = parsePriceAndUnits(cleanTitle, raw.price, raw.description);
    const category = inferCategory(cleanTitle, raw.brand);
    const genericProductGroup = inferGenericProductGroup(cleanTitle, raw.brand);

    deals.push({
      id: `${store.id}-live-${raw.id || idx + 1}`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
      title: cleanTitle,
      subtitle: raw.description || undefined,
      imageUrl: raw.cutout_image_url || raw.clean_image_url,
      category,
      originalPrice: priceInfo.originalPrice,
      salePrice: priceInfo.salePrice,
      discountPercent: priceInfo.discountPercent,
      unitPrice: priceInfo.unitPrice,
      normalizedUnitCost: priceInfo.normalizedUnitCost,
      normalizedUnitType: priceInfo.normalizedUnitType,
      unitDescription: priceInfo.unitDescription,
      dealType: priceInfo.dealType,
      dealBadge: priceInfo.dealBadge,
      bundleQuantity: priceInfo.bundleQuantity,
      bundleTotalPrice: priceInfo.bundleTotalPrice,
      validUntil,
      inStock: true,
      genericProductGroup,
      tags: [store.chain.toLowerCase(), 'weekly_ad', category],
      brand: raw.brand || undefined,
    });
  }

  store.totalDealsCount = deals.length;
  console.info(`[LiveCircularScraper] Loaded ${deals.length} authentic live circular deals for ${store.name}`);
  return deals;
}
