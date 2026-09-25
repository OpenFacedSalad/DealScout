import { GoogleGenAI, Type, Schema } from '@google/genai';
import sharp from 'sharp';
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
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
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
      flavorOrBrand: {
        type: Type.STRING,
        description: "STEP 1: Extract any brand names, flavors, or adjectives (e.g., 'Strawberry', 'Butternut', 'A.1.'). If none, leave blank."
      },
      coreBaseNoun: {
        type: Type.STRING,
        description: "STEP 2: Identify the fundamental physical object being sold (e.g., 'Soda', 'Pastry', 'Squash', 'Sauce'). NEVER include the flavor or brand."
      },
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
        enum: ['lb', 'oz', 'dozen', 'pkg', 'each', 'unit', 'gallon', 'count'],
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
      'flavorOrBrand',
      'coreBaseNoun',
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
  // 1. Get today's date strictly as YYYY-MM-DD in the local timezone to avoid UTC drift
  const now = new Date();
  const localMonth = String(now.getMonth() + 1).padStart(2, '0');
  const localDay = String(now.getDate()).padStart(2, '0');
  const todayString = `${now.getFullYear()}-${localMonth}-${localDay}`;

  const cleanedDeals = (rawDeals || [])
    .filter((deal: any) => {
      if (!isValidGroceryDeal(deal)) return false;

      // 2. Safely compare strings (e.g. '2026-09-17' < '2026-09-25')
      if (deal.validUntil) {
        const dealDateString = deal.validUntil.split('T')[0]; // Ensure it is just YYYY-MM-DD
        if (dealDateString < todayString) {
          return false; // Safely skip genuinely expired deals
        }
      }

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
      const validUnits = ['lb', 'oz', 'dozen', 'pkg', 'each'];
      let nType = (deal.normalizedUnitType || '').toLowerCase();
      if (!validUnits.includes(nType)) {
        if (nType === 'unit' || nType === 'count') {
          nType = 'each';
        } else {
          nType = 'each';
        }
      }

      const nCost = deal.normalizedUnitCost && !isNaN(Number(deal.normalizedUnitCost)) && Number(deal.normalizedUnitCost) > 0
        ? Number(deal.normalizedUnitCost)
        : (deal.salePrice || 0);

      deal.normalizedUnitCost = deal.isUnpricedPromo ? 0 : nCost;
      deal.normalizedUnitType = nType;
      if (!deal.unitPrice || deal.unitPrice === 'undefined' || deal.unitPrice === '$0.00 / undefined') {
        deal.unitPrice = deal.isUnpricedPromo ? 'Free / Unpriced' : `$${deal.normalizedUnitCost.toFixed(2)} / ${deal.normalizedUnitType}`;
      }

      // Strip non-verified MSRPs
      if (!deal.hasExplicitOriginalPrice || deal.originalPrice <= deal.salePrice) {
        deal.originalPrice = deal.salePrice;
        deal.discountPercent = 0;
      }

      const rawTitle = (deal.title || '').toLowerCase();
      if (!deal.genericProductGroup) {
        deal.genericProductGroup = `${deal.category || 'grocery'}_${rawTitle.replace(/[^a-z0-9]/g, '_').substring(0, 15)}_default`;
      }

      // Inject AI Chain of Thought into the subtitle for visual debugging
      const debugNoun = deal.coreBaseNoun || 'UNKNOWN_NOUN';
      const debugKey = deal.genericProductGroup || 'UNKNOWN_KEY';
      
      const originalSubtitle = deal.subtitle ? deal.subtitle + ' | ' : '';
      deal.subtitle = `${originalSubtitle}Noun: [${debugNoun}] -> Key: [${debugKey}]`;

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
 * Downloads image bytes for a circular tile, compresses with sharp, and sends them to Gemini Vision
 * to inspect graphic bursts, badges, and multi-buy pricing with a 10s fuse.
 */
async function ocrVerifyDealTile(
  ai: GoogleGenAI,
  deal: DealItem
): Promise<{ update: Partial<DealItem> | null; quotaExhausted?: boolean }> {
  if (!deal.imageUrl) return { update: null };

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
    if (!res.ok) return { update: null };

    const arrayBuffer = await res.arrayBuffer();
    
    // Compress and resize image to a max of 600px to prevent Gemini payload bloat
    const resizedBuffer = await sharp(Buffer.from(arrayBuffer))
      .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
      
    const base64Data = resizedBuffer.toString('base64');
    const optimizedContentType = 'image/jpeg';

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let response: any;
    let quotaHit = false;

    for (const model of modelsToTry) {
      try {
        const aiPromise = ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: optimizedContentType,
                  data: base64Data,
                },
              },
              {
                text: `Analyze this grocery store circular ad image tile with high-accuracy OCR:
1. Examine all visual text, yellow/red badges, bursts, banners, and price stamps.
2. Check for multi-buys (e.g., "2 for $10", "2 for $4", "3 for $5", "4 for $10", "10 for $10").
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
}`
              },
            ],
          },
          config: { responseMimeType: 'application/json' },
        });

        // 10-second fuse to prevent backend deadlocks if Gemini stalls
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Vision OCR Timeout')), 10000)
        );

        response = await Promise.race([aiPromise, timeoutPromise]) as any;
        
        if (response?.text) break;
      } catch (modelErr: any) {
        const errMsg = modelErr?.message || String(modelErr);
        const isQuota =
          modelErr?.status === 'RESOURCE_EXHAUSTED' ||
          modelErr?.code === 429 ||
          errMsg.includes('429') ||
          errMsg.includes('quota') ||
          errMsg.includes('Quota exceeded') ||
          errMsg.includes('RESOURCE_EXHAUSTED');

        if (isQuota) {
          quotaHit = true;
          // Quota limit hit on project key: do not retry remaining models in loop
          break;
        }

        const isUnavailable =
          modelErr?.status === 'UNAVAILABLE' ||
          modelErr?.code === 503 ||
          errMsg.includes('503') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('high demand');

        if (isUnavailable) {
          console.info(`[OCR] Model ${model} unavailable (high demand); trying fallback model.`);
        } else {
          console.info(`[OCR] Model ${model} did not complete; trying fallback model.`);
        }
      }
    }

    if (quotaHit) {
      return { update: null, quotaExhausted: true };
    }

    if (!response?.text) {
      return { update: null };
    }

    const cleanedText = response.text.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseErr: any) {
      return { update: null };
    }

    if (parsed.bundleQuantity && parsed.bundleQuantity > 1 && parsed.bundleTotalPrice && parsed.bundleTotalPrice > 0) {
      const singlePrice = parsed.unitSalePrice || Number((parsed.bundleTotalPrice / parsed.bundleQuantity).toFixed(2));
      return {
        update: {
          bundleQuantity: parsed.bundleQuantity,
          bundleTotalPrice: parsed.bundleTotalPrice,
          salePrice: singlePrice,
          unitPrice: `$${singlePrice.toFixed(2)} each`,
          normalizedUnitCost: singlePrice,
          normalizedUnitType: deal.normalizedUnitType || 'unit',
          unitDescription: `${parsed.bundleQuantity} for $${parsed.bundleTotalPrice.toFixed(2)} ($${singlePrice.toFixed(2)} ea)`,
          dealType: 'multi_buy',
          isUnpricedPromo: false,
          promoBadgeText: parsed.promoBadgeText || undefined,
          subtitle: '',
        },
      };
    }

    if (parsed.isUnpricedPromo) {
      return {
        update: {
          isUnpricedPromo: true,
          salePrice: 0,
          originalPrice: 0,
          dealType: 'bogo',
          promoBadgeText: parsed.promoBadgeText || undefined,
          subtitle: '',
        },
      };
    }

    if (parsed.hasPromoBadge && parsed.promoBadgeText) {
      return {
        update: {
          promoBadgeText: parsed.promoBadgeText,
          subtitle: '',
        },
      };
    }

    return { update: null };
  } catch (err: any) {
    return { update: null };
  }
}

