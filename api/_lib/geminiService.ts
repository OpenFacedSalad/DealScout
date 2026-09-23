import { GoogleGenAI, Type, Schema } from '@google/genai';
import { Store, DealItem } from '../../src/types.js';
import { findPhysicalGroceryStoresOSM, getRegionalDefaultStores } from './storeFinder.js';
import { getFullKarnsCircularDeals } from './karnsScraper.js';
import { fetchLiveDealsForStore } from './liveCircularScraper.js';

let aiClient: GoogleGenAI | null = null;

const circularsCache = new Map<string, { timestamp: number; data: { stores: Store[]; deals: DealItem[] } }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export interface AIComparisonResult {
  bestDealId: string;
  verdict: string;
  keyDifference: string;
  unitPriceAdvantage: string;
  caveats: string;
}

export const dealsResponseSchema: Schema = {
  type: Type.ARRAY,
  description: 'List of weekly circular flyer grocery deals for local stores.',
  items: {
    type: Type.OBJECT,
    properties: {
      ocrTranscript: {
        type: Type.STRING,
        description: "Literal, verbatim transcription of ALL text, prices, numbers, and badges visible on the circular tile (e.g., 'Weis Price Lock 2 for $4 Weis Quality Italian or Long French Bread').",
      },
      id: { type: Type.STRING },
      storeId: { type: Type.STRING },
      storeName: { type: Type.STRING },
      storeLogoBg: { type: Type.STRING },
      storeLogoText: { type: Type.STRING },
      title: { 
        type: Type.STRING, 
        description: "Product name and brand without promo badge slogans" 
      },
      subtitle: { type: Type.STRING },
      category: {
        type: Type.STRING,
        enum: [
          'produce',
          'meat_seafood',
          'dairy_eggs',
          'bakery_deli',
          'pantry_snacks',
          'frozen',
          'beverages',
          'household',
        ],
      },
      originalPrice: { 
        type: Type.NUMBER, 
        description: "Strikethrough regular price ONLY if printed. If not printed, set equal to salePrice" 
      },
      salePrice: { 
        type: Type.NUMBER, 
        description: "Base price for ONE unit. If multi-buy ('2 for $7'), mathematically divide total by quantity (7.00 / 2 = 3.50). If unpriced BOGO, set to 0." 
      },
      discountPercent: { 
        type: Type.NUMBER, 
        description: "Explicit percentage off printed on circular, or calculated from printed MSRP. Otherwise 0" 
      },
      unitPrice: { 
        type: Type.STRING, 
        description: "Formatted unit cost string, e.g. '$3.50 each' or '$1.99 / lb'" 
      },
      normalizedUnitCost: { type: Type.NUMBER },
      normalizedUnitType: {
        type: Type.STRING,
        enum: ['lb', 'oz', 'unit', 'gallon', 'count', 'dozen'],
      },
      unitDescription: { type: Type.STRING },
      dealType: {
        type: Type.STRING,
        enum: ['sale', 'bogo', 'digital_coupon', 'multi_buy', 'clearance'],
      },
      dealBadge: { type: Type.STRING },
      validUntil: { type: Type.STRING },
      inStock: { type: Type.BOOLEAN },
      genericProductGroup: { type: Type.STRING },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      brand: { type: Type.STRING },
      qualityTier: {
        type: Type.STRING,
        enum: ['budget', 'standard', 'premium', 'organic'],
      },
      promoBadgeText: {
        type: Type.STRING,
        description: "EXACT text from graphic badges, banners, or bursts on the image, e.g. '2 FOR $7', 'BUY 1 GET 2 FREE', 'BUY ONE, GET ONE 50% OFF', '3 FOR $5'",
      },
      hasExplicitDollarPrice: {
        type: Type.BOOLEAN,
        description: "FALSE if ad only states BOGO, buy 1 get 2 free, or % off without a base dollar price",
      },
      bundleQuantity: {
        type: Type.INTEGER,
        description: "Number of units required to get the deal (e.g. 2 for '2 for $7', 3 for 'buy 1 get 2 free', 1 for single item)",
      },
      bundleTotalPrice: {
        type: Type.NUMBER,
        description: "Total bundle price if multi-buy, e.g. 7.00 for '2 for $7'. Null/0 if not a bundle.",
      },
      isUnpricedPromo: {
        type: Type.BOOLEAN,
        description: "TRUE if the circular graphic displays an offer (BOGO, Buy X Get Y, % off) but prints NO base dollar amount.",
      },
      hasExplicitOriginalPrice: {
        type: Type.BOOLEAN,
        description: 'True ONLY if a regular/crossed-out price is explicitly printed in the ad',
      },
    },
    required: [
      'ocrTranscript',
      'id',
      'storeId',
      'storeName',
      'storeLogoBg',
      'storeLogoText',
      'title',
      'category',
      'originalPrice',
      'salePrice',
      'discountPercent',
      'unitPrice',
      'normalizedUnitCost',
      'normalizedUnitType',
      'unitDescription',
      'dealType',
      'validUntil',
      'inStock',
      'genericProductGroup',
      'tags',
    ],
  },
};

const comparisonResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    bestDealId: {
      type: Type.STRING,
      description: 'The exact ID of the objectively superior deal based on unit economics and value.',
    },
    verdict: {
      type: Type.STRING,
      description: '1-2 sentence authoritative shopper recommendation.',
    },
    keyDifference: {
      type: Type.STRING,
      description: 'Mathematical unit cost advantage or quality tier distinction.',
    },
    unitPriceAdvantage: {
      type: Type.STRING,
      description: 'Formatted unit cost comparison (e.g. "$1.99/lb vs $3.49/lb - 43% lower").',
    },
    caveats: {
      type: Type.STRING,
      description: 'Any purchase requirements, membership constraints, or loyalty clip rules.',
    },
  },
  required: ['bestDealId', 'verdict', 'keyDifference', 'unitPriceAdvantage', 'caveats'],
};

