import { DealItem, ComparisonGroup, ShoppingListItem, BetterAlternative } from '../types';

export const COMMODITY_DISPLAY_NAMES: Record<string, string> = {
  // Produce
  "produce_apples": "Fresh Apples",
  "produce_bananas": "Fresh Bananas",
  "produce_strawberries": "Fresh Strawberries",
  "produce_blueberries": "Fresh Blueberries",
  "produce_cane_berries": "Fresh Raspberries & Blackberries",
  "produce_grapes_conventional": "Fresh Grapes",
  "produce_grapes_organic": "Organic Grapes",
  "produce_oranges": "Fresh Oranges",
  "produce_lemons": "Fresh Lemons",
  "produce_limes": "Fresh Limes",
  "produce_grapefruits": "Fresh Grapefruit",
  "produce_melons": "Fresh Melons",
  "produce_avocados": "Fresh Avocados",
  "produce_potatoes": "Fresh Potatoes",
  "produce_sweet_potatoes": "Sweet Potatoes",
  "produce_onions": "Fresh Onions",
  "produce_broccoli": "Fresh Broccoli",
  "produce_cauliflower": "Fresh Cauliflower",
  "produce_carrots": "Fresh Carrots",
  "produce_celery": "Fresh Celery",
  "produce_corn": "Fresh Corn",
  "produce_salad_greens": "Salad Greens & Lettuce",
  "produce_tomatoes": "Fresh Tomatoes",
  "produce_cucumbers": "Fresh Cucumbers",
  "produce_peppers": "Bell Peppers",
  "produce_squash": "Fresh Squash & Zucchini",
  "produce_mushrooms": "Fresh Mushrooms",
  
  // Meat & Seafood
  "meat_chicken_breast": "Chicken Breast",
  "meat_chicken_dark": "Chicken Thighs & Drumsticks",
  "meat_chicken_wings": "Chicken Wings",
  "meat_chicken_whole": "Whole Chicken",
  "meat_beef_ground": "Ground Beef",
  "meat_beef_steak": "Beef Steak",
  "meat_beef_roast": "Beef Roast & Stew Meat",
  "meat_pork_chops": "Pork Chops",
  "meat_pork_roast": "Pork Roast & Tenderloin",
  "meat_pork_ribs": "Pork Ribs",
  "meat_pork_ham": "Ham & Ham Steaks",
  "meat_bacon": "Bacon",
  "meat_sausage": "Sausage",
  "meat_turkey_ground": "Ground Turkey",
  "meat_seafood_salmon": "Salmon",
  "meat_seafood_whitefish": "Whitefish Fillets",
  "meat_seafood_shrimp": "Shrimp",
  "meat_seafood_shellfish": "Crab & Shellfish",
  "pantry_seafood_canned": "Canned Tuna & Salmon",

  // Dairy
  "dairy_eggs": "Eggs",
  "dairy_milk_cow": "Milk",
  "dairy_milk_plant": "Plant-Based Milk",
  "dairy_butter_margarine": "Butter & Margarine",
  "dairy_cheese_shredded": "Shredded Cheese",
  "dairy_cheese_sliced_block": "Block & Sliced Cheese",
  "dairy_cream_cheese": "Cream Cheese",
  "dairy_yogurt": "Yogurt",
  "dairy_sour_cream": "Sour Cream",
  "dairy_cottage_cheese": "Cottage Cheese",
  "dairy_cream": "Heavy Cream",
  "dairy_creamer": "Coffee Creamer",

  // Bakery & Deli
  "bakery_bread_sandwich": "Sandwich Bread",
  "bakery_bread_artisan": "Artisan Bread",
  "bakery_breakfast_breads": "Bagels & English Muffins",
  "bakery_buns": "Buns & Rolls",
  "bakery_tortillas": "Tortillas & Wraps",
  "deli_cold_cuts": "Deli Cold Cuts",

  // Pantry
  "pantry_pasta": "Dry Pasta",
  "pantry_sauce_pasta": "Pasta Sauce",
  "pantry_sauce_bbq": "BBQ Sauce",
  "pantry_rice_grains": "Rice & Grains",
  "pantry_beans_canned": "Canned Beans",
  "pantry_tomatoes_canned": "Canned Tomatoes",
  "pantry_soup_broth": "Soup & Broth",
  "pantry_cereal": "Breakfast Cereal",
  "pantry_oatmeal": "Oatmeal",
  "pantry_baking_basics": "Baking Flour & Sugar",
  "pantry_cooking_oil": "Cooking Oil",
  "pantry_nut_spreads": "Peanut Butter",
  "pantry_coffee": "Coffee (Ground & Bean)",
  "pantry_coffee_pods": "Coffee Pods (K-Cups)",

  // Frozen
  "frozen_pizza": "Frozen Pizza",
  "frozen_vegetables": "Frozen Vegetables",
  "frozen_fruit": "Frozen Fruit",
  "frozen_waffles_pancakes": "Frozen Waffles & Pancakes",
  "frozen_ice_cream": "Ice Cream",
  "frozen_potatoes": "Frozen Fries & Potatoes",
  "frozen_meals": "Frozen Meals",

  // Beverages
  "beverages_water": "Bottled Water",
  "beverages_soda_12pk": "Soda (12-Packs)",
  "beverages_soda_2liter": "Soda (2-Liters)",
  "beverages_juice_orange": "Orange Juice",
  "beverages_juice_shelf": "Juice (Shelf Stable)",
  "beverages_sports": "Sports Drinks",
  "beverages_energy": "Energy Drinks",
  "beverages_seltzer": "Sparkling Water & Seltzer",

  // Snacks
  "snacks_potato_chips": "Potato Chips",
  "snacks_tortilla_chips": "Tortilla Chips",
  "snacks_pretzels": "Pretzels",
  "snacks_crackers": "Crackers",
  "snacks_popcorn": "Popcorn",
  "snacks_nuts": "Nuts & Peanuts",

  // Household
  "household_paper_towels": "Paper Towels",
  "household_bath_tissue": "Bath Tissue",
  "household_laundry_detergent_liquid": "Liquid Laundry Detergent",
  "household_laundry_detergent_pods": "Laundry Detergent Pods",
  "household_dish_liquid": "Dish Soap",
  "household_dishwasher_pods": "Dishwasher Pods",
  "household_trash_bags": "Trash Bags",
};

