import { GoogleGenAI, Type, Schema } from '@google/genai';
import { Store, DealItem } from '../../src/types.js';
import { findPhysicalGroceryStoresOSM, getRegionalDefaultStores } from './storeFinder.js';
import { getFullKarnsCircularDeals } from './karnsScraper.js';
import { fetchLiveDealsForStore } from './liveCircularScraper.js';
import { sanitizeDealList } from './dealPricing.js';

let aiClient: GoogleGenAI | null = null;

const circularsCache = new Map<string, { timestamp: number; data: { stores: Store[]; deals: DealItem[] } }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return aiClient;
}

export const dealsResponseSchema: Schema = {
  type: Type.ARRAY,
  description: 'List of weekly circular flyer grocery deals for local stores.',
  items: {
    type: Type.OBJECT,
    properties: {
      ocrTranscript: { type: Type.STRING },
      id: { type: Type.STRING },
      storeId: { type: Type.STRING },
      storeName: { type: Type.STRING },
      storeLogoBg: { type: Type.STRING },
      storeLogoText: { type: Type.STRING },
      title: { type: Type.STRING },
      subtitle: { type: Type.STRING },
      flavorOrBrand: { type: Type.STRING },
      coreBaseNoun: { type: Type.STRING },
      category: {
        type: Type.STRING,
        enum: ['produce', 'meat_seafood', 'dairy_eggs', 'bakery_deli', 'pantry_snacks', 'frozen', 'beverages', 'household'],
      },
      originalPrice: { type: Type.NUMBER },
      salePrice: { type: Type.NUMBER },
      discountPercent: { type: Type.NUMBER },
      unitPrice: { type: Type.STRING },
      normalizedUnitCost: { type: Type.NUMBER },
      normalizedUnitType: { type: Type.STRING },
      unitDescription: { type: Type.STRING },
      dealType: { type: Type.STRING },
      dealBadge: { type: Type.STRING },
      validUntil: { type: Type.STRING },
      inStock: { type: Type.BOOLEAN },
      genericProductGroup: { type: Type.STRING },
      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      brand: { type: Type.STRING },
      qualityTier: { type: Type.STRING },
      promoBadgeText: { type: Type.STRING },
      hasExplicitDollarPrice: { type: Type.BOOLEAN },
      bundleQuantity: { type: Type.INTEGER },
      bundleTotalPrice: { type: Type.NUMBER },
      isUnpricedPromo: { type: Type.BOOLEAN },
      hasExplicitOriginalPrice: { type: Type.BOOLEAN },
    },
    required: ['title', 'category', 'originalPrice', 'salePrice'],
  },
};

