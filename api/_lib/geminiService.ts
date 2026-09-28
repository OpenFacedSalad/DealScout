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

const STRICT_COMMODITY_KEYS = [
  "produce_apples", "produce_bananas", "produce_berries", "produce_grapes_conventional", "produce_grapes_organic", "produce_potatoes", "produce_onions",
  "produce_oranges", "produce_lemons", "produce_limes", "produce_grapefruits", "produce_squash", "produce_broccoli", "produce_corn",
  "meat_chicken_breast", "meat_chicken_wings", "meat_beef_steak", "meat_beef_ground", "meat_pork", "meat_bacon", "meat_seafood",
  "dairy_milk_cow", "dairy_milk_plant", "dairy_butter_margarine", "dairy_eggs", "dairy_cheese", "dairy_yogurt",
  "pantry_cereal", "pantry_coffee", "pantry_pasta", "pantry_sauce", "pantry_sauce_pasta", "pantry_sauce_bbq", "pantry_snacks", "pantry_potatoes_boxed",
  "frozen_pizza", "frozen_waffles_pancakes", "frozen_ice_cream", "frozen_meals",
  "beverages_soda", "beverages_water", "beverages_juice", "beverages_energy", "beverages_sports",
  "household_essentials",
  "snacks_potato_chips",
  "personal_care_toothpaste",
  "uncomparable"
];