export async function enrichDealsWithOCR(
  ai: GoogleGenAI,
  deals: DealItem[]
): Promise<DealItem[]> {
  const candidateDeals: DealItem[] = [];

  // Filter candidates and prioritize those most in need of OCR
  // Priority 1: Unpriced items
  // Priority 2: Suspected multi-buys with promo badges or whole dollar pricing
  const unpricedCandidates: DealItem[] = [];
  const multiBuyCandidates: DealItem[] = [];

  for (const deal of deals) {
    if (!deal.imageUrl) continue;
    const isUnpriced = !deal.salePrice || deal.salePrice === 0 || deal.isUnpricedPromo;
    const hasPromoSignal = /bogo|buy|get|free|\d+\s*(?:for|\/)\s*\$?\d+|save/i.test(
      `${deal.title} ${deal.subtitle || ''} ${deal.promoBadgeText || ''}`
    );
    const isWholeDollar = deal.salePrice >= 2 && Math.floor(deal.salePrice) === deal.salePrice;

    if (isUnpriced) {
      unpricedCandidates.push(deal);
    } else if (hasPromoSignal || isWholeDollar) {
      multiBuyCandidates.push(deal);
    }
  }

  // Cap OCR verification to a safe quota budget (e.g. max 3 candidates per search) to avoid 429 rate limit errors
  const MAX_OCR_CANDIDATES = 3;
  candidateDeals.push(...unpricedCandidates.slice(0, MAX_OCR_CANDIDATES));
  if (candidateDeals.length < MAX_OCR_CANDIDATES) {
    candidateDeals.push(...multiBuyCandidates.slice(0, MAX_OCR_CANDIDATES - candidateDeals.length));
  }

  if (candidateDeals.length === 0) return deals;

  const ocrResults: { id: string; update: Partial<DealItem> | null }[] = [];
  let quotaExhausted = false;

  for (const deal of candidateDeals) {
    if (quotaExhausted) break;
    try {
      const { update, quotaExhausted: isExhausted } = await ocrVerifyDealTile(ai, deal);
      if (isExhausted) {
        quotaExhausted = true;
        console.info('[Gemini OCR] Quota budget reached for image OCR; keeping standard circular data.');
        break;
      }
      if (update) {
        ocrResults.push({ id: deal.id, update });
      }
    } catch (err: any) {
      console.warn('[Gemini OCR] Error processing candidate tile:', err?.message || err);
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
    const timeoutPromise = new Promise<Store[]>((_, reject) =>
      setTimeout(() => reject(new Error('OSM POI timeout')), 8000)
    );
    osmStores = await Promise.race([
      findPhysicalGroceryStoresOSM(lat, lng, radiusMiles),
      timeoutPromise,
    ]);
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

CRITICAL INSTRUCTIONS:
1. Extract REAL advertised items and prices. Do NOT invent prices.
2. DICTIONARY MAPPING (CRITICAL): 
   - You MUST first deconstruct the item into "flavorOrBrand" and "coreBaseNoun".
   - Your final "genericProductGroup" MUST be selected based ONLY on the "coreBaseNoun", entirely ignoring the "flavorOrBrand".
   - Example: "Strawberry Prebiotic Soda" -> flavorOrBrand: "Strawberry Prebiotic", coreBaseNoun: "Soda". Maps to "beverages_soda".
   - Example: "Butternut Squash" -> flavorOrBrand: "Butternut", coreBaseNoun: "Squash". Maps to "produce_squash".

   Map to EXACTLY ONE string from this Allowed Product Keys array:
   [
     "produce_apple", "produce_banana", "produce_berries", "produce_grapes", "produce_citrus", "produce_potato", "produce_onion", "produce_squash", "produce_other",
     "meat_chicken_breast", "meat_chicken_other", "meat_beef_steak", "meat_beef_ground", "meat_pork", "meat_bacon", "meat_seafood_shrimp", "meat_seafood_fish",
     "dairy_milk", "dairy_butter", "dairy_margarine", "dairy_eggs", "dairy_cheese_shredded", "dairy_cheese_block", "dairy_yogurt",
     "pantry_cereal", "pantry_coffee", "pantry_pasta", "pantry_sauce", "pantry_snacks",
     "frozen_pizza", "frozen_waffles_pancakes", "frozen_ice_cream", "frozen_pastry", "frozen_meals",
     "beverages_soda", "beverages_water", "beverages_juice",
     "household_paper", "household_cleaning",
     "uncategorized_general"
   ]
3. Math & Normalization: You must populate "normalizedUnitType" with EXACTLY one of these values: "lb", "oz", "dozen", "pkg", or "each".
4. Calculate "normalizedUnitCost" as a number based on that unit.
5. For multi-buys ("2 for $5"): bundleQuantity: 2, bundleTotalPrice: 5.00, salePrice: 2.50, dealType: "multi_buy".
6. For BOGO without price: isUnpricedPromo: true, salePrice: 0, dealType: "bogo".

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

      const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
      let lastLlmError: any = null;
      for (let i = 0; i < modelsToTry.length; i++) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AbortError: Timeout after 50s')), 50000)
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
                lastLlmError = null;
                break;
              }
            }
          }
        } catch (tierErr: any) {
          lastLlmError = tierErr;
          const errMsg = tierErr?.message || String(tierErr);
          const isQuota =
            tierErr?.status === 'RESOURCE_EXHAUSTED' ||
            tierErr?.code === 429 ||
            errMsg.includes('429') ||
            errMsg.includes('quota') ||
            errMsg.includes('Quota exceeded') ||
            errMsg.includes('RESOURCE_EXHAUSTED');
          if (isQuota) {
            break;
          }
        }
      }

      if (lastLlmError && liveDealsByStore.size === 0 && karnsDeals.length === 0) {
        throw lastLlmError;
      }
    } catch (error: any) {
      console.error('[Gemini] Live Search Failed:', error.message || error);
      // Throw the raw error so the frontend catches it and displays the failure state
      throw new Error(`Live Data Fetch Failed: ${error.message || 'Unknown LLM Error'}`);
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

  const finalStores = activeStores.length > 0 ? activeStores : stores;
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

  const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  let response;
  for (let i = 0; i < modelsToTry.length; i++) {
    try {
      response = await ai.models.generateContent({
        model: modelsToTry[i],
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            { text: prompt },
          ],
        },
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
    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let response: any = null;

    for (const model of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
                },
              },
              { text: prompt },
            ],
          },
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
): Promise<{
  bestDealId: string;
  verdict: string;
  keyDifference: string;
  unitPriceAdvantage: string;
  caveats?: string;
}> {
  const ai = getAiClient();
  
  // 1. STRICT FILTER: Remove unpriced promos, BOGOs without prices, or "varies in store" items
  const validDeals = (deals || []).filter((d) => d.salePrice > 0 && !d.isUnpricedPromo);

  if (!ai || validDeals.length < 2) {
    const fallbackBest = [...validDeals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost)[0];
    
    if (!fallbackBest) {
      return {
        bestDealId: '',
        verdict: 'Cannot compare deals as no items have listed local prices (e.g., unpriced BOGO or varies-in-store).',
        keyDifference: 'Missing price data.',
        unitPriceAdvantage: 'N/A',
      };
    }

    return {
      bestDealId: fallbackBest.id,
      verdict: `Best listed price is at ${fallbackBest.storeName}. Other stores did not list a verifiable price.`,
      keyDifference: 'Lowest verifiable price.',
      unitPriceAdvantage: `${fallbackBest.unitPrice}`,
      caveats: fallbackBest.dealType === 'digital_coupon' ? 'Requires digital coupon clipping.' : undefined,
    };
  }

  // 2. ENFORCE STRICT NORMALIZED UNITS IN PROMPT
  const prompt = `
Compare these competing grocery deals for "${productGroupName}":
${JSON.stringify(validDeals, null, 2)}

CRITICAL MATH & UNIT RULES:
1. You MUST standardize and compare these items using ONLY one of these exact units: "1 lb", "1 oz", "1 dozen", "1 pkg", or "1 each".
2. You MUST do the math to convert varying sizes. (e.g., If Store A sells 16 oz for $4.00, and Store B sells 2 lbs for $6.00, convert both to "1 lb" to find the true winner).
3. Base your verdict strictly on the lowest calculated cost per standardized unit.

Respond ONLY with JSON:
{
  "bestDealId": "exact id of winning deal",
  "verdict": "1-2 decisive sentences explaining the winner based on normalized math.",
  "keyDifference": "savings delta or size difference (e.g., 'Store A is cheaper per lb, but Store B has smaller packages')",
  "unitPriceAdvantage": "e.g., $1.99/lb vs $2.50/lb - 20% cheaper",
  "caveats": "membership, digital coupon, or minimum quantity rules"
}
`;

  const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  for (const model of modelsToTry) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      const clean = (res.text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      if (parsed && parsed.bestDealId && parsed.verdict) {
        return parsed;
      }
    } catch {
      // Continue to next model or fallback
    }
  }

  const sorted = [...validDeals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
  return {
    bestDealId: sorted[0]?.id || '',
    verdict: `Best unit price is offered by ${sorted[0]?.storeName}.`,
    keyDifference: 'Direct mathematical unit cost winner.',
    unitPriceAdvantage: `${sorted[0]?.unitPrice}`,
    caveats: sorted[0]?.dealType === 'digital_coupon' ? 'Requires clipping a digital coupon in the store app.' : undefined,
  };
}