export function formatProductGroupName(groupKey: string): string {
  if (COMMODITY_DISPLAY_NAMES[groupKey]) {
    return COMMODITY_DISPLAY_NAMES[groupKey];
  }
  return groupKey
    .replace(/^([a-z]+)_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function groupSimilarDeals(deals: DealItem[]): ComparisonGroup[] {
  const groups = new Map<string, DealItem[]>();
  
  deals.forEach((deal) => {
    if (!deal.genericProductGroup || deal.genericProductGroup === 'uncomparable' || deal.genericProductGroup === 'NEEDS_AI_SORT') {
      return;
    }
    if (!groups.has(deal.genericProductGroup)) {
      groups.set(deal.genericProductGroup, []);
    }
    groups.get(deal.genericProductGroup)!.push(deal);
  });

  const result: ComparisonGroup[] = [];
  
  groups.forEach((groupDeals, key) => {
    // Determine unique stores offering this exact commodity
    const uniqueStores = new Set(groupDeals.map((d) => d.storeId));
    
    // Sort deals by normalizedUnitCost to easily identify the cheapest option
    const sorted = [...groupDeals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
    const bestDeal = sorted[0];

    // Calculate maximum savings spread across the group
    const highestPrice = Math.max(...groupDeals.map((d) => d.normalizedUnitCost));
    const maxSavingsPercent = highestPrice > bestDeal.normalizedUnitCost
      ? Math.round(((highestPrice - bestDeal.normalizedUnitCost) / highestPrice) * 100)
      : 0;

    // Force strict display name mapping instead of adopting item-specific titles
    const cleanProductName = COMMODITY_DISPLAY_NAMES[key] || key.replace(/_/g, ' ').toUpperCase();

    result.push({
      genericProductGroup: key,
      productName: cleanProductName,
      category: bestDeal.category,
      totalStores: uniqueStores.size,
      unitType: bestDeal.normalizedUnitType,
      unitPriceDiff: Number((highestPrice - bestDeal.normalizedUnitCost).toFixed(2)),
      deals: sorted,
      bestDeal,
      maxSavingsPercent,
    });
  });

  // Display highly contested commodities first (most stores), then alphabetical
  return result.sort((a, b) => {
    if (b.totalStores !== a.totalStores) return b.totalStores - a.totalStores;
    return a.productName.localeCompare(b.productName);
  });
}

export function findBetterAlternative(item: ShoppingListItem, allDeals: DealItem[]): BetterAlternative | null {
  if (!item.deal || !item.deal.genericProductGroup || item.deal.genericProductGroup === 'uncomparable' || !allDeals || allDeals.length === 0) {
    return null;
  }
  
  const categoryDeals = allDeals.filter(d => 
    d.genericProductGroup === item.deal!.genericProductGroup && 
    d.id !== item.deal!.id &&
    d.normalizedUnitCost > 0
  );

  let bestAlternative: DealItem | null = null;
  let currentBestPrice = item.deal.normalizedUnitCost;

  categoryDeals.forEach(d => {
    if (d.normalizedUnitCost < currentBestPrice) {
      currentBestPrice = d.normalizedUnitCost;
      bestAlternative = d;
    }
  });

  if (!bestAlternative) return null;

  const savingsPerUnit = Number((item.deal.normalizedUnitCost - currentBestPrice).toFixed(2));
  const savingsPercent = item.deal.normalizedUnitCost > 0 
    ? Math.round((savingsPerUnit / item.deal.normalizedUnitCost) * 100) 
    : 0;
  const itemQty = item.quantity || 1;
  const totalPotentialSavings = Number((savingsPerUnit * itemQty).toFixed(2));

  return {
    cheaperDeal: bestAlternative,
    savingsPerUnit,
    totalPotentialSavings,
    savingsPercent,
    summary: `Save $${totalPotentialSavings.toFixed(2)} at ${(bestAlternative as DealItem).storeName} (${(bestAlternative as DealItem).unitPrice} vs ${item.deal.unitPrice})`,
  };
}
