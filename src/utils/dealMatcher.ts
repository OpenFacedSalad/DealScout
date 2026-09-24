import { DealItem, ComparisonGroup, ShoppingListItem, BetterAlternative } from '../types';

export function formatProductGroupName(group: string): string {
  const customLabels: Record<string, string> = {
    ground_beef_80_20: 'Ground Beef (80/20)',
    boneless_chicken_breast: 'Boneless Chicken Breast',
    large_white_eggs: 'Large White Eggs (1 Dozen)',
    eggs_large_12ct: 'Large Grade A Eggs (1 Dozen)',
    frozen_waffles: 'Frozen Waffles',
    fresh_eggplant: 'Fresh Eggplant',
    frozen_egg_rolls: 'Frozen Egg Rolls',
    whole_milk_gallon: 'Whole Milk (1 Gallon)',
    honeycrisp_apples: 'Honeycrisp Apples',
    hass_avocados: 'Hass Avocados',
    strawberries_1lb: 'Fresh Strawberries (1 lb)',
    sourdough_bread: 'Artisan Sourdough Bread',
    extra_virgin_olive_oil: 'Extra Virgin Olive Oil',
    shredded_cheddar_cheese: 'Shredded Cheddar Cheese',
    bacon_16oz: 'Thick Cut Bacon (16 oz)',
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
    const key = deal.genericProductGroup || 'other';
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(deal);
  }

  const comparisonGroups: ComparisonGroup[] = [];

  groupMap.forEach((groupDeals, genericGroup) => {
    // 1. When mapping groups, filter out unpriced items for the math check
    const comparableDeals = groupDeals.filter(
      (d) => d.salePrice > 0 && d.normalizedUnitCost > 0 && !d.isUnpricedPromo
    );

    // 2. Sort only the valid, priced deals to find the true winner
    const sortedDeals = [...comparableDeals].sort(
      (a, b) => a.normalizedUnitCost - b.normalizedUnitCost
    );

    const bestDeal = sortedDeals[0];
    // 3. If there are no valid priced deals in the group, skip from comparison groups
    if (!bestDeal) {
      return;
    }

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

    if (b.totalStores !== a.totalStores) {
      return b.totalStores - a.totalStores;
    }

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
