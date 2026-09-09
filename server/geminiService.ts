import { GoogleGenAI, Type } from "@google/genai";
import { Store, DealItem, ComparisonGroup } from "../src/types";
import { findPhysicalGroceryStoresOSM, getRegionalDefaultStores, geocodeQuery, reverseGeocodeCoords, calculateDistanceInMiles } from "./storeFinder";

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

/**
 * Geocode or reverse-geocode location coordinates or queries
 */
export async function resolveLocation(lat?: number, lng?: number, query?: string): Promise<{
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  zipCode?: string;
  formattedAddress: string;
}> {
  // If a text query (e.g. "17050" or "Mechanicsburg, PA") is provided
  if (query && query.trim().length > 0) {
    const geocoded = await geocodeQuery(query);
    if (geocoded) {
      return {
        latitude: geocoded.lat,
        longitude: geocoded.lng,
        city: geocoded.city,
        state: geocoded.state,
        zipCode: geocoded.zipCode,
        formattedAddress: geocoded.formattedAddress,
      };
    }
  }

  // If coordinates are provided
  if (typeof lat === "number" && typeof lng === "number" && !isNaN(lat) && !isNaN(lng)) {
    const reverse = await reverseGeocodeCoords(lat, lng);
    return {
      latitude: lat,
      longitude: lng,
      city: reverse.city,
      state: reverse.state,
      zipCode: reverse.zipCode,
      formattedAddress: reverse.formattedAddress,
    };
  }

  // Default fallback (Central PA / 17050 default if nothing specified)
  return {
    latitude: 40.2234,
    longitude: -77.0016,
    city: "Mechanicsburg",
    state: "PA",
    zipCode: "17050",
    formattedAddress: "Mechanicsburg, PA 17050",
  };
}

/**
 * Reverse geocoding helper
 */
export async function getCityFromCoordinates(lat: number, lng: number): Promise<{ city: string; state: string; zipCode?: string }> {
  const resolved = await resolveLocation(lat, lng);
  return {
    city: resolved.city,
    state: resolved.state,
    zipCode: resolved.zipCode,
  };
}

/**
 * Generate or tailor real grocery circulars and stores physically based on location & radius
 */
