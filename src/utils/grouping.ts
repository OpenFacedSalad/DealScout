import { DealItem, ComparisonGroup } from '../types';

export function formatProductGroupName(group: string): string {
  const customLabels: Record<string, string> = {
    produce_apples: 'Fresh Apples',
    produce_bananas: 'Fresh Bananas',
    produce_berries: 'Fresh Berries',
    produce_grapes_conventional: 'Fresh Grapes (Conventional)',
    produce_grapes_organic: 'Fresh Grapes (Organic)',
    produce_potatoes: 'Fresh Potatoes',
    produce_onions: 'Fresh Onions',
    produce_citrus: 'Fresh Citrus',
    produce_oranges: 'Fresh Oranges',
    produce_lemons: 'Fresh Lemons',
    produce_limes: 'Fresh Limes',
    produce_grapefruits: 'Fresh Grapefruit',
    produce_squash: 'Fresh Squash',
    produce_broccoli: 'Fresh Broccoli',
    produce_corn: 'Sweet Corn',
    meat_chicken_breast: 'Chicken Breast',
    meat_chicken_wings: 'Chicken Wings',
    meat_beef_steak: 'Beef Steak',
    meat_beef_ground: 'Ground Beef',
    meat_pork: 'Pork & Ham',
    meat_bacon: 'Bacon',
    meat_seafood: 'Seafood',
    dairy_milk_cow: 'Dairy Milk (Cow)',
    dairy_milk_plant: 'Plant-Based Milk (Oat/Almond/Soy)',
    dairy_butter_margarine: 'Butter & Margarine',
    dairy_eggs: 'Eggs',
    dairy_cheese: 'Cheese',
    dairy_yogurt: 'Yogurt',
    pantry_cereal: 'Breakfast Cereal',
    pantry_coffee: 'Coffee',
    pantry_pasta: 'Pasta',
    pantry_sauce: 'Pasta & BBQ/Steak Sauce',
    pantry_sauce_pasta: 'Pasta Sauce',
    pantry_sauce_bbq: 'BBQ Sauce',
    pantry_snacks: 'Pantry Snacks',
    pantry_potatoes_boxed: 'Boxed & Scalloped Potatoes',
    frozen_pizza: 'Frozen Pizza & Snacks',
    frozen_waffles_pancakes: 'Frozen Waffles & Pancakes',
    frozen_ice_cream: 'Ice Cream',
    frozen_meals: 'Frozen Meals',
    beverages_soda: 'Soda & Pop',
    beverages_water: 'Water',
    beverages_juice: 'Juice',
    beverages_energy: 'Energy Drinks',
    beverages_sports: 'Sports Drinks',
    household_essentials: 'Household Essentials',
    snacks_potato_chips: 'Potato Chips',
    personal_care_toothpaste: 'Toothpaste',
  };

  if (customLabels[group]) {
    return customLabels[group];
  }

  return group
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function groupSimilarDeals(deals: DealItem[]): ComparisonGroup[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  // 1. Identify which brandMatchKeys exist across > 1 distinct stores
  const storeCountsByBrand = new Map<string, Set<string>>();
  for (const deal of deals) {
    const rawKey = deal.brandMatchKey?.trim().toLowerCase();
    if (rawKey && rawKey.length > 2 && rawKey !== 'unknown' && rawKey !== 'uncomparable') {
      if (!storeCountsByBrand.has(rawKey)) {
        storeCountsByBrand.set(rawKey, new Set());
      }
      storeCountsByBrand.get(rawKey)!.add(deal.storeId);
    }
  }

  const hasBrandedMatches = (brandKey?: string): boolean => {
    if (!brandKey) return false;
    const clean = brandKey.trim().toLowerCase();
    const storeSet = storeCountsByBrand.get(clean);
    return Boolean(storeSet && storeSet.size > 1);
  };

  const groupMap = new Map<string, DealItem[]>();
  const isBrandedGroup = new Map<string, boolean>();

  deals.forEach((deal) => {
    const rawBrand = deal.brandMatchKey?.trim().toLowerCase();
    const hasBrandMatch = Boolean(rawBrand && hasBrandedMatches(rawBrand));

    // If this specific branded item exists at >1 store, group it under its brand name.
    // Otherwise, if it's a tracked commodity, group it under the commodity.
    const groupingKey = hasBrandMatch
      ? rawBrand!
      : deal.genericProductGroup;

    if (!groupingKey) return;

    if (!groupMap.has(groupingKey)) {
      groupMap.set(groupingKey, []);
      isBrandedGroup.set(groupingKey, hasBrandMatch);
    }
    groupMap.get(groupingKey)!.push(deal);
  });

  const comparisonGroups: ComparisonGroup[] = [];

  groupMap.forEach((groupDeals, groupingKey) => {
    const isBranded = isBrandedGroup.get(groupingKey) || false;

    // 0. STRICT FILTER: Never compare items in generic garbage buckets UNLESS it is an exact cross-store branded match
    if (!isBranded && (!groupingKey || groupingKey === 'uncomparable' || groupingKey === 'NEEDS_AI_SORT' || groupingKey === 'uncategorized_general')) {
      return;
    }

    const comparableDeals = groupDeals.filter(
      (d) => d.salePrice > 0 && d.normalizedUnitCost > 0 && !d.isUnpricedPromo
    );

    const sortedDeals = [...comparableDeals].sort(
      (a, b) => a.normalizedUnitCost - b.normalizedUnitCost
    );

    const bestDeal = sortedDeals[0];
    if (!bestDeal) return;

    const unpricedDeals = groupDeals.filter(
      (d) => d.salePrice === 0 || d.isUnpricedPromo
    );
    const allGroupDeals = [...sortedDeals, ...unpricedDeals];

    const uniqueStores = new Set(allGroupDeals.map((d) => d.storeId));
    const highestPrice = Math.max(...comparableDeals.map((d) => d.normalizedUnitCost));
    const unitPriceDiff = highestPrice > bestDeal.normalizedUnitCost ? highestPrice - bestDeal.normalizedUnitCost : 0;
    const maxSavingsPercent = highestPrice > bestDeal.normalizedUnitCost
      ? Math.round(((highestPrice - bestDeal.normalizedUnitCost) / highestPrice) * 100)
      : 0;

    let groupTitle: string;
    if (isBranded) {
      groupTitle = groupingKey
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    } else {
      groupTitle = formatProductGroupName(groupingKey);
    }

    comparisonGroups.push({
      genericProductGroup: groupingKey,
      productName: groupTitle,
      category: bestDeal.category,
      deals: allGroupDeals,
      bestDeal,
      totalStores: uniqueStores.size,
      unitType: bestDeal.normalizedUnitType || 'each',
      unitPriceDiff: Number(unitPriceDiff.toFixed(2)),
      maxSavingsPercent,
    });
  });

  return comparisonGroups.sort((a, b) => {
    if (a.totalStores > 1 && b.totalStores <= 1) return -1;
    if (b.totalStores > 1 && a.totalStores <= 1) return 1;
    if (b.totalStores !== a.totalStores) return b.totalStores - a.totalStores;
    return b.maxSavingsPercent - a.maxSavingsPercent;
  });
}
