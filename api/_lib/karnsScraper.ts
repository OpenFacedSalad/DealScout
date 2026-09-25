import { Store, DealItem, DealCategory, DealType, NormalizedUnitType } from '../../src/types.js';
import { KARNS_FULL_CIRCULAR_SNAPSHOT, KARNS_CIRCULAR_VALID_DATES } from './karnsSnapshotData.js';
import { getDynamicFallbackDate, getDynamicDateRange } from './liveCircularScraper.js';

interface RawItem {
  rawTitle: string;
  subtitle?: string;
  imageUrl?: string;
  category: DealCategory;
  salePrice: number;
  originalPrice: number;
  discountPercent: number;
  unitPrice: string;
  normalizedUnitCost: number;
  normalizedUnitType: NormalizedUnitType;
  unitDescription: string;
  dealType: DealType;
  dealBadge?: string;
  genericProductGroup: string;
  tags: string[];
  qualityTier?: 'budget' | 'standard' | 'premium' | 'organic';
}

let karnsCache: {
  timestamp: number;
  items: RawItem[];
  validDates: string;
} | null = null;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function parseKarnsPrice(dealStr: string, subtitle: string) {
  const cleanDeal = dealStr.trim();
  let salePrice = 0;
  let originalPrice = 0;
  let unitPrice = cleanDeal;
  let normalizedUnitCost = 0;
  let normalizedUnitType: NormalizedUnitType = 'unit';
  let unitDescription = 'per unit';
  let dealType: DealType = 'sale';
  let dealBadge: string | undefined = undefined;
  let isUnpricedPromo = false;

  let savingsAmount = 0;
  const saveMatch = subtitle.match(/Save\s+\$?([\d\.]+)/i);
  if (saveMatch) {
    savingsAmount = parseFloat(saveMatch[1]) || 0;
  }

  // 1. Check for BOGO / Multi-free
  if (/bogo|buy\s+one\s+get\s+one/i.test(cleanDeal)) {
    dealType = 'bogo';
    dealBadge = 'BOGO FREE';
    if (savingsAmount > 0) {
      salePrice = savingsAmount;
      originalPrice = salePrice * 2;
      normalizedUnitCost = Number((salePrice / 2).toFixed(2));
      unitPrice = `$${normalizedUnitCost.toFixed(2)} ea (BOGO Free)`;
      unitDescription = 'effective per item';
    } else {
      isUnpricedPromo = true;
      salePrice = 0;
      originalPrice = 0;
      normalizedUnitCost = 0;
      unitPrice = 'Varies in-store';
      unitDescription = 'Discount at register';
    }
  } else if (/buy\s+(\d+)\s+get\s+(\d+)\s+free/i.test(cleanDeal)) {
    dealType = 'bogo';
    dealBadge = cleanDeal.toUpperCase();
    isUnpricedPromo = true;
    salePrice = 0;
    originalPrice = 0;
    normalizedUnitCost = 0;
    unitPrice = 'Varies in-store';
    unitDescription = 'Discount at register';
  }
  // 2. Multi-buy e.g. 2/$4
  else if (/^(\d+)\s*\/\s*\$?([\d\.]+)$/.test(cleanDeal)) {
    const m = cleanDeal.match(/^(\d+)\s*\/\s*\$?([\d\.]+)$/);
    const qty = parseInt(m![1], 10);
    const total = parseFloat(m![2]);
    dealType = 'multi_buy';
    dealBadge = `${qty} FOR $${total}`;
    salePrice = Number((total / qty).toFixed(2));
    originalPrice = savingsAmount > 0 ? salePrice + (savingsAmount / qty) : salePrice;
    normalizedUnitCost = salePrice;
    unitPrice = `$${salePrice.toFixed(2)} each (${cleanDeal})`;
    unitDescription = 'per item';
  }
  // 3. Per pound e.g. $1.49 lb
  else if (/\$?([\d\.]+)\s*(?:lb|\/lb|per\s*lb)/i.test(cleanDeal)) {
    const m = cleanDeal.match(/\$?([\d\.]+)/);
    salePrice = parseFloat(m![1]);
    normalizedUnitType = 'lb';
    normalizedUnitCost = salePrice;
    unitPrice = `$${salePrice.toFixed(2)} / lb`;
    unitDescription = 'per pound';
    originalPrice = savingsAmount > 0 ? salePrice + savingsAmount : salePrice;
    dealType = 'sale';
    if (/must\s+buy\s+\d+\s+lbs/i.test(subtitle)) {
      dealBadge = '5 LB+ VALUE PACK';
    } else {
      dealBadge = 'BUTCHER SPECIAL';
    }
  }
  // 4. Standard price e.g. $4.99, $5 each
  else if (/\$?([\d\.]+)/.test(cleanDeal)) {
    const m = cleanDeal.match(/\$?([\d\.]+)/);
    salePrice = parseFloat(m![1]);
    normalizedUnitCost = salePrice;
    unitPrice = `$${salePrice.toFixed(2)}`;
    unitDescription = 'each';
    originalPrice = savingsAmount > 0 ? salePrice + savingsAmount : salePrice;
    dealType = 'sale';
    if (/each/i.test(cleanDeal)) {
      unitPrice += ' each';
    }
  } else {
    isUnpricedPromo = true;
  }

  const discountPercent = originalPrice > salePrice && salePrice > 0
    ? Math.round(((originalPrice - salePrice) / originalPrice) * 100)
    : 0;

  return {
    salePrice: Number(salePrice.toFixed(2)),
    originalPrice: Number(originalPrice.toFixed(2)),
    discountPercent,
    unitPrice,
    normalizedUnitCost: Number(normalizedUnitCost.toFixed(2)),
    normalizedUnitType,
    unitDescription,
    dealType,
    dealBadge,
    promoBadgeText: dealBadge,
    isUnpricedPromo,
  };
}