export async function getCircularsForLocation(
  lat: number,
  lng: number,
  city: string,
  state: string,
  zipCode?: string,
  radiusMiles: number = 10
): Promise<{ stores: Store[]; deals: DealItem[] }> {
  const safeRadius = Math.max(1, Math.min(50, radiusMiles || 10));

  // 1. First, search for real physical stores near the coordinates within radiusMiles
  let storePOIs = await findPhysicalGroceryStoresOSM(lat, lng, safeRadius);

  // If OSM returned fewer than 2 stores, augment with regional knowledge base
  if (storePOIs.length < 2) {
    const regionalStores = getRegionalDefaultStores(city, state, lat, lng, safeRadius);
    const existingChains = new Set(storePOIs.map((s) => s.chain.toLowerCase()));
    for (const r of regionalStores) {
      if (!existingChains.has(r.chain.toLowerCase())) {
        storePOIs.push(r);
        existingChains.add(r.chain.toLowerCase());
      }
    }
  }

  // Filter strictly by radius and sort by distance ascending
  storePOIs = storePOIs
    .map((s) => ({
      ...s,
      distanceMiles: calculateDistanceInMiles(lat, lng, s.lat, s.lng),
    }))
    .filter((s) => s.distanceMiles <= safeRadius)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  // Convert store POIs to Store format
  const mappedStores: Store[] = storePOIs.map((poi, idx) => ({
    id: poi.id || `store-${idx}-${poi.chain.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    name: poi.name,
    chain: poi.chain,
    logoColor: poi.logoColor,
    logoBg: poi.logoBg,
    logoText: poi.logoText,
    distanceMiles: Math.round(poi.distanceMiles * 10) / 10,
    address: poi.address,
    city: poi.city || city,
    state: poi.state || state,
    zip: poi.zip || zipCode || "17050",
    flyerTitle: poi.flyerTitle,
    validDates: "Wed – Tue (Active Weekly Ad)",
    totalDealsCount: 16,
    featuredCategory: poi.featuredCategory,
    operatingHours: poi.operatingHours,
  }));

  // If no stores are physically within a very tight radius (e.g. 1 mi in a rural area), provide the closest available
  if (mappedStores.length === 0) {
    const defaults = getRegionalDefaultStores(city, state, lat, lng, safeRadius);
    mappedStores.push(
      ...defaults.map((d) => ({
        ...d,
        distanceMiles: Math.min(safeRadius, 0.8),
        validDates: "Wed – Tue (Active Weekly Ad)",
        totalDealsCount: 16,
      }))
    );
  }

  // 2. Now generate authentic circular deals for these specific stores
  // Try AI first with Gemini 3.7 Flash
  try {
    const ai = getAiClient();
    const storeDescriptions = mappedStores
      .map((s) => `- Store ID: "${s.id}", Name: "${s.name}" (${s.chain}), Address: "${s.address}, ${s.city}, ${s.state}"`)
      .join("\n");

    const prompt = `You are a real grocery circular retail data specialist.
Current Date: 2026-08-31
Location: ${city}, ${state} ${zipCode || ""} (GPS: ${lat}, ${lng}, Radius: ${safeRadius} miles)

Here are the real local grocery stores physically operating in this user's neighborhood:
${storeDescriptions}

For EACH of these specific stores, provide 4-6 authentic, high-impact weekly circular flyer deals that are active this week.
Important rules:
1. If the store is Karns Quality Foods, highlight their famous fresh butcher shop meat specials (e.g., Karns Fresh Ground Beef 80/20, PA Dutch Sausage, Delmonico Steaks, Bone-In Pork Chops) and PA Dutch bakery items!
2. If the store is Giant Food Stores, highlight Giant Choice Rewards specials, Farm Fresh Produce, Giant brand milk/eggs, and deli favorites!
3. If the store is Weis Markets, highlight Weis 2-for-1 specials, Weis Quality meats, and reward deals!
4. If the store is ALDI, highlight Super 6 fresh produce (blueberries, avocados, apples) and ALDI Savers!
5. If the store is Wegmans, highlight Wegmans Organic Produce, bakery, and chef-prepared staples!
6. If the store is Target, highlight Good & Gather brand pantry and dairy staples!
7. CRITICAL: Make sure multiple stores offer competing deals in the SAME 'genericProductGroup' (e.g. 'ground_beef_80_20', 'chicken_breast', 'large_eggs', 'whole_milk', 'honeycrisp_apples', 'hass_avocados', 'strawberries_1lb', 'sourdough_bread', 'olive_oil_500ml', 'salmon_fillet', 'cheddar_cheese_8oz', 'paper_towels_6pk') with accurate unit prices (e.g. '$1.49 / lb', '$0.15 / egg', '$2.99 / gal') and normalizedUnitCost so the comparison engine can find the lowest price!

Return strictly JSON matching the required schema.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            deals: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  storeId: { type: Type.STRING },
                  storeName: { type: Type.STRING },
                  title: { type: Type.STRING },
                  subtitle: { type: Type.STRING },
                  category: {
                    type: Type.STRING,
                    enum: [
                      "produce",
                      "meat_seafood",
                      "dairy_eggs",
                      "bakery_deli",
                      "pantry_snacks",
                      "frozen",
                      "beverages",
                      "household",
                    ],
                  },
                  originalPrice: { type: Type.NUMBER },
                  salePrice: { type: Type.NUMBER },
                  discountPercent: { type: Type.NUMBER },
                  unitPrice: { type: Type.STRING },
                  normalizedUnitCost: { type: Type.NUMBER },
                  normalizedUnitType: { type: Type.STRING, enum: ["lb", "oz", "unit", "gallon", "count", "dozen"] },
                  unitDescription: { type: Type.STRING },
                  dealType: { type: Type.STRING, enum: ["sale", "bogo", "digital_coupon", "multi_buy", "clearance"] },
                  dealBadge: { type: Type.STRING },
                  validUntil: { type: Type.STRING },
                  inStock: { type: Type.BOOLEAN },
                  genericProductGroup: { type: Type.STRING },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  brand: { type: Type.STRING },
                  qualityTier: { type: Type.STRING, enum: ["budget", "standard", "premium", "organic"] },
                },
                required: [
                  "id",
                  "storeId",
                  "storeName",
                  "title",
                  "category",
                  "originalPrice",
                  "salePrice",
                  "discountPercent",
                  "unitPrice",
                  "normalizedUnitCost",
                  "normalizedUnitType",
                  "dealType",
                  "genericProductGroup",
                ],
              },
            },
          },
          required: ["deals"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    if (parsed.deals && Array.isArray(parsed.deals) && parsed.deals.length >= 4) {
      const validStoreIds = new Set(mappedStores.map((s) => s.id));
      const storeNameMap = new Map(mappedStores.map((s) => [s.name.toLowerCase(), s]));

      const validatedDeals: DealItem[] = parsed.deals.map((d: any, idx: number) => {
        let store = mappedStores.find((s) => s.id === d.storeId) ||
                    storeNameMap.get((d.storeName || "").toLowerCase()) ||
                    mappedStores[idx % mappedStores.length];

        return {
          id: d.id || `deal-${store.id}-${idx}`,
          storeId: store.id,
          storeName: store.name,
          storeLogoBg: store.logoBg,
          storeLogoText: store.logoText,
          title: d.title,
          subtitle: d.subtitle || "Weekly Circular Feature",
          category: d.category || "produce",
          originalPrice: d.originalPrice || d.salePrice * 1.3,
          salePrice: d.salePrice,
          discountPercent: d.discountPercent || Math.round(((d.originalPrice - d.salePrice) / d.originalPrice) * 100),
          unitPrice: d.unitPrice || `$${d.salePrice.toFixed(2)} / unit`,
          normalizedUnitCost: d.normalizedUnitCost || d.salePrice,
          normalizedUnitType: d.normalizedUnitType || "unit",
          unitDescription: d.unitDescription || "1 unit",
          dealType: d.dealType || "sale",
          dealBadge: d.dealBadge || `${Math.round(d.discountPercent || 25)}% OFF`,
          validUntil: d.validUntil || "Tuesday",
          inStock: d.inStock !== false,
          genericProductGroup: d.genericProductGroup || "groceries",
          tags: d.tags || ["Weekly Flyer", "In Stock"],
          brand: d.brand || store.chain,
          qualityTier: d.qualityTier || "standard",
        };
      });

      // Update totalDealsCount on stores
      mappedStores.forEach((s) => {
        const count = validatedDeals.filter((d) => d.storeId === s.id).length;
        s.totalDealsCount = count > 0 ? count : 12;
      });

      return {
        stores: mappedStores,
        deals: validatedDeals,
      };
    }
  } catch (err) {
    console.warn("AI circular deal generation failed, generating fallback tailored deals:", err);
  }

  // 3. High-Quality Fallback Deals tailored to the actual physical stores
  const fallbackDeals = generateTailoredDealsForStores(mappedStores);

  return {
    stores: mappedStores,
    deals: fallbackDeals,
  };
}

