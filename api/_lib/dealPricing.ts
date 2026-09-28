import { DealItem } from '../../src/types.js';

// Standard ground meat fat ratios that must NEVER be parsed as multi-buy bundles
const GROUND_MEAT_FAT_RATIO_REGEX = /\b(70\/30|73\/27|75\/25|80\/20|85\/15|90\/10|93\/7|96\/4)\b/i;

export function sanitizeDealItem(deal: any): DealItem {
  let title = String(deal.title || deal.name || '').trim();
  title = title.replace(/^Branded\s+/i, '').replace(/\s+/g, ' ');
  
  const subtitle = String(deal.subtitle || '').trim();
  const rawBadge = String(deal.dealBadge || deal.promoBadgeText || '').trim();
  const ocr = String(deal.ocrTranscript || '').trim();
  const corpus = `${ocr} ${title} ${subtitle} ${rawBadge}`.toLowerCase();

  // 1. Hardened Multi-Buy Detection
  // Strip ground meat ratios from corpus before matching multi-buys
  const cleanCorpusForMultiBuy = corpus.replace(GROUND_MEAT_FAT_RATIO_REGEX, ' ');

  // Multi-buy requires either explicit 'for' (e.g. 2 for $5, 10 for $10) or slash with dollar sign (2/$5)
  // Constrain bundle quantity strictly between 2 and 12 to eliminate false positive item codes
  const multiMatch = cleanCorpusForMultiBuy.match(/\b([2-9]|1[0-2])\s*(?:for|\/\s*\$)\s*\$?(\d+(?:\.\d{2})?)\b/i);

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

  if (/^[A-Z0-9_-]{10,}$/i.test(title) || /^(WEGMN|PLU|SKU|PROMO|ITEM)\d+/i.test(title)) {
    return false;
  }
  if (!/[a-zA-Z]{3,}/.test(title)) {
    return false;
  }
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