function parseJsonFromText<T>(text: string | null | undefined, fallback: T): T {
  if (!text || typeof text !== 'string') {
    return fallback;
  }
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  if (!cleaned) {
    return fallback;
  }
  try {
    const jsonStart = cleaned.indexOf('[');
    const jsonEnd = cleaned.lastIndexOf(']');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      return JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
    }
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      return JSON.parse(cleaned.substring(objStart, objEnd + 1));
    }
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

const NON_GROCERY_KEYWORDS = [
  'vtech', 'leapfrog', 'lego', 'toy', 'doll', 'plush', 'playset',
  'action figure', 'board game', 'apparel', 'shirt', 'pants', 'towel',
  'jeans', 'shoes', 'boots', 't-shirt', 'hoodie', 'socks', 'underwear',
  'tv', 'television', 'headphone', 'earbuds', 'ipad', 'tablet',
  'laptop', 'console', 'nintendo', 'playstation', 'xbox',
  'blender', 'vacuum', 'microwave', 'patio', 'furniture', 'rug',
  'doors opening', 'grand opening', 'hiring', 'now open', 'weekly ad'
];

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

/**
 * Programmatic Post-Processing Sanitizer.
 * Enforces strict grocery-only filtration, drops non-grocery general merchandise,
 * purges unpriced banners/promotions, normalizes multi-buys, and eliminates hallucinated discounts.
 */
export function sanitizeAndValidateDeals(rawDeals: DealItem[]): DealItem[] {
  const cleanedDeals = (rawDeals || [])
    .filter((deal: any) => {
      if (!isValidGroceryDeal(deal)) return false;

      const titleLower = deal.title.toLowerCase();
      const subLower = (deal.subtitle || '').toLowerCase();
      const badgeLower = (deal.promoBadgeText || deal.dealBadge || '').toLowerCase();
      const combinedText = `${titleLower} ${subLower} ${badgeLower}`;

      // 1. Drop non-grocery merchandise
      if (
        NON_GROCERY_KEYWORDS.some((keyword) => {
          if (keyword === 'towel' && combinedText.includes('paper towel')) {
            return false;
          }
          return combinedText.includes(keyword);
        })
      ) {
        return false;
      }

      // 2. Drop non-grocery category tags
      if (deal.category === 'household' && (combinedText.includes('toy') || combinedText.includes('item'))) {
        const validHousehold = ['paper', 'towel', 'tissue', 'soap', 'detergent', 'cleaner', 'trash', 'foil', 'bag'];
        if (!validHousehold.some((w) => combinedText.includes(w))) {
          return false;
        }
      }

      // 3. Drop produce/grocery extreme price anomalies
      if (deal.category === 'produce' && deal.salePrice > 20.0) {
        return false;
      }

      return true;
    })
    .map((deal: any) => {
      const transcript = (deal.ocrTranscript || '').toUpperCase();
      const badge = (deal.promoBadgeText || '').toUpperCase();
      const title = (deal.title || '').toUpperCase();
      const combined = `${transcript} ${badge} ${title}`.trim();

      // Dynamic Multi-Buy Parser (works for any "X for $Y" or "X/$Y")
      const multiMatch = combined.match(/(\d+)\s*(?:FOR|\/)\s*\$?(\d+(?:\.\d{2})?)/);
      if (multiMatch) {
        const qty = parseInt(multiMatch[1], 10);
        const total = parseFloat(multiMatch[2]);
        if (qty > 1 && total > 0) {
          deal.bundleQuantity = qty;
          deal.bundleTotalPrice = total;
          deal.salePrice = Number((total / qty).toFixed(2));
          deal.unitDescription = `${qty} for $${total.toFixed(2)} ($${deal.salePrice.toFixed(2)} ea)`;
          deal.dealType = 'multi_buy';
          deal.normalizedUnitCost = deal.salePrice;
          deal.unitPrice = `$${deal.salePrice.toFixed(2)} each`;
        }
      } else if (deal.bundleQuantity && deal.bundleQuantity > 1 && deal.bundleTotalPrice) {
        deal.salePrice = Number((deal.bundleTotalPrice / deal.bundleQuantity).toFixed(2));
        deal.unitDescription = `${deal.bundleQuantity} for $${deal.bundleTotalPrice.toFixed(2)} ($${deal.salePrice.toFixed(2)} ea)`;
        deal.dealType = 'multi_buy';
        deal.normalizedUnitCost = deal.salePrice;
        deal.unitPrice = `$${deal.salePrice.toFixed(2)} each`;
      }

      // Dynamic Unpriced Promotion Catch
      const isUnpricedOffer =
        deal.isUnpricedPromo ||
        !deal.salePrice ||
        deal.salePrice === 0 ||
        /BOGO|BUY\s+\d+\s+GET|FREE|\d+%\s+OFF/.test(combined);

      if (isUnpricedOffer && (!deal.bundleQuantity || deal.bundleQuantity <= 1)) {
        deal.isUnpricedPromo = true;
        deal.salePrice = 0;
        deal.originalPrice = 0;
        deal.discountPercent = 0;
        deal.dealType = 'bogo';
      }

      // Recalculate normalized unit cost if single unit and not unpriced promo
      if (!deal.isUnpricedPromo && (!deal.normalizedUnitCost || isNaN(deal.normalizedUnitCost) || deal.normalizedUnitCost === 0)) {
        deal.normalizedUnitCost = deal.salePrice;
        deal.normalizedUnitType = deal.normalizedUnitType || 'unit';
        deal.unitPrice = `$${deal.salePrice.toFixed(2)} / ${deal.normalizedUnitType}`;
      }

      // Strip non-verified MSRPs
      if (!deal.hasExplicitOriginalPrice || deal.originalPrice <= deal.salePrice) {
        deal.originalPrice = deal.salePrice;
        deal.discountPercent = 0;
      }

      return deal;
    });

  return cleanedDeals;
}