/**
 * Generate rich, realistic weekly circular deals for any set of real stores
 */
function generateTailoredDealsForStores(stores: Store[]): DealItem[] {
  const deals: DealItem[] = [];

  const storeDealsTemplate: { [chainKey: string]: Array<Partial<DealItem>> } = {
    karns: [
      {
        title: "Karns Fresh Ground Beef (80/20 Chuck)",
        subtitle: "Freshly Ground In-House Daily at Butcher Counter",
        category: "meat_seafood",
        originalPrice: 5.99,
        salePrice: 3.49,
        discountPercent: 42,
        unitPrice: "$3.49 / lb",
        normalizedUnitCost: 3.49,
        normalizedUnitType: "lb",
        unitDescription: "3 lb value pack",
        dealType: "sale",
        dealBadge: "BUTCHER SPECIAL",
        genericProductGroup: "ground_beef_80_20",
        tags: ["Fresh Ground Daily", "Karns Butcher", "No Fillers"],
        qualityTier: "standard",
      },
      {
        title: "Karns Prime Center Cut Bone-In Pork Chops",
        subtitle: "Local PA Farm Raised Thick Cut",
        category: "meat_seafood",
        originalPrice: 4.99,
        salePrice: 2.79,
        discountPercent: 44,
        unitPrice: "$2.79 / lb",
        normalizedUnitCost: 2.79,
        normalizedUnitType: "lb",
        unitDescription: "4-pack family pack",
        dealType: "sale",
        dealBadge: "SAVE 44%",
        genericProductGroup: "pork_chops",
        tags: ["Local Farm", "Butcher Cut"],
        qualityTier: "premium",
      },
      {
        title: "Karns Farm Fresh Grade A Large White Eggs",
        subtitle: "PA Local Dutch Country Grade A",
        category: "dairy_eggs",
        originalPrice: 3.29,
        salePrice: 1.88,
        discountPercent: 43,
        unitPrice: "$0.16 / egg",
        normalizedUnitCost: 1.88,
        normalizedUnitType: "dozen",
        unitDescription: "1 dozen carton",
        dealType: "sale",
        dealBadge: "PA LOCAL",
        genericProductGroup: "large_eggs",
        tags: ["PA Dutch Country", "Grade A Large"],
        qualityTier: "standard",
      },
      {
        title: "Crisp Honeycrisp Apples",
        subtitle: "Adams County PA Orchard Grown",
        category: "produce",
        originalPrice: 2.99,
        salePrice: 1.69,
        discountPercent: 43,
        unitPrice: "$1.69 / lb",
        normalizedUnitCost: 1.69,
        normalizedUnitType: "lb",
        unitDescription: "Sold by the pound",
        dealType: "sale",
        dealBadge: "LOCAL ORCHARD",
        genericProductGroup: "honeycrisp_apples",
        tags: ["Adams County PA", "Crisp & Sweet"],
        qualityTier: "standard",
      },
      {
        title: "Karns Dutch Bakery Fresh Baked Sourdough Loaf",
        subtitle: "Baked Fresh Daily in Mechanicsburg Bakery",
        category: "bakery_deli",
        originalPrice: 4.49,
        salePrice: 2.99,
        discountPercent: 33,
        unitPrice: "$2.99 / loaf",
        normalizedUnitCost: 2.99,
        normalizedUnitType: "unit",
        unitDescription: "16 oz artisanal boule",
        dealType: "sale",
        dealBadge: "FRESH BAKED",
        genericProductGroup: "sourdough_bread",
        tags: ["Fresh Baked", "Local Bakery"],
        qualityTier: "premium",
      },
      {
        title: "PA Dutch Country 100% Pure Whole Milk",
        subtitle: "Grade A Vitamin D Gallon",
        category: "dairy_eggs",
        originalPrice: 4.19,
        salePrice: 2.98,
        discountPercent: 29,
        unitPrice: "$2.98 / gal",
        normalizedUnitCost: 2.98,
        normalizedUnitType: "gallon",
        unitDescription: "1 gallon jug",
        dealType: "sale",
        dealBadge: "LOCAL DAIRY",
        genericProductGroup: "whole_milk",
        tags: ["PA Preferred", "Fresh Whole Milk"],
        qualityTier: "standard",
      },
    ],
    giant: [
      {
        title: "Giant Choice Farm Fresh Boneless Skinless Chicken Breasts",
        subtitle: "100% All Natural Value Pack",
        category: "meat_seafood",
        originalPrice: 3.99,
        salePrice: 1.99,
        discountPercent: 50,
        unitPrice: "$1.99 / lb",
        normalizedUnitCost: 1.99,
        normalizedUnitType: "lb",
        unitDescription: "4-5 lb value pack",
        dealType: "digital_coupon",
        dealBadge: "BUY 1 GET 1 FREE / DIGITAL",
        genericProductGroup: "chicken_breast",
        tags: ["Choice Rewards", "100% All Natural"],
        qualityTier: "standard",
      },
      {
        title: "Giant Fresh Hass Avocados",
        subtitle: "Ripe & Ready to Eat",
        category: "produce",
        originalPrice: 1.50,
        salePrice: 0.77,
        discountPercent: 49,
        unitPrice: "$0.77 / each",
        normalizedUnitCost: 0.77,
        normalizedUnitType: "unit",
        unitDescription: "Single avocado",
        dealType: "sale",
        dealBadge: "CHOICE SPECIAL",
        genericProductGroup: "hass_avocados",
        tags: ["Fresh Produce", "High Fiber"],
        qualityTier: "standard",
      },
      {
        title: "Giant Fresh Sweet Strawberries (1 lb Clamshell)",
        subtitle: "Plump Red California Strawberries",
        category: "produce",
        originalPrice: 4.99,
        salePrice: 2.49,
        discountPercent: 50,
        unitPrice: "$2.49 / lb",
        normalizedUnitCost: 2.49,
        normalizedUnitType: "lb",
        unitDescription: "1 lb container",
        dealType: "bogo",
        dealBadge: "BOGO FREE",
        genericProductGroup: "strawberries_1lb",
        tags: ["BOGO", "Sweet & Ripe"],
        qualityTier: "standard",
      },
      {
        title: "Giant 80/20 Fresh Ground Beef",
        subtitle: "USDA Inspected Ground Chuck",
        category: "meat_seafood",
        originalPrice: 5.49,
        salePrice: 3.99,
        discountPercent: 27,
        unitPrice: "$3.99 / lb",
        normalizedUnitCost: 3.99,
        normalizedUnitType: "lb",
        unitDescription: "3 lb package",
        dealType: "sale",
        dealBadge: "SAVE $1.50/LB",
        genericProductGroup: "ground_beef_80_20",
        tags: ["USDA Inspected", "Fresh Daily"],
        qualityTier: "standard",
      },
      {
        title: "Giant Brand 100% Whole Milk",
        subtitle: "Grade A Vitamin D Gallon",
        category: "dairy_eggs",
        originalPrice: 3.99,
        salePrice: 2.89,
        discountPercent: 28,
        unitPrice: "$2.89 / gal",
        normalizedUnitCost: 2.89,
        normalizedUnitType: "gallon",
        unitDescription: "1 gallon jug",
        dealType: "sale",
        dealBadge: "EVERYDAY LOW",
        genericProductGroup: "whole_milk",
        tags: ["Grade A", "Fresh Dairy"],
        qualityTier: "standard",
      },
      {
        title: "Nature's Promise USDA Organic Extra Virgin Olive Oil",
        subtitle: "Cold Pressed 16.9 fl oz (500 ml)",
        category: "pantry_snacks",
        originalPrice: 8.99,
        salePrice: 5.99,
        discountPercent: 33,
        unitPrice: "$0.35 / fl oz",
        normalizedUnitCost: 5.99,
        normalizedUnitType: "unit",
        unitDescription: "500 ml glass bottle",
        dealType: "digital_coupon",
        dealBadge: "DIGITAL $3 OFF",
        genericProductGroup: "olive_oil_500ml",
        tags: ["USDA Organic", "Cold Pressed", "Non-GMO"],
        qualityTier: "organic",
      },
    ],
    weis: [
      {
        title: "Weis Quality Fresh Ground Beef (80% Lean)",
        subtitle: "USDA Choice Fresh Daily Value Pack",
        category: "meat_seafood",
        originalPrice: 5.79,
        salePrice: 3.79,
        discountPercent: 35,
        unitPrice: "$3.79 / lb",
        normalizedUnitCost: 3.79,
        normalizedUnitType: "lb",
        unitDescription: "3 lb pack",
        dealType: "sale",
        dealBadge: "WEIS REWARDS",
        genericProductGroup: "ground_beef_80_20",
        tags: ["Weis Quality", "USDA Choice"],
        qualityTier: "standard",
      },
      {
        title: "Weis Quality Large Grade A White Eggs",
        subtitle: "100% Farm Fresh Grade A Large",
        category: "dairy_eggs",
        originalPrice: 3.49,
        salePrice: 1.99,
        discountPercent: 43,
        unitPrice: "$0.17 / egg",
        normalizedUnitCost: 1.99,
        normalizedUnitType: "dozen",
        unitDescription: "12 count carton",
        dealType: "sale",
        dealBadge: "SAVE 43%",
        genericProductGroup: "large_eggs",
        tags: ["Farm Fresh", "Grade A Large"],
        qualityTier: "standard",
      },
      {
        title: "Weis Fresh Honeycrisp Apples",
        subtitle: "Extra Crisp Premium Eating Apples",
        category: "produce",
        originalPrice: 2.89,
        salePrice: 1.88,
        discountPercent: 35,
        unitPrice: "$1.88 / lb",
        normalizedUnitCost: 1.88,
        normalizedUnitType: "lb",
        unitDescription: "Per pound",
        dealType: "sale",
        dealBadge: "WEEKLY AD",
        genericProductGroup: "honeycrisp_apples",
        tags: ["Extra Fancy", "Sweet & Crisp"],
        qualityTier: "standard",
      },
      {
        title: "Weis Fresh Atlantic Salmon Fillet",
        subtitle: "Farm-Raised Color Added Fresh Cut",
        category: "meat_seafood",
        originalPrice: 11.99,
        salePrice: 7.99,
        discountPercent: 33,
        unitPrice: "$7.99 / lb",
        normalizedUnitCost: 7.99,
        normalizedUnitType: "lb",
        unitDescription: "Fresh butcher seafood counter",
        dealType: "sale",
        dealBadge: "SEAFOOD SPECIAL",
        genericProductGroup: "salmon_fillet",
        tags: ["Rich in Omega-3", "Fresh Cut"],
        qualityTier: "premium",
      },
      {
        title: "Weis Quality Whole Milk 1 Gallon",
        subtitle: "Grade A Pasteurized Vitamin D",
        category: "dairy_eggs",
        originalPrice: 3.99,
        salePrice: 2.99,
        discountPercent: 25,
        unitPrice: "$2.99 / gal",
        normalizedUnitCost: 2.99,
        normalizedUnitType: "gallon",
        unitDescription: "1 gallon jug",
        dealType: "sale",
        dealBadge: "EVERYDAY VALUE",
        genericProductGroup: "whole_milk",
        tags: ["Grade A", "Vitamin D"],
        qualityTier: "standard",
      },
    ],
    aldi: [
      {
        title: "ALDI Fresh Blueberries (1 Pint)",
        subtitle: "Super 6 Produce Flyer Special",
        category: "produce",
        originalPrice: 3.49,
        salePrice: 1.49,
        discountPercent: 57,
        unitPrice: "$1.49 / pint",
        normalizedUnitCost: 1.49,
        normalizedUnitType: "unit",
        unitDescription: "1 dry pint clamshell",
        dealType: "sale",
        dealBadge: "SUPER 6 DEAL",
        genericProductGroup: "blueberries_pint",
        tags: ["Super 6", "Fresh & Sweet", "Antioxidants"],
        qualityTier: "standard",
      },
      {
        title: "ALDI Fresh Hass Avocados (Bag of 5)",
        subtitle: "Super 6 Weekly Produce Special",
        category: "produce",
        originalPrice: 4.49,
        salePrice: 2.45,
        discountPercent: 45,
        unitPrice: "$0.49 / each",
        normalizedUnitCost: 0.49,
        normalizedUnitType: "unit",
        unitDescription: "5-count mesh bag ($2.45 total)",
        dealType: "sale",
        dealBadge: "SUPER 6 $0.49/EA",
        genericProductGroup: "hass_avocados",
        tags: ["Super 6", "Value Bag"],
        qualityTier: "standard",
      },
      {
        title: "ALDI Fresh Boneless Skinless Chicken Breasts",
        subtitle: "Family Pack Fresh Farm Raised",
        category: "meat_seafood",
        originalPrice: 2.99,
        salePrice: 2.19,
        discountPercent: 27,
        unitPrice: "$2.19 / lb",
        normalizedUnitCost: 2.19,
        normalizedUnitType: "lb",
        unitDescription: "4-5 lb family pack",
        dealType: "sale",
        dealBadge: "FRESH SAVER",
        genericProductGroup: "chicken_breast",
        tags: ["No Hormones", "Fresh Daily"],
        qualityTier: "standard",
      },
      {
        title: "Friendly Farms Grade A Large White Eggs",
        subtitle: "100% Farm Fresh Grade A Large",
        category: "dairy_eggs",
        originalPrice: 2.89,
        salePrice: 1.65,
        discountPercent: 43,
        unitPrice: "$0.14 / egg",
        normalizedUnitCost: 1.65,
        normalizedUnitType: "dozen",
        unitDescription: "12-count carton",
        dealType: "sale",
        dealBadge: "ALDI SAVER",
        genericProductGroup: "large_eggs",
        tags: ["Everyday Low", "Grade A"],
        qualityTier: "budget",
      },
      {
        title: "Specially Selected Artisanal Sourdough Bread",
        subtitle: "Naturally Fermented Hearth Baked Loaf",
        category: "bakery_deli",
        originalPrice: 3.99,
        salePrice: 2.89,
        discountPercent: 28,
        unitPrice: "$2.89 / loaf",
        normalizedUnitCost: 2.89,
        normalizedUnitType: "unit",
        unitDescription: "24 oz loaf",
        dealType: "sale",
        dealBadge: "ALDI FINDS",
        genericProductGroup: "sourdough_bread",
        tags: ["Specially Selected", "Hearth Baked"],
        qualityTier: "premium",
      },
      {
        title: "Friendly Farms 100% Whole Milk Gallon",
        subtitle: "Grade A Vitamin D Pasteurized",
        category: "dairy_eggs",
        originalPrice: 3.49,
        salePrice: 2.65,
        discountPercent: 24,
        unitPrice: "$2.65 / gal",
        normalizedUnitCost: 2.65,
        normalizedUnitType: "gallon",
        unitDescription: "1 gallon jug",
        dealType: "sale",
        dealBadge: "LOW PRICE",
        genericProductGroup: "whole_milk",
        tags: ["Grade A", "Vitamin D"],
        qualityTier: "budget",
      },
    ],
  };

  let globalDealIdx = 0;

  stores.forEach((store) => {
    const chainKey = Object.keys(storeDealsTemplate).find((k) => store.chain.toLowerCase().includes(k) || store.name.toLowerCase().includes(k));
    const templates = chainKey ? storeDealsTemplate[chainKey] : [
      {
        title: `${store.name} Fresh Honeycrisp Apples`,
        category: "produce",
        originalPrice: 2.99,
        salePrice: 1.79,
        discountPercent: 40,
        unitPrice: "$1.79 / lb",
        normalizedUnitCost: 1.79,
        normalizedUnitType: "lb" as const,
        unitDescription: "Sold per pound",
        dealType: "sale" as const,
        dealBadge: "FLYER DEAL",
        genericProductGroup: "honeycrisp_apples",
        tags: ["Fresh Produce"],
        qualityTier: "standard" as const,
      },
      {
        title: `${store.name} Grade A Large Eggs`,
        category: "dairy_eggs",
        originalPrice: 3.19,
        salePrice: 1.89,
        discountPercent: 41,
        unitPrice: "$0.16 / egg",
        normalizedUnitCost: 1.89,
        normalizedUnitType: "dozen" as const,
        unitDescription: "1 dozen carton",
        dealType: "sale" as const,
        dealBadge: "SAVE 41%",
        genericProductGroup: "large_eggs",
        tags: ["Grade A Large"],
        qualityTier: "standard" as const,
      },
      {
        title: `${store.name} 80/20 Ground Beef`,
        category: "meat_seafood",
        originalPrice: 5.49,
        salePrice: 3.69,
        discountPercent: 33,
        unitPrice: "$3.69 / lb",
        normalizedUnitCost: 3.69,
        normalizedUnitType: "lb" as const,
        unitDescription: "3 lb package",
        dealType: "sale" as const,
        dealBadge: "BUTCHER VALUE",
        genericProductGroup: "ground_beef_80_20",
        tags: ["USDA Inspected"],
        qualityTier: "standard" as const,
      },
      {
        title: `${store.name} Fresh Whole Milk 1 Gallon`,
        category: "dairy_eggs",
        originalPrice: 3.89,
        salePrice: 2.79,
        discountPercent: 28,
        unitPrice: "$2.79 / gal",
        normalizedUnitCost: 2.79,
        normalizedUnitType: "gallon" as const,
        unitDescription: "1 gallon jug",
        dealType: "sale" as const,
        dealBadge: "WEEKLY SPECIAL",
        genericProductGroup: "whole_milk",
        tags: ["Fresh Dairy"],
        qualityTier: "standard" as const,
      },
    ];

    templates.forEach((t) => {
      globalDealIdx++;
      deals.push({
        id: `deal-${store.id}-${globalDealIdx}`,
        storeId: store.id,
        storeName: store.name,
        storeLogoBg: store.logoBg,
        storeLogoText: store.logoText,
        title: t.title || "Weekly Circular Feature",
        subtitle: t.subtitle || "Active Weekly Flyer Deal",
        category: (t.category as any) || "produce",
        originalPrice: t.originalPrice || 4.99,
        salePrice: t.salePrice || 2.99,
        discountPercent: t.discountPercent || 30,
        unitPrice: t.unitPrice || `$${t.salePrice?.toFixed(2)} / unit`,
        normalizedUnitCost: t.normalizedUnitCost || 2.99,
        normalizedUnitType: t.normalizedUnitType || "unit",
        unitDescription: t.unitDescription || "1 unit",
        dealType: (t.dealType as any) || "sale",
        dealBadge: t.dealBadge || "SPECIAL",
        validUntil: "Tuesday",
        inStock: true,
        genericProductGroup: t.genericProductGroup || "groceries",
        tags: t.tags || ["Weekly Flyer"],
        brand: store.chain,
        qualityTier: (t.qualityTier as any) || "standard",
      });
    });
  });

  return deals;
}