function mapKarnsCategory(catID: number, name: string): DealCategory {
  switch (catID) {
    case 1:
      return 'produce';
    case 2:
      return 'bakery_deli';
    case 3:
      return 'meat_seafood';
    case 4:
      return 'dairy_eggs';
    case 5:
      return 'bakery_deli';
    case 6:
    case 7:
    case 8:
      return 'household';
    case 9:
      return 'frozen';
    case 10:
      return 'meat_seafood';
    case 11:
    case 12:
    default:
      if (/tea|juice|coffee|soda|water|cider|drink/i.test(name)) return 'beverages';
      return 'pantry_snacks';
  }
}

function inferGenericProductGroup(name: string): string {
  const n = name.toLowerCase();
  if (/wing/i.test(n)) return 'chicken_wings';
  if (/ground (?:beef|angus|chuck|round)/i.test(n)) return 'ground_beef_80_20';
  if (/ribeye/i.test(n)) return 'ribeye_steak';
  if (/strip steak/i.test(n)) return 'ny_strip_steak';
  if (/porterhouse|t-bone/i.test(n)) return 't_bone_steak';
  if (/rump roast|chuck roast/i.test(n)) return 'beef_roast';
  if (/chicken breast/i.test(n)) return 'boneless_chicken_breast';
  if (/pork rib|country rib/i.test(n)) return 'pork_ribs';
  if (/pork chop/i.test(n)) return 'pork_chops';
  if (/bacon/i.test(n)) return 'bacon';
  if (/frank|hot dog/i.test(n)) return 'hot_dogs';
  if (/salmon/i.test(n)) return 'salmon_fillet';
  if (/shrimp/i.test(n)) return 'raw_shrimp';
  if (/haddock|cod|flounder/i.test(n)) return 'whitefish_fillet';
  if (/egg/i.test(n)) return 'large_white_eggs';
  if (/milk/i.test(n)) return 'whole_milk_gallon';
  if (/cheese/i.test(n)) return 'shredded_cheese';
  if (/butter/i.test(n)) return 'butter';
  if (/ice cream/i.test(n)) return 'ice_cream';
  if (/grape/i.test(n)) return 'grapes';
  if (/orange|mandarin/i.test(n)) return 'mandarin_oranges';
  if (/apple/i.test(n)) return 'fresh_apples';
  if (/potato/i.test(n)) return 'russet_potatoes';
  if (/broccoli/i.test(n)) return 'broccoli';
  if (/onion/i.test(n)) return 'onions';
  if (/corn/i.test(n)) return 'sweet_corn';
  if (/bread|roll/i.test(n)) return 'fresh_bread';
  if (/pie/i.test(n)) return 'bakery_pie';
  if (/ham/i.test(n)) return 'deli_ham';
  if (/turkey/i.test(n)) return 'deli_turkey';
  if (/potato salad|macaroni salad/i.test(n)) return 'deli_salad';
  if (/chip|pretzel/i.test(n)) return 'potato_chips';
  if (/soup/i.test(n)) return 'canned_soup';
  if (/sauce|marinara/i.test(n)) return 'pasta_sauce';
  return n.replace(/[^a-z0-9]+/g, '_').slice(0, 30);
}

