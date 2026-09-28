import { DealItem, ComparisonGroup, ShoppingListItem, BetterAlternative } from '../types';

export { formatProductGroupName, groupSimilarDeals } from './grouping';

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
