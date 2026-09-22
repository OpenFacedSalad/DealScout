import { GoogleGenAI, Type, Schema } from '@google/genai';
import { Store, DealItem, AIComparisonResult } from './types.js';
import { findPhysicalGroceryStoresOSM, getRegionalDefaultStores } from './storeFinder.js';

// ============================================================================
// 1. IN-MEMORY CACHE SHIELD (Protects RPM & Daily Quotas during testing)
// ============================================================================
interface CacheEntry {
  timestamp: number;
  data: { stores: Store[]; deals: DealItem[] };
}

const CIRCULAR_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1-Hour in-memory cache

function getCacheKey(lat: number, lng: number, radiusMiles: number, zipCode?: string): string {
  if (zipCode && zipCode.trim().length === 5) {
    return `zip_${zipCode.trim()}_r${radiusMiles}`;
  }
  return `coords_${lat.toFixed(2)}_${lng.toFixed(2)}_r${radiusMiles}`;
}

// ============================================================================
// 2. AI CLIENT SINGLETON
// ============================================================================
let aiClientInstance: GoogleGenAI | null = null;

export function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[GeminiService] GEMINI_API_KEY is not defined.');
    return null;
  }
  if (!aiClientInstance) {
    aiClientInstance = new GoogleGenAI({ apiKey });
  }
  return aiClientInstance;
}

// ============================================================================
// 3. TARGETED OCR VERIFICATION (Distributed across stores to protect RPM)
// ============================================================================
interface OCRVerifyResult {
  hasPromoBadge: boolean;
  promoBadgeText?: string;
  bundleQuantity?: number;
  bundleTotalPrice?: number;
  unitSalePrice?: number;
  isUnpricedPromo?: boolean;
}

async function ocrVerifyDealTile(
  ai: GoogleGenAI,
  deal: DealItem
): Promise<Partial<DealItem> | null> {
  if (!deal.imageUrl) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(deal.imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'DealScout/2.5 (GroceryDealMatcher/ImageOCR)',
        Accept: 'image/*,*/*',
      },
    });

    clearTimeout(timeoutId);
    if (!res.ok) return null;

    const arrayBuffer = await res.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const contentType = res.headers.get('content-type') || 'image/jpeg';

    const modelsToTry = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let response: any = null;

    for (const model of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                mimeType: contentType.startsWith('image/') ? contentType : 'image/jpeg',
                data: base64Data,
              },
            },
            {
              text: `Examine this grocery store circular ad image tile with high-accuracy OCR:
1. Examine all visual text, yellow/red badges, bursts, banners, and price stamps.
2. Check for multi-buys (e.g., "2 for $10", "2 for $4", "3 for $5", "4 for $10").
   - If found:
     bundleQuantity: the integer count (e.g., 2)
     bundleTotalPrice: the total bundle cost (e.g., 10.00)
     unitSalePrice: bundleTotalPrice / bundleQuantity (e.g., 5.00)
3. Check for unpriced promotions (e.g., "BUY 1 GET 2 FREE", "BOGO FREE", "50% OFF") with no base dollar amount:
   - isUnpricedPromo: true
   - unitSalePrice: 0.00
4. Transcribe all visible text verbatim into promoBadgeText.

Respond ONLY with valid JSON matching this schema:
{
  "hasPromoBadge": boolean,
  "promoBadgeText": string,
  "bundleQuantity": number,
  "bundleTotalPrice": number,
  "unitSalePrice": number,
  "isUnpricedPromo": boolean
}`,
            },
          ],
          config: { responseMimeType: 'application/json' },
        });
        if (response?.text) break;
      } catch {
        // Try next model tier
      }
    }

    if (!response?.text) return null;

    const parsed = JSON.parse(response.text || '{}') as OCRVerifyResult;

    if (parsed.hasPromoBadge && parsed.bundleQuantity && parsed.bundleQuantity > 1 && parsed.bundleTotalPrice && parsed.bundleTotalPrice > 0) {
      const singlePrice = Number((parsed.bundleTotalPrice / parsed.bundleQuantity).toFixed(2));
      return {
        bundleQuantity: parsed.bundleQuantity,
        bundleTotalPrice: parsed.bundleTotalPrice,
        salePrice: singlePrice,
        unitPrice: `$${singlePrice.toFixed(2)} each`,
        normalizedUnitCost: singlePrice,
        promoBadgeText: parsed.promoBadgeText || `${parsed.bundleQuantity} for $${parsed.bundleTotalPrice}`,
        unitDescription: `${parsed.bundleQuantity} for $${parsed.bundleTotalPrice.toFixed(2)} ($${singlePrice.toFixed(2)} ea)`,
        dealType: 'multi_buy',
        isUnpricedPromo: false,
      };
    }

    if (parsed.isUnpricedPromo) {
      return {
        isUnpricedPromo: true,
        salePrice: 0,
        originalPrice: 0,
        discountPercent: 0,
        promoBadgeText: parsed.promoBadgeText || 'SPECIAL OFFER',
        dealType: 'bogo',
      };
    }
  } catch (err) {
    console.warn(`[OCR Verifier] Skipped deal "${deal.title}":`, err);
  }

  return null;
}