function parseJsonFromText<T>(text: string | null | undefined, fallback: T): T {
  if (!text || typeof text !== 'string') return fallback;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  if (!cleaned) return fallback;
  try {
    const jsonStart = cleaned.indexOf('[');
    const jsonEnd = cleaned.lastIndexOf(']');
    if (jsonStart !== -1 && jsonEnd > jsonStart) return JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

export interface ParsedProductSyntax {
  brandToken: string;
  modifiers: string[];
  headNoun: string;
}

export function extractSyntacticHeadNoun(rawTitle: string, brand?: string | null): ParsedProductSyntax {
  const PACKAGING_WORDS = new Set(['bag', 'bags', 'box', 'boxes', 'pack', 'packs', 'pkg', 'pkgs', 'package', 'packages', 'bunch', 'bunches', 'container', 'containers', 'tub', 'tubs', 'jar', 'jars', 'can', 'cans', 'bottle', 'bottles', 'clamshell', 'clamshells', 'jug', 'jugs', 'carton', 'cartons']);

  const clean = rawTitle.replace(/\(.*?\)/g, '').replace(/\b\d+(\.\d+)?\s*(oz|lb|lbs|ct|pk|pack|fl oz|g|kg|ml|l)\b/gi, '').replace(/[^a-zA-Z0-9\s-]/g, ' ').trim();
  let words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { brandToken: '', modifiers: [], headNoun: 'unknown' };

  let remainingWords = [...words];
  let brandToken = '';
  if (brand && rawTitle.toLowerCase().startsWith(brand.toLowerCase())) {
    const brandWordCount = brand.split(/\s+/).length;
    brandToken = remainingWords.slice(0, brandWordCount).join(' ');
    remainingWords = remainingWords.slice(brandWordCount);
  }

  while (remainingWords.length > 1 && PACKAGING_WORDS.has(remainingWords[remainingWords.length - 1].toLowerCase())) {
    remainingWords.pop();
  }

  const headNoun = (remainingWords.pop() || words[words.length - 1]).toLowerCase();
  const modifiers = remainingWords.map(w => w.toLowerCase());
  return { brandToken, modifiers, headNoun };
}

interface TaxonomicMatrix { defaultKey: string; overrides?: Record<string, string>; }

const TAXONOMY_MATRIX: Record<string, TaxonomicMatrix> = {
  'apple': { defaultKey: 'produce_apples' }, 'apples': { defaultKey: 'produce_apples' },
  'banana': { defaultKey: 'produce_bananas' }, 'bananas': { defaultKey: 'produce_bananas' },
  'strawberry': { defaultKey: 'produce_strawberries' }, 'strawberries': { defaultKey: 'produce_strawberries' },
  'blueberry': { defaultKey: 'produce_blueberries' }, 'blueberries': { defaultKey: 'produce_blueberries' },
  'raspberry': { defaultKey: 'produce_cane_berries' }, 'raspberries': { defaultKey: 'produce_cane_berries' },
  'blackberry': { defaultKey: 'produce_cane_berries' }, 'blackberries': { defaultKey: 'produce_cane_berries' },
  'grape': { defaultKey: 'produce_grapes_conventional', overrides: { 'organic': 'produce_grapes_organic' } }, 'grapes': { defaultKey: 'produce_grapes_conventional', overrides: { 'organic': 'produce_grapes_organic' } },
  'orange': { defaultKey: 'produce_oranges' }, 'oranges': { defaultKey: 'produce_oranges' },
  'mandarin': { defaultKey: 'produce_oranges' }, 'mandarins': { defaultKey: 'produce_oranges' },
  'lemon': { defaultKey: 'produce_lemons' }, 'lemons': { defaultKey: 'produce_lemons' },
  'lime': { defaultKey: 'produce_limes' }, 'limes': { defaultKey: 'produce_limes' },
  'grapefruit': { defaultKey: 'produce_grapefruits' }, 'grapefruits': { defaultKey: 'produce_grapefruits' },
  'melon': { defaultKey: 'produce_melons' }, 'melons': { defaultKey: 'produce_melons' },
  'watermelon': { defaultKey: 'produce_melons' }, 'watermelons': { defaultKey: 'produce_melons' },
  'avocado': { defaultKey: 'produce_avocados' }, 'avocados': { defaultKey: 'produce_avocados' },
  'potato': { defaultKey: 'produce_potatoes', overrides: { 'sweet': 'produce_sweet_potatoes', 'frozen': 'frozen_potatoes', 'fries': 'frozen_potatoes', 'tots': 'frozen_potatoes' } }, 'potatoes': { defaultKey: 'produce_potatoes', overrides: { 'sweet': 'produce_sweet_potatoes', 'frozen': 'frozen_potatoes', 'fries': 'frozen_potatoes', 'tots': 'frozen_potatoes' } },
  'onion': { defaultKey: 'produce_onions' }, 'onions': { defaultKey: 'produce_onions' },
  'broccoli': { defaultKey: 'produce_broccoli' },
  'cauliflower': { defaultKey: 'produce_cauliflower' },
  'carrot': { defaultKey: 'produce_carrots' }, 'carrots': { defaultKey: 'produce_carrots' },
  'celery': { defaultKey: 'produce_celery' },
  'corn': { defaultKey: 'produce_corn' },
  'lettuce': { defaultKey: 'produce_salad_greens' }, 'spinach': { defaultKey: 'produce_salad_greens' }, 'salad': { defaultKey: 'produce_salad_greens' },
  'tomato': { defaultKey: 'produce_tomatoes' }, 'tomatoes': { defaultKey: 'produce_tomatoes' },
  'cucumber': { defaultKey: 'produce_cucumbers' }, 'cucumbers': { defaultKey: 'produce_cucumbers' },
  'pepper': { defaultKey: 'produce_peppers' }, 'peppers': { defaultKey: 'produce_peppers' },
  'squash': { defaultKey: 'produce_squash' }, 'zucchini': { defaultKey: 'produce_squash' },
  'mushroom': { defaultKey: 'produce_mushrooms' }, 'mushrooms': { defaultKey: 'produce_mushrooms' },
  'steak': { defaultKey: 'meat_beef_steak', overrides: { 'ham': 'meat_pork_ham', 'pork': 'meat_pork_ham', 'tuna': 'meat_seafood_salmon', 'salmon': 'meat_seafood_salmon' } }, 'steaks': { defaultKey: 'meat_beef_steak', overrides: { 'ham': 'meat_pork_ham', 'pork': 'meat_pork_ham', 'tuna': 'meat_seafood_salmon', 'salmon': 'meat_seafood_salmon' } },
  'beef': { defaultKey: 'meat_beef_ground' },
  'chicken': { defaultKey: 'meat_chicken_breast', overrides: { 'whole': 'meat_chicken_whole', 'roaster': 'meat_chicken_whole', 'wings': 'meat_chicken_wings', 'wing': 'meat_chicken_wings', 'thighs': 'meat_chicken_dark', 'drumsticks': 'meat_chicken_dark', 'legs': 'meat_chicken_dark' } },
  'pork': { defaultKey: 'meat_pork_chops' }, 'chop': { defaultKey: 'meat_pork_chops' }, 'chops': { defaultKey: 'meat_pork_chops' },
  'roast': { defaultKey: 'meat_beef_roast', overrides: { 'pork': 'meat_pork_roast' } },
  'rib': { defaultKey: 'meat_pork_ribs' }, 'ribs': { defaultKey: 'meat_pork_ribs' },
  'ham': { defaultKey: 'meat_pork_ham' }, 'bacon': { defaultKey: 'meat_bacon' },
  'sausage': { defaultKey: 'meat_sausage' }, 'sausages': { defaultKey: 'meat_sausage' },
  'turkey': { defaultKey: 'meat_turkey_ground' },
  'salmon': { defaultKey: 'meat_seafood_salmon' }, 'tilapia': { defaultKey: 'meat_seafood_whitefish' }, 'cod': { defaultKey: 'meat_seafood_whitefish' }, 'flounder': { defaultKey: 'meat_seafood_whitefish' }, 'shrimp': { defaultKey: 'meat_seafood_shrimp' }, 'crab': { defaultKey: 'meat_seafood_shellfish' }, 'lobster': { defaultKey: 'meat_seafood_shellfish' }, 'tuna': { defaultKey: 'pantry_seafood_canned' },
  'egg': { defaultKey: 'dairy_eggs' }, 'eggs': { defaultKey: 'dairy_eggs' },
  'milk': { defaultKey: 'dairy_milk_cow', overrides: { 'oat': 'dairy_milk_plant', 'almond': 'dairy_milk_plant', 'soy': 'dairy_milk_plant', 'plant': 'dairy_milk_plant', 'cashew': 'dairy_milk_plant', 'coconut': 'dairy_milk_plant' } },
  'butter': { defaultKey: 'dairy_butter_margarine', overrides: { 'peanut': 'pantry_nut_spreads', 'almond': 'pantry_nut_spreads', 'apple': 'pantry_nut_spreads', 'cookie': 'pantry_nut_spreads' } }, 'margarine': { defaultKey: 'dairy_butter_margarine' },
  'cheese': { defaultKey: 'dairy_cheese_shredded', overrides: { 'cream': 'dairy_cream_cheese', 'cottage': 'dairy_cottage_cheese', 'sliced': 'dairy_cheese_sliced_block', 'block': 'dairy_cheese_sliced_block', 'chunk': 'dairy_cheese_sliced_block' } },
  'yogurt': { defaultKey: 'dairy_yogurt' },
  'cream': { defaultKey: 'dairy_cream', overrides: { 'sour': 'dairy_sour_cream', 'ice': 'frozen_ice_cream', 'heavy': 'dairy_cream', 'whipping': 'dairy_cream' } },
  'creamer': { defaultKey: 'dairy_creamer' }, 'creamers': { defaultKey: 'dairy_creamer' },
  'bread': { defaultKey: 'bakery_bread_sandwich', overrides: { 'artisan': 'bakery_bread_artisan', 'baguette': 'bakery_bread_artisan', 'sourdough': 'bakery_bread_artisan' } },
  'roll': { defaultKey: 'bakery_buns' }, 'rolls': { defaultKey: 'bakery_buns' }, 'bun': { defaultKey: 'bakery_buns' }, 'buns': { defaultKey: 'bakery_buns' },
  'bagel': { defaultKey: 'bakery_breakfast_breads' }, 'bagels': { defaultKey: 'bakery_breakfast_breads' }, 'muffin': { defaultKey: 'bakery_breakfast_breads' }, 'muffins': { defaultKey: 'bakery_breakfast_breads' },
  'tortilla': { defaultKey: 'bakery_tortillas' }, 'tortillas': { defaultKey: 'bakery_tortillas' },
  'pasta': { defaultKey: 'pantry_pasta' },
  'sauce': { defaultKey: 'pantry_sauce_pasta', overrides: { 'bbq': 'pantry_sauce_bbq', 'barbecue': 'pantry_sauce_bbq' } },
  'rice': { defaultKey: 'pantry_rice_grains' },
  'bean': { defaultKey: 'pantry_beans_canned' }, 'beans': { defaultKey: 'pantry_beans_canned' },
  'soup': { defaultKey: 'pantry_soup_broth' }, 'broth': { defaultKey: 'pantry_soup_broth' },
  'cereal': { defaultKey: 'pantry_cereal' }, 'oats': { defaultKey: 'pantry_oatmeal' }, 'oatmeal': { defaultKey: 'pantry_oatmeal' },
  'flour': { defaultKey: 'pantry_baking_basics' }, 'sugar': { defaultKey: 'pantry_baking_basics' }, 'oil': { defaultKey: 'pantry_cooking_oil' },
  'coffee': { defaultKey: 'pantry_coffee' }, 'pod': { defaultKey: 'pantry_coffee_pods' }, 'pods': { defaultKey: 'pantry_coffee_pods' },
  'pizza': { defaultKey: 'frozen_pizza' }, 'pizzas': { defaultKey: 'frozen_pizza' },
  'waffle': { defaultKey: 'frozen_waffles_pancakes' }, 'waffles': { defaultKey: 'frozen_waffles_pancakes' }, 'pancake': { defaultKey: 'frozen_waffles_pancakes' }, 'pancakes': { defaultKey: 'frozen_waffles_pancakes' },
  'meal': { defaultKey: 'frozen_meals' }, 'meals': { defaultKey: 'frozen_meals' },
  'water': { defaultKey: 'beverages_water' },
  'soda': { defaultKey: 'beverages_soda_12pk', overrides: { '2': 'beverages_soda_2liter', 'liter': 'beverages_soda_2liter' } }, 'cola': { defaultKey: 'beverages_soda_12pk', overrides: { '2': 'beverages_soda_2liter', 'liter': 'beverages_soda_2liter' } },
  'juice': { defaultKey: 'beverages_juice_shelf', overrides: { 'orange': 'beverages_juice_orange' } },
  'drink': { defaultKey: 'beverages_sports', overrides: { 'energy': 'beverages_energy' } },
  'seltzer': { defaultKey: 'beverages_seltzer' },
  'chip': { defaultKey: 'snacks_potato_chips', overrides: { 'tortilla': 'snacks_tortilla_chips', 'corn': 'snacks_tortilla_chips' } }, 'chips': { defaultKey: 'snacks_potato_chips', overrides: { 'tortilla': 'snacks_tortilla_chips', 'corn': 'snacks_tortilla_chips' } },
  'pretzel': { defaultKey: 'snacks_pretzels' }, 'pretzels': { defaultKey: 'snacks_pretzels' },
  'cracker': { defaultKey: 'snacks_crackers' }, 'crackers': { defaultKey: 'snacks_crackers' },
  'popcorn': { defaultKey: 'snacks_popcorn' }, 'nut': { defaultKey: 'snacks_nuts' }, 'nuts': { defaultKey: 'snacks_nuts' }, 'peanut': { defaultKey: 'snacks_nuts' }, 'peanuts': { defaultKey: 'snacks_nuts' },
  'towel': { defaultKey: 'household_paper_towels' }, 'towels': { defaultKey: 'household_paper_towels' },
  'tissue': { defaultKey: 'household_bath_tissue' },
  'paper': { defaultKey: 'household_paper_towels', overrides: { 'toilet': 'household_bath_tissue', 'bath': 'household_bath_tissue' } },
  'detergent': { defaultKey: 'household_laundry_detergent_liquid', overrides: { 'pods': 'household_laundry_detergent_pods', 'pacs': 'household_laundry_detergent_pods' } },
  'soap': { defaultKey: 'household_dish_liquid' },
  'bag': { defaultKey: 'household_trash_bags' }, 'bags': { defaultKey: 'household_trash_bags' }
};

export function classifyItemDeterministically(title: string, brand?: string | null, _description?: string | null): string {
  const { modifiers, headNoun } = extractSyntacticHeadNoun(title, brand);
  const processedModifiers = ['roasted', 'canned', 'jar', 'jarred', 'pickled', 'diced', 'crushed', 'paste', 'puree', 'sun-dried'];
  if (modifiers.some(m => processedModifiers.includes(m))) {
     if (headNoun.includes('tomato')) return 'pantry_tomatoes_canned';
     if (['pepper','peppers','mushroom','mushrooms','onion','onions'].includes(headNoun)) return 'uncomparable'; 
  }
  const entry = TAXONOMY_MATRIX[headNoun];
  if (!entry) return 'uncomparable';
  if (entry.overrides) {
    for (const mod of modifiers) {
      if (entry.overrides[mod]) return entry.overrides[mod];
    }
  }
  return entry.defaultKey;
}

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

  function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  let osmStores: Store[] = [];
  try {
    const timeoutPromise = new Promise<Store[]>((_, reject) => setTimeout(() => reject(new Error('OSM timeout')), 6000));
    osmStores = await Promise.race([findPhysicalGroceryStoresOSM(lat, lng, radiusMiles), timeoutPromise]);
  } catch (err: any) {
    console.info('[GeminiService] OSM fallback:', err?.message || err);
  }

  const regionalStores = getRegionalDefaultStores(city, state, lat, lng, radiusMiles);
  const candidateStores = [...regionalStores, ...osmStores];
  const uniqueStoreMap = new Map<string, Store>();
  
  for (const s of candidateStores) {
    if (!s || !s.id) continue;
    const chainKey = (s.chain || s.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    
    const storeLat = s.latitude ?? (s as any).lat;
    const storeLng = s.longitude ?? (s as any).lng;
    
    s.distanceMiles = (storeLat !== undefined && storeLng !== undefined)
      ? getDistanceMiles(lat, lng, storeLat, storeLng)
      : 9999;

    if (s.distanceMiles <= radiusMiles) {
      if (!uniqueStoreMap.has(chainKey) || (uniqueStoreMap.get(chainKey)!.distanceMiles || 999) > s.distanceMiles) {
        uniqueStoreMap.set(chainKey, s);
      }
    }
  }

  const storesWithinRadius = Array.from(uniqueStoreMap.values());
  if (storesWithinRadius.length === 0) return { stores: [], deals: [] };

  let karnsDeals: DealItem[] = [];
  const karnsStore = storesWithinRadius.find((s) => (s?.name || '').toLowerCase().includes('karns') || (s?.chain || '').toLowerCase().includes('karns'));
  if (karnsStore) {
    try {
      const karnsTimeout = new Promise<DealItem[]>((_, reject) => setTimeout(() => reject(new Error('Karns timeout')), 8000));
      karnsDeals = await Promise.race([getFullKarnsCircularDeals(karnsStore), karnsTimeout]);
      karnsStore.totalDealsCount = karnsDeals.length;
    } catch (err) {
      console.warn('[GeminiService] Karns scraper timed out or failed.');
    }
  }

  const otherStores = storesWithinRadius.filter((s) => s !== karnsStore);
  const liveDealsByStore = new Map<string, DealItem[]>();

  // Strict 8-second killswitch for Flipp Scraper
  await Promise.all(
    otherStores.map(async (s) => {
      try {
        const flippTimeout = new Promise<DealItem[]>((_, reject) => setTimeout(() => reject(new Error('Flipp timeout')), 8000));
        const liveItems = await Promise.race([fetchLiveDealsForStore(s, zipCode), flippTimeout]);
        if (liveItems && liveItems.length > 0) liveDealsByStore.set(s.id, liveItems);
      } catch (err) {
        console.warn(`[GeminiService] fetchLiveDealsForStore failed/timed out for ${s.name}`);
      }
    })
  );

  const storesNeedingDeals = otherStores.filter((s) => !liveDealsByStore.has(s.id));
  let aiDeals: DealItem[] = [];
  const ai = getAiClient();

  if (storesNeedingDeals.length > 0 && ai) {
    try {
      const storeSummary = storesNeedingDeals.map((s) => ({ id: s.id, name: s.name, address: `${s.address}, ${s.city}` }));
      const currentDate = new Date().toISOString().split('T')[0];
      const searchInstructions = storesNeedingDeals.map((s) => `- ${s.name}: "${s.name} ${city} ${state} weekly ad circular deals"`).join('\n');

      const prompt = `Based on current weekly grocery circulars, flyers, and advertised specials for supermarkets near ${city}, ${state} ${zipCode} active as of ${currentDate}:
Specifically, search for:
${searchInstructions}
Target Supermarkets:
${JSON.stringify(storeSummary, null, 2)}
CRITICAL INSTRUCTIONS:
1. Extract REAL advertised items and prices. Do NOT invent prices.
2. If a store has NO advertised deals online, DO NOT invent them.
3. Map to exactly one allowed product key.
Return ONLY a valid JSON array of deal objects matching the schema.`;

      // FIXED MODEL ALIASES
      const modelsToTry = ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'];
      for (let i = 0; i < modelsToTry.length; i++) {
        try {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 12000));
          const result = (await Promise.race([
            ai.models.generateContent({ model: modelsToTry[i], contents: prompt, config: { responseMimeType: 'application/json', responseSchema: dealsResponseSchema, temperature: 0.1 } }),
            timeoutPromise,
          ])) as any;
          if (result?.text && result.text.trim()) {
            const parsed = parseJsonFromText<DealItem[]>(result.text, []);
            if (Array.isArray(parsed) && parsed.length > 0) { aiDeals = parsed; break; }
          }
        } catch (err: any) {
          // If the model actually timed out (hanging), break the loop immediately to save the server response
          if (err?.message === 'AI_TIMEOUT') {
             console.warn('[Gemini] Live Search hit hard timeout. Aborting AI Web Search to save response.');
             break;
          }
        }
      }
    } catch (err) {}
  }

  const authenticDeals: DealItem[] = [...karnsDeals];

  for (const store of otherStores) {
    const dealsForStore = liveDealsByStore.get(store.id);
    if (dealsForStore && dealsForStore.length > 0) {
      authenticDeals.push(...dealsForStore);
    } else {
      const matchingAi = aiDeals.filter((d) => d.storeId === store.id || d.storeName?.toLowerCase().includes(store.name.toLowerCase()));
      if (matchingAi.length > 0) {
        matchingAi.forEach((d) => { d.storeId = store.id; d.storeName = store.name; d.storeLogoBg = store.logoBg; d.storeLogoText = store.logoText; });
        authenticDeals.push(...matchingAi);
      }
    }
  }

  const seenDealIds = new Set<string>();
  authenticDeals.forEach((d, idx) => {
    if (!d.id || seenDealIds.has(d.id)) d.id = `${d.storeId || 'deal'}-${idx + 1}-${Date.now()}`;
    seenDealIds.add(d.id);
  });

  const categorizedDeals = authenticDeals.map((d) => {
    const localCat = classifyItemDeterministically(d.title, d.brand);
    const { headNoun } = extractSyntacticHeadNoun(d.title, d.brand);
    d.coreBaseNoun = headNoun;
    d.genericProductGroup = localCat || 'uncomparable';
    d.subtitle = `Noun: [${headNoun}] -> Key: [${d.genericProductGroup}]`;
    return d;
  });

  const finalDeals = sanitizeDealList(categorizedDeals);

  const counts: Record<string, number> = {};
  finalDeals.forEach((d) => { counts[d.storeId] = (counts[d.storeId] || 0) + 1; });
  storesWithinRadius.forEach((s) => { s.totalDealsCount = counts[s.id] || 0; });

  const result = { stores: storesWithinRadius, deals: finalDeals };
  circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
}

