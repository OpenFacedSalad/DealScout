import { DealItem, ComparisonGroup, ShoppingListItem, BetterAlternative } from '../types';

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
    // We intentionally leave out 'uncomparable' as it gets filtered out below
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

  const groupMap = new Map<string, DealItem[]>();

  for (const deal of deals) {
    const key = deal.genericProductGroup || 'uncomparable';
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(deal);
  }

  const comparisonGroups: ComparisonGroup[] = [];

  groupMap.forEach((groupDeals, genericGroup) => {
    // 0. STRICT FILTER: Never compare items in the generic garbage buckets
    if (!genericGroup || genericGroup === 'uncomparable' || genericGroup === 'NEEDS_AI_SORT' || genericGroup === 'uncategorized_general') {
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

    comparisonGroups.push({
      genericProductGroup: genericGroup,
      productName: formatProductGroupName(genericGroup),
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

export function findBetterAlternative(
  item: ShoppingListItem,
  allDeals: DealItem[]
): BetterAlternative | null {
  if (!item.deal || !item.deal.genericProductGroup || !allDeals || allDeals.length === 0) {
    return null;
  }

  const currentDeal = item.deal;
  const currentGroup = currentDeal.genericProductGroup;
  const currentUnitCost = currentDeal.normalizedUnitCost;

  const candidateDeals = allDeals.filter((deal) => {
    return (
      deal.genericProductGroup === currentGroup &&
      deal.storeId !== currentDeal.storeId &&
      deal.inStock &&
      deal.normalizedUnitCost < currentUnitCost - 0.01
    );
  });

  if (candidateDeals.length === 0) {
    return null;
  }

  const bestAlternative = candidateDeals.reduce((best, current) => {
    return current.normalizedUnitCost < best.normalizedUnitCost ? current : best;
  }, candidateDeals[0]);

  const savingsPerUnit = Number((currentUnitCost - bestAlternative.normalizedUnitCost).toFixed(2));
  const savingsPercent = Math.round((savingsPerUnit / currentUnitCost) * 100);

  const itemQty = item.quantity || 1;
  const estimatedPackageSavings = Math.max(
    0,
    Number(((currentDeal.salePrice - bestAlternative.salePrice) * itemQty).toFixed(2))
  );

  const totalPotentialSavings = estimatedPackageSavings > 0
    ? estimatedPackageSavings
    : Number((savingsPerUnit * itemQty).toFixed(2));

  return {
    cheaperDeal: bestAlternative,
    savingsPerUnit,
    totalPotentialSavings,
    savingsPercent,
    summary: `Save $${totalPotentialSavings.toFixed(2)} at ${bestAlternative.storeName} (${bestAlternative.unitPrice} vs ${currentDeal.unitPrice})`,
  };
}