interface OCRVerifyResult {
  hasPromoBadge: boolean;
  promoBadgeText?: string;
  bundleQuantity?: number;
  bundleTotalPrice?: number;
  unitSalePrice?: number;
  isUnpricedPromo?: boolean;
}

/**
 * Downloads image bytes for a circular tile and sends them to Gemini Vision
 * to inspect graphic bursts, badges, and multi-buy pricing.
 */
async function ocrVerifyDealTile(
  ai: GoogleGenAI,
  deal: DealItem
): Promise<Partial<DealItem> | null> {
  if (!deal.imageUrl) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(deal.imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    clearTimeout(timeoutId);
    if (!res.ok) return { subtitle: `DEBUG Fetch: HTTP ${res.status}` };

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');
    
    let mimeType = 'image/jpeg';
    if (buffer.length > 4) {
      const hex = buffer.subarray(0, 4).toString('hex').toLowerCase();
      if (hex.startsWith('89504e47')) mimeType = 'image/png';
      else if (hex.startsWith('52494646')) mimeType = 'image/webp';
    }

    let responseText = '';
    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: { mimeType, data: base64Data },
            },
            {
              text: `Analyze this grocery store circular ad image tile.
Look for multi-buy deals (e.g., "2 for $10", "3 for $4", "2/$5", "10/$10").
If found, set bundleQuantity (integer) and bundleTotalPrice (number).
Respond ONLY with raw JSON:
{
  "bundleQuantity": number,
  "bundleTotalPrice": number,
  "isUnpricedPromo": boolean
}`,
            },
          ],
        });
        if (response?.text) {
          responseText = response.text;
          break;
        }
      } catch (apiErr: any) {
        lastError = apiErr;
      }
    }

    if (!responseText) {
      if (lastError) return { subtitle: `DEBUG API: ${lastError.message?.substring(0, 40)}` };
      return { subtitle: 'DEBUG: API Returned Empty Response' };
    }

    const cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseErr: any) {
      return { subtitle: `DEBUG JSON: ${cleanedText.substring(0, 30)}` };
    }

    if (parsed.bundleQuantity && parsed.bundleQuantity > 1 && parsed.bundleTotalPrice && parsed.bundleTotalPrice > 0) {
      const singlePrice = Number((parsed.bundleTotalPrice / parsed.bundleQuantity).toFixed(2));
      return {
        bundleQuantity: parsed.bundleQuantity,
        bundleTotalPrice: parsed.bundleTotalPrice,
        salePrice: singlePrice,
        unitPrice: `$${singlePrice.toFixed(2)} each`,
        normalizedUnitCost: singlePrice,
        normalizedUnitType: deal.normalizedUnitType || 'unit',
        unitDescription: `${parsed.bundleQuantity} for $${parsed.bundleTotalPrice.toFixed(2)} ($${singlePrice.toFixed(2)} ea)`,
        dealType: 'multi_buy',
        isUnpricedPromo: false,
        subtitle: '',
      };
    }

    if (parsed.isUnpricedPromo) {
      return {
        isUnpricedPromo: true,
        salePrice: 0,
        originalPrice: 0,
        dealType: 'bogo',
        subtitle: '',
      };
    }

    return { subtitle: '' };
  } catch (err: any) {
    if (err.name === 'AbortError') return { subtitle: 'DEBUG: Fetch Timeout' };
    return { subtitle: `DEBUG Fatal: ${err.message?.substring(0, 30)}` };
  }
}