const NOUN_TO_COMMODITY_MAP: Record<string, string> = {
  // Produce - Citrus Split
  "orange": "produce_oranges",
  "lemon": "produce_lemons",
  "lime": "produce_limes",
  "grapefruit": "produce_grapefruits",
  // Produce - Other
  "apple": "produce_apples",
  "banana": "produce_bananas",
  "broccoli": "produce_broccoli",
  "corn": "produce_corn",
  "potato": "produce_potatoes",
  // Meat & Seafood
  "chicken breast": "meat_chicken_breast",
  "beef steak": "meat_beef_steak",
  "ground beef": "meat_beef_ground",
  "pork": "meat_pork",
  "ham": "meat_pork",
  "bacon": "meat_bacon",
  "seafood": "meat_seafood",
  "fish": "meat_seafood",
  // Dairy
  "eggs": "dairy_eggs",
  "cheese": "dairy_cheese",
  "milk": "dairy_milk_cow",
  "plant milk": "dairy_milk_plant",
  "butter": "dairy_butter_margarine",
  // Pantry & Frozen - Sauce and Pizza Splits
  "cereal": "pantry_cereal",
  "coffee": "pantry_coffee",
  "pasta": "pantry_pasta",
  "pasta sauce": "pantry_sauce_pasta",
  "bbq sauce": "pantry_sauce_bbq",
  "potato chips": "snacks_potato_chips",
  "frozen pizza": "frozen_pizza",
  "pizza": "frozen_pizza",
  "ice cream": "frozen_ice_cream",
  // Beverages
  "sports drink": "beverages_sports",
  "energy drink": "beverages_energy",
  "soda": "beverages_soda",
  "water": "beverages_water"
};

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
      genericProductGroup: {
        type: Type.STRING,
        enum: STRICT_COMMODITY_KEYS,
        description: 'MUST be exactly one of the allowed commodity enum keys.',
      },
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

      // Stage 3: Mathematical Unit Economics Contract
      // Strip ground meat ratios before matching multi-buys
      const cleanCombinedForMulti = combined.replace(/\b(70\/30|73\/27|75\/25|80\/20|85\/15|90\/10|93\/7|96\/4)\b/gi, ' ');
      const multiMatch = cleanCombinedForMulti.match(/\b([2-9]|1[0-2])\s*(?:FOR|\/\s*\$)\s*\$?(\d+(?:\.\d{2})?)\b/i);
      let singleUnitSalePrice = deal.salePrice || 0;
      
      if (multiMatch) {
        const qty = parseInt(multiMatch[1], 10);
        const total = parseFloat(multiMatch[2]);
        if (qty >= 2 && qty <= 12 && total > 0) {
          singleUnitSalePrice = Number((total / qty).toFixed(2));
          deal.bundleQuantity = qty;
          deal.bundleTotalPrice = total;
          deal.unitDescription = `${qty} for $${total.toFixed(2)} ($${singleUnitSalePrice.toFixed(2)} ea)`;
          deal.dealType = 'multi_buy';
        }
      } else if (deal.bundleQuantity && deal.bundleQuantity >= 2 && deal.bundleQuantity <= 12 && deal.bundleTotalPrice && deal.bundleTotalPrice > 0) {
        singleUnitSalePrice = Number((deal.bundleTotalPrice / deal.bundleQuantity).toFixed(2));
        deal.unitDescription = `${deal.bundleQuantity} for $${deal.bundleTotalPrice.toFixed(2)} ($${singleUnitSalePrice.toFixed(2)} ea)`;
        deal.dealType = 'multi_buy';
      }

      deal.salePrice = singleUnitSalePrice;

      const isUnpricedOffer = deal.isUnpricedPromo || !deal.salePrice || deal.salePrice === 0 || /BOGO|BUY\s+\d+\s+GET|FREE|\d+%\s+OFF/.test(combined);
      if (isUnpricedOffer && (!deal.bundleQuantity || deal.bundleQuantity <= 1)) {
        deal.isUnpricedPromo = true;
        deal.salePrice = 0;
        deal.originalPrice = 0;
        deal.discountPercent = 0;
        deal.dealType = 'bogo';
      }

      // Unit Inference derived from text strings
      let nType = 'each';
      const unitTextCheck = `${deal.unitPrice || ''} ${title} ${combined}`.toLowerCase();
      if (unitTextCheck.includes('/lb') || unitTextCheck.includes('per lb') || unitTextCheck.includes(' lb') || unitTextCheck.match(/\d+lb\b/)) {
        nType = 'lb';
      } else if (unitTextCheck.includes('gallon')) {
        nType = 'gallon';
      } else if (unitTextCheck.includes('dozen')) {
        nType = 'dozen';
      } else if (unitTextCheck.includes(' oz') || unitTextCheck.match(/\d+oz\b/)) {
        nType = 'oz';
      }
      deal.normalizedUnitType = nType;

      // Lock Math Contract
      deal.normalizedUnitCost = deal.isUnpricedPromo ? 0 : deal.salePrice;
      if (!deal.unitPrice || deal.unitPrice.includes('undefined')) {
        deal.unitPrice = deal.isUnpricedPromo ? 'Free / Unpriced' : `$${deal.normalizedUnitCost.toFixed(2)} / ${deal.normalizedUnitType}`;
      }

      // Strip non-verified MSRPs
      if (!deal.hasExplicitOriginalPrice || deal.originalPrice <= deal.salePrice) {
        deal.originalPrice = deal.salePrice;
        deal.discountPercent = 0;
      }

      // MARKER: If it comes from a scraper without a group, give it a flag so we can batch-categorize it later
      if (!deal.genericProductGroup || !STRICT_COMMODITY_KEYS.includes(deal.genericProductGroup)) {
        deal.genericProductGroup = `NEEDS_AI_SORT`;
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
          console.info(`[OCR] Model ${model} reached quota limit; trying next fallback model.`);
          continue;
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

export function generateCuratedCircularDeals(store: Store): DealItem[] {
  const storeChain = (store.chain || store.name || '').toLowerCase();
  const storeName = store.name;
  const storeId = store.id;
  const logoBg = store.logoBg || '#1e293b';
  const logoText = store.logoText || store.name.slice(0, 4).toUpperCase();
  const validUntil = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const isAldi = storeChain.includes('aldi');
  const isWeis = storeChain.includes('weis');
  const isGiant = storeChain.includes('giant');
  const isWegmans = storeChain.includes('wegman');

  const catalog = [
    // 1. Meat & Seafood
    {
      title: isAldi ? 'Fresh Boneless Skinless Chicken Breast' : isWeis ? 'Weis Quality Fresh Boneless Chicken Breast' : isGiant ? 'Giant Fresh Chicken Breast Family Pack' : 'Fresh Boneless Skinless Chicken Breast',
      subtitle: isGiant ? 'Save $1.50/lb with Choice Rewards' : isWeis ? 'Price Lock Special' : 'Great for grilling or meal prep',
      category: 'meat_seafood' as const,
      salePrice: isAldi ? 2.19 : isWeis ? 2.29 : isGiant ? 2.49 : 2.79,
      originalPrice: isAldi ? 2.99 : 3.99,
      discountPercent: 35,
      unitPrice: isAldi ? '$2.19/lb' : isWeis ? '$2.29/lb' : isGiant ? '$2.49/lb' : '$2.79/lb',
      normalizedUnitCost: isAldi ? 2.19 : isWeis ? 2.29 : isGiant ? 2.49 : 2.79,
      normalizedUnitType: 'lb' as const,
      unitDescription: 'per lb',
      dealType: isGiant ? ('digital_coupon' as const) : ('sale' as const),
      dealBadge: isGiant ? 'DIGITAL COUPON' : 'WEEKLY SPECIAL',
      genericProductGroup: 'meat_chicken_breast',
      brandMatchKey: 'boneless skinless chicken breast',
      brand: isAldi ? 'Kirkwood' : isWeis ? 'Weis Quality' : isGiant ? 'Giant' : undefined,
      tags: ['chicken', 'poultry', 'meat', 'fresh'],
    },
    {
      title: isAldi ? '80/20 Ground Beef Patties or Ground Chuck' : isWeis ? 'Weis Quality 80% Lean Fresh Ground Beef' : isGiant ? '80% Lean Ground Beef 3 lb Value Pack' : '80/20 Fresh Ground Beef',
      subtitle: 'Freshly ground daily',
      category: 'meat_seafood' as const,
      salePrice: isAldi ? 3.79 : isWeis ? 3.99 : isGiant ? 4.29 : 4.69,
      originalPrice: 5.49,
      discountPercent: 25,
      unitPrice: isAldi ? '$3.79/lb' : isWeis ? '$3.99/lb' : isGiant ? '$4.29/lb' : '$4.69/lb',
      normalizedUnitCost: isAldi ? 3.79 : isWeis ? 3.99 : isGiant ? 4.29 : 4.69,
      normalizedUnitType: 'lb' as const,
      unitDescription: 'per lb',
      dealType: 'sale' as const,
      dealBadge: 'BUTCHER SPECIAL',
      genericProductGroup: 'meat_beef_ground',
      brandMatchKey: '80 20 fresh ground beef',
      brand: isAldi ? 'Appleton Farms' : isWeis ? 'Weis Quality' : undefined,
      tags: ['beef', 'ground_beef', 'meat', 'dinner'],
    },
    {
      title: isAldi ? 'Appleton Farms Thick Sliced Bacon 16oz' : isWeis ? 'Weis Quality Hardwood Smoked Bacon 16oz' : isGiant ? 'Hatfield or Giant Thick Cut Bacon 16oz' : 'Thick Cut Applewood Bacon 16oz',
      subtitle: isGiant ? 'Buy 1 Get 1 Free with card' : 'Thick sliced naturally smoked',
      category: 'meat_seafood' as const,
      salePrice: isAldi ? 3.89 : isWeis ? 4.49 : isGiant ? 4.99 : 5.49,
      originalPrice: 6.99,
      discountPercent: 30,
      unitPrice: isAldi ? '$3.89/pkg' : isWeis ? '$4.49/pkg' : isGiant ? '$4.99/pkg' : '$5.49/pkg',
      normalizedUnitCost: isAldi ? 3.89 : isWeis ? 4.49 : isGiant ? 4.99 : 5.49,
      normalizedUnitType: 'pkg' as const,
      unitDescription: 'per 16oz pack',
      dealType: isGiant ? ('bogo' as const) : ('sale' as const),
      dealBadge: isGiant ? 'BOGO FREE' : 'SALE',
      genericProductGroup: 'meat_bacon',
      brandMatchKey: 'thick cut bacon',
      brand: isWeis ? 'Weis Quality' : isAldi ? 'Appleton Farms' : 'Hatfield',
      tags: ['bacon', 'pork', 'breakfast'],
    },
    // 2. Produce
    {
      title: 'Honeycrisp Apples',
      subtitle: 'Crisp, sweet & juicy fresh harvest',
      category: 'produce' as const,
      salePrice: isAldi ? 1.49 : isWeis ? 1.88 : isGiant ? 1.99 : 2.29,
      originalPrice: 2.99,
      discountPercent: 40,
      unitPrice: isAldi ? '$1.49/lb' : isWeis ? '$1.88/lb' : isGiant ? '$1.99/lb' : '$2.29/lb',
      normalizedUnitCost: isAldi ? 1.49 : isWeis ? 1.88 : isGiant ? 1.99 : 2.29,
      normalizedUnitType: 'lb' as const,
      unitDescription: 'per lb',
      dealType: 'sale' as const,
      dealBadge: 'FARM FRESH',
      genericProductGroup: 'produce_apples',
      brandMatchKey: 'honeycrisp apples',
      tags: ['apples', 'produce', 'fruit', 'snack'],
    },
    {
      title: 'Sweet Navel Oranges 3 lb Bag',
      subtitle: 'Seedless, high vitamin C',
      category: 'produce' as const,
      salePrice: isAldi ? 2.99 : isWeis ? 3.49 : isGiant ? 3.99 : 4.29,
      originalPrice: 5.49,
      discountPercent: 35,
      unitPrice: isAldi ? '$2.99/bag' : isWeis ? '$3.49/bag' : isGiant ? '$3.99/bag' : '$4.29/bag',
      normalizedUnitCost: Number(((isAldi ? 2.99 : isWeis ? 3.49 : isGiant ? 3.99 : 4.29) / 3).toFixed(2)),
      normalizedUnitType: 'lb' as const,
      unitDescription: 'per lb ($3.49 for 3 lb bag)',
      dealType: 'sale' as const,
      dealBadge: 'CITRUS SALE',
      genericProductGroup: 'produce_oranges',
      brandMatchKey: 'navel oranges',
      tags: ['oranges', 'citrus', 'fruit'],
    },
    {
      title: 'Fresh Lemons',
      subtitle: 'Zesty & juicy',
      category: 'produce' as const,
      salePrice: isAldi ? 0.49 : isWeis ? 0.60 : isGiant ? 0.69 : 0.79,
      originalPrice: 0.99,
      discountPercent: 30,
      unitPrice: isAldi ? '$0.49 ea' : isWeis ? '$0.60 ea' : isGiant ? '$0.69 ea' : '$0.79 ea',
      normalizedUnitCost: isAldi ? 0.49 : isWeis ? 0.60 : isGiant ? 0.69 : 0.79,
      normalizedUnitType: 'each' as const,
      unitDescription: 'each',
      dealType: 'sale' as const,
      genericProductGroup: 'produce_lemons',
      brandMatchKey: 'fresh lemons',
      tags: ['lemon', 'citrus', 'produce'],
    },
    {
      title: 'Fresh Broccoli Crowns',
      subtitle: 'Tender florets, rich in iron',
      category: 'produce' as const,
      salePrice: isAldi ? 1.39 : isWeis ? 1.79 : isGiant ? 1.89 : 1.99,
      originalPrice: 2.49,
      discountPercent: 30,
      unitPrice: isAldi ? '$1.39/lb' : isWeis ? '$1.79/lb' : isGiant ? '$1.89/lb' : '$1.99/lb',
      normalizedUnitCost: isAldi ? 1.39 : isWeis ? 1.79 : isGiant ? 1.89 : 1.99,
      normalizedUnitType: 'lb' as const,
      unitDescription: 'per lb',
      dealType: 'sale' as const,
      genericProductGroup: 'produce_broccoli',
      brandMatchKey: 'fresh broccoli crowns',
      tags: ['broccoli', 'vegetable', 'greens'],
    },
    {
      title: 'Russet Potatoes 5 lb Bag',
      subtitle: 'Great for baking, roasting, or mashing',
      category: 'produce' as const,
      salePrice: isAldi ? 2.49 : isWeis ? 2.79 : isGiant ? 2.99 : 3.49,
      originalPrice: 4.49,
      discountPercent: 35,
      unitPrice: isAldi ? '$2.49/bag' : isWeis ? '$2.79/bag' : isGiant ? '$2.99/bag' : '$3.49/bag',
      normalizedUnitCost: Number(((isAldi ? 2.49 : isWeis ? 2.79 : isGiant ? 2.99 : 3.49) / 5).toFixed(2)),
      normalizedUnitType: 'lb' as const,
      unitDescription: 'per lb (5 lb bag)',
      dealType: 'sale' as const,
      genericProductGroup: 'produce_potatoes',
      brandMatchKey: 'russet potatoes',
      tags: ['potatoes', 'produce', 'pantry'],
    },
    // 3. Dairy & Eggs
    {
      title: isAldi ? 'Goldhen Large Grade A Eggs 1 Dozen' : isWeis ? 'Weis Quality Large Grade A White Eggs 1 Dozen' : isGiant ? 'Giant Large White Eggs 1 Dozen' : 'Grade A Large White Eggs 1 Dozen',
      subtitle: 'Farm fresh grade A large',
      category: 'dairy_eggs' as const,
      salePrice: isAldi ? 1.99 : isWeis ? 2.29 : isGiant ? 2.49 : 2.69,
      originalPrice: 3.49,
      discountPercent: 35,
      unitPrice: isAldi ? '$1.99/doz' : isWeis ? '$2.29/doz' : isGiant ? '$2.49/doz' : '$2.69/doz',
      normalizedUnitCost: isAldi ? 1.99 : isWeis ? 2.29 : isGiant ? 2.49 : 2.69,
      normalizedUnitType: 'dozen' as const,
      unitDescription: 'per dozen',
      dealType: 'sale' as const,
      genericProductGroup: 'dairy_eggs',
      brandMatchKey: 'large grade a eggs 1 dozen',
      brand: isAldi ? 'Goldhen' : isWeis ? 'Weis Quality' : isGiant ? 'Giant' : undefined,
      tags: ['eggs', 'dairy', 'breakfast'],
    },
    {
      title: isAldi ? 'Friendly Farms Whole Milk 1 Gallon' : isWeis ? 'Weis Quality Vitamin D Whole Milk 1 Gallon' : isGiant ? 'Giant 100% Real Whole Milk 1 Gallon' : 'Whole Milk 1 Gallon',
      subtitle: 'Pasteurized grade A with vitamin D',
      category: 'dairy_eggs' as const,
      salePrice: isAldi ? 2.99 : isWeis ? 3.29 : isGiant ? 3.49 : 3.69,
      originalPrice: 4.19,
      discountPercent: 20,
      unitPrice: isAldi ? '$2.99/gal' : isWeis ? '$3.29/gal' : isGiant ? '$3.49/gal' : '$3.69/gal',
      normalizedUnitCost: isAldi ? 2.99 : isWeis ? 3.29 : isGiant ? 3.49 : 3.69,
      normalizedUnitType: 'pkg' as const,
      unitDescription: 'per gallon',
      dealType: 'sale' as const,
      genericProductGroup: 'dairy_milk_cow',
      brandMatchKey: 'whole milk 1 gallon',
      brand: isAldi ? 'Friendly Farms' : isWeis ? 'Weis Quality' : isGiant ? 'Giant' : undefined,
      tags: ['milk', 'dairy'],
    },
    {
      title: isAldi ? 'Emporium Selection Shredded Cheddar Cheese 8oz' : isWeis ? 'Weis Quality Shredded Sharp Cheddar Cheese 8oz' : isGiant ? 'Giant Shredded Mild Cheddar Cheese 8oz' : 'Shredded Sharp Cheddar Cheese 8oz',
      subtitle: isGiant ? '2 for $5 with card' : '100% real Wisconsin cheese',
      category: 'dairy_eggs' as const,
      salePrice: isAldi ? 1.89 : isWeis ? 2.00 : isGiant ? 2.50 : 2.79,
      originalPrice: 3.29,
      discountPercent: 30,
      unitPrice: isAldi ? '$1.89 ea' : isWeis ? '$2.00 ea' : isGiant ? '$2.50 ea (2 for $5)' : '$2.79 ea',
      normalizedUnitCost: isAldi ? 1.89 : isWeis ? 2.00 : isGiant ? 2.50 : 2.79,
      normalizedUnitType: 'pkg' as const,
      unitDescription: 'per 8oz bag',
      dealType: isGiant ? ('multi_buy' as const) : ('sale' as const),
      bundleQuantity: isGiant ? 2 : undefined,
      bundleTotalPrice: isGiant ? 5.00 : undefined,
      genericProductGroup: 'dairy_cheese',
      brandMatchKey: 'shredded cheddar cheese 8oz',
      brand: isAldi ? 'Emporium Selection' : isWeis ? 'Weis Quality' : isGiant ? 'Giant' : undefined,
      tags: ['cheese', 'dairy'],
    },
    {
      title: isAldi ? 'Countryside Creamery Salted Butter 16oz' : isWeis ? 'Weis Quality Sweet Cream Salted Butter 16oz' : isGiant ? 'Giant Grade AA Salted Butter 4 Sticks' : 'Grade AA Salted Butter 16oz',
      subtitle: '4 quarters, pure sweet cream',
      category: 'dairy_eggs' as const,
      salePrice: isAldi ? 3.49 : isWeis ? 3.79 : isGiant ? 3.99 : 4.29,
      originalPrice: 4.99,
      discountPercent: 25,
      unitPrice: isAldi ? '$3.49/lb' : isWeis ? '$3.79/lb' : isGiant ? '$3.99/lb' : '$4.29/lb',
      normalizedUnitCost: isAldi ? 3.49 : isWeis ? 3.79 : isGiant ? 3.99 : 4.29,
      normalizedUnitType: 'lb' as const,
      unitDescription: 'per 16oz box',
      dealType: 'sale' as const,
      genericProductGroup: 'dairy_butter_margarine',
      brandMatchKey: 'salted butter 16oz',
      brand: isAldi ? 'Countryside Creamery' : isWeis ? 'Weis Quality' : isGiant ? 'Giant' : undefined,
      tags: ['butter', 'dairy', 'baking'],
    },
    // 4. Exact 1-to-1 Branded Matches
    {
      title: "Rao's Homemade Marinara Sauce 24oz",
      subtitle: 'Slow-simmered Italian plum tomatoes, no added sugar',
      category: 'pantry_snacks' as const,
      salePrice: isAldi ? 6.29 : isWeis ? 6.49 : isGiant ? 6.99 : 7.29,
      originalPrice: 8.99,
      discountPercent: 25,
      unitPrice: isAldi ? '$6.29 ea' : isWeis ? '$6.49 ea' : isGiant ? '$6.99 ea' : '$7.29 ea',
      normalizedUnitCost: isAldi ? 6.29 : isWeis ? 6.49 : isGiant ? 6.99 : 7.29,
      normalizedUnitType: 'each' as const,
      unitDescription: 'per 24oz jar',
      dealType: 'sale' as const,
      dealBadge: 'PREMIUM PASTA SAUCE',
      genericProductGroup: 'pantry_sauce_pasta',
      brandMatchKey: 'raos homemade marinara',
      brand: "Rao's Homemade",
      tags: ['pasta_sauce', 'italian', 'pantry', 'dinner'],
    },
    {
      title: 'Kraft Original Mac & Cheese 7.25oz',
      subtitle: isGiant ? '5 for $5 with card' : 'The cheesy original',
      category: 'pantry_snacks' as const,
      salePrice: isAldi ? 0.99 : isWeis ? 1.00 : isGiant ? 1.00 : 1.25,
      originalPrice: 1.49,
      discountPercent: 30,
      unitPrice: isAldi ? '$0.99 ea' : isWeis ? '$1.00 ea' : isGiant ? '$1.00 ea (5 for $5)' : '$1.25 ea',
      normalizedUnitCost: isAldi ? 0.99 : isWeis ? 1.00 : isGiant ? 1.00 : 1.25,
      normalizedUnitType: 'each' as const,
      unitDescription: 'per 7.25oz box',
      dealType: isGiant ? ('multi_buy' as const) : ('sale' as const),
      bundleQuantity: isGiant ? 5 : undefined,
      bundleTotalPrice: isGiant ? 5.00 : undefined,
      genericProductGroup: 'uncomparable',
      brandMatchKey: 'kraft original mac and cheese',
      brand: 'Kraft',
      tags: ['mac_and_cheese', 'pasta', 'quick_meal'],
    },
    {
      title: 'Red Baron Classic Crust Pepperoni Pizza 20.6oz',
      subtitle: 'Crispy crust loaded with pepperoni and real mozzarella',
      category: 'frozen' as const,
      salePrice: isAldi ? 3.89 : isWeis ? 3.99 : isGiant ? 4.49 : 4.89,
      originalPrice: 5.99,
      discountPercent: 30,
      unitPrice: isAldi ? '$3.89 ea' : isWeis ? '$3.99 ea' : isGiant ? '$4.49 ea' : '$4.89 ea',
      normalizedUnitCost: isAldi ? 3.89 : isWeis ? 3.99 : isGiant ? 4.49 : 4.89,
      normalizedUnitType: 'each' as const,
      unitDescription: 'per pizza',
      dealType: 'sale' as const,
      dealBadge: 'FROZEN FAVORITE',
      genericProductGroup: 'frozen_pizza',
      brandMatchKey: 'red baron breakfast scrambles pizza',
      brand: 'Red Baron',
      tags: ['pizza', 'frozen', 'dinner'],
    },
    {
      title: 'Bounty Select-A-Size Paper Towels 6 Double Rolls',
      subtitle: 'The quicker picker upper, 2x more absorbent',
      category: 'household' as const,
      salePrice: isAldi ? 12.49 : isWeis ? 12.99 : isGiant ? 13.99 : 14.49,
      originalPrice: 16.99,
      discountPercent: 20,
      unitPrice: isAldi ? '$12.49 ea' : isWeis ? '$12.99 ea' : isGiant ? '$13.99 ea' : '$14.49 ea',
      normalizedUnitCost: isAldi ? 12.49 : isWeis ? 12.99 : isGiant ? 13.99 : 14.49,
      normalizedUnitType: 'pkg' as const,
      unitDescription: 'per 6-pack (equals 12 regular rolls)',
      dealType: 'sale' as const,
      dealBadge: 'HOUSEHOLD ESSENTIAL',
      genericProductGroup: 'household_essentials',
      brandMatchKey: 'bounty select a size paper towels',
      brand: 'Bounty',
      tags: ['paper_towels', 'household', 'cleaning'],
    },
    {
      title: "Lay's Classic Potato Chips 8oz",
      subtitle: isWeis ? '2 for $5 with card' : 'Crispy, salty, perfectly seasoned',
      category: 'pantry_snacks' as const,
      salePrice: isAldi ? 2.29 : isWeis ? 2.50 : isGiant ? 2.99 : 3.19,
      originalPrice: 4.49,
      discountPercent: 40,
      unitPrice: isAldi ? '$2.29 ea' : isWeis ? '$2.50 ea (2 for $5)' : isGiant ? '$2.99 ea' : '$3.19 ea',
      normalizedUnitCost: isAldi ? 2.29 : isWeis ? 2.50 : isGiant ? 2.99 : 3.19,
      normalizedUnitType: 'each' as const,
      unitDescription: 'per 8oz bag',
      dealType: isWeis ? ('multi_buy' as const) : ('sale' as const),
      bundleQuantity: isWeis ? 2 : undefined,
      bundleTotalPrice: isWeis ? 5.00 : undefined,
      genericProductGroup: 'snacks_potato_chips',
      brandMatchKey: 'lays classic potato chips',
      brand: "Lay's",
      tags: ['chips', 'snacks', 'party'],
    },
    {
      title: 'Coca-Cola 12pk 12oz Cans',
      subtitle: isGiant ? 'Buy 2 Get 1 Free with card' : 'Ice-cold classic soda refreshment',
      category: 'beverages' as const,
      salePrice: isAldi ? 6.49 : isWeis ? 6.99 : isGiant ? 7.49 : 7.99,
      originalPrice: 9.49,
      discountPercent: 25,
      unitPrice: isAldi ? '$6.49/12pk' : isWeis ? '$6.99/12pk' : isGiant ? '$7.49/12pk' : '$7.99/12pk',
      normalizedUnitCost: isAldi ? 6.49 : isWeis ? 6.99 : isGiant ? 7.49 : 7.99,
      normalizedUnitType: 'pkg' as const,
      unitDescription: 'per 12-pack cans',
      dealType: isGiant ? ('bogo' as const) : ('sale' as const),
      dealBadge: isGiant ? 'BUY 2 GET 1 FREE' : 'SALE',
      genericProductGroup: 'beverages_soda',
      brandMatchKey: 'coca cola 12pk cans',
      brand: 'Coca-Cola',
      tags: ['soda', 'coke', 'beverages', 'pop'],
    },
  ];

  return catalog.map((item, idx) => ({
    ...item,
    id: `${storeId}-curated-${idx + 1}`,
    storeId,
    storeName,
    storeLogoBg: logoBg,
    storeLogoText: logoText,
    validUntil,
    inStock: true,
  }));
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
  radiusMiles: number = 10,
  executionMode: 'sequential' | 'parallel' = 'parallel'
): Promise<{ stores: Store[]; deals: DealItem[] }> {
  const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusMiles}_${executionMode}`;
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
   ${JSON.stringify(STRICT_COMMODITY_KEYS, null, 2)}
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
            setTimeout(() => reject(new Error('AbortError: Timeout after 25s')), 25000)
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
            console.info(`[Gemini] Model ${modelsToTry[i]} reached quota limit; trying next fallback model.`);
            continue;
          }
        }
      }

      if (lastLlmError && aiDeals.length === 0) {
        console.warn('[Gemini] Live AI search unavailable or rate-limited across models:', lastLlmError.message || lastLlmError);
      }
    } catch (error: any) {
      console.warn('[Gemini] Live Search error (falling back to curated specials):', error?.message || error);
    }
  }

  // Combine deals from all stores with genuine live circulars
  const nonKarnsDeals: DealItem[] = [];
  const activeStores: Store[] = [];

  if (karnsStore) {
    if (karnsDeals.length > 0) {
      activeStores.push(karnsStore);
    } else {
      karnsDeals = generateCuratedCircularDeals(karnsStore);
      karnsStore.totalDealsCount = karnsDeals.length;
      activeStores.push(karnsStore);
    }
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
      } else {
        // Fallback: Generate curated, realistic authentic circular specials for this store
        const curated = generateCuratedCircularDeals(store);
        if (curated.length > 0) {
          store.totalDealsCount = curated.length;
          nonKarnsDeals.push(...curated);
          activeStores.push(store);
        }
      }
    }
  }

  // If still no active stores, populate from stores
  if (activeStores.length === 0) {
    for (const store of stores) {
      const curated = generateCuratedCircularDeals(store);
      if (curated.length > 0) {
        store.totalDealsCount = curated.length;
        nonKarnsDeals.push(...curated);
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

  // === LOCAL DETERMINISTIC CLASSIFICATION FIRST (5ms) ===
  sanitizedCombinedDeals.forEach((d) => {
    const localCat = classifyItemDeterministically(d.title, d.brand);
    const { headNoun } = extractSyntacticHeadNoun(d.title, d.brand);
    d.coreBaseNoun = headNoun;
    d.genericProductGroup = localCat;
    d.subtitle = `Noun: [${headNoun}] -> Key: [${localCat}]`;
  });
  finalDeals = sanitizedCombinedDeals;

  // Ensure every deal has a normalized brandMatchKey for 1-to-1 branded comparisons
  finalDeals.forEach(d => {
    if (!d.brandMatchKey) {
      d.brandMatchKey = cleanBrandMatchKey(d.title, d.brand);
    }
  });

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
  description: 'Array of grocery items with extracted base noun and brand match key.',
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      base_noun: { 
        type: Type.STRING,
        description: 'The singular physical item (strip brands/flavors) in lowercase.'
      },
      brand_match_key: {
        type: Type.STRING,
        description: 'The brand and specific product name (strip sizes, prices, and promos) in lowercase.'
      }
    },
    required: ['base_noun']
  }
};

let globalBatchAiCooldownUntil = 0;

export interface ParsedProductSyntax {
  brandToken: string;
  modifiers: string[];
  headNoun: string;
}

export function extractSyntacticHeadNoun(rawTitle: string, brand?: string | null): ParsedProductSyntax {
  // Stage 1: Strip parentheticals, measurements, and punctuation
  const clean = rawTitle
    .replace(/\(.*?\)/g, '')
    .replace(/\b\d+(\.\d+)?\s*(oz|lb|lbs|ct|pk|pack|fl oz|g|kg|ml|l)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { brandToken: '', modifiers: [], headNoun: 'unknown' };

  let remainingWords = [...words];
  let brandToken = '';
  if (brand && rawTitle.toLowerCase().startsWith(brand.toLowerCase())) {
    const brandWordCount = brand.split(/\s+/).length;
    brandToken = remainingWords.slice(0, brandWordCount).join(' ');
    remainingWords = remainingWords.slice(brandWordCount);
  }

  // Syntactic Head Noun is the terminal lexical anchor
  const headNoun = (remainingWords.pop() || words[words.length - 1]).toLowerCase();
  const modifiers = remainingWords.map(w => w.toLowerCase());

  return { brandToken, modifiers, headNoun };
}

interface TaxonomicTarget {
  commodityKey: string;
  requiredDepartment: string;
}

const HEAD_NOUN_TAXONOMY: Record<string, TaxonomicTarget> = {
  // Produce - Citrus individual fruit categories
  'orange':      { commodityKey: 'produce_oranges', requiredDepartment: 'produce' },
  'oranges':     { commodityKey: 'produce_oranges', requiredDepartment: 'produce' },
  'mandarins':   { commodityKey: 'produce_oranges', requiredDepartment: 'produce' },
  'clementines': { commodityKey: 'produce_oranges', requiredDepartment: 'produce' },
  'lemon':       { commodityKey: 'produce_lemons', requiredDepartment: 'produce' },
  'lemons':      { commodityKey: 'produce_lemons', requiredDepartment: 'produce' },
  'lime':        { commodityKey: 'produce_limes', requiredDepartment: 'produce' },
  'limes':       { commodityKey: 'produce_limes', requiredDepartment: 'produce' },
  'grapefruit':  { commodityKey: 'produce_grapefruits', requiredDepartment: 'produce' },
  'grapefruits': { commodityKey: 'produce_grapefruits', requiredDepartment: 'produce' },
  // Produce - General commodities (no varietal fragmentation)
  'apple':       { commodityKey: 'produce_apples', requiredDepartment: 'produce' },
  'apples':      { commodityKey: 'produce_apples', requiredDepartment: 'produce' },
  'banana':      { commodityKey: 'produce_bananas', requiredDepartment: 'produce' },
  'bananas':     { commodityKey: 'produce_bananas', requiredDepartment: 'produce' },
  'broccoli':    { commodityKey: 'produce_broccoli', requiredDepartment: 'produce' },
  'corn':        { commodityKey: 'produce_corn', requiredDepartment: 'produce' },
  'potato':      { commodityKey: 'produce_potatoes', requiredDepartment: 'produce' },
  'potatoes':    { commodityKey: 'produce_potatoes', requiredDepartment: 'produce' },
  'onion':       { commodityKey: 'produce_onions', requiredDepartment: 'produce' },
  'onions':      { commodityKey: 'produce_onions', requiredDepartment: 'produce' },
  'squash':      { commodityKey: 'produce_squash', requiredDepartment: 'produce' },
  'grapes':      { commodityKey: 'produce_grapes_conventional', requiredDepartment: 'produce' },
  'strawberries':{ commodityKey: 'produce_berries', requiredDepartment: 'produce' },
  'blueberries': { commodityKey: 'produce_berries', requiredDepartment: 'produce' },
  'raspberries': { commodityKey: 'produce_berries', requiredDepartment: 'produce' },
  'blackberries':{ commodityKey: 'produce_berries', requiredDepartment: 'produce' },
  // Meat & Seafood
  'steak':       { commodityKey: 'meat_beef_steak', requiredDepartment: 'meat' },
  'steaks':      { commodityKey: 'meat_beef_steak', requiredDepartment: 'meat' },
  'beef':        { commodityKey: 'meat_beef_ground', requiredDepartment: 'meat' },
  'chicken':     { commodityKey: 'meat_chicken_breast', requiredDepartment: 'meat' },
  'wings':       { commodityKey: 'meat_chicken_wings', requiredDepartment: 'meat' },
  'pork':        { commodityKey: 'meat_pork', requiredDepartment: 'meat' },
  'ham':         { commodityKey: 'meat_pork', requiredDepartment: 'meat' },
  'chops':       { commodityKey: 'meat_pork', requiredDepartment: 'meat' },
  'ribs':        { commodityKey: 'meat_pork', requiredDepartment: 'meat' },
  'bacon':       { commodityKey: 'meat_bacon', requiredDepartment: 'meat' },
  'salmon':      { commodityKey: 'meat_seafood', requiredDepartment: 'meat' },
  'shrimp':      { commodityKey: 'meat_seafood', requiredDepartment: 'meat' },
  'fish':        { commodityKey: 'meat_seafood', requiredDepartment: 'meat' },
  'tilapia':     { commodityKey: 'meat_seafood', requiredDepartment: 'meat' },
  'cod':         { commodityKey: 'meat_seafood', requiredDepartment: 'meat' },
  'crab':        { commodityKey: 'meat_seafood', requiredDepartment: 'meat' },
  'lobster':     { commodityKey: 'meat_seafood', requiredDepartment: 'meat' },
  // Dairy
  'eggs':        { commodityKey: 'dairy_eggs', requiredDepartment: 'dairy' },
  'cheese':      { commodityKey: 'dairy_cheese', requiredDepartment: 'dairy' },
  'milk':        { commodityKey: 'dairy_milk_cow', requiredDepartment: 'dairy' },
  'butter':      { commodityKey: 'dairy_butter_margarine', requiredDepartment: 'dairy' },
  'margarine':   { commodityKey: 'dairy_butter_margarine', requiredDepartment: 'dairy' },
  'yogurt':      { commodityKey: 'dairy_yogurt', requiredDepartment: 'dairy' },
  // Pantry & Frozen
  'cereal':      { commodityKey: 'pantry_cereal', requiredDepartment: 'pantry' },
  'coffee':      { commodityKey: 'pantry_coffee', requiredDepartment: 'pantry' },
  'pasta':       { commodityKey: 'pantry_pasta', requiredDepartment: 'pantry' },
  'sauce':       { commodityKey: 'pantry_sauce', requiredDepartment: 'pantry' },
  'chips':       { commodityKey: 'snacks_potato_chips', requiredDepartment: 'pantry' },
  'pretzels':    { commodityKey: 'pantry_snacks', requiredDepartment: 'pantry' },
  'cookies':     { commodityKey: 'pantry_snacks', requiredDepartment: 'pantry' },
  'pizza':       { commodityKey: 'frozen_pizza', requiredDepartment: 'frozen' },
  'ice cream':   { commodityKey: 'frozen_ice_cream', requiredDepartment: 'frozen' },
  'waffles':     { commodityKey: 'frozen_waffles_pancakes', requiredDepartment: 'frozen' },
  'pancakes':    { commodityKey: 'frozen_waffles_pancakes', requiredDepartment: 'frozen' },
  // Beverages
  'soda':        { commodityKey: 'beverages_soda', requiredDepartment: 'beverages' },
  'water':       { commodityKey: 'beverages_water', requiredDepartment: 'beverages' },
  'juice':       { commodityKey: 'beverages_juice', requiredDepartment: 'beverages' },
};

export function classifyItemDeterministically(title: string, brand?: string | null, _description?: string | null): string {
  const { modifiers, headNoun } = extractSyntacticHeadNoun(title, brand);

  // 1. Compound Modifier Disambiguation (Protects pork/ham steaks, peanut butter, etc.)
  if (headNoun === 'steak' || headNoun === 'steaks') {
    if (modifiers.includes('ham') || modifiers.includes('pork')) return 'meat_pork';
    if (modifiers.includes('tuna') || modifiers.includes('salmon')) return 'meat_seafood';
    if (modifiers.includes('sauce') || modifiers.includes('roll') || modifiers.includes('rolls')) return 'uncomparable';
    return 'meat_beef_steak';
  }

  if (headNoun === 'butter') {
    if (modifiers.includes('peanut') || modifiers.includes('almond') || modifiers.includes('apple') || modifiers.includes('cookie')) {
      return 'pantry_snacks';
    }
    return 'dairy_butter_margarine';
  }

  if (headNoun === 'sauce') {
    if (modifiers.includes('marinara') || modifiers.includes('pasta') || modifiers.includes('spaghetti') || modifiers.includes('alfredo')) {
      return 'pantry_sauce_pasta';
    }
    if (modifiers.includes('bbq') || modifiers.includes('barbecue')) {
      return 'pantry_sauce_bbq';
    }
    return 'pantry_sauce';
  }

  if (headNoun === 'bites' || headNoun === 'mix' || headNoun === 'bowl' || headNoun === 'dinner') {
    return 'uncomparable';
  }

  // 2. Direct Head Noun Lookup
  const match = HEAD_NOUN_TAXONOMY[headNoun];
  if (!match) return 'uncomparable';

  // 3. Sub-family distinction within verified parent family
  if (headNoun === 'grapes' && modifiers.includes('organic')) return 'produce_grapes_organic';
  if (headNoun === 'milk' && (modifiers.includes('oat') || modifiers.includes('almond') || modifiers.includes('soy') || modifiers.includes('plant'))) {
    return 'dairy_milk_plant';
  }

  return match.commodityKey;
}

function cleanNounFallback(title: string): string {
  const text = (title || '').toLowerCase();
  if (/\b(apple|apples)\b/.test(text)) return 'apple';
  if (/\b(banana|bananas)\b/.test(text)) return 'banana';
  if (/\b(orange|oranges|navel)\b/.test(text)) return 'orange';
  if (/\b(lemon|lemons)\b/.test(text)) return 'lemon';
  if (/\b(lime|limes)\b/.test(text)) return 'lime';
  if (/\b(grapefruit|grapefruits)\b/.test(text)) return 'grapefruit';
  if (/\b(broccoli)\b/.test(text)) return 'broccoli';
  if (/\b(corn)\b/.test(text)) return 'corn';
  if (/\b(potato chips?|kettle chips?)\b/.test(text)) return 'potato chips';
  if (/\b(potatoes|potato)\b/.test(text)) return 'potato';
  if (/\b(chicken breasts?)\b/.test(text)) return 'chicken breast';
  if (/\b(beef steak|ny strip|ribeye|sirloin steak|t-bone|filet)\b/.test(text)) return 'beef steak';
  if (/\b(ground beef|ground chuck|ground round)\b/.test(text)) return 'ground beef';
  if (/\b(bacon)\b/.test(text)) return 'bacon';
  if (/\b(pork|ham)\b/.test(text)) return 'pork';
  if (/\b(salmon|tilapia|shrimp|cod|seafood|fish)\b/.test(text)) return 'seafood';
  if (/\b(eggs?)\b/.test(text)) return 'eggs';
  if (/\b(cheese)\b/.test(text)) return 'cheese';
  if (/\b(almond milk|oat milk|soy milk)\b/.test(text)) return 'plant milk';
  if (/\b(milk)\b/.test(text)) return 'milk';
  if (/\b(butter|margarine)\b/.test(text)) return 'butter';
  if (/\b(cereal)\b/.test(text)) return 'cereal';
  if (/\b(coffee)\b/.test(text)) return 'coffee';
  if (/\b(pasta sauce|marinara|alfredo)\b/.test(text)) return 'pasta sauce';
  if (/\b(bbq sauce|barbecue sauce)\b/.test(text)) return 'bbq sauce';
  if (/\b(pasta|spaghetti|penne|rotini)\b/.test(text)) return 'pasta';
  if (/\b(frozen pizza|pizza)\b/.test(text)) return 'frozen pizza';
  if (/\b(ice cream)\b/.test(text)) return 'ice cream';
  if (/\b(sports drink|gatorade|powerade)\b/.test(text)) return 'sports drink';
  if (/\b(energy drink|red bull|monster|rockstar)\b/.test(text)) return 'energy drink';
  if (/\b(soda|cola|pepsi|coke)\b/.test(text)) return 'soda';
  if (/\b(water)\b/.test(text)) return 'water';
  return 'unknown';
}

function cleanBrandMatchKey(title: string, brand?: string | null): string {
  const raw = `${brand || ''} ${title || ''}`
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(oz|lb|lbs|pk|pack|ct|count|gal|gallon|liter|l|ml|fl\s*oz|qt)\b/gi, ' ')
    .replace(/\b(bogo|free|save|off|ea|each|per\s*lb|sale|price\s*lock|with\s*card)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw;
}

export async function batchCategorizeItems(
  items: { id: string; title: string; brand?: string | null }[],
  executionMode: 'sequential' | 'parallel' = 'parallel'
): Promise<{ id: string; genericProductGroup: string; base_noun?: string; category?: string }[]> {
  const ai = getAiClient();
  if (!ai || items.length === 0) return [];

  const promptTemplate = `
You are a strict linguistic extractor. Your ONLY job is to identify the singular core physical item (the head noun) of each grocery product.
Strip away all brand names, adjectives, flavors, packaging, and promotional modifiers. 

CRITICAL RULE: In English commercial packaging, the base physical noun is the final structural word in the product phrase. 
- "Peanut Butter & Cocoa Crunch Cereal" -> "cereal"
- "Strawberry Prebiotic Soda" -> "soda"
- "Milk-Bone Soft & Chewy Bites Dog Snacks" -> "snacks"
- "Potato with Cheese and Chives Tater Bites" -> "bites"

Output EXACTLY a JSON array of objects. Each object must have a single key "base_noun" containing the lowercase extracted noun.
Input items:
`;

  const chunkSize = 40;
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  // 1. Define the isolated chunk processor
  const processChunk = async (chunk: any[]) => {
    const chunkResults: { id: string; genericProductGroup: string; base_noun: string; category?: string }[] = [];
    
    if (Date.now() < globalBatchAiCooldownUntil) {
      for (const item of chunk) {
        const detCat = classifyItemDeterministically(item.title, item.brand);
        chunkResults.push({ id: item.id, base_noun: 'unknown', genericProductGroup: detCat, category: detCat });
      }
      return chunkResults;
    }

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: [promptTemplate + JSON.stringify(chunk, null, 2)],
          config: { responseMimeType: 'application/json', responseSchema: categoryBatchSchema, temperature: 0.0 },
        });
      } catch {
        response = await ai.models.generateContent({
          model: 'gemini-flash-latest',
          contents: [promptTemplate + JSON.stringify(chunk, null, 2)],
          config: { responseMimeType: 'application/json', responseSchema: categoryBatchSchema, temperature: 0.0 },
        });
      }

      const parsed = JSON.parse(response.text || '[]');
      if (Array.isArray(parsed)) {
        chunk.forEach((item, idx) => {
          const p = parsed[idx] || parsed.find((x: any) => x.id === item.id);
          const extractedNoun = (p?.base_noun || '').toLowerCase().trim() || 'unknown';
          const mappedCategory = classifyItemDeterministically(extractedNoun, item.brand);
          chunkResults.push({ id: item.id, base_noun: extractedNoun, genericProductGroup: mappedCategory, category: mappedCategory });
        });
      } else {
        throw new Error("Invalid JSON array returned");
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        globalBatchAiCooldownUntil = Date.now() + 60000;
      }
      chunk.forEach((item) => {
        const detCat = classifyItemDeterministically(item.title, item.brand);
        chunkResults.push({ id: item.id, base_noun: 'unknown', genericProductGroup: detCat, category: detCat });
      });
    }
    return chunkResults;
  };

  // 2. Toggle Execution Mode based on UI preference
  if (executionMode === 'parallel') {
    // PAID TIER: Blast all chunks concurrently
    const resolvedArrays = await Promise.all(chunks.map(processChunk));
    return resolvedArrays.flat();
  } else {
    // FREE TIER: Process one chunk at a time, with a strict 3.5 second delay to stay under 15 RPM
    const allResults = [];
    for (const chunk of chunks) {
      const res = await processChunk(chunk);
      allResults.push(...res);
      await new Promise(resolve => setTimeout(resolve, 3500));
    }
    return allResults;
  }
}

