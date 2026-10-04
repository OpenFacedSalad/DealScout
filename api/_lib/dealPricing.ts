import { DealItem } from '../../src/types.js';

// Standard ground meat fat ratios that must NEVER be parsed as multi-buy bundles
const GROUND_MEAT_FAT_RATIO_REGEX = /\b(70\/30|73\/27|75\/25|80\/20|85\/15|90\/10|93\/7|96\/4)\b/i;

// THE STRICT UOM CONTRACT: Mandates the unit for every category
const CATEGORY_UOM_CONTRACT: Record<string, string> = {
  // Produce
  "produce_apples": "lb", "produce_bananas": "lb", "produce_grapes_conventional": "lb", "produce_grapes_organic": "lb", 
  "produce_oranges": "lb", "produce_potatoes": "lb", "produce_sweet_potatoes": "lb", "produce_onions": "lb", 
  "produce_broccoli": "lb", "produce_squash": "lb", "produce_tomatoes": "lb",
  "produce_strawberries": "oz", "produce_blueberries": "oz", "produce_cane_berries": "oz", "produce_mushrooms": "oz", "produce_salad_greens": "oz",
  "produce_lemons": "each", "produce_limes": "each", "produce_grapefruits": "each", "produce_melons": "each", 
  "produce_avocados": "each", "produce_cauliflower": "each", "produce_carrots": "each", "produce_celery": "each", 
  "produce_corn": "each", "produce_cucumbers": "each", "produce_peppers": "each",
  // Meat & Seafood
  "meat_chicken_breast": "lb", "meat_chicken_dark": "lb", "meat_chicken_wings": "lb", "meat_chicken_whole": "lb",
  "meat_beef_ground": "lb", "meat_beef_steak": "lb", "meat_beef_roast": "lb", "meat_pork_chops": "lb", 
  "meat_pork_roast": "lb", "meat_pork_ribs": "lb", "meat_pork_ham": "lb", "meat_sausage": "lb", "meat_turkey_ground": "lb",
  "meat_seafood_salmon": "lb", "meat_seafood_whitefish": "lb", "meat_seafood_shrimp": "lb", "meat_seafood_shellfish": "lb",
  "meat_bacon": "oz", "pantry_seafood_canned": "oz",
  // Dairy 
  "dairy_eggs": "dozen", "dairy_milk_cow": "gallon", "dairy_milk_plant": "fl oz",
  "dairy_butter_margarine": "oz", "dairy_cheese_shredded": "oz", "dairy_cheese_sliced_block": "oz", 
  "dairy_cream_cheese": "oz", "dairy_yogurt": "oz", "dairy_sour_cream": "oz", "dairy_cottage_cheese": "oz", 
  "dairy_cream": "fl oz", "dairy_creamer": "fl oz",
  // Bakery & Deli
  "bakery_bread_sandwich": "each", "bakery_bread_artisan": "each", "bakery_breakfast_breads": "pkg", 
  "bakery_buns": "pkg", "bakery_tortillas": "each", "deli_cold_cuts": "lb",
  // Pantry
  "pantry_pasta": "oz", "pantry_sauce_pasta": "oz", "pantry_sauce_bbq": "oz", "pantry_rice_grains": "lb", 
  "pantry_beans_canned": "oz", "pantry_tomatoes_canned": "oz", "pantry_soup_broth": "oz", "pantry_cereal": "oz", 
  "pantry_oatmeal": "oz", "pantry_baking_basics": "lb", "pantry_cooking_oil": "fl oz", "pantry_nut_spreads": "oz", 
  "pantry_coffee": "oz", "pantry_coffee_pods": "each",
  // Frozen
  "frozen_pizza": "each", "frozen_vegetables": "oz", "frozen_fruit": "oz", "frozen_waffles_pancakes": "each", 
  "frozen_ice_cream": "fl oz", "frozen_potatoes": "oz", "frozen_meals": "each",
  // Beverages
  "beverages_water": "each", "beverages_soda_12pk": "pkg", "beverages_soda_2liter": "each", 
  "beverages_juice_orange": "fl oz", "beverages_juice_shelf": "fl oz", "beverages_sports": "fl oz", 
  "beverages_energy": "each", "beverages_seltzer": "each",
  // Snacks
  "snacks_potato_chips": "oz", "snacks_tortilla_chips": "oz", "snacks_pretzels": "oz", "snacks_crackers": "oz", 
  "snacks_popcorn": "oz", "snacks_nuts": "oz",
  // Household
  "household_paper_towels": "each", "household_bath_tissue": "each", "household_laundry_detergent_liquid": "fl oz", 
  "household_laundry_detergent_pods": "each", "household_dish_liquid": "fl oz", "household_dishwasher_pods": "each", 
  "household_trash_bags": "each"
};

