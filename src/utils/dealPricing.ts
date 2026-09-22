import { DealItem } from '../types';

/**
 * Sanitizes incoming flyer deals dynamically.
 * - Parses multi-buys ("2 for $7", "3 for $10", "4/$5") into per-unit prices.
 * - Flags unpriced promotions (BOGO, % off) so the UI displays the promo badge
 *   instead of a misleading dollar amount or $0.00.
 * - Eliminates hallucinated MSRP strikethroughs.
 */
export function sanitizeDealItem(deal: any): DealItem {
  const title = String(deal.title || deal.name || '').trim();
  const subtitle = String(deal.subtitle || '').trim();
  const rawBadge = String(deal.dealBadge || deal.promoBadgeText || '').trim();
  const ocr = String(deal.ocrTranscript || '').trim();
  const corpus = `${ocr} ${title} ${subtitle} ${rawBadge}`.toLowerCase();

  // 1. Dynamic Multi-Buy Detection (e.g. "2 for $7", "2 for 7", "3 for $10", "4/$5")
  const multiMatch = corpus.match(/\b([2-9])\s*(?:for|\/)\s*\$?(\d+(?:\.\d{2})?)\b/i);

  let bundleQuantity: number | undefined = deal.bundleQuantity;
  let bundleTotalPrice: number | undefined = deal.bundleTotalPrice;
  let salePrice =
    typeof deal.salePrice === 'number'
      ? deal.salePrice
      : parseFloat(String(deal.salePrice || '0').replace(/[^0-9.]/g, '')) || 0;
  let dealType = deal.dealType || 'sale';
  let unitDescription = deal.unitDescription || '';
  let dealBadge = rawBadge || deal.dealBadge;

  if (multiMatch) {
    const qty = parseInt(multiMatch[1], 10);
    const total = parseFloat(multiMatch[2]);
    if (qty > 1 && total > 0) {
      bundleQuantity = qty;
      bundleTotalPrice = total;
      salePrice = Number((total / qty).toFixed(2));
      unitDescription = `${qty} for $${total.toFixed(2)} ($${salePrice.toFixed(2)} ea)`;
      dealBadge = dealBadge || `${qty} FOR $${total.toFixed(0)}`;
      dealType = 'multi_buy';
    }
  } else if (bundleQuantity && bundleQuantity > 1 && bundleTotalPrice && bundleTotalPrice > 0) {
    salePrice = Number((bundleTotalPrice / bundleQuantity).toFixed(2));
    unitDescription = `${bundleQuantity} for $${bundleTotalPrice.toFixed(2)} ($${salePrice.toFixed(2)} ea)`;
    dealBadge = dealBadge || `${bundleQuantity} FOR $${bundleTotalPrice.toFixed(0)}`;
    dealType = 'multi_buy';
  }

  // 2. Dynamic Unpriced Promotion Detection (BOGO, 50% Off, Buy X Get Y Free)
  const isPromoKeyword = /\b(bogo|buy\s*1\s*get\s*1|buy\s*one\s*get\s*one|50%\s*off|\d+%\s*off|free)\b/i.test(corpus);
  const isUnpricedPromo =
    deal.isUnpricedPromo === true ||
    (isPromoKeyword && (salePrice === 0 || deal.dealType === 'bogo' || salePrice === 3.99));

  let displayPrice: string | null = null;
  let normalizedUnitCost = salePrice;

  if (isUnpricedPromo) {
    salePrice = 0;
    normalizedUnitCost = 0;
    displayPrice = null;
    dealType = 'bogo';
    dealBadge = dealBadge || (corpus.includes('50%') ? 'BUY 1 GET 1 50% OFF' : 'BUY 1 GET 1 FREE');
    unitDescription = 'Discount applied at checkout';
  } else {
    displayPrice = `$${salePrice.toFixed(2)}`;
    if (!unitDescription) {
      unitDescription = `$${salePrice.toFixed(2)} each`;
    }
  }

  // 3. Discount Math - Strip fabricated discounts
  const origPrice =
    typeof deal.originalPrice === 'number'
      ? deal.originalPrice
      : parseFloat(String(deal.originalPrice || '0').replace(/[^0-9.]/g, '')) || 0;
  const originalPrice = origPrice > salePrice ? origPrice : salePrice;
  const discountPercent =
    originalPrice > salePrice && !isUnpricedPromo
      ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
      : 0;

  return {
    ...deal,
    title,
    subtitle,
    salePrice,
    originalPrice,
    displayPrice,
    discountPercent,
    normalizedUnitCost,
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

  // 1. Drop internal store tracking IDs / SKUs (e.g., "WEGMN091526590018")
  if (/^[A-Z0-9_-]{10,}$/i.test(title) || /^(WEGMN|PLU|SKU|PROMO|ITEM)\d+/i.test(title)) {
    return false;
  }

  // 2. Must contain at least one normal English word (3+ letters)
  if (!/[a-zA-Z]{3,}/.test(title)) {
    return false;
  }

  // 3. Drop blank placeholder cards with no image and no description
  if (!deal.imageUrl && (!deal.salePrice || deal.salePrice <= 0) && !deal.subtitle) {
    return false;
  }

  return true;
}

export function sanitizeDealList(deals: any[]): DealItem[] {
  if (!Array.isArray(deals)) return [];
  return deals
    .filter((deal) => {
      if (!deal || !deal.title) return false;
      if (!isValidGroceryDeal(deal)) return false;
      const titleLower = String(deal.title).toLowerCase();
      const badgeLower = String(deal.promoBadgeText || deal.dealBadge || '').toLowerCase();
      const subLower = String(deal.subtitle || '').toLowerCase();
      const combined = `${titleLower} ${subLower} ${badgeLower}`;
      const banned = ['vtech', 'leapfrog', 'lego', 'toy', 'doll', 'doors opening', 'grand opening', 'hiring'];
      return !banned.some((b) => combined.includes(b));
    })
    .map(sanitizeDealItem);
}
