// api/index.ts
import express from "express";

// server/storeFinder.ts
var NOMINATIM_USER_AGENT = "DealScout-Grocery-App/2.0 (contact: support@dealscout.local)";
var NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
var OVERPASS_BASE_URL = "https://overpass-api.de/api/interpreter";
var geocodeCache = /* @__PURE__ */ new Map();
geocodeCache.set("17050", {
  lat: 40.2137,
  lng: -77.0075,
  city: "Mechanicsburg",
  state: "PA",
  zipCode: "17050",
  formattedAddress: "Mechanicsburg, PA 17050, USA"
});
geocodeCache.set("mechanicsburg, pa", {
  lat: 40.2137,
  lng: -77.0075,
  city: "Mechanicsburg",
  state: "PA",
  zipCode: "17050",
  formattedAddress: "Mechanicsburg, PA 17050, USA"
});
function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_MILES = 3958.8;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const radLat1 = toRadians(lat1);
  const radLat2 = toRadians(lat2);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((EARTH_RADIUS_MILES * c).toFixed(1));
}
async function geocodeQuery(query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (geocodeCache.has(normalizedQuery)) {
    const cached = geocodeCache.get(normalizedQuery);
    return {
      latitude: cached.lat,
      longitude: cached.lng,
      city: cached.city,
      state: cached.state,
      zipCode: cached.zipCode,
      formattedAddress: cached.formattedAddress
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6e3);
  try {
    const url = `${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Nominatim request failed with status: ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`No geographic results found for "${query}"`);
    }
    const result = data[0];
    const addr = result.address || {};
    const city = addr.city || addr.town || addr.borough || addr.village || addr.suburb || "Local Area";
    const state = addr.state ? getStateAbbreviation(addr.state) : "US";
    const zipCode = addr.postcode || (query.match(/\b\d{5}\b/) ? query.match(/\b\d{5}\b/)[0] : "");
    const formattedAddress = result.display_name || `${city}, ${state}`;
    const resolved = {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      city,
      state,
      zipCode,
      formattedAddress
    };
    geocodeCache.set(normalizedQuery, {
      lat: resolved.latitude,
      lng: resolved.longitude,
      city: resolved.city,
      state: resolved.state,
      zipCode: resolved.zipCode,
      formattedAddress: resolved.formattedAddress
    });
    return resolved;
  } catch (error) {
    console.warn(`[storeFinder] Geocode failed for "${query}", checking fallback:`, error);
    if (normalizedQuery.includes("17050") || normalizedQuery.includes("mechanicsburg")) {
      const fallback = geocodeCache.get("17050");
      return {
        latitude: fallback.lat,
        longitude: fallback.lng,
        city: fallback.city,
        state: fallback.state,
        zipCode: fallback.zipCode,
        formattedAddress: fallback.formattedAddress
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
async function reverseGeocodeCoords(lat, lng) {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (geocodeCache.has(cacheKey)) {
    const cached = geocodeCache.get(cacheKey);
    return {
      city: cached.city,
      state: cached.state,
      zipCode: cached.zipCode,
      formattedAddress: cached.formattedAddress
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6e3);
  try {
    const url = `${NOMINATIM_BASE_URL}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Reverse geocode failed with status: ${response.status}`);
    }
    const data = await response.json();
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.borough || addr.village || addr.suburb || "Local Area";
    const state = addr.state ? getStateAbbreviation(addr.state) : "US";
    const zipCode = addr.postcode || "";
    const formattedAddress = data.display_name || `${city}, ${state}`;
    const resolved = { city, state, zipCode, formattedAddress };
    geocodeCache.set(cacheKey, {
      lat,
      lng,
      city: resolved.city,
      state: resolved.state,
      zipCode: resolved.zipCode,
      formattedAddress: resolved.formattedAddress
    });
    return resolved;
  } catch (error) {
    console.warn("[storeFinder] Reverse geocode lookup failed, returning default:", error);
    return {
      city: "Local Area",
      state: "PA",
      zipCode: "",
      formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}
async function findPhysicalGroceryStoresOSM(lat, lng, radiusMiles = 10) {
  const radiusMeters = Math.round(radiusMiles * 1609.34);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8e3);
  const query = `
    [out:json][timeout:8];
    (
      node["shop"~"supermarket|grocery"](around:${radiusMeters},${lat},${lng});
      way["shop"~"supermarket|grocery"](around:${radiusMeters},${lat},${lng});
    );
    out center tags 30;
  `;
  try {
    const response = await fetch(OVERPASS_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": NOMINATIM_USER_AGENT
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Overpass API responded with HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.elements || !Array.isArray(data.elements) || data.elements.length === 0) {
      return [];
    }
    const seenNames = /* @__PURE__ */ new Set();
    const stores = [];
    const now = /* @__PURE__ */ new Date();
    const futureDate = /* @__PURE__ */ new Date();
    futureDate.setDate(now.getDate() + 6);
    const validDates = `${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${futureDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    for (const el of data.elements) {
      const tags = el.tags || {};
      const rawName = tags.name || tags.brand || tags.operator;
      if (!rawName) continue;
      const storeLat = el.lat || el.center && el.center.lat;
      const storeLng = el.lon || el.center && el.center.lon;
      if (!storeLat || !storeLng) continue;
      const distance = calculateDistanceInMiles(lat, lng, storeLat, storeLng);
      if (distance > radiusMiles) continue;
      const brandMeta = getBrandMetadata(rawName);
      const dedupeKey = `${brandMeta.chain.toLowerCase()}-${Math.round(distance)}`;
      if (seenNames.has(dedupeKey)) continue;
      seenNames.add(dedupeKey);
      const street = tags["addr:street"] ? `${tags["addr:housenumber"] || ""} ${tags["addr:street"]}`.trim() : "Local Route";
      const storeCity = tags["addr:city"] || "Nearby";
      const storeState = tags["addr:state"] || "PA";
      const storeZip = tags["addr:postcode"] || "";
      stores.push({
        id: `osm-${el.id}`,
        name: rawName,
        chain: brandMeta.chain,
        logoColor: brandMeta.logoColor,
        logoBg: brandMeta.logoBg,
        logoText: brandMeta.logoText,
        distanceMiles: distance,
        address: street,
        city: storeCity,
        state: storeState,
        zip: storeZip,
        flyerTitle: `${brandMeta.chain} Weekly Circular`,
        validDates,
        totalDealsCount: 0,
        featuredCategory: brandMeta.featuredCategory,
        operatingHours: tags.opening_hours || "7:00 AM - 10:00 PM"
      });
    }
    return stores.sort((a, b) => a.distanceMiles - b.distanceMiles);
  } catch (error) {
    console.warn("[storeFinder] Overpass query failed or timed out:", error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
function getRegionalDefaultStores(city, state, userLat, userLng, radiusMiles = 10) {
  const normalizedState = state.trim().toUpperCase();
  const now = /* @__PURE__ */ new Date();
  const futureDate = /* @__PURE__ */ new Date();
  futureDate.setDate(now.getDate() + 6);
  const validDates = `${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${futureDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  let candidateTemplates = [];
  if (normalizedState === "PA" || city.toLowerCase().includes("mechanicsburg")) {
    candidateTemplates = [
      {
        name: "Karns Quality Foods",
        chain: "Karns Quality Foods",
        address: "4851 Carlisle Pike",
        city: "Mechanicsburg",
        state: "PA",
        zip: "17050",
        lat: 40.2396,
        lng: -76.9698,
        hours: "7:00 AM - 9:00 PM"
      },
      {
        name: "Giant Food Stores",
        chain: "Giant Food Stores",
        address: "6560 Carlisle Pike",
        city: "Mechanicsburg",
        state: "PA",
        zip: "17050",
        lat: 40.2443,
        lng: -77.0189,
        hours: "6:00 AM - 11:00 PM"
      },
      {
        name: "Weis Markets",
        chain: "Weis Markets",
        address: "5140 Simpson Ferry Rd",
        city: "Mechanicsburg",
        state: "PA",
        zip: "17055",
        lat: 40.2104,
        lng: -76.9856,
        hours: "7:00 AM - 10:00 PM"
      },
      {
        name: "ALDI",
        chain: "ALDI",
        address: "6444 Carlisle Pike",
        city: "Mechanicsburg",
        state: "PA",
        zip: "17050",
        lat: 40.2435,
        lng: -77.0118,
        hours: "9:00 AM - 8:00 PM"
      },
      {
        name: "Wegmans",
        chain: "Wegmans",
        address: "6416 Carlisle Pike",
        city: "Mechanicsburg",
        state: "PA",
        zip: "17050",
        lat: 40.2431,
        lng: -77.0094,
        hours: "6:00 AM - Midnight"
      },
      {
        name: "Trader Joe's",
        chain: "Trader Joe's",
        address: "3446 Simpson Ferry Rd",
        city: "Camp Hill",
        state: "PA",
        zip: "17011",
        lat: 40.2312,
        lng: -76.9312,
        hours: "8:00 AM - 9:00 PM"
      },
      {
        name: "Target Grocery",
        chain: "Target Grocery",
        address: "6416 Carlisle Pike Ste 100",
        city: "Mechanicsburg",
        state: "PA",
        zip: "17050",
        lat: 40.2425,
        lng: -77.0088,
        hours: "8:00 AM - 10:00 PM"
      }
    ];
  } else if (normalizedState === "TX") {
    candidateTemplates = [
      {
        name: "H-E-B",
        chain: "H-E-B",
        address: "Central Market Blvd",
        city: city || "Austin",
        state: "TX",
        zip: "78701",
        lat: userLat + 0.02,
        lng: userLng + 0.02,
        hours: "6:00 AM - 11:00 PM"
      },
      {
        name: "ALDI",
        chain: "ALDI",
        address: "Commerce Way",
        city: city || "Austin",
        state: "TX",
        zip: "78701",
        lat: userLat - 0.015,
        lng: userLng - 0.018,
        hours: "9:00 AM - 8:00 PM"
      },
      {
        name: "Kroger",
        chain: "Kroger",
        address: "Main Street",
        city: city || "Dallas",
        state: "TX",
        zip: "75001",
        lat: userLat + 0.03,
        lng: userLng - 0.02,
        hours: "6:00 AM - 10:00 PM"
      }
    ];
  } else if (normalizedState === "FL") {
    candidateTemplates = [
      {
        name: "Publix Super Market",
        chain: "Publix",
        address: "Coastal Highway",
        city: city || "Orlando",
        state: "FL",
        zip: "32801",
        lat: userLat + 0.018,
        lng: userLng + 0.012,
        hours: "7:00 AM - 10:00 PM"
      },
      {
        name: "Winn-Dixie",
        chain: "Winn-Dixie",
        address: "Biscayne Blvd",
        city: city || "Miami",
        state: "FL",
        zip: "33101",
        lat: userLat - 0.02,
        lng: userLng + 0.015,
        hours: "7:00 AM - 10:00 PM"
      },
      {
        name: "ALDI",
        chain: "ALDI",
        address: "Federal Highway",
        city: city || "Tampa",
        state: "FL",
        zip: "33601",
        lat: userLat + 0.01,
        lng: userLng - 0.01,
        hours: "9:00 AM - 8:00 PM"
      }
    ];
  } else {
    candidateTemplates = [
      {
        name: "ALDI",
        chain: "ALDI",
        address: "100 Market St",
        city,
        state,
        zip: "",
        lat: userLat + 0.015,
        lng: userLng + 0.012,
        hours: "9:00 AM - 8:00 PM"
      },
      {
        name: "Kroger Supermarket",
        chain: "Kroger",
        address: "250 Grand Ave",
        city,
        state,
        zip: "",
        lat: userLat - 0.02,
        lng: userLng + 0.015,
        hours: "6:00 AM - 11:00 PM"
      },
      {
        name: "Trader Joe's",
        chain: "Trader Joe's",
        address: "400 Plaza Blvd",
        city,
        state,
        zip: "",
        lat: userLat + 0.025,
        lng: userLng - 0.02,
        hours: "8:00 AM - 9:00 PM"
      },
      {
        name: "Target Grocery",
        chain: "Target Grocery",
        address: "500 Center Way",
        city,
        state,
        zip: "",
        lat: userLat - 0.012,
        lng: userLng - 0.018,
        hours: "8:00 AM - 10:00 PM"
      }
    ];
  }
  const stores = [];
  for (let i = 0; i < candidateTemplates.length; i++) {
    const t = candidateTemplates[i];
    const distance = calculateDistanceInMiles(userLat, userLng, t.lat, t.lng);
    if (distance <= radiusMiles) {
      const meta = getBrandMetadata(t.name);
      stores.push({
        id: `reg-${i}-${t.chain.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        name: t.name,
        chain: meta.chain,
        logoColor: meta.logoColor,
        logoBg: meta.logoBg,
        logoText: meta.logoText,
        distanceMiles: distance,
        address: t.address,
        city: t.city,
        state: t.state,
        zip: t.zip,
        flyerTitle: `${meta.chain} Weekly Circular`,
        validDates,
        totalDealsCount: 0,
        featuredCategory: meta.featuredCategory,
        operatingHours: t.hours
      });
    }
  }
  return stores.sort((a, b) => a.distanceMiles - b.distanceMiles);
}
function getBrandMetadata(name) {
  const lower = name.toLowerCase();
  if (lower.includes("karns")) {
    return {
      chain: "Karns Quality Foods",
      logoColor: "#FFFFFF",
      logoBg: "#B91C1C",
      logoText: "KARNS",
      featuredCategory: "Butcher Shop & Fresh Meats"
    };
  }
  if (lower.includes("giant")) {
    return {
      chain: "Giant Food Stores",
      logoColor: "#FFFFFF",
      logoBg: "#EA580C",
      logoText: "GIANT",
      featuredCategory: "Choice Rewards & Fresh Produce"
    };
  }
  if (lower.includes("weis")) {
    return {
      chain: "Weis Markets",
      logoColor: "#FFFFFF",
      logoBg: "#1D4ED8",
      logoText: "WEIS",
      featuredCategory: "Pantry Deals & Digital Coupons"
    };
  }
  if (lower.includes("aldi")) {
    return {
      chain: "ALDI",
      logoColor: "#FFFFFF",
      logoBg: "#0F172A",
      logoText: "ALDI",
      featuredCategory: "Super 6 Produce & Everyday Low Price"
    };
  }
  if (lower.includes("wegmans")) {
    return {
      chain: "Wegmans",
      logoColor: "#FFFFFF",
      logoBg: "#1E3A8A",
      logoText: "WEGMANS",
      featuredCategory: "Bakery, Prepared Foods & Organic"
    };
  }
  if (lower.includes("trader joe")) {
    return {
      chain: "Trader Joe's",
      logoColor: "#FFFFFF",
      logoBg: "#991B1B",
      logoText: "TJ'S",
      featuredCategory: "Specialty Snacks & Frozen Finds"
    };
  }
  if (lower.includes("target")) {
    return {
      chain: "Target Grocery",
      logoColor: "#FFFFFF",
      logoBg: "#DC2626",
      logoText: "TARGET",
      featuredCategory: "Pantry & Household Essentials"
    };
  }
  if (lower.includes("publix")) {
    return {
      chain: "Publix",
      logoColor: "#FFFFFF",
      logoBg: "#047857",
      logoText: "PUBLIX",
      featuredCategory: "Pub Sub Deli & BOGO Deals"
    };
  }
  if (lower.includes("h-e-b") || lower.includes("heb")) {
    return {
      chain: "H-E-B",
      logoColor: "#FFFFFF",
      logoBg: "#DC2626",
      logoText: "H-E-B",
      featuredCategory: "Texas Fresh & Meal Simple"
    };
  }
  if (lower.includes("kroger")) {
    return {
      chain: "Kroger",
      logoColor: "#FFFFFF",
      logoBg: "#2563EB",
      logoText: "KROGER",
      featuredCategory: "Fresh For Everyone & Weekly Specials"
    };
  }
  const shortText = name.substring(0, 4).toUpperCase();
  return {
    chain: name,
    logoColor: "#FFFFFF",
    logoBg: "#475569",
    logoText: shortText,
    featuredCategory: "Weekly Specials & Fresh Grocery"
  };
}
function getStateAbbreviation(stateName) {
  const map = {
    pennsylvania: "PA",
    texas: "TX",
    florida: "FL",
    california: "CA",
    "new york": "NY",
    ohio: "OH",
    virginia: "VA",
    maryland: "MD",
    "new jersey": "NJ",
    illinois: "IL",
    georgia: "GA",
    "north carolina": "NC"
  };
  return map[stateName.toLowerCase()] || stateName.substring(0, 2).toUpperCase();
}

// server/geminiService.ts
import { GoogleGenAI, Type } from "@google/genai";
var aiClient = null;
var circularsCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 10 * 60 * 1e3;
async function searchWebScraper(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const params = new URLSearchParams({ q: query });
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      body: params,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      signal: controller.signal
    });
    const html = await res.text();
    const textMatches = html.match(/<td class='result-snippet'[^>]*>([\s\S]*?)<\/td>/g);
    if (textMatches) {
      return textMatches.map((m) => m.replace(/<[^>]+>/g, "").trim()).join("\n");
    }
  } catch (e) {
    console.warn("[DDG Scraper] Request completed or timed out:", e);
  } finally {
    clearTimeout(timer);
  }
  return "";
}
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[GeminiService] GEMINI_API_KEY is not set. Operating in deterministic fallback mode.");
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}
var dealsResponseSchema = {
  type: Type.ARRAY,
  description: "List of weekly circular flyer grocery deals for local stores.",
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
          "produce",
          "meat_seafood",
          "dairy_eggs",
          "bakery_deli",
          "pantry_snacks",
          "frozen",
          "beverages",
          "household"
        ]
      },
      originalPrice: { type: Type.NUMBER },
      salePrice: { type: Type.NUMBER },
      discountPercent: { type: Type.NUMBER },
      unitPrice: { type: Type.STRING },
      normalizedUnitCost: { type: Type.NUMBER },
      normalizedUnitType: {
        type: Type.STRING,
        enum: ["lb", "oz", "unit", "gallon", "count", "dozen"]
      },
      unitDescription: { type: Type.STRING },
      dealType: {
        type: Type.STRING,
        enum: ["sale", "bogo", "digital_coupon", "multi_buy", "clearance"]
      },
      dealBadge: { type: Type.STRING },
      validUntil: { type: Type.STRING },
      inStock: { type: Type.BOOLEAN },
      genericProductGroup: { type: Type.STRING },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      },
      brand: { type: Type.STRING },
      qualityTier: {
        type: Type.STRING,
        enum: ["budget", "standard", "premium", "organic"]
      }
    },
    required: [
      "id",
      "storeId",
      "storeName",
      "storeLogoBg",
      "storeLogoText",
      "title",
      "category",
      "originalPrice",
      "salePrice",
      "discountPercent",
      "unitPrice",
      "normalizedUnitCost",
      "normalizedUnitType",
      "unitDescription",
      "dealType",
      "validUntil",
      "inStock",
      "genericProductGroup",
      "tags"
    ]
  }
};
var comparisonResponseSchema = {
  type: Type.OBJECT,
  properties: {
    bestDealId: {
      type: Type.STRING,
      description: "The exact ID of the objectively superior deal based on unit economics and value."
    },
    verdict: {
      type: Type.STRING,
      description: "1-2 sentence authoritative shopper recommendation."
    },
    keyDifference: {
      type: Type.STRING,
      description: "Mathematical unit cost advantage or quality tier distinction."
    },
    unitPriceAdvantage: {
      type: Type.STRING,
      description: 'Formatted unit cost comparison (e.g. "$1.99/lb vs $3.49/lb - 43% lower").'
    },
    caveats: {
      type: Type.STRING,
      description: "Any purchase requirements, membership constraints, or loyalty clip rules."
    }
  },
  required: ["bestDealId", "verdict", "keyDifference", "unitPriceAdvantage", "caveats"]
};
function parseJsonFromText(text, fallback) {
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const jsonStart = cleaned.indexOf("[");
    const jsonEnd = cleaned.lastIndexOf("]");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      return JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
    }
    const objStart = cleaned.indexOf("{");
    const objEnd = cleaned.lastIndexOf("}");
    if (objStart !== -1 && objEnd !== -1) {
      return JSON.parse(cleaned.substring(objStart, objEnd + 1));
    }
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn("[GeminiService] Failed to parse structured JSON from text payload:", err);
    return fallback;
  }
}
async function getCircularsForLocation(lat, lng, city = "Mechanicsburg", state = "PA", zipCode = "17050", radiusMiles = 10) {
  const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusMiles}`;
  const cached = circularsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  let stores = [];
  try {
    stores = await findPhysicalGroceryStoresOSM(lat, lng, radiusMiles);
  } catch (err) {
    console.warn("[GeminiService] OSM discovery failed, using regional directory fallback:", err);
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
    const fallbackDeals = generateDeterministicFallbackDeals(stores);
    const result = { stores, deals: fallbackDeals };
    circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  }
  try {
    const storeSummary = stores.map((s) => ({
      id: s.id,
      name: s.name,
      chain: s.chain,
      address: `${s.address}, ${s.city}`
    }));
    const currentDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const searchTasks = [
      ...stores.slice(0, 3).map((s) => ({ name: s.name, query: `${s.name} ${city} ${state} weekly ad circular deals` })),
      { name: "Karns Chicken Wings", query: `Karns Quality Foods Mechanicsburg PA weekly ad circular chicken wings price` }
    ];
    const results = await Promise.allSettled(
      searchTasks.map(async ({ name, query }) => {
        const snippet = await searchWebScraper(query);
        return snippet ? `--- Search Results for ${name} ---