/**
 * Distributes OCR checks evenly: 1 candidate per unique store, up to 4 stores max.
 * This prevents rate-limit exhaustion while ensuring all stores (Weis, Giant, ALDI, etc.)
 * get their promotional tiles verified.
 */
export async function enrichDealsWithOCR(
  ai: GoogleGenAI,
  deals: DealItem[]
): Promise<DealItem[]> {
  const candidateDeals: DealItem[] = [];
  const storesSeen = new Set<string>();

  for (const deal of deals) {
    const isWholeDollar = deal.salePrice >= 3 && Math.floor(deal.salePrice) === deal.salePrice;
    const isUnpriced = !deal.salePrice || deal.salePrice === 0;

    if (deal.imageUrl && (isWholeDollar || isUnpriced) && !storesSeen.has(deal.storeId)) {
      candidateDeals.push(deal);
      storesSeen.add(deal.storeId);
      if (candidateDeals.length >= 4) break;
    }
  }

  if (candidateDeals.length === 0) return deals;

  const ocrResults = await Promise.all(
    candidateDeals.map(async (deal) => {
      const update = await ocrVerifyDealTile(ai, deal);
      return { id: deal.id, update };
    })
  );

  const updatesMap = new Map<string, Partial<DealItem>>(
    ocrResults
      .filter((r): r is { id: string; update: Partial<DealItem> } => r.update !== null)
      .map((r) => [r.id, r.update])
  );

  return deals.map((deal) => {
    if (updatesMap.has(deal.id)) {
      return { ...deal, ...updatesMap.get(deal.id)! };
    }
    return deal;
  });
}

// ============================================================================
// 4. MAIN CIRCULAR FETCHER WITH STORE QUOTAS & ROBUST MULTI-BUY PARSING
// ============================================================================

// Regex word boundaries (\b) protect items like "Game Day" wings and "Arugula"
const NON_GROCERY_REGEX = /\b(vtech|leapfrog|lego|toy|toys|doll|dolls|plush|playset|action figure|board game|video game|apparel|shirt|pants|jeans|shoes|boots|hoodie|socks|underwear|television|headphone|earbuds|ipad|tablet|laptop|vacuum|patio furniture)\b/i;