export async function enrichDealsWithOCR(
  ai: GoogleGenAI,
  deals: DealItem[]
): Promise<DealItem[]> {
  const candidateDeals: DealItem[] = [];

  // Filter candidates first
  for (const deal of deals) {
    const isWholeDollar = deal.salePrice >= 2 && Math.floor(deal.salePrice) === deal.salePrice;
    const isUnpriced = !deal.salePrice || deal.salePrice === 0;

    if (deal.imageUrl && (isWholeDollar || isUnpriced)) {
      candidateDeals.push(deal);
    }
  }

  if (candidateDeals.length === 0) return deals;

  // NO QUOTA CAP: We process all candidates to intentionally expose 429 limits
  const ocrResults: { id: string; update: Partial<DealItem> | null }[] = [];
  
  // Staggering in chunks of 5 just to prevent browser/network level socket hangups
  const chunkSize = 5;

  for (let i = 0; i < candidateDeals.length; i += chunkSize) {
    const chunk = candidateDeals.slice(i, i + chunkSize);
    
    const chunkResults = await Promise.all(
      chunk.map(async (deal) => {
        const update = await ocrVerifyDealTile(ai, deal);
        return { id: deal.id, update };
      })
    );
    
    ocrResults.push(...chunkResults);

    // Minor 1s delay so Vercel doesn't kill the TCP connections
    if (i + chunkSize < candidateDeals.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

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

/**
 * Live Grounded Circular Ingestion via Google Search Grounding.
 */
export async function getCircularsForLocation(
  lat: number,
  lng: number,
  city: string = 'Mechanicsburg',
  state: string = 'PA',
  zipCode: string = '17050',
  radiusMiles: number = 10
): Promise<{ stores: Store[]; deals: DealItem[] }> {
  const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusMiles}`;
  const cached = circularsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  let stores: Store[] = [];

  const regionalStores = getRegionalDefaultStores(city, state, lat, lng, radiusMiles);
  let osmStores: Store[] = [];

  try {
    osmStores = await findPhysicalGroceryStoresOSM(lat, lng, radiusMiles);
  } catch (err: any) {
    console.info('[GeminiService] OSM discovery fallback to regional directory:', err?.message || err);
  }

  // Prioritize primary regional supermarkets, followed by OSM discovered stores
  stores = [...regionalStores, ...osmStores];

  // Deduplicate stores by ID and distinct chain key (keeping closest)
  const uniqueStoreMap = new Map<string, Store>();
  const seenChains = new Set<string>();

  for (const s of stores) {
    if (!s || !s.id) continue;
    const chainKey = (s.chain || s.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenChains.has(chainKey)) continue;
    seenChains.add(chainKey);
    uniqueStoreMap.set(s.id, s);
  }
  stores = (Array.from(uniqueStoreMap.values()) || []).filter((s) => (s?.distanceMiles ?? 0) <= radiusMiles);

  if (stores.length === 0) {
    return { stores: [], deals: [] };
  }

  // Always fetch the complete, authentic Karns circular (all 226 items)
  let karnsDeals: DealItem[] = [];
  const karnsStore = stores.find((s) => (s?.name || '').toLowerCase().includes('karns') || (s?.chain || '').toLowerCase().includes('karns'));
  if (karnsStore) {
    try {
      karnsDeals = await getFullKarnsCircularDeals(karnsStore);
      karnsStore.totalDealsCount = karnsDeals.length;
    } catch (err) {
      console.warn('[GeminiService] Error fetching full Karns circular, falling back:', err);
    }
  }

  const otherStores = stores.filter((s) => s !== karnsStore);

  // Fetch real, live circular items for other stores (ALDI, Giant, The Fresh Market, Trader Joe's, Weis, etc.)
  const liveDealsByStore = new Map<string, DealItem[]>();
  await Promise.all(
    otherStores.map(async (s) => {
      try {
        const liveItems = await fetchLiveDealsForStore(s, zipCode);
        if (liveItems && liveItems.length > 0) {
          liveDealsByStore.set(s.id, liveItems);
          s.totalDealsCount = liveItems.length;
        }
      } catch (err) {
        console.warn(`[GeminiService] Error in fetchLiveDealsForStore for ${s.name}:`, err);
      }
    })
  );

  // Check if any stores need AI circular search
  const storesNeedingDeals = otherStores.filter((s) => !liveDealsByStore.has(s.id) || (liveDealsByStore.get(s.id)?.length || 0) === 0);

  let aiDeals: DealItem[] = [];
  const ai = getAiClient();

  if (storesNeedingDeals.length > 0 && ai) {
    try {
      const storeSummary = storesNeedingDeals.map((s) => ({
        id: s.id,
        name: s.name,
        chain: s.chain,
        address: `${s.address}, ${s.city}`,
      }));

      const currentDate = new Date().toISOString().split('T')[0];
      const searchInstructions = storesNeedingDeals.map((s) => {
        return `- ${s.name}: "${s.name} ${city} ${state} weekly ad circular deals"`;
      }).join('\n');

      const prompt = `
Based on current weekly grocery circulars, flyers, and advertised specials for supermarkets near ${city}, ${state} ${zipCode} active as of ${currentDate}:

Specifically, search for:
${searchInstructions}

Target Supermarkets:
${JSON.stringify(storeSummary, null, 2)}

CRITICAL STEP-BY-STEP TRANSCRIPTION & PRICING RULES:
1. STEP 1 (OCR FIRST):
   You MUST begin every deal extraction by transcribing every piece of text visible on the image tile or circular listing into 'ocrTranscript'.
   Read every badge, banner, small print, and large number verbatim.
2. STEP 2 (DETECT MULTI-BUYS):
   Inspect your 'ocrTranscript'. If it contains any variation of 'X for $Y', 'X/$Y', or 'Buy X for $Y':
   - Set promoBadgeText = 'X for $Y'
   - Set bundleQuantity = X
   - Set bundleTotalPrice = Y
   - CALCULATE: salePrice = Y / X (e.g., for '2 for $4', salePrice MUST be 2.00. NEVER set salePrice to 4.00).
   - Set unitPrice = '$' + (Y / X).toFixed(2) + ' each'
3. STEP 3 (UNPRICED PROMOTIONS):
   If 'ocrTranscript' contains 'BUY 1 GET 1 FREE', 'BUY 1 GET 2 FREE', or '% OFF' but NO dollar amount is printed anywhere:
   - Set isUnpricedPromo = true
   - Set salePrice = 0.00
   - Set originalPrice = 0.00
   - Set discountPercent = 0
   - DO NOT INVENT A $3.99 OR ANY PLACEHOLDER PRICE.
4. STEP 4 (NO FABRICATED DISCOUNTS):
   If no original/strikethrough price is printed, set originalPrice = salePrice and discountPercent = 0.

STRICT EXCLUSIONS & FILTERS:
1. FOOD & GROCERY ONLY:
   Extract ONLY edible food, beverages, and consumable grocery essentials.
   STRICTLY IGNORE and DROP all non-grocery departments:
   - NO toys, children's learning sets (e.g., VTech, LeapFrog, LEGO, Barbie)
   - NO apparel, shoes, or clothing
   - NO electronics, TVs, video games, or appliances
   - NO patio, furniture, or home decor
2. BAN BANNER HEADERS:
   Never parse store announcements, grand openings (e.g. "Doors opening in College Station"), hiring notices, or weekly circular headers as product deals. Every item MUST be an edible food or household consumer product.
3. STRICT CONSUMER UNIT MATCHING:
   Apples, produce, and meats must be priced per standard consumer units ($/lb, $/oz, or per piece), NEVER whole agricultural crates or bulk cases.

Extract authentic advertised items, sales, and butcher shop specials.
Return ONLY a valid JSON array of deal objects matching DealItem schema.
`;

      const modelsToTry = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
      for (let i = 0; i < modelsToTry.length; i++) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI inference timeout')), 20000)
          );
          const result = (await Promise.race([
            ai.models.generateContent({
              model: modelsToTry[i],
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: dealsResponseSchema,
                temperature: 0.1,
              },
            }),
            timeoutPromise,
          ])) as any;
          if (result?.text && result.text.trim()) {
            const parsed = parseJsonFromText<DealItem[]>(result.text, []);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const sanitized = sanitizeAndValidateDeals(parsed);
              if (sanitized.length > 0) {
                aiDeals = sanitized;
                break;
              }
            }
          }
        } catch {
          // Gracefully continue to subsequent model tier if current model experiences high demand spikes or timeout
        }
      }
    } catch {
      // Gracefully continue with verified circulars
    }
  }

  // Combine deals from all stores with genuine live circulars
  const nonKarnsDeals: DealItem[] = [];
  const activeStores: Store[] = [];

  if (karnsStore && karnsDeals.length > 0) {
    activeStores.push(karnsStore);
  }

  for (const store of otherStores) {
    const liveItems = liveDealsByStore.get(store.id);
    if (liveItems && liveItems.length > 0) {
      nonKarnsDeals.push(...liveItems);
      activeStores.push(store);
    } else {
      // Check if AI found deals for this store
      const matchingAi = aiDeals.filter(
        (d) => d.storeId === store.id || d.storeName?.toLowerCase().includes(store.name.toLowerCase())
      );
      if (matchingAi.length > 0) {
        matchingAi.forEach((d, idx) => {
          d.storeId = store.id;
          d.storeName = store.name;
          d.storeLogoBg = store.logoBg;
          d.storeLogoText = store.logoText;
          if (!d.id) d.id = `${store.id}-ai-${idx + 1}-${Date.now()}`;
        });
        store.totalDealsCount = matchingAi.length;
        nonKarnsDeals.push(...matchingAi);
        activeStores.push(store);
      }
    }
  }

  // If in an unsupported region with zero live flyers across all stores, only then provide emergency regional fallback
  if (activeStores.length === 0 && karnsDeals.length === 0) {
    const fallback = generateDeterministicFallbackDeals(otherStores.slice(0, 3));
    nonKarnsDeals.push(...fallback);
    activeStores.push(...otherStores.slice(0, 3));
  }

  const finalStores = activeStores;
  const combinedDeals = [...karnsDeals, ...nonKarnsDeals];
  const seenDealIds = new Set<string>();
  combinedDeals.forEach((d, idx) => {
    if (!d.id || seenDealIds.has(d.id)) {
      d.id = `${d.storeId || 'deal'}-${idx + 1}-${Date.now()}`;
    }
    seenDealIds.add(d.id);
  });

  const sanitizedCombinedDeals = sanitizeAndValidateDeals(combinedDeals);

  // Execute server-side Vision OCR enrichment on candidate deals
  let finalDeals = sanitizedCombinedDeals;
  if (ai && Array.isArray(finalDeals) && finalDeals.length > 0) {
    try {
      finalDeals = await enrichDealsWithOCR(ai, finalDeals);
    } catch (ocrErr) {
      console.warn('[GeminiService] enrichDealsWithOCR skipped due to error:', ocrErr);
    }
  }

  // Update store deal counters with final counts
  const counts: Record<string, number> = {};
  finalDeals.forEach((d) => {
    counts[d.storeId] = (counts[d.storeId] || 0) + 1;
  });
  finalStores.forEach((s) => {
    s.totalDealsCount = counts[s.id] || 0;
  });

  const result = { stores: finalStores, deals: finalDeals };
  circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
}

/**
 * Multimodal PDF & Flyer Image OCR Deal Extractor.
 */
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
Analyze this physical weekly circular flyer or promotional PDF for "${store.name}".
Extract EVERY advertised grocery product special, butcher meat cut, produce price, and BOGO deal shown.

CRITICAL STEP-BY-STEP TRANSCRIPTION & PRICING RULES:
1. STEP 1 (OCR FIRST):
   You MUST begin every deal extraction by transcribing every piece of text visible on the image tile into 'ocrTranscript'.
   Read every badge, banner, small print, and large number verbatim.
2. STEP 2 (DETECT MULTI-BUYS):
   Inspect your 'ocrTranscript'. If it contains any variation of 'X for $Y', 'X/$Y', or 'Buy X for $Y':
   - Set promoBadgeText = 'X for $Y'
   - Set bundleQuantity = X
   - Set bundleTotalPrice = Y
   - CALCULATE: salePrice = Y / X (e.g., for '2 for $4', salePrice MUST be 2.00. NEVER set salePrice to 4.00).
   - Set unitPrice = '$' + (Y / X).toFixed(2) + ' each'
3. STEP 3 (UNPRICED PROMOTIONS):
   If 'ocrTranscript' contains 'BUY 1 GET 1 FREE', 'BUY 1 GET 2 FREE', or '% OFF' but NO dollar amount is printed anywhere:
   - Set isUnpricedPromo = true
   - Set salePrice = 0.00
   - Set originalPrice = 0.00
   - Set discountPercent = 0
   - DO NOT INVENT A $3.99 OR ANY PLACEHOLDER PRICE.
4. STEP 4 (NO FABRICATED DISCOUNTS):
   If no original/strikethrough price is printed, set originalPrice = salePrice and discountPercent = 0.

STRICT EXCLUSIONS & FILTERS:
1. FOOD & GROCERY ONLY:
   Extract ONLY edible food, beverages, and consumable grocery essentials.
   STRICTLY IGNORE and DROP all non-grocery departments:
   - NO toys, children's learning sets (e.g., VTech, LeapFrog, LEGO, Barbie)
   - NO apparel, shoes, or clothing
   - NO electronics, TVs, video games, or appliances
   - NO patio, furniture, or home decor
2. BAN BANNER HEADERS:
   Never parse store announcements, grand openings (e.g. "Doors opening in College Station"), hiring notices, or weekly circular headers as product deals. Every item MUST be an edible food or household consumer product.
3. STRICT CONSUMER UNIT MATCHING:
   Apples, produce, and meats must be priced per standard consumer units ($/lb, $/oz, or per piece), NEVER whole agricultural crates or bulk cases.

Requirements for each extracted item:
1. "title": Exact item description from the circular.
2. "originalPrice": Exact stated pre-sale price if printed; if not printed, set equal to salePrice.
3. "salePrice": True single-unit promotional package or per-pound sale price (e.g., $3.50 for 2-for-$7 deal; 0.00 for unpriced BOGOs).
4. "discountPercent": Percentage discount integer, or 0 if pre-sale price is not explicitly printed.
5. "unitPrice": Formatted normalized unit price string (e.g., "$3.49 / lb", "$0.20 / egg", "$2.49 / 16 oz").
6. "normalizedUnitCost": Precise numeric float for mathematical sorting.
7. "normalizedUnitType": One of ['lb', 'oz', 'unit', 'gallon', 'count', 'dozen'].
8. "unitDescription": Brief explanation (e.g. "per pound", "per egg", "2 for $7 ($3.50 ea)").
9. "dealType": One of ['sale', 'bogo', 'digital_coupon', 'multi_buy'].
10. "dealBadge": Visual highlight text if present (e.g. "BUTCHER CUT", "BUY 1 GET 1", "CLIP COUPON").
11. "promoBadgeText": Exact text from graphic badges, e.g. '2 FOR $7', 'BUY 1 GET 2 FREE', 'BUY ONE, GET ONE 50% OFF', 'SUPER 6'.
12. "hasExplicitDollarPrice": Boolean. FALSE if ad only states BOGO, buy 1 get 2 free, or % off without a base dollar price.
13. "genericProductGroup": Normalized commodity key for cross-store comparison matching:
    (e.g., 'ground_beef_80_20', 'boneless_chicken_breast', 'large_white_eggs', 'whole_milk_gallon',
     'strawberries_1lb', 'honeycrisp_apples', 'bacon_16oz', 'shredded_cheddar_cheese', 'sourdough_bread').
14. "storeId": Set to "${store.id}".
15. "storeName": Set to "${store.name}".
16. "storeLogoBg": Set to "${store.logoBg}".
17. "storeLogoText": Set to "${store.logoText}".
18. "validUntil": Extract valid flyer end date, or set to next Tuesday/Wednesday.
19. "inStock": true.
20. "bundleQuantity": Integer (default 1, e.g. 2 for "2 for $7").
21. "bundleTotalPrice": Total price for bundle (e.g. 7.00), or null.
22. "isUnpricedPromo": Boolean (true for unpriced BOGOs/percent-off without base price).
23. "hasExplicitOriginalPrice": Boolean (true ONLY if regular/crossed-out price is printed).
`;

  const modelsToTry = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  let response;
  for (let i = 0; i < modelsToTry.length; i++) {
    try {
      response = await ai.models.generateContent({
        model: modelsToTry[i],
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          { text: prompt },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: dealsResponseSchema,
          temperature: 0.1,
        },
      });
      if (response?.text) break;
    } catch {
      // Continue to next model tier
    }
  }

  const parsed = response?.text ? parseJsonFromText<DealItem[]>(response.text, []) : [];
  const sanitized = sanitizeAndValidateDeals(parsed);

  return sanitized.map((item, idx) => ({
    ...item,
    id: item.id || `scanned-${store.id}-${Date.now()}-${idx}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg,
    storeLogoText: store.logoText,
  }));
}

/**
 * Universal Vision Pipeline for non-Flipp store flyers (e.g. Trader Joe's, The Fresh Market, Piggly Wiggly).
 * Downloads raw flyer promotional images and runs multimodal extraction with Gemini.
 */
export async function extractDealsFromFlyerImage(
  store: Store,
  imageUrl: string
): Promise<DealItem[]> {
  const ai = getAiClient();
  if (!ai) {
    console.warn('[Vision Pipeline] Gemini AI offline. Cannot parse flyer image.');
    return [];
  }

  try {
    // 1. Fetch the image and convert to base64
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch flyer image: ${imgRes.status}`);
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    // 2. Build the Vision Prompt
    const prompt = `
You are DealScout's Universal Vision Pipeline.
Target Store: ${store.name} (${store.chain})
Category Speciality: ${store.featuredCategory || 'Grocery'}

Task: 
Extract every grocery deal visible in this promotional flyer image.
Reflect the store's real brand signatures.

Rules:
1. 'salePrice' MUST be the final sale price.
2. Ensure 'normalizedUnitCost' is mathematically precise ($/lb, $/oz, $/gallon, $/unit, $/dozen).
3. Check for multi-buys ("2 for $10") and calculate 'normalizedUnitCost' correctly.
4. Assign a standard 'genericProductGroup' identifier (e.g., "ground_beef_80_20", "honeycrisp_apples") to match against competitors.
5. Set 'inStock' to true.
`;

    // 3. Send Multimodal Request with model fallback
    const modelsToTry = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
    let response: any = null;

    for (const model of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [
            prompt,
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
              },
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: dealsResponseSchema,
            temperature: 0.1,
          },
        });
        if (response?.text) break;
      } catch {
        // Try next model tier
      }
    }

    if (!response?.text) {
      return [];
    }

    const parsedDeals = parseJsonFromText<DealItem[]>(response.text, []);
    const sanitized = sanitizeAndValidateDeals(parsedDeals);

    // 4. Decorate deals with store IDs
    return sanitized.map((deal, idx) => ({
      ...deal,
      id: `${store.id}-vision-${Date.now()}-${idx}`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
    }));
  } catch (err) {
    console.error('[Vision Pipeline] AI Flyer Extraction Failed:', err);
    return [];
  }
}

