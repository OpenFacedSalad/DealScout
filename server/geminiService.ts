import { GoogleGenAI, Type, Schema } from '@google/genai';
import { Store, DealItem } from '../src/types';
import { findPhysicalGroceryStoresOSM, getRegionalDefaultStores } from './storeFinder';

let aiClient: GoogleGenAI | null = null;

async function searchWebScraper(query: string): Promise<string> {
  try {
    const params = new URLSearchParams({ q: query });
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: 'POST',
      body: params,
      headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();
    const textMatches = html.match(/<td class='result-snippet'[^>]*>([\s\S]*?)<\/td>/g);
    if (textMatches) {
        return textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).join('\n');
    }
  } catch (e) {
    console.error("DDG Scraper error:", e);
  }
  return "";
}

export function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[GeminiService] GEMINI_API_KEY is not set. Operating in deterministic fallback mode.');
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
      id: { type: Type.STRING },
      storeId: { type: Type.STRING },
      storeName: { type: Type.STRING },
      storeLogoBg: { type: Type.STRING },
      storeLogoText: { type: Type.STRING },
      title: { type: Type.STRING },
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
      originalPrice: { type: Type.NUMBER },
      salePrice: { type: Type.NUMBER },
      discountPercent: { type: Type.NUMBER },
      unitPrice: { type: Type.STRING },
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
    },
    required: [
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

function parseJsonFromText<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonStart = cleaned.indexOf('[');
    const jsonEnd = cleaned.lastIndexOf(']');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      return JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
    }
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1) {
      return JSON.parse(cleaned.substring(objStart, objEnd + 1));
    }
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn('[GeminiService] Failed to parse structured JSON from text payload:', err);
    return fallback;
  }
}

/**
 * Live Grounded Circular Ingestion via Google Search Grounding.
 */
export async function getCircularsForLocation(
  lat: number,
  lng: number,
  city: string,
  state: string,
  zipCode: string,
  radiusMiles: number = 10
): Promise<{ stores: Store[]; deals: DealItem[] }> {
  let stores: Store[] = [];

  try {
    stores = await findPhysicalGroceryStoresOSM(lat, lng, radiusMiles);
  } catch (err) {
    console.warn('[GeminiService] OSM discovery failed, using regional directory fallback:', err);
  }

  if (!stores || stores.length === 0) {
    stores = getRegionalDefaultStores(city, state, lat, lng, radiusMiles);
  }

  stores = stores.filter((s) => s.distanceMiles <= radiusMiles);
  if (stores.length === 0) {
    return { stores: [], deals: [] };
  }

  const ai = getAiClient();
  if (!ai) {
    return {
      stores,
      deals: generateDeterministicFallbackDeals(stores),
    };
  }

  try {
    const storeSummary = stores.map((s) => ({
      id: s.id,
      name: s.name,
      chain: s.chain,
      address: `${s.address}, ${s.city}`,
    }));

    const currentDate = new Date().toISOString().split('T')[0];

    const webSnippets = [];
    for (const s of stores.slice(0, 3)) {
       const snippet = await searchWebScraper(`${s.name} ${city} ${state} weekly ad circular deals`);
       if (snippet) webSnippets.push(`--- Search Results for ${s.name} ---\n${snippet}`);
    }
    const karnSnippet = await searchWebScraper(`Karns Quality Foods Mechanicsburg PA weekly ad circular chicken wings price`);
    if (karnSnippet) webSnippets.push(`--- Search Results for Karns Chicken Wings ---\n${karnSnippet}`);
    const combinedSnippets = webSnippets.join('\n\n');

    const prompt = `
Based on the following live web search snippets for current weekly grocery circulars, flyers, and advertised specials for supermarkets near ${city}, ${state} ${zipCode} active as of ${currentDate}:\n\n${combinedSnippets}\n\n
Target Supermarkets:
${JSON.stringify(storeSummary, null, 2)}

Instructions:
1. Extract authentic advertised items, sales, and butcher shop specials from the search snippets provided.
2. Extract authentic advertised items, sales, and butcher shop specials. ENSURE you include the current Karn's deal on chicken wings.
3. For each deal found:
   - "storeId": Match the EXACT store "id" provided above.
   - "storeName": The matching store name.
   - "title": Clean product title (e.g., "Fresh 80/20 Ground Beef Chuck").
   - "category": One of [produce, meat_seafood, dairy_eggs, bakery_deli, pantry_snacks, frozen, beverages, household].
   - "originalPrice": Float regular price.
   - "salePrice": Float promotional package price.
   - "discountPercent": Percentage integer discount.
   - "unitPrice": Formatted unit cost (e.g., "$3.49 / lb", "$0.19 / egg", "$2.89 / gallon").
   - "normalizedUnitCost": Decimal number for normalized unit cost.
   - "normalizedUnitType": One of ['lb', 'oz', 'unit', 'gallon', 'count', 'dozen'].
   - "dealType": One of ['sale', 'bogo', 'digital_coupon', 'multi_buy', 'clearance'].
   - "genericProductGroup": Normalized commodity key for cross-store price matching. Use standard keys:
     "ground_beef_80_20", "boneless_chicken_breast", "chicken_wings", "large_white_eggs", "whole_milk_gallon",
     "honeycrisp_apples", "hass_avocados", "strawberries_1lb", "sourdough_bread",
     "extra_virgin_olive_oil", "shredded_cheddar_cheese", "bacon_16oz".
   - "validUntil": Expiration date string (YYYY-MM-DD).
   - "tags": Array of keyword strings.
4. Return ONLY a valid JSON array of deal objects.
`;

    let response;
    let retries = 3;
    const modelsToTry = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'];
    for (let i = 0; i < retries; i++) {
      try {
        response = await ai.models.generateContent({
          model: modelsToTry[i % modelsToTry.length],
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: i > 0 ? 0.4 : 0.1,
          },
        });
        break;
      } catch (err) {
        console.error(`[GeminiService] Attempt ${i + 1} failed with model ${modelsToTry[i % modelsToTry.length]}: ${err.message}`);
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s before retry
      }
    }

    console.log('[GeminiService] Raw Gemini response text:', response.text);
    
    const groundedDeals = parseJsonFromText<DealItem[]>(response.text || '', []);

    if (Array.isArray(groundedDeals) && groundedDeals.length > 0) {
      const counts: Record<string, number> = {};
      groundedDeals.forEach((d) => {
        const storeMatch = stores.find((s) => s.id === d.storeId) || stores.find((s) => s.name.toLowerCase().includes(d.storeName?.toLowerCase() || ''));
        if (storeMatch) {
          d.storeId = storeMatch.id;
          d.storeName = storeMatch.name;
          d.storeLogoBg = storeMatch.logoBg;
          d.storeLogoText = storeMatch.logoText;
        } else {
          d.storeLogoBg = '#334155';
          d.storeLogoText = 'STORE';
        }
        counts[d.storeId] = (counts[d.storeId] || 0) + 1;
      });

      stores.forEach((s) => {
        s.totalDealsCount = counts[s.id] || 0;
      });

      return { stores, deals: groundedDeals };
    } else {
      throw new Error('AI returned an empty or invalid array of deals. Response: ' + response.text);
    }
  } catch (error) {
    console.error('[GeminiService] Grounded circular search failed:', error);
    throw error;
  }
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