export async function getCircularsForLocation(
  lat: number,
  lng: number,
  city: string,
  state: string,
  zipCode: string,
  radiusMiles: number = 10
): Promise<{ stores: Store[]; deals: DealItem[] }> {
  // Check Cache Shield
  const cacheKey = getCacheKey(lat, lng, radiusMiles, zipCode);
  const cached = CIRCULAR_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // 1. Discover physical supermarkets
  let stores: Store[] = [];
  try {
    stores = await findPhysicalGroceryStoresOSM(lat, lng, radiusMiles);
  } catch (err) {
    console.warn('[GeminiService] OSM discovery fallback triggered:', err);
  }

  if (!stores || stores.length === 0) {
    stores = getRegionalDefaultStores(city, state, lat, lng, radiusMiles);
  }

  stores = (stores || []).filter((s) => (s.distanceMiles ?? 0) <= radiusMiles);

  const ai = getAiClient();
  if (!ai || stores.length === 0) {
    return { stores, deals: [] };
  }

  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const storeSummary = stores.map((s) => ({
    id: s.id,
    name: s.name,
    chain: s.chain,
    address: `${s.address}, ${s.city}`,
  }));

  // 2. Search Grounding Prompt with Store Quota Guarantees
  const prompt = `
Search the live web for CURRENT weekly grocery circulars, flyers, and advertised food specials for supermarkets near ${city}, ${state} ${zipCode} active as of ${currentDate}.

Target Supermarkets:
${JSON.stringify(storeSummary, null, 2)}

CRITICAL STORE BALANCE & QUOTA RULES:
1. STORE BALANCE:
   You MUST return 6 to 10 active food/grocery deals for EACH target supermarket listed above.
   Ensure every store has an even distribution of circular deals. Do not return 1 item for Weis/Giant and 10 for ALDI.
2. GROCERY ONLY:
   Extract meat, poultry, seafood, produce, dairy, bakery, deli, and pantry items.
   Do not extract general merchandise (clothing, toys, electronics).
3. PROMOTIONS & MULTI-BUYS:
   - For promotions like "2 for $4", "2 for $10", record:
     promoBadgeText: "2 for $4",
     bundleQuantity: 2,
     bundleTotalPrice: 4.00,
     salePrice: 2.00 (MUST be bundleTotalPrice divided by bundleQuantity).
   - For "Buy 1 Get 1 Free" or "Buy 1 Get 2 Free" without a printed dollar price, set isUnpricedPromo: true, salePrice: 0.00, and dealType: "bogo".
   - If regular price is not explicitly printed, set originalPrice = salePrice and discountPercent = 0.
4. TRANSCRIPT:
   Transcribe all visible promotional text/badges into ocrTranscript.
`;

  try {
    const modelsToTry = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let response: any = null;

    for (const model of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: 'application/json',
          },
        });
        if (response?.text) break;
      } catch {
        // Continue to fallback model tier
      }
    }

    const parsed = JSON.parse(response?.text || '{"deals":[]}');
    const rawDeals: any[] = Array.isArray(parsed) ? parsed : parsed.deals || [];

    // 3. Post-Processing: Assign stable IDs & execute mathematical multi-buy division
    let cleanedDeals: DealItem[] = rawDeals
      .filter((deal: any) => {
        if (!deal || !deal.title) return false;

        const combined = `${deal.title} ${deal.subtitle || ''}`.toLowerCase();
        if (NON_GROCERY_REGEX.test(combined)) return false;

        const isLegitBogo = deal.isUnpricedPromo === true || deal.dealType === 'bogo';
        if (!isLegitBogo && (!deal.salePrice || deal.salePrice <= 0 || isNaN(deal.salePrice))) {
          return false;
        }

        if (deal.category === 'produce' && deal.salePrice > 15.0) return false;

        return true;
      })
      .map((deal: any, index: number) => {
        // Deterministic unique ID to prevent OCR collision
        deal.id = deal.id || `${deal.storeId || 'store'}_item_${index}_${Date.now()}`;

        // Scan ALL available text fields for multi-buy tokens
        const searchCorpus = `${deal.ocrTranscript || ''} ${deal.title || ''} ${deal.subtitle || ''} ${deal.promoBadgeText || ''} ${deal.dealBadge || ''} ${deal.unitDescription || ''}`;
        const multiMatch = searchCorpus.match(/(\d+)\s*(?:for|\/)\s*\$?(\d+(?:\.\d{2})?)/i);

        if (multiMatch) {
          const qty = parseInt(multiMatch[1], 10);
          const total = parseFloat(multiMatch[2]);
          if (qty > 1 && total > 0) {
            deal.bundleQuantity = qty;
            deal.bundleTotalPrice = total;
            deal.salePrice = Number((total / qty).toFixed(2));
            deal.unitDescription = `${qty} for $${total.toFixed(2)} ($${deal.salePrice.toFixed(2)} ea)`;
            deal.dealType = 'multi_buy';
          }
        } else if (deal.bundleQuantity && deal.bundleQuantity > 1 && deal.bundleTotalPrice && deal.bundleTotalPrice > 0) {
          deal.salePrice = Number((deal.bundleTotalPrice / deal.bundleQuantity).toFixed(2));
          deal.unitDescription = `${deal.bundleQuantity} for $${deal.bundleTotalPrice.toFixed(2)} ($${deal.salePrice.toFixed(2)} ea)`;
          deal.dealType = 'multi_buy';
        }

        // Clamp fabricated MSRP discounts
        if (!deal.hasExplicitOriginalPrice || deal.originalPrice <= deal.salePrice) {
          deal.originalPrice = deal.salePrice;
          deal.discountPercent = 0;
        }

        deal.normalizedUnitCost = deal.salePrice;
        deal.normalizedUnitType = deal.normalizedUnitType || 'unit';
        deal.unitPrice = `$${deal.salePrice.toFixed(2)} each`;

        return deal as DealItem;
      });

    // 4. Targeted OCR verification on store-distributed candidates
    if (cleanedDeals.length > 0) {
      try {
        cleanedDeals = await enrichDealsWithOCR(ai, cleanedDeals);
      } catch (ocrErr) {
        console.warn('[GeminiService] enrichDealsWithOCR bypassed:', ocrErr);
      }
    }

    // 5. Update store deal counts
    const counts: Record<string, number> = {};
    cleanedDeals.forEach((d) => {
      counts[d.storeId] = (counts[d.storeId] || 0) + 1;
    });

    stores.forEach((s) => {
      s.totalDealsCount = counts[s.id] || 0;
    });

    const result = { stores, deals: cleanedDeals };

    // Save to in-memory cache shield
    CIRCULAR_CACHE.set(cacheKey, { timestamp: Date.now(), data: result });

    return result;
  } catch (apiErr) {
    console.error('[GeminiService] Circular retrieval failed:', apiErr);
    return { stores, deals: [] };
  }
}