export async function compareDealsWithAI(
  productGroupName: string,
  deals: DealItem[]
): Promise<AIComparisonResult> {
  if (!deals || deals.length === 0) {
    throw new Error('Cannot compare an empty list of deals.');
  }

  if (deals.length === 1) {
    const single = deals[0];
    return {
      bestDealId: single.id,
      verdict: `Sole offer available at ${single.storeName}.`,
      keyDifference: `No competing circular deals found in your area.`,
      unitPriceAdvantage: `${single.unitPrice}`,
      caveats: single.dealType === 'digital_coupon' ? 'Requires digital coupon clipping.' : 'None',
    };
  }

  const ai = getAiClient();
  if (!ai) {
    return generateDeterministicComparison(productGroupName, deals);
  }

  try {
    const prompt = `
Analyze these competing supermarket deals for the product commodity "${productGroupName}".
Identify the single best purchase based on true unit cost, quality tier, and purchase friction.

Competing Deals:
${JSON.stringify(deals, null, 2)}

Evaluation Criteria:
1. True Normalized Unit Cost ($/lb, $/oz, $/egg, etc.) is the top factor.
2. Note if a lower price requires buying multiples (e.g. Buy 2 Get 1 Free, Must Buy 3) or digital loyalty coupons.
3. Compare quality tiers (Organic/Grass-fed vs Conventional).
`;

    const modelsToTry = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
    let response;
    for (let i = 0; i < modelsToTry.length; i++) {
      try {
        response = await ai.models.generateContent({
          model: modelsToTry[i],
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: comparisonResponseSchema,
            temperature: 0.1,
          },
        });
        if (response?.text) break;
      } catch {
        // Continue to next model tier
      }
    }

    if (response?.text) {
      const parsed = parseJsonFromText<AIComparisonResult | null>(response.text, null);
      if (parsed && parsed.bestDealId && parsed.verdict) {
        return parsed;
      }
    }
  } catch {
    // Utilize deterministic fallback
  }

  return generateDeterministicComparison(productGroupName, deals);
}