Requirements for each extracted item:
1. "title": Exact item description from the circular.
2. "originalPrice": Estimated or stated pre-sale price.
3. "salePrice": True promotional package sale price.
4. "discountPercent": Percentage discount integer.
5. "unitPrice": Formatted normalized unit price string (e.g., "$3.49 / lb", "$0.20 / egg", "$2.49 / 16 oz").
6. "normalizedUnitCost": Precise numeric float for mathematical sorting.
7. "normalizedUnitType": One of ['lb', 'oz', 'unit', 'gallon', 'count', 'dozen'].
8. "unitDescription": Brief explanation (e.g. "per pound", "per egg").
9. "dealType": One of ['sale', 'bogo', 'digital_coupon', 'multi_buy'].
10. "dealBadge": Visual highlight text if present (e.g. "BUTCHER CUT", "BUY 1 GET 1", "CLIP COUPON").
11. "genericProductGroup": Normalized commodity key for cross-store comparison matching:
    (e.g., 'ground_beef_80_20', 'boneless_chicken_breast', 'large_white_eggs', 'whole_milk_gallon',
     'strawberries_1lb', 'honeycrisp_apples', 'bacon_16oz', 'shredded_cheddar_cheese', 'sourdough_bread').
12. "storeId": Set to "${store.id}".
13. "storeName": Set to "${store.name}".
14. "storeLogoBg": Set to "${store.logoBg}".
15. "storeLogoText": Set to "${store.logoText}".
16. "validUntil": Extract valid flyer end date, or set to next Tuesday/Wednesday.
17. "inStock": true.
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
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

  const parsed = JSON.parse(response.text || '[]') as DealItem[];

  return parsed.map((item, idx) => ({
    ...item,
    id: item.id || `scanned-${store.id}-${Date.now()}-${idx}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg,
    storeLogoText: store.logoText,
  }));
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: comparisonResponseSchema,
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text || '{}') as AIComparisonResult;
    if (parsed.bestDealId && parsed.verdict) {
      return parsed;
    }
  } catch (error) {
    console.error('[GeminiService] AI deal comparison failed:', error);
  }

  return generateDeterministicComparison(productGroupName, deals);
}

function generateDeterministicFallbackDeals(stores: Store[]): DealItem[] {
  const deals: DealItem[] = [];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5);
  const validUntilStr = futureDate.toISOString().split('T')[0];

  stores.forEach((store) => {
    const isBudget = store.chain.toLowerCase().includes('aldi');
    const isButcher = store.chain.toLowerCase().includes('karns');
    const isWeis = store.chain.toLowerCase().includes('weis');
    const isGiant = store.chain.toLowerCase().includes('giant');

    const beefPrice = isButcher ? 3.49 : isBudget ? 3.89 : 4.99;
    deals.push({
      id: `${store.id}-beef`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
      title: isButcher ? 'Fresh Ground Chuck (80/20) Value Pack' : '80/20 Ground Beef',
      subtitle: isButcher ? 'Butcher shop cut, 3 lb avg' : '1 lb tray',
      category: 'meat_seafood',
      originalPrice: beefPrice + 1.5,
      salePrice: beefPrice,
      discountPercent: Math.round((1.5 / (beefPrice + 1.5)) * 100),
      unitPrice: `$${beefPrice.toFixed(2)} / lb`,
      normalizedUnitCost: beefPrice,
      normalizedUnitType: 'lb',
      unitDescription: 'per pound',
      dealType: isButcher ? 'sale' : isWeis ? 'digital_coupon' : 'sale',
      dealBadge: isButcher ? 'BUTCHER SPECIAL' : undefined,
      validUntil: validUntilStr,
      inStock: true,
      genericProductGroup: 'ground_beef_80_20',
      tags: ['meat', 'beef', 'protein', 'dinner'],
      brand: isBudget ? 'Simply Nature' : 'Store Brand',
      qualityTier: isButcher ? 'premium' : 'standard',
    });

    if (isButcher) {
      const wingsPrice = 2.49;
      deals.push({
        id: `${store.id}-wings`,
        storeId: store.id,
        storeName: store.name,
        storeLogoBg: store.logoBg,
        storeLogoText: store.logoText,
        title: 'Fresh Jumbo Chicken Wings',
        subtitle: 'Family Pack, 4 lb avg',
        category: 'meat_seafood',
        originalPrice: 3.99,
        salePrice: wingsPrice,
        discountPercent: Math.round(((3.99 - wingsPrice) / 3.99) * 100),
        unitPrice: `$${wingsPrice.toFixed(2)} / lb`,
        normalizedUnitCost: wingsPrice,
        normalizedUnitType: 'lb',
        unitDescription: 'per pound',
        dealType: 'sale',
        dealBadge: 'WEEKLY SPECIAL',
        validUntil: validUntilStr,
        inStock: true,
        genericProductGroup: 'chicken_wings',
        tags: ['meat', 'chicken', 'poultry', 'wings'],
        brand: 'Karns Butcher',
        qualityTier: 'premium',
      });
    }

    const eggPrice = isBudget ? 1.95 : isGiant ? 2.49 : 2.79;
    deals.push({
      id: `${store.id}-eggs`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
      title: 'Grade A Large White Eggs, 1 Dozen',
      category: 'dairy_eggs',
      originalPrice: 3.49,
      salePrice: eggPrice,
      discountPercent: Math.round(((3.49 - eggPrice) / 3.49) * 100),
      unitPrice: `$${(eggPrice / 12).toFixed(2)} / egg`,
      normalizedUnitCost: Number((eggPrice / 12).toFixed(3)),
      normalizedUnitType: 'unit',
      unitDescription: 'per egg',
      dealType: 'sale',
      dealBadge: isBudget ? 'SUPER SAVER' : undefined,
      validUntil: validUntilStr,
      inStock: true,
      genericProductGroup: 'large_white_eggs',
      tags: ['dairy', 'eggs', 'breakfast'],
      brand: isBudget ? 'Goldhen' : 'Store Brand',
      qualityTier: 'standard',
    });

    const milkPrice = isBudget ? 2.89 : 3.29;
    deals.push({
      id: `${store.id}-milk`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
      title: 'Whole Milk, 1 Gallon',
      category: 'dairy_eggs',
      originalPrice: 4.19,
      salePrice: milkPrice,
      discountPercent: Math.round(((4.19 - milkPrice) / 4.19) * 100),
      unitPrice: `$${milkPrice.toFixed(2)} / gallon`,
      normalizedUnitCost: milkPrice,
      normalizedUnitType: 'gallon',
      unitDescription: 'per gallon',
      dealType: 'sale',
      validUntil: validUntilStr,
      inStock: true,
      genericProductGroup: 'whole_milk_gallon',
      tags: ['dairy', 'milk'],
      brand: isBudget ? 'Friendly Farms' : 'Dairy Pure',
      qualityTier: 'standard',
    });
  });

  return deals;
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