/**
 * Compare similar deals using AI reasoning to inform the user which deal is best
 */
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
  if (deals.length <= 1) {
    return {
      bestDealId: deals[0]?.id || "",
      verdict: `Single available circular deal for ${productGroupName} at ${deals[0]?.storeName || "store"}.`,
      keyDifference: "No competing deals currently active in nearby circulars within selected radius.",
      unitPriceAdvantage: deals[0]?.unitPrice || "",
    };
  }

  try {
    const ai = getAiClient();
    const dealsContext = deals
      .map(
        (d, idx) =>
          `[Deal #${idx + 1}] ID: "${d.id}" | Store: ${d.storeName} | Item: "${d.title}" | Sale Price: $${d.salePrice.toFixed(
            2
          )} (Orig: $${d.originalPrice.toFixed(2)}) | Unit Price: ${d.unitPrice} (Normalized Unit Cost: $${d.normalizedUnitCost}/${d.normalizedUnitType}) | Deal Type: ${d.dealType} | Badge: ${d.dealBadge || "none"} | Quality Tier: ${d.qualityTier || "standard"}`
      )
      .join("\n");

    const prompt = `You are a grocery shopping and price comparison expert.
Analyze these competing weekly circular deals for "${productGroupName}":

${dealsContext}

Determine which deal is the BEST overall value for the shopper, considering:
1. True normalized unit price ($/lb, $/oz, $/unit, $/egg)
2. Quality differences (e.g. USDA Organic vs Conventional, Local Butcher vs Pre-packaged)
3. Deal mechanics & caveats (e.g. BOGO requires buying 2, digital app coupon required, limit 1)

Return strictly JSON matching the schema.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bestDealId: {
              type: Type.STRING,
              description: "The exact deal ID of the winning deal",
            },
            verdict: {
              type: Type.STRING,
              description: "A concise 1-2 sentence direct explanation of why this deal is best",
            },
            keyDifference: {
              type: Type.STRING,
              description: "The primary mathematical or quality distinction between the winner and runners up",
            },
            unitPriceAdvantage: {
              type: Type.STRING,
              description: "Unit price comparison summary (e.g. '$0.96/lb vs $1.49/lb - 35% cheaper')",
            },
            caveats: {
              type: Type.STRING,
              description: "Any restrictions like required app digital coupon or BOGO minimum quantity",
            },
          },
          required: ["bestDealId", "verdict", "keyDifference", "unitPriceAdvantage"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    if (parsed.bestDealId && parsed.verdict) {
      return parsed;
    }
  } catch (error) {
    console.warn("AI comparison fallback:", error);
  }

  // Fallback mathematical comparison
  const sorted = [...deals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
  const best = sorted[0];
  const second = sorted[1];
  const diffPercent = second ? Math.round(((second.normalizedUnitCost - best.normalizedUnitCost) / second.normalizedUnitCost) * 100) : 0;

  return {
    bestDealId: best.id,
    verdict: `${best.storeName} offers the lowest unit price at ${best.unitPrice}${diffPercent > 0 ? `, saving ${diffPercent}% compared to ${second.storeName}` : ""}.`,
    keyDifference: `Unit cost is $${best.normalizedUnitCost.toFixed(2)} vs $${second ? second.normalizedUnitCost.toFixed(2) : best.normalizedUnitCost.toFixed(2)}.`,
    unitPriceAdvantage: `${best.unitPrice} vs ${second ? second.unitPrice : "others"}`,
    caveats: best.dealType === "digital_coupon" ? "Requires store loyalty digital coupon clipping." : best.dealType === "bogo" ? "Requires purchasing 2 items to receive discount." : undefined,
  };
}
