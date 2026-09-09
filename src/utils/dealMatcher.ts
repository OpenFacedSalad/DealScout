import { DealItem, ComparisonGroup, ShoppingListItem } from '../types';

/**
 * Group all deals across stores by their genericProductGroup or title keywords
 */
export function groupSimilarDeals(deals: DealItem[]): ComparisonGroup[] {
  const groupsMap = new Map<string, DealItem[]>();

  deals.forEach((deal) => {
    const key = deal.genericProductGroup || deal.title.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (!groupsMap.has(key)) {
      groupsMap.set(key, []);
    }
    groupsMap.get(key)!.push(deal);
  });

  const comparisonGroups: ComparisonGroup[] = [];

  groupsMap.forEach((groupDeals, key) => {
    // Sort deals in group by normalized unit cost
    const sorted = [...groupDeals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
    const best = sorted[0];

    // Format display name
    const rawName = key.replace(/_/g, ' ');
    const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    comparisonGroups.push({
      productGroup: key,
      displayName: displayName,
      category: best.category,
      dealCount: groupDeals.length,
      lowestPrice: best.salePrice,
      lowestUnitPrice: best.unitPrice,
      bestDealId: best.id,
      bestStoreName: best.storeName,
      deals: sorted,
    });
  });

  // Sort groups by number of competing deals (most compared first), then alphabetically
  return comparisonGroups.sort((a, b) => b.dealCount - a.dealCount || a.displayName.localeCompare(b.displayName));
}

/**
 * Find better alternatives in other circulars for a shopping list item
 */
export function findBetterAlternative(
  item: ShoppingListItem,
  allDeals: DealItem[]
): ShoppingListItem['betterAlternative'] | undefined {
  if (!item.dealItem) return undefined;

  const productGroup = item.dealItem.genericProductGroup;
  if (!productGroup) return undefined;

  // Find all other deals in the same product group from DIFFERENT stores
  const alternatives = allDeals.filter(
    (d) => d.genericProductGroup === productGroup && d.storeId !== item.storeId
  );

  if (alternatives.length === 0) return undefined;

  // Sort by normalized unit cost
  const sorted = [...alternatives].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
  const bestAlt = sorted[0];

  // If the alternative is cheaper per unit than current item
  if (bestAlt.normalizedUnitCost < item.dealItem.normalizedUnitCost) {
    const savingsPerUnit = item.dealItem.normalizedUnitCost - bestAlt.normalizedUnitCost;
    const estimatedSavings = Math.round(savingsPerUnit * (item.dealItem.normalizedUnitCost > 0 ? (item.price / item.dealItem.salePrice) : 1) * 100) / 100;

    return {
      storeName: bestAlt.storeName,
      salePrice: bestAlt.salePrice,
      unitPrice: bestAlt.unitPrice,
      savingsAmount: Math.max(0.20, estimatedSavings || (item.dealItem.salePrice - bestAlt.salePrice)),
      dealId: bestAlt.id,
    };
  }

  return undefined;
}