// ============================================================================
// 5. AI COMPARISON ENGINE
// ============================================================================
export async function compareDealsWithAI(
  productGroupName: string,
  deals: DealItem[]
): Promise<AIComparisonResult> {
  const ai = getAiClient();
  if (!ai || !deals || deals.length === 0) {
    const fallbackBest = [...deals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost)[0];
    return {
      bestDealId: fallbackBest?.id || '',
      verdict: `Best price per unit is at ${fallbackBest?.storeName || 'local store'}.`,
      keyDifference: 'Lowest normalized price.',
      unitPriceAdvantage: fallbackBest ? `${fallbackBest.unitPrice}` : '',
      caveats: 'None',
    };
  }

  const prompt = `
Compare these competing grocery deals for the commodity "${productGroupName}":
${JSON.stringify(deals, null, 2)}

Determine which deal offers the true lowest unit price and superior consumer value.
Respond ONLY with JSON matching this schema:
{
  "bestDealId": "string (the exact id of the winning deal)",
  "verdict": "string (1-2 decisive sentences explaining the winner)",
  "keyDifference": "string (savings delta or quality difference)",
  "unitPriceAdvantage": "string (e.g. '$0.49/ea vs $0.77/ea - 36% cheaper')",
  "caveats": "string (any membership, coupon clipping, or minimum quantity rules)"
}
`;

  try {
    const modelsToTry = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let res: any = null;

    for (const model of modelsToTry) {
      try {
        res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });
        if (res?.text) break;
      } catch {
        // Try next model tier
      }
    }

    if (res?.text) {
      const parsed = JSON.parse(res.text || '{}');
      if (parsed && parsed.bestDealId && parsed.verdict) {
        return {
          bestDealId: parsed.bestDealId,
          verdict: parsed.verdict,
          keyDifference: parsed.keyDifference || 'Unit price advantage.',
          unitPriceAdvantage: parsed.unitPriceAdvantage || 'Lower cost per unit.',
          caveats: parsed.caveats || 'None',
        };
      }
    }
  } catch (err) {
    console.error('[GeminiService] AI comparison failed:', err);
  }

  const sorted = [...deals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
  return {
    bestDealId: sorted[0]?.id || '',
    verdict: `Best unit price is offered by ${sorted[0]?.storeName}.`,
    keyDifference: 'Direct mathematical unit cost winner.',
    unitPriceAdvantage: `${sorted[0]?.unitPrice}`,
    caveats: 'None',
  };
}