export async function fetchLiveKarnsCircular(): Promise<{ items: RawItem[]; validDates: string }> {
  if (karnsCache && Date.now() - karnsCache.timestamp < CACHE_TTL_MS) {
    return { items: karnsCache.items, validDates: karnsCache.validDates };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch('https://www.karnsfoods.com/weekly-ad/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Karns Foods returned HTTP ${res.status}`);
    }

    const html = await res.text();
    const regex = /<li[^>]*>([\s\S]*?data-addtoshoppinglist=[\s\S]*?)<\/li>/g;
    let m;
    const items: RawItem[] = [];
    const seen = new Set<string>();

    while ((m = regex.exec(html)) !== null) {
      const block = m[1];
      const dataMatch = block.match(/data-addtoshoppinglist="([^"]+)"/);
      if (!dataMatch) continue;

      try {
        const decoded = dataMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        const data = JSON.parse(decoded);
        if (!data.name || seen.has(data.name)) continue;
        seen.add(data.name);

        const imgMatch = block.match(/data-img-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
        let imgSrc = imgMatch ? imgMatch[1] : '';
        if (imgSrc.startsWith('/..')) {
          imgSrc = 'https://www.karnsfoods.com' + imgSrc.replace(/^\/\.\./, '');
        } else if (imgSrc.startsWith('/')) {
          imgSrc = 'https://www.karnsfoods.com' + imgSrc;
        }

        const smallMatch = block.match(/<small>([\s\S]*?)<\/small>/);
        let subtitle = '';
        if (smallMatch) {
          subtitle = smallMatch[1]
            .replace(/<em[^>]*>[\s\S]*?<\/em>/g, '')
            .replace(/<br\s*\/?>/g, ' • ')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          subtitle = subtitle.replace(/^•\s*|•\s*$/g, '').replace(/\s*•\s*•\s*/g, ' • ').trim();
        }

        const priceInfo = parseKarnsPrice(data.realdeal || '', subtitle);
        const category = mapKarnsCategory(data.categoryID, data.name);
        const genericProductGroup = inferGenericProductGroup(data.name);

        items.push({
          rawTitle: data.name,
          subtitle: subtitle || undefined,
          imageUrl: imgSrc || undefined,
          category,
          ...priceInfo,
          genericProductGroup,
          tags: ['karns', 'weekly_ad', category, 'butcher_market', 'central_pa'],
          qualityTier: category === 'meat_seafood' ? 'premium' : 'standard',
        });
      } catch {
        // Skip malformed individual entries
      }
    }

    if (items.length > 20) {
      const dateMatch = html.match(/Specials Valid\s*<span[^>]*>([^<]+)<\/span>\s*to\s*<span[^>]*>([^<]+)<\/span>/i);
      const validDates = dateMatch ? `${dateMatch[1].trim()} - ${dateMatch[2].trim()}` : KARNS_CIRCULAR_VALID_DATES;
      karnsCache = {
        timestamp: Date.now(),
        items,
        validDates,
      };
      return { items, validDates };
    }
  } catch (err) {
    console.warn('[KarnsScraper] Live fetch had issue, using curated full circular snapshot:', err);
  } finally {
    clearTimeout(timer);
  }

  // Fallback to complete snapshot
  return {
    items: KARNS_FULL_CIRCULAR_SNAPSHOT as RawItem[],
    validDates: KARNS_CIRCULAR_VALID_DATES,
  };
}

export async function getFullKarnsCircularDeals(store: Store): Promise<DealItem[]> {
  const { items, validDates } = await fetchLiveKarnsCircular();

  const rollingValidUntil = getDynamicFallbackDate(7);
  const rollingDateRange = getDynamicDateRange(7);

  // Update store metadata
  const hasLiveValidDates = validDates && !validDates.includes('September 14') && !validDates.includes('2026-09-14');
  store.validDates = hasLiveValidDates ? validDates : rollingDateRange;
  store.flyerTitle = `Karns Weekly Circular (${store.validDates})`;
  store.totalDealsCount = items.length;

  return items.map((raw, idx) => ({
    id: `${store.id}-deal-${idx + 1}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg || '#991B1B',
    storeLogoText: store.logoText || 'KARNS',
    title: raw.rawTitle,
    subtitle: raw.subtitle,
    imageUrl: raw.imageUrl,
    category: raw.category,
    originalPrice: raw.originalPrice,
    salePrice: raw.salePrice,
    discountPercent: raw.discountPercent,
    unitPrice: raw.unitPrice,
    normalizedUnitCost: raw.normalizedUnitCost,
    normalizedUnitType: raw.normalizedUnitType,
    unitDescription: raw.unitDescription,
    dealType: raw.dealType,
    dealBadge: raw.dealBadge,
    validUntil: rollingValidUntil,
    inStock: true,
    genericProductGroup: raw.genericProductGroup,
    tags: raw.tags,
    brand: raw.category === 'meat_seafood' ? "Karns Butcher's Market" : undefined,
    qualityTier: raw.qualityTier,
  }));
}