function generateDeterministicComparison(
  productGroupName: string,
  deals: DealItem[]
): AIComparisonResult {
  const sorted = [...deals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
  const best = sorted[0];
  const runnerUp = sorted[1];

  const diff = runnerUp ? runnerUp.normalizedUnitCost - best.normalizedUnitCost : 0;
  const pctDiff = runnerUp ? Math.round((diff / runnerUp.normalizedUnitCost) * 100) : 0;

  const advantageStr = runnerUp
    ? `${best.unitPrice} at ${best.storeName} vs ${runnerUp.unitPrice} at ${runnerUp.storeName} (${pctDiff}% cheaper)`
    : `${best.unitPrice} at ${best.storeName}`;

  let caveats = 'No special purchase restrictions noted.';
  if (best.dealType === 'digital_coupon') {
    caveats = 'Requires clipping a digital coupon in the store app.';
  } else if (best.dealType === 'bogo') {
    caveats = 'Requires purchasing two items to receive the promotional price.';
  } else if (best.dealType === 'multi_buy') {
    caveats = 'Price valid only when purchasing specified quantity.';
  }

  const prettyName = productGroupName.replace(/_/g, ' ');

  return {
    bestDealId: best.id,
    verdict: `${best.storeName} offers the lowest true cost on ${prettyName}, saving you money per unit.`,
    keyDifference: runnerUp
      ? `Save $${diff.toFixed(2)} per ${best.normalizedUnitType} compared to ${runnerUp.storeName}.`
      : 'Lowest available unit price among local circulars.',
    unitPriceAdvantage: advantageStr,
    caveats,
  };
}


export function generateDeterministicFallbackDeals(stores: Store[]): DealItem[] {
  const allDeals: DealItem[] = [];
  const currentDate = new Date().toISOString().split('T')[0];
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  stores.forEach((store) => {
    const sName = store.name.toLowerCase();
    let items: any[] = [];
    
    if (sName.includes('aldi')) {
      items = [
        { t: 'Fresh Hass Avocados', c: 'produce', o: 1.29, s: 0.69, ut: 'unit', ud: 'each', p: 0.69, k: 'hass_avocados', dt: 'sale' },
        { t: 'Fresh 73/27 Ground Beef', c: 'meat_seafood', o: 3.49, s: 2.99, ut: 'lb', ud: 'per lb', p: 2.99, k: 'ground_beef_80_20', dt: 'sale' },
        { t: 'Large White Eggs', c: 'dairy_eggs', o: 2.99, s: 1.99, ut: 'dozen', ud: 'per dozen', p: 1.99, k: 'large_white_eggs', dt: 'sale' },
        { t: 'Fresh Honeycrisp Apples', c: 'produce', o: 4.99, s: 3.49, ut: 'lb', ud: 'per lb', p: 3.49, k: 'honeycrisp_apples', dt: 'sale' },
        { t: 'Kirkwood Chicken Wings', c: 'meat_seafood', o: 12.99, s: 9.99, ut: 'lb', ud: 'per lb', p: 9.99, k: 'chicken_wings', dt: 'sale' }
      ];
    } else if (sName.includes('giant')) {
      items = [
        { t: 'Fresh 80/20 Ground Beef', c: 'meat_seafood', o: 5.99, s: 3.99, ut: 'lb', ud: 'per lb', p: 3.99, k: 'ground_beef_80_20', dt: 'sale' },
        { t: 'Giant Boneless Skinless Chicken Breast', c: 'meat_seafood', o: 4.99, s: 1.99, ut: 'lb', ud: 'per lb', p: 1.99, k: 'boneless_chicken_breast', dt: 'sale' },
        { t: 'Giant Brand Shredded Cheddar', c: 'dairy_eggs', o: 3.29, s: 2.00, ut: 'unit', ud: '8 oz bag', p: 2.00, k: 'shredded_cheddar_cheese', dt: 'sale' },
        { t: 'Whole Milk Gallon', c: 'dairy_eggs', o: 3.99, s: 3.29, ut: 'gallon', ud: 'per gallon', p: 3.29, k: 'whole_milk_gallon', dt: 'sale' },
        { t: 'Giant Brand Bacon', c: 'meat_seafood', o: 6.99, s: 4.99, ut: 'unit', ud: '16 oz pack', p: 4.99, k: 'bacon_16oz', dt: 'digital_coupon' }
      ];
    } else if (sName.includes('fresh market')) {
      items = [
        { t: 'Little Big Meal: Chicken Stir Fry', c: 'meat_seafood', o: 35.0, s: 25.0, ut: 'unit', ud: 'Meal for 4', p: 25.0, k: 'boneless_chicken_breast', dt: 'sale' },
        { t: 'Premium Extra Virgin Olive Oil', c: 'pantry_snacks', o: 14.99, s: 11.99, ut: 'unit', ud: '16 oz bottle', p: 11.99, k: 'extra_virgin_olive_oil', dt: 'sale' },
        { t: 'Fresh Strawberries', c: 'produce', o: 5.99, s: 3.99, ut: 'unit', ud: '1 lb container', p: 3.99, k: 'strawberries_1lb', dt: 'sale' },
        { t: 'Artisan Sourdough Boule', c: 'bakery_deli', o: 6.99, s: 5.49, ut: 'unit', ud: 'each', p: 5.49, k: 'sourdough_bread', dt: 'sale' },
        { t: 'Gourmet Ground Chuck', c: 'meat_seafood', o: 7.99, s: 5.99, ut: 'lb', ud: 'per lb', p: 5.99, k: 'ground_beef_80_20', dt: 'sale' }
      ];
    } else if (sName.includes('trader joe')) {
      items = [
        { t: 'Organic Large Brown Eggs', c: 'dairy_eggs', o: 4.49, s: 4.49, ut: 'dozen', ud: 'per dozen', p: 4.49, k: 'large_white_eggs', dt: 'sale' },
        { t: 'Teeny Tiny Avocados', c: 'produce', o: 3.99, s: 3.99, ut: 'unit', ud: '6-pack', p: 3.99, k: 'hass_avocados', dt: 'sale' },
        { t: 'Organic Honeycrisp Apples', c: 'produce', o: 5.49, s: 5.49, ut: 'lb', ud: 'per lb', p: 5.49, k: 'honeycrisp_apples', dt: 'sale' },
        { t: 'Trader Joe\'s Extra Virgin Olive Oil', c: 'pantry_snacks', o: 8.99, s: 8.99, ut: 'unit', ud: '16 oz bottle', p: 8.99, k: 'extra_virgin_olive_oil', dt: 'sale' },
        { t: 'Unexpected Cheddar Cheese', c: 'dairy_eggs', o: 4.99, s: 4.99, ut: 'unit', ud: 'per block', p: 4.99, k: 'shredded_cheddar_cheese', dt: 'sale' }
      ];
    } else {
      items = [
        { t: 'Fresh Ground Beef', c: 'meat_seafood', o: 5.49, s: 4.49, ut: 'lb', ud: 'per lb', p: 4.49, k: 'ground_beef_80_20', dt: 'sale' },
        { t: 'Large Eggs', c: 'dairy_eggs', o: 3.49, s: 2.49, ut: 'dozen', ud: 'per dozen', p: 2.49, k: 'large_white_eggs', dt: 'sale' },
        { t: 'Fresh Apples', c: 'produce', o: 2.99, s: 1.99, ut: 'lb', ud: 'per lb', p: 1.99, k: 'honeycrisp_apples', dt: 'sale' },
        { t: 'Whole Milk', c: 'dairy_eggs', o: 3.59, s: 2.99, ut: 'gallon', ud: 'per gallon', p: 2.99, k: 'whole_milk_gallon', dt: 'sale' }
      ];
    }

    items.forEach((item, index) => {
      allDeals.push({
        id: `${store.id}-deal-${index}-${Date.now()}`,
        storeId: store.id,
        storeName: store.name,
        storeLogoBg: store.logoBg,
        storeLogoText: store.logoText,
        title: item.t,
        category: item.c as any,
        originalPrice: item.o,
        salePrice: item.s,
        discountPercent: Math.round(((item.o - item.s) / item.o) * 100),
        unitPrice: `$${item.s.toFixed(2)} ${item.ud.replace('per ', '/ ')}`,
        normalizedUnitCost: item.p,
        normalizedUnitType: item.ut as any,
        unitDescription: item.ud,
        dealType: item.dt as any,
        genericProductGroup: item.k,
        validUntil,
        inStock: true,
        tags: [store.chain.toLowerCase(), 'weekly_ad'],
      });
    });
  });

  return allDeals;
}