// ============================================================================
// 6. MULTIMODAL FLYER SCANNER (for uploads/camera)
// ============================================================================
export async function parseFlyerWithAI(
  base64Data: string,
  mimeType: string,
  store: { id: string; name: string; logoBg: string; logoText: string }
): Promise<DealItem[]> {
  const ai = getAiClient();
  if (!ai) {
    throw new Error('Gemini API client not initialized. GEMINI_API_KEY is required.');
  }

  const prompt = `
Analyze this physical weekly circular flyer or promotional image/PDF for "${store.name}".
Extract EVERY advertised grocery product special, butcher meat cut, produce price, and BOGO deal shown.

CRITICAL RULES:
1. FOOD & GROCERY ONLY (produce, meat, dairy, pantry, deli).
2. For multi-buys (e.g. 2 for $4), calculate single salePrice = 2.00, bundleQuantity = 2, bundleTotalPrice = 4.00.
3. For unpriced BOGOs, set isUnpricedPromo = true, salePrice = 0.00, originalPrice = 0.00.
4. Transcribe text verbatim into ocrTranscript.
Respond with JSON array of deals:
[{
  "title": string,
  "originalPrice": number,
  "salePrice": number,
  "discountPercent": number,
  "unitPrice": string,
  "normalizedUnitCost": number,
  "normalizedUnitType": "lb" | "oz" | "unit" | "gallon" | "count" | "dozen",
  "unitDescription": string,
  "dealType": "sale" | "bogo" | "digital_coupon" | "multi_buy",
  "dealBadge": string,
  "promoBadgeText": string,
  "ocrTranscript": string,
  "isUnpricedPromo": boolean,
  "bundleQuantity": number,
  "bundleTotalPrice": number,
  "genericProductGroup": string,
  "category": "produce" | "meat_seafood" | "dairy_eggs" | "bakery_deli" | "pantry_snacks" | "frozen" | "beverages" | "household"
}]
`;

  const modelsToTry = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
  let response: any = null;

  for (const model of modelsToTry) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          { text: prompt },
        ],
        config: { responseMimeType: 'application/json' },
      });
      if (response?.text) break;
    } catch {
      // Continue to next model tier
    }
  }

  const rawDeals: any[] = JSON.parse(response?.text || '[]');
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return (Array.isArray(rawDeals) ? rawDeals : []).map((item, idx) => ({
    id: item.id || `scanned-${store.id}-${Date.now()}-${idx}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg,
    storeLogoText: store.logoText,
    title: item.title || 'Special Item',
    category: item.category || 'pantry_snacks',
    originalPrice: item.originalPrice ?? item.salePrice ?? 0,
    salePrice: item.salePrice ?? 0,
    discountPercent: item.discountPercent ?? 0,
    unitPrice: item.unitPrice || `$${(item.salePrice || 0).toFixed(2)} each`,
    normalizedUnitCost: item.normalizedUnitCost ?? item.salePrice ?? 0,
    normalizedUnitType: item.normalizedUnitType || 'unit',
    unitDescription: item.unitDescription || 'each',
    dealType: item.dealType || 'sale',
    dealBadge: item.dealBadge || item.promoBadgeText,
    promoBadgeText: item.promoBadgeText,
    ocrTranscript: item.ocrTranscript,
    isUnpricedPromo: item.isUnpricedPromo || false,
    bundleQuantity: item.bundleQuantity || 1,
    bundleTotalPrice: item.bundleTotalPrice || null,
    validUntil: item.validUntil || validUntil,
    inStock: true,
    genericProductGroup: item.genericProductGroup || item.title?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'groceries',
    tags: ['circular_upload', store.name.toLowerCase()],
  }));
}