export async function parseFlyerWithAI(
  base64Data: string,
  mimeType: string,
  store: { id: string; name: string; logoBg: string; logoText: string }
): Promise<DealItem[]> {
  const ai = getAiClient();
  if (!ai) throw new Error('Gemini API client not initialized.');

  const prompt = `Analyze this physical weekly circular flyer or promotional PDF for "${store.name}". Extract EVERY advertised grocery product special. Return ONLY a JSON array matching the schema.`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }],
      config: { responseMimeType: 'application/json', responseSchema: dealsResponseSchema, temperature: 0.1 },
    });
  } catch {}

  const parsed = response?.text ? parseJsonFromText<DealItem[]>(response.text, []) : [];
  const sanitized = sanitizeDealList(parsed);

  return sanitized.map((item, idx) => ({
    ...item,
    id: item.id || `scanned-${store.id}-${Date.now()}-${idx}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg,
    storeLogoText: store.logoText,
  }));
}

export async function extractDealsFromFlyerImage(
  store: Store,
  imageUrl: string
): Promise<DealItem[]> {
  const ai = getAiClient();
  if (!ai) return [];

  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return [];
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ inlineData: { data: base64Data, mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg' } }, { text: 'Extract deals.' }],
      config: { responseMimeType: 'application/json', responseSchema: dealsResponseSchema, temperature: 0.1 },
    });

    const parsedDeals = response?.text ? parseJsonFromText<DealItem[]>(response.text, []) : [];
    const sanitized = sanitizeDealList(parsedDeals);

    return sanitized.map((deal, idx) => ({
      ...deal,
      id: `${store.id}-vision-${Date.now()}-${idx}`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
    }));
  } catch {
    return [];
  }
}

export async function batchCategorizeItems(
  items: Array<{ id: string; title: string; brand?: string | null }>
): Promise<Array<{ id: string; category?: string; genericProductGroup?: string }>> {
  return items.map((item) => {
    const cat = classifyItemDeterministically(item.title, item.brand);
    return {
      id: item.id,
      genericProductGroup: cat,
      category: cat.split('_')[0] || 'pantry_snacks',
    };
  });
}

export async function compareDealsWithAI(productGroupName: string, deals: DealItem[]): Promise<any> {
  const ai = getAiClient();
  if (!ai || !deals || deals.length === 0) {
    return {
      productGroup: productGroupName,
      bestDeal: deals?.[0] || null,
      summary: 'Comparison based on normalized unit pricing.',
      savingsInsight: 'Shop the lowest unit price for maximum value.',
    };
  }

  try {
    const prompt = `Compare these grocery deals for "${productGroupName}":\n${JSON.stringify(deals, null, 2)}\nProvide a concise value analysis, identify the absolute best value item, and state why. Return JSON: { "bestDealId": string, "summary": string, "savingsInsight": string }`;
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.1 },
    });
    if (response?.text) {
      const parsed = JSON.parse(response.text);
      return {
        productGroup: productGroupName,
        bestDeal: deals.find((d) => d.id === parsed.bestDealId) || deals[0],
        summary: parsed.summary || 'Comparison based on lowest unit price.',
        savingsInsight: parsed.savingsInsight || 'Best savings found.',
      };
    }
  } catch {}

  return {
    productGroup: productGroupName,
    bestDeal: deals[0],
    summary: 'Comparison based on lowest unit price.',
    savingsInsight: 'Shop the lowest unit price for maximum savings.',
  };
}