export function sanitizeDealItem(deal: any): DealItem {
  let title = String(deal.title || deal.name || '').trim().replace(/^Branded\s+/i, '').replace(/\s+/g, ' ');
  const subtitle = String(deal.subtitle || '').trim();
  const rawBadge = String(deal.dealBadge || deal.promoBadgeText || '').trim();
  const ocr = String(deal.ocrTranscript || '').trim();
  const corpus = `${ocr} ${title} ${subtitle} ${rawBadge}`.toLowerCase();

  // 1. Hardened Multi-Buy Detection (Requires a literal dollar sign to trigger "2 for $5", ignoring "80/20")
  const cleanCorpusForMultiBuy = corpus.replace(GROUND_MEAT_FAT_RATIO_REGEX, ' ');
  const multiMatch = cleanCorpusForMultiBuy.match(/\b([2-9]|1[0-2])\s*(?:for\s*\$?|\/\s*\$)(\d+(?:\.\d{2})?)\b/i);

  let bundleQuantity: number | undefined = deal.bundleQuantity;
  let bundleTotalPrice: number | undefined = deal.bundleTotalPrice;
  let salePrice = typeof deal.salePrice === 'number' ? deal.salePrice : parseFloat(String(deal.salePrice || '0').replace(/[^0-9.]/g, '')) || 0;
  let dealType = deal.dealType || 'sale';
  let unitDescription = deal.unitDescription || '';
  let dealBadge = rawBadge || deal.dealBadge;

  if (multiMatch) {
    const qty = parseInt(multiMatch[1], 10);
    const total = parseFloat(multiMatch[2]);
    if (qty >= 2 && qty <= 12 && total > 0) {
      bundleQuantity = qty;
      bundleTotalPrice = total;
      salePrice = Number((total / qty).toFixed(2));
      unitDescription = `${qty} for $${total.toFixed(2)} ($${salePrice.toFixed(2)} ea)`;
      dealBadge = dealBadge || `${qty} FOR $${total.toFixed(0)}`;
      dealType = 'multi_buy';
    }
  } else if (bundleQuantity && bundleQuantity >= 2 && bundleQuantity <= 12 && bundleTotalPrice && bundleTotalPrice > 0) {
    salePrice = Number((bundleTotalPrice / bundleQuantity).toFixed(2));
    unitDescription = `${bundleQuantity} for $${bundleTotalPrice.toFixed(2)} ($${salePrice.toFixed(2)} ea)`;
    dealBadge = dealBadge || `${bundleQuantity} FOR $${bundleTotalPrice.toFixed(0)}`;
    dealType = 'multi_buy';
  }

  const isPromoKeyword = /\b(bogo|buy\s*1\s*get\s*1|buy\s*one\s*get\s*one|50%\s*off|\d+%\s*off|free)\b/i.test(corpus);
  const isUnpricedPromo = deal.isUnpricedPromo === true || (isPromoKeyword && (salePrice === 0 || deal.dealType === 'bogo' || salePrice === 3.99));

  if (isUnpricedPromo) {
    salePrice = 0;
    dealType = 'bogo';
    dealBadge = dealBadge || (corpus.includes('50%') ? 'BUY 1 GET 1 50% OFF' : 'BUY 1 GET 1 FREE');
    unitDescription = 'Discount applied at checkout';
  }

  const origPrice = typeof deal.originalPrice === 'number' ? deal.originalPrice : parseFloat(String(deal.originalPrice || '0').replace(/[^0-9.]/g, '')) || 0;

  // Hard clamp on hallucinated bundle quantities 
  if (bundleQuantity && bundleQuantity > 12) {
    bundleQuantity = undefined;
    bundleTotalPrice = undefined;
    dealType = 'sale';
    if (salePrice < 0.50 && origPrice > 1.00) {
      salePrice = origPrice;
    }
  }

  // 3. Strict UOM Contract Enforcement & Division
  const targetUOM = CATEGORY_UOM_CONTRACT[deal.genericProductGroup || ''] || 'each';
  let finalUnitCost = salePrice;
  let finalUnitType: any = targetUOM;
  let displayUnitPrice = `$${salePrice.toFixed(2)} each`;

  if (!isUnpricedPromo) {
    if (targetUOM === 'each' || targetUOM === 'pkg') {
      const countMatch = corpus.match(/(\d+)\s*(?:ct|count|pk|pack|pack\b|pk\b)/i) || corpus.match(/(?:pack of|box of)\s*(\d+)/i);
      if (countMatch && parseInt(countMatch[1], 10) > 1 && parseInt(countMatch[1], 10) < 50) {
        const count = parseInt(countMatch[1], 10);
        finalUnitCost = Number((salePrice / count).toFixed(4));
        displayUnitPrice = `$${finalUnitCost.toFixed(2)} each`;
        unitDescription = `${count}-pack ($${salePrice.toFixed(2)} total)`;
      } else {
        finalUnitCost = salePrice;
        displayUnitPrice = `$${salePrice.toFixed(2)} ${targetUOM === 'pkg' ? 'each' : targetUOM}`;
      }
    } else {
      const explicitUnitRegex = new RegExp(`(\\/|per)\\s*${targetUOM}`, 'i');
      if (explicitUnitRegex.test(deal.unitPrice || '') || explicitUnitRegex.test(corpus)) {
        finalUnitCost = salePrice;
        displayUnitPrice = `$${salePrice.toFixed(2)} / ${targetUOM}`;
      } else {
        const sizeMatch = corpus.match(/(\d+(?:\.\d+)?)\s*(-)?\s*(oz|ounce|ounces|lb|lbs|pound|pounds|fl oz|gal|gallon|pt|qt|liter|l|ml)\b/i);
        if (sizeMatch) {
          const amount = parseFloat(sizeMatch[1]);
          const unitStr = sizeMatch[3].toLowerCase();
          let divisor = 0;

          if (targetUOM === 'oz') {
            if (unitStr.startsWith('lb') || unitStr.startsWith('pound')) divisor = amount * 16;
            else if (unitStr.startsWith('oz') || unitStr.startsWith('ounce')) divisor = amount;
          } else if (targetUOM === 'lb') {
            if (unitStr.startsWith('oz') || unitStr.startsWith('ounce')) divisor = amount / 16;
            else if (unitStr.startsWith('lb') || unitStr.startsWith('pound')) divisor = amount;
          } else if (targetUOM === 'fl oz') {
            if (unitStr.startsWith('fl oz')) divisor = amount;
            else if (unitStr.startsWith('ml')) divisor = amount / 29.5735;
            else if (unitStr === 'l' || unitStr === 'liter') divisor = amount * 33.814;
            else if (unitStr.startsWith('gal')) divisor = amount * 128;
          } else if (targetUOM === 'gallon') {
            if (unitStr.startsWith('gal')) divisor = amount;
          }

          if (divisor > 0) {
            finalUnitCost = Number((salePrice / divisor).toFixed(4));
            displayUnitPrice = `$${finalUnitCost.toFixed(2)} / ${targetUOM}`;
          } else {
            finalUnitCost = 9999;
            finalUnitType = 'UOM not found';
            displayUnitPrice = 'UOM not found';
          }
        } else {
          finalUnitCost = 9999;
          finalUnitType = 'UOM not found';
          displayUnitPrice = 'UOM not found';
        }
      }
    }
  } else {
    finalUnitType = targetUOM;
    displayUnitPrice = 'Free / Promo';
  }

  const originalPrice = origPrice > salePrice ? origPrice : salePrice;
  const discountPercent = originalPrice > salePrice && !isUnpricedPromo ? Math.round(((originalPrice - salePrice) / originalPrice) * 100) : 0;

  return {
    ...deal,
    title,
    subtitle,
    salePrice,
    originalPrice,
    displayPrice: isUnpricedPromo ? null : `$${salePrice.toFixed(2)}`,
    discountPercent,
    normalizedUnitCost: finalUnitCost,
    normalizedUnitType: finalUnitType,
    unitPrice: displayUnitPrice,
    unitDescription,
    dealType,
    dealBadge,
    isUnpricedPromo,
    bundleQuantity,
    bundleTotalPrice,
  };
}

export function isValidGroceryDeal(deal: any): boolean {
  if (!deal) return false;
  const title = String(deal.title || deal.name || '').trim();

  if (/^[A-Z0-9_-]{10,}$/i.test(title) || /^(WEGMN|PLU|SKU|PROMO|ITEM)\d+/i.test(title)) return false;
  if (!/[a-zA-Z]{3,}/.test(title)) return false;
  if (!deal.imageUrl && (!deal.salePrice || deal.salePrice <= 0) && !deal.subtitle) return false;

  const titleLower = title.toLowerCase();
  const subLower = String(deal.subtitle || '').toLowerCase();
  const badgeLower = String(deal.promoBadgeText || deal.dealBadge || '').toLowerCase();
  const combined = `${titleLower} ${subLower} ${badgeLower}`;
  
  const banned = ['vtech', 'leapfrog', 'lego', 'toy', 'doll', 'doors opening', 'grand opening', 'hiring', 'apparel', 'patio'];
  if (banned.some((b) => combined.includes(b))) return false;

  return true;
}

export function sanitizeDealList(deals: any[]): DealItem[] {
  if (!Array.isArray(deals)) return [];
  return deals
    .filter(isValidGroceryDeal)
    .map(sanitizeDealItem);
}