const categoryBatchSchema: Schema = {
  type: Type.ARRAY,
  description: 'Array of categorized grocery items.',
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      category: { 
        type: Type.STRING,
        description: 'MUST be exactly one of the Tier 1 keys, or "TIER_2".'
      }
    },
    required: ['id', 'category']
  }
};

const modelCooldowns = new Map<string, number>();
let globalBatchAiCooldownUntil = 0;

export async function batchCategorizeItems(
  items: { id: string; title: string; brand?: string | null }[]
): Promise<{ id: string; category: string }[]> {
  const ai = getAiClient();
  if (!ai || items.length === 0) return items.map(i => ({ id: i.id, category: 'TIER_2' }));

  if (Date.now() < globalBatchAiCooldownUntil) {
    return items.map(i => ({ id: i.id, category: 'TIER_2' }));
  }

  const prompt = `
You are a strict grocery classification engine.
Your task is to map an array of grocery items to their corresponding category.

TIER 1 COMMODITIES (Exact Matches Only):
- ground_beef
- beef_steak
- chicken_breast
- chicken_wings
- chicken_thighs
- bacon_16oz
- pork_chops
- salmon_fillet
- shrimp
- eggs_large_12ct
- milk_gallon
- butter_1lb
- strawberries
- avocados
- apples
- grapes
- potatoes
- onions
- snacks_chips

RULES:
1. If the item is a raw, unpackaged commodity listed above (e.g., "Honeycrisp Apples", "80/20 Ground Chuck", "Large White Eggs"), return the exact Tier 1 key.
2. If the item is PROCESSED, PACKAGED, COOKED, HEALTH/BEAUTY, or ANY BRANDED GOOD (e.g., "Potato Soup", "Chips Ahoy", "Just Egg", "Ore-Ida Fries", "Shampoo", "Caress Body Wash", "Red Baron Pizza", "Croissants"), you MUST return "TIER_2".
3. Only return "snacks_chips" for actual potato/tortilla chips (e.g., Lay's, Doritos).
4. Do not guess. If unsure, return "TIER_2".

Input items:
${JSON.stringify(items, null, 2)}
`;

  // Prefer stable high-throughput models with larger capacity for batch classification
  const modelsToTry = ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let quotaHitCount = 0;

  for (const model of modelsToTry) {
    if ((modelCooldowns.get(model) || 0) > Date.now()) {
      quotaHitCount++;
      continue;
    }

    try {
      const response = await ai.models.generateContent({
        model,
        contents: [prompt],
        config: {
          responseMimeType: 'application/json',
          responseSchema: categoryBatchSchema,
          temperature: 0.0,
        },
      });

      const parsed = JSON.parse(response.text || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isQuota =
        err?.status === 'RESOURCE_EXHAUSTED' ||
        err?.code === 429 ||
        errMsg.includes('429') ||
        errMsg.includes('quota') ||
        errMsg.includes('Quota exceeded') ||
        errMsg.includes('RESOURCE_EXHAUSTED');

      const isUnavailable =
        err?.status === 'UNAVAILABLE' ||
        err?.code === 503 ||
        errMsg.includes('503') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('high demand') ||
        errMsg.includes('experiencing high demand');

      if (isQuota) {
        quotaHitCount++;
        let cooldownMs = 60000;
        const retryMatch = errMsg.match(/retry in ([0-9.]+)s/i);
        if (retryMatch && retryMatch[1]) {
          cooldownMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 2000;
        }
        modelCooldowns.set(model, Date.now() + cooldownMs);
        console.info(`[Gemini Batch] Model ${model} quota reached; switching to fallback model.`);
      } else if (isUnavailable) {
        quotaHitCount++;
        modelCooldowns.set(model, Date.now() + 30000);
        console.info(`[Gemini Batch] Model ${model} currently experiencing high demand; switching to fallback model.`);
      } else {
        console.info(`[Gemini Batch] Model ${model} categorization skipped; switching to fallback model.`);
      }
    }
  }

  if (quotaHitCount >= modelsToTry.length) {
    globalBatchAiCooldownUntil = Date.now() + 30000;
  }

  return items.map(i => ({ id: i.id, category: 'TIER_2' })); // Fallback
}