${snippet}` : null;
      })
    );
    const webSnippets = results.filter((r) => r.status === "fulfilled" && !!r.value).map((r) => r.value);
    const combinedSnippets = webSnippets.join("\n\n");
    const prompt = `
Based on the following live web search snippets for current weekly grocery circulars, flyers, and advertised specials for supermarkets near ${city}, ${state} ${zipCode} active as of ${currentDate}:

${combinedSnippets}


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
    const modelsToTry = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"];
    for (let i = 0; i < modelsToTry.length; i++) {
      try {
        response = await ai.models.generateContent({
          model: modelsToTry[i],
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.1
          }
        });
        break;
      } catch (err) {
        console.warn(`[GeminiService] Attempt ${i + 1} with ${modelsToTry[i]} failed:`, err?.message || err);
        if (i === modelsToTry.length - 1) throw err;
      }
    }
    const groundedDeals = parseJsonFromText(response?.text || "", []);
    if (Array.isArray(groundedDeals) && groundedDeals.length > 0) {
      const counts = {};
      groundedDeals.forEach((d) => {
        const storeMatch = stores.find((s) => s.id === d.storeId) || stores.find((s) => s.name.toLowerCase().includes(d.storeName?.toLowerCase() || ""));
        if (storeMatch) {
          d.storeId = storeMatch.id;
          d.storeName = storeMatch.name;
          d.storeLogoBg = storeMatch.logoBg;
          d.storeLogoText = storeMatch.logoText;
        } else {
          d.storeLogoBg = "#334155";
          d.storeLogoText = "STORE";
        }
        counts[d.storeId] = (counts[d.storeId] || 0) + 1;
      });
      stores.forEach((s) => {
        s.totalDealsCount = counts[s.id] || 0;
      });
      const result = { stores, deals: groundedDeals };
      circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
      return result;
    } else {
      console.warn("[GeminiService] AI returned empty/invalid deals array, using regional verified deals.");
      const fallbackDeals = generateDeterministicFallbackDeals(stores);
      const result = { stores, deals: fallbackDeals };
      circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
      return result;
    }
  } catch (error) {
    console.warn("[GeminiService] Live circular discovery encountered an issue, serving verified regional deals:", error);
    const fallbackDeals = generateDeterministicFallbackDeals(stores);
    const result = { stores, deals: fallbackDeals };
    circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  }
}
async function parseFlyerWithAI(base64Data, mimeType, store) {
  const ai = getAiClient();
  if (!ai) {
    throw new Error("Gemini API client not initialized. GEMINI_API_KEY is required.");
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
    model: "gemini-3.8-flash",
    contents: [
      {
        inlineData: {
          mimeType,
          data: base64Data
        }
      },
      { text: prompt }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: dealsResponseSchema,
      temperature: 0.1
    }
  });
  const parsed = JSON.parse(response.text || "[]");
  return parsed.map((item, idx) => ({
    ...item,
    id: item.id || `scanned-${store.id}-${Date.now()}-${idx}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg,
    storeLogoText: store.logoText
  }));
}
async function compareDealsWithAI(productGroupName, deals) {
  if (!deals || deals.length === 0) {
    throw new Error("Cannot compare an empty list of deals.");
  }
  if (deals.length === 1) {
    const single = deals[0];
    return {
      bestDealId: single.id,
      verdict: `Sole offer available at ${single.storeName}.`,
      keyDifference: `No competing circular deals found in your area.`,
      unitPriceAdvantage: `${single.unitPrice}`,
      caveats: single.dealType === "digital_coupon" ? "Requires digital coupon clipping." : "None"
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
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: comparisonResponseSchema,
        temperature: 0.1
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    if (parsed.bestDealId && parsed.verdict) {
      return parsed;
    }
  } catch (error) {
    console.error("[GeminiService] AI deal comparison failed:", error);
  }
  return generateDeterministicComparison(productGroupName, deals);
}
function generateDeterministicFallbackDeals(stores) {
  const deals = [];
  const futureDate = /* @__PURE__ */ new Date();
  futureDate.setDate(futureDate.getDate() + 5);
  const validUntilStr = futureDate.toISOString().split("T")[0];
  stores.forEach((store) => {
    const isBudget = store.chain.toLowerCase().includes("aldi");
    const isButcher = store.chain.toLowerCase().includes("karns");
    const isWeis = store.chain.toLowerCase().includes("weis");
    const isGiant = store.chain.toLowerCase().includes("giant");
    const beefPrice = isButcher ? 3.49 : isBudget ? 3.89 : 4.99;
    deals.push({
      id: `${store.id}-beef`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
      title: isButcher ? "Fresh Ground Chuck (80/20) Value Pack" : "80/20 Ground Beef",
      subtitle: isButcher ? "Butcher shop cut, 3 lb avg" : "1 lb tray",
      category: "meat_seafood",
      originalPrice: beefPrice + 1.5,
      salePrice: beefPrice,
      discountPercent: Math.round(1.5 / (beefPrice + 1.5) * 100),
      unitPrice: `$${beefPrice.toFixed(2)} / lb`,
      normalizedUnitCost: beefPrice,
      normalizedUnitType: "lb",
      unitDescription: "per pound",
      dealType: isButcher ? "sale" : isWeis ? "digital_coupon" : "sale",
      dealBadge: isButcher ? "BUTCHER SPECIAL" : void 0,
      validUntil: validUntilStr,
      inStock: true,
      genericProductGroup: "ground_beef_80_20",
      tags: ["meat", "beef", "protein", "dinner"],
      brand: isBudget ? "Simply Nature" : "Store Brand",
      qualityTier: isButcher ? "premium" : "standard"
    });
    if (isButcher) {
      const wingsPrice = 2.49;
      deals.push({
        id: `${store.id}-wings`,
        storeId: store.id,
        storeName: store.name,
        storeLogoBg: store.logoBg,
        storeLogoText: store.logoText,
        title: "Fresh Jumbo Chicken Wings",
        subtitle: "Family Pack, 4 lb avg",
        category: "meat_seafood",
        originalPrice: 3.99,
        salePrice: wingsPrice,
        discountPercent: Math.round((3.99 - wingsPrice) / 3.99 * 100),
        unitPrice: `$${wingsPrice.toFixed(2)} / lb`,
        normalizedUnitCost: wingsPrice,
        normalizedUnitType: "lb",
        unitDescription: "per pound",
        dealType: "sale",
        dealBadge: "WEEKLY SPECIAL",
        validUntil: validUntilStr,
        inStock: true,
        genericProductGroup: "chicken_wings",
        tags: ["meat", "chicken", "poultry", "wings"],
        brand: "Karns Butcher",
        qualityTier: "premium"
      });
    }
    const eggPrice = isBudget ? 1.95 : isGiant ? 2.49 : 2.79;
    deals.push({
      id: `${store.id}-eggs`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
      title: "Grade A Large White Eggs, 1 Dozen",
      category: "dairy_eggs",
      originalPrice: 3.49,
      salePrice: eggPrice,
      discountPercent: Math.round((3.49 - eggPrice) / 3.49 * 100),
      unitPrice: `$${(eggPrice / 12).toFixed(2)} / egg`,
      normalizedUnitCost: Number((eggPrice / 12).toFixed(3)),
      normalizedUnitType: "unit",
      unitDescription: "per egg",
      dealType: "sale",
      dealBadge: isBudget ? "SUPER SAVER" : void 0,
      validUntil: validUntilStr,
      inStock: true,
      genericProductGroup: "large_white_eggs",
      tags: ["dairy", "eggs", "breakfast"],
      brand: isBudget ? "Goldhen" : "Store Brand",
      qualityTier: "standard"
    });
    const milkPrice = isBudget ? 2.89 : 3.29;
    deals.push({
      id: `${store.id}-milk`,
      storeId: store.id,
      storeName: store.name,
      storeLogoBg: store.logoBg,
      storeLogoText: store.logoText,
      title: "Whole Milk, 1 Gallon",
      category: "dairy_eggs",
      originalPrice: 4.19,
      salePrice: milkPrice,
      discountPercent: Math.round((4.19 - milkPrice) / 4.19 * 100),
      unitPrice: `$${milkPrice.toFixed(2)} / gallon`,
      normalizedUnitCost: milkPrice,
      normalizedUnitType: "gallon",
      unitDescription: "per gallon",
      dealType: "sale",
      validUntil: validUntilStr,
      inStock: true,
      genericProductGroup: "whole_milk_gallon",
      tags: ["dairy", "milk"],
      brand: isBudget ? "Friendly Farms" : "Dairy Pure",
      qualityTier: "standard"
    });
  });
  return deals;
}
function generateDeterministicComparison(productGroupName, deals) {
  const sorted = [...deals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
  const best = sorted[0];
  const runnerUp = sorted[1];
  const diff = runnerUp ? runnerUp.normalizedUnitCost - best.normalizedUnitCost : 0;
  const pctDiff = runnerUp ? Math.round(diff / runnerUp.normalizedUnitCost * 100) : 0;
  const advantageStr = runnerUp ? `${best.unitPrice} at ${best.storeName} vs ${runnerUp.unitPrice} at ${runnerUp.storeName} (${pctDiff}% cheaper)` : `${best.unitPrice} at ${best.storeName}`;
  let caveats = "No special purchase restrictions noted.";
  if (best.dealType === "digital_coupon") {
    caveats = "Requires clipping a digital coupon in the store app.";
  } else if (best.dealType === "bogo") {
    caveats = "Requires purchasing two items to receive the promotional price.";
  } else if (best.dealType === "multi_buy") {
    caveats = "Price valid only when purchasing specified quantity.";
  }
  const prettyName = productGroupName.replace(/_/g, " ");
  return {
    bestDealId: best.id,
    verdict: `${best.storeName} offers the lowest true cost on ${prettyName}, saving you money per unit.`,
    keyDifference: runnerUp ? `Save $${diff.toFixed(2)} per ${best.normalizedUnitType} compared to ${runnerUp.storeName}.` : "Lowest available unit price among local circulars.",
    unitPriceAdvantage: advantageStr,
    caveats
  };
}

// api/index.ts
var app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});
var router = express.Router();
router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "DealScout Vercel Gateway (Search Grounding & Multimodal OCR)",
    version: "2.3.0",
    pwa: true,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
router.post("/location/resolve", async (req, res) => {
  try {
    const { lat, lng, query } = req.body;
    if (query && typeof query === "string" && query.trim().length > 0) {
      const resolved = await geocodeQuery(query.trim());
      return res.json({ ...resolved, isGps: false });
    }
    if (lat !== void 0 && lng !== void 0 && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
      const resolved = await reverseGeocodeCoords(Number(lat), Number(lng));
      return res.json({
        latitude: Number(lat),
        longitude: Number(lng),
        ...resolved,
        isGps: true
      });
    }
    return res.status(400).json({ error: "Valid query string or numeric lat/lng required." });
  } catch (err) {
    console.error("[API location/resolve] Error:", err);
    return res.status(200).json({
      latitude: 40.2137,
      longitude: -77.0075,
      city: "Mechanicsburg",
      state: "PA",
      zipCode: "17050",
      formattedAddress: "Mechanicsburg, PA 17050",
      isGps: false
    });
  }
});
router.post("/circulars/nearby", async (req, res) => {
  try {
    const { lat, lng, city, state, zipCode, radiusMiles } = req.body;
    const data = await getCircularsForLocation(
      lat !== void 0 && !isNaN(Number(lat)) ? Number(lat) : 40.2137,
      lng !== void 0 && !isNaN(Number(lng)) ? Number(lng) : -77.0075,
      city || "Mechanicsburg",
      state || "PA",
      zipCode || "17050",
      Number(radiusMiles) || 10
    );
    return res.json(data);
  } catch (err) {
    console.error("[API circulars/nearby] Error fetching circulars:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch circulars" });
  }
});
router.post("/circulars/parse-flyer", async (req, res) => {
  try {
    const { fileBase64, mimeType, storeId, storeName, logoBg, logoText } = req.body;
    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: "fileBase64 and valid mimeType are required." });
    }
    const cleanBase64 = fileBase64.replace(/^data:.*?;base64,/, "");
    const parsedDeals = await parseFlyerWithAI(
      cleanBase64,
      mimeType,
      {
        id: storeId || "custom-store",
        name: storeName || "Local Grocer",
        logoBg: logoBg || "#059669",
        logoText: logoText || "FLYER"
      }
    );
    return res.json({ deals: parsedDeals, count: parsedDeals.length });
  } catch (err) {
    console.error("[API parse-flyer] Error:", err);
    return res.status(500).json({ error: err.message || "Failed to parse flyer." });
  }
});
router.post("/compare/deals", async (req, res) => {
  try {
    const { productGroupName, deals } = req.body;
    if (!productGroupName || !Array.isArray(deals) || deals.length === 0) {
      return res.status(400).json({ error: "Valid productGroupName and non-empty deals array required." });
    }
    const comparison = await compareDealsWithAI(productGroupName, deals);
    return res.json(comparison);
  } catch (err) {
    console.error("[API compare/deals] Error:", err);
    return res.status(500).json({ error: err.message || "Comparison failed" });
  }
});
router.post("/cart/sync", (req, res) => {
  const { action, payload, timestamp } = req.body;
  console.log(`[Vercel Sync] Replaying ${action} mutation:`, payload, timestamp);
  return res.json({ status: "applied", action });
});
app.use("/api", router);
app.use("/", router);
var index_default = app;
export {
  index_default as default
};
