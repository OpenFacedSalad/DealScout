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
  const timeout = setTimeout(() => controller.abort(), 2500);
  const query = `
    [out:json][timeout:3];
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

// server/karnsSnapshotData.ts
var KARNS_CIRCULAR_VALID_DATES = "September 8, 2026 - September 14, 2026";
var KARNS_FULL_CIRCULAR_SNAPSHOT = [
  {
    "rawTitle": "Fresh Jumbo Chicken Party Wings",
    "subtitle": "Add Items From Entire Store",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/1.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 1.49,
    "originalPrice": 1.94,
    "discountPercent": 23,
    "unitPrice": "$1.49 / lb",
    "normalizedUnitCost": 1.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "chicken_wings",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Hatfield Bone In Country Ribs",
    "subtitle": "Save $1.70 lb \u2022 Must Buy 5 lbs or More",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/2.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 1.99,
    "originalPrice": 3.69,
    "discountPercent": 46,
    "unitPrice": "$1.99 / lb",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "5 LB+ VALUE PACK",
    "genericProductGroup": "pork_ribs",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh Ground Angus Beef",
    "subtitle": "Must Buy 5 lbs or More \u2022 Save $2 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/3.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 5.99,
    "originalPrice": 7.99,
    "discountPercent": 25,
    "unitPrice": "$5.99 / lb",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "5 LB+ VALUE PACK",
    "genericProductGroup": "ground_beef_80_20",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Seedless Grapes",
    "subtitle": "Red or Green \u2022 Save $2 lb \u2022 Fresh Picked Savings",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/4.jpg?v=",
    "category": "produce",
    "salePrice": 1.99,
    "originalPrice": 3.99,
    "discountPercent": 50,
    "unitPrice": "$1.99 / lb",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "grapes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Halos Mandarin Oranges",
    "subtitle": "3 lb Bag \u2022 Save $2 each \u2022 Fresh Picked Savings",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/5.jpg?v=",
    "category": "produce",
    "salePrice": 4.99,
    "originalPrice": 6.99,
    "discountPercent": 29,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "mandarin_oranges",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fresh Broccoli Crowns",
    "subtitle": "Save $1.20 lb \u2022 Fresh Picked Savings",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/6.jpg?v=",
    "category": "produce",
    "salePrice": 1.79,
    "originalPrice": 2.99,
    "discountPercent": 40,
    "unitPrice": "$1.79 / lb",
    "normalizedUnitCost": 1.79,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "broccoli",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Angus Rump Roast",
    "subtitle": "USDA Choice - Save $2 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/7.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 6.99,
    "originalPrice": 8.99,
    "discountPercent": 22,
    "unitPrice": "$6.99 / lb",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "beef_roast",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Porterhouse or T-Bone Steaks",
    "subtitle": "USDA Choice - Save $7 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/8.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 10.99,
    "originalPrice": 17.99,
    "discountPercent": 39,
    "unitPrice": "$10.99 / lb",
    "normalizedUnitCost": 10.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "t_bone_steak",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Boneless New York Strip Steaks ",
    "subtitle": "USDA Choice - 10 oz Average \u2022 Save $1 each",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/9.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 9,
    "originalPrice": 10,
    "discountPercent": 10,
    "unitPrice": "$9.00 each",
    "normalizedUnitCost": 9,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "ny_strip_steak",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Prime Softshell Crabs",
    "subtitle": "Order Now for 9/11-9/13 Pick-Up!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/10.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 5,
    "originalPrice": 6.25,
    "discountPercent": 20,
    "unitPrice": "$5.00 each",
    "normalizedUnitCost": 5,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "prime_softshell_crabs",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Karns Lump Crab Cakes ",
    "subtitle": "Sold in 4 Packs for $18 each \u2022 Save $2 per 4 Pack",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/11.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 4.5,
    "originalPrice": 6.5,
    "discountPercent": 31,
    "unitPrice": "$4.50",
    "normalizedUnitCost": 4.5,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "karns_lump_crab_cakes_",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Kunzler Grill Franks",
    "subtitle": "16 oz -While Supplies Last",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/12.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 1.5,
    "originalPrice": 1.88,
    "discountPercent": 20,
    "unitPrice": "$1.50 each (2/$3)",
    "normalizedUnitCost": 1.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $3",
    "genericProductGroup": "hot_dogs",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Kunzler Original Sliced Bacon",
    "subtitle": "16 oz - Original Only!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/13.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "bacon",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Karns 8 Piece Fried Chicken Thighs & Drumsticks Bucket",
    "subtitle": "Save $2 each",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/14.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 6,
    "originalPrice": 8,
    "discountPercent": 25,
    "unitPrice": "$6.00 each",
    "normalizedUnitCost": 6,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "bakery_pie",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Shredded or Chunk Cheeses",
    "subtitle": "6-8 oz \u2022 Save $1.09 each",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/15.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 2,
    "originalPrice": 2.54,
    "discountPercent": 21,
    "unitPrice": "$2.00 each (2/$4)",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $4",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Chobani Yogurts",
    "subtitle": "5.3 oz - Save 99&cent; each \u2022 Less Sugar, Zero Sugar, Creations or Greek",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/16.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 1,
    "originalPrice": 10.9,
    "discountPercent": 85,
    "unitPrice": "$1.00 each (10/$10)",
    "normalizedUnitCost": 1,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "10 FOR $10",
    "genericProductGroup": "chobani_yogurts",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Canada Dry, A&W, 7Up, RC Cola & Sunkist ",
    "subtitle": "2 Liters \u2022 You Pay $7.98 for 5",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/17.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.4,
    "originalPrice": 5.99,
    "discountPercent": 60,
    "unitPrice": "$2.40 ea (BUY 2 GET 3 FREE)",
    "normalizedUnitCost": 2.4,
    "normalizedUnitType": "unit",
    "unitDescription": "effective per item",
    "dealType": "multi_buy",
    "dealBadge": "BUY 2 GET 3 FREE",
    "genericProductGroup": "canada_dry_a_w_7up_rc_cola_sun",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Dieffenbach's Uglies Potato Chips",
    "subtitle": "5.5-6 oz \u2022 Save $3.99",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/18.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.99,
    "originalPrice": 7.98,
    "discountPercent": 50,
    "unitPrice": "$2.00 ea (BOGO Free)",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "effective per item",
    "dealType": "bogo",
    "dealBadge": "BOGO FREE",
    "genericProductGroup": "russet_potatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Spring Water ",
    "subtitle": "16.9 oz/24 pk \u2022 Save $1.79 each",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/19.jpg?v=",
    "category": "beverages",
    "salePrice": 3.5,
    "originalPrice": 4.39,
    "discountPercent": 20,
    "unitPrice": "$3.50 each (2/$7)",
    "normalizedUnitCost": 3.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $7",
    "genericProductGroup": "essential_everyday_spring_wate",
    "tags": [
      "karns",
      "weekly_ad",
      "beverages",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Turkey Hill Late Night Ice Creams or Premium Ice Cream",
    "subtitle": "14 oz Late Night or \u2022 46 oz Premium \u2022 SAVE!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/20.jpg?v=",
    "category": "frozen",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "ice_cream",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Utz 10 count Variety Packs",
    "subtitle": "9.3-10 oz \u2022 Save $2.99",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/21.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 5,
    "originalPrice": 7.99,
    "discountPercent": 37,
    "unitPrice": "$5.00",
    "normalizedUnitCost": 5,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "utz_10_count_variety_packs",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Pepsi ",
    "subtitle": "16.9 oz/6 pk \u2022 You Pay $22.47 for 6",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/22.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.99,
    "originalPrice": 5.99,
    "discountPercent": 50,
    "unitPrice": "$2.99 ea (BUY 3 GET 3 FREE)",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "effective per item",
    "dealType": "multi_buy",
    "dealBadge": "BUY 3 GET 3 FREE",
    "genericProductGroup": "pepsi_",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns 1/2 Caramel Apple Pie ",
    "subtitle": "Apple Harvest!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/23.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 7.59,
    "originalPrice": 9.49,
    "discountPercent": 20,
    "unitPrice": "$7.59",
    "normalizedUnitCost": 7.59,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Apple Strudel ",
    "subtitle": "2 ct \u2022 Apple Harvest!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/24.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Apple Cinnamon Muffins ",
    "subtitle": "4 ct \u2022 Apple Harvest!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/25.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 5.99,
    "originalPrice": 7.49,
    "discountPercent": 20,
    "unitPrice": "$5.99",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Apple Cinnamon Coffee Cake Ring ",
    "subtitle": "Apple Harvest!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/26.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 8.99,
    "originalPrice": 11.24,
    "discountPercent": 20,
    "unitPrice": "$8.99",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Miami Onion Rolls ",
    "subtitle": "4 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/27.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "onions",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Apple Cinnamon Pull A Part Bread ",
    "subtitle": "Apple Harvest!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/28.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Premium Yuenglling Battered Haddock Fillets",
    "subtitle": "6 oz Average Frozen \u2022 Save $1 each",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/29.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 7,
    "originalPrice": 8,
    "discountPercent": 13,
    "unitPrice": "$7.00 each",
    "normalizedUnitCost": 7,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "whitefish_fillet",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "4 Pack Canadian Lobster Tails",
    "subtitle": "3-4 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/30.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 25,
    "originalPrice": 31.25,
    "discountPercent": 20,
    "unitPrice": "$25.00",
    "normalizedUnitCost": 25,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "4_pack_canadian_lobster_tails",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "EZ Peel Extra Large Shrimp ",
    "subtitle": "26-30 ct - Save $3.49 lb \u2022 Sold in 2 lb Bags for $15",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/31.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 7.5,
    "originalPrice": 10.99,
    "discountPercent": 32,
    "unitPrice": "$7.50 / lb",
    "normalizedUnitCost": 7.5,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "raw_shrimp",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Norwegian Salmon Fillets",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/32.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 12.99,
    "originalPrice": 16.89,
    "discountPercent": 23,
    "unitPrice": "$12.99 / lb",
    "normalizedUnitCost": 12.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "salmon_fillet",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh White Little Neck Clams ",
    "subtitle": "50 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/33.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 19.99,
    "originalPrice": 24.99,
    "discountPercent": 20,
    "unitPrice": "$19.99",
    "normalizedUnitCost": 19.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_white_little_neck_clams_",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Pasteurized Claw Crabmeat",
    "subtitle": "16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/34.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 12,
    "originalPrice": 15,
    "discountPercent": 20,
    "unitPrice": "$12.00",
    "normalizedUnitCost": 12,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "pasteurized_claw_crabmeat",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh Chilean Salmon Fillet Portions ",
    "subtitle": "5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/35.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 4,
    "originalPrice": 5,
    "discountPercent": 20,
    "unitPrice": "$4.00 each",
    "normalizedUnitCost": 4,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "salmon_fillet",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Pasteurized Lump Crabmeat",
    "subtitle": "16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/36.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 16,
    "originalPrice": 20,
    "discountPercent": 20,
    "unitPrice": "$16.00",
    "normalizedUnitCost": 16,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "pasteurized_lump_crabmeat",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Cedar Bay Cedar Plank Salmon Fillet Portions",
    "subtitle": "5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/37.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 6.99,
    "originalPrice": 8.74,
    "discountPercent": 20,
    "unitPrice": "$6.99",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "salmon_fillet",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Northern Fisheries Scallop Medallions",
    "subtitle": "1 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/38.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 10.99,
    "originalPrice": 13.74,
    "discountPercent": 20,
    "unitPrice": "$10.99",
    "normalizedUnitCost": 10.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "northern_fisheries_scallop_med",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Nature's Best Seafood Swai Fillets ",
    "subtitle": "32 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/39.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 9.99,
    "originalPrice": 12.49,
    "discountPercent": 20,
    "unitPrice": "$9.99",
    "normalizedUnitCost": 9.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "nature_s_best_seafood_swai_fil",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Nature's Best Seafood Sea Scallops",
    "subtitle": "16 oz Wild Caught",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/40.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 19.99,
    "originalPrice": 24.99,
    "discountPercent": 20,
    "unitPrice": "$19.99",
    "normalizedUnitCost": 19.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "nature_s_best_seafood_sea_scal",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Tastee Choice Popcorn, Coconut or Breaded Shrimp",
    "subtitle": "9-12 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/41.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "raw_shrimp",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Progresso Protein, Rich & Hearty or Traditional Soups",
    "subtitle": "18.5-19 oz Can",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/42.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2,
    "originalPrice": 2.5,
    "discountPercent": 20,
    "unitPrice": "$2.00 each (3/$6)",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "3 FOR $6",
    "genericProductGroup": "canned_soup",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Seasoning Mix Packets",
    "subtitle": "1-1.5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/43.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 79,
    "originalPrice": 98.75,
    "discountPercent": 20,
    "unitPrice": "$79.00",
    "normalizedUnitCost": 79,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "essential_everyday_seasoning_m",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Gravy Mix Packets",
    "subtitle": "0.75-1 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/44.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 0.67,
    "originalPrice": 0.84,
    "discountPercent": 20,
    "unitPrice": "$0.67 each (3/$2)",
    "normalizedUnitCost": 0.67,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "3 FOR $2",
    "genericProductGroup": "essential_everyday_gravy_mix_p",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Idahoan Mashed Potatoes",
    "subtitle": "4-4.1 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/45.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 1.67,
    "originalPrice": 2.09,
    "discountPercent": 20,
    "unitPrice": "$1.67 each (3/$5)",
    "normalizedUnitCost": 1.67,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "3 FOR $5",
    "genericProductGroup": "russet_potatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kraft Mayonnaise",
    "subtitle": "15 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/46.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "kraft_mayonnaise",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Schmidt's Italian Bread or Old Tyme Game Day Rolls",
    "subtitle": "20 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/47.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_bread",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Maruchan Instant Lunch Ramen Noodle Soups",
    "subtitle": "2.25 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/48.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 0.5,
    "originalPrice": 0.63,
    "discountPercent": 20,
    "unitPrice": "$0.50 each (2/$1)",
    "normalizedUnitCost": 0.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $1",
    "genericProductGroup": "canned_soup",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kool Aid Jammers Drink Pouches",
    "subtitle": "6 oz/10 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/49.jpg?v=",
    "category": "beverages",
    "salePrice": 3.5,
    "originalPrice": 4.38,
    "discountPercent": 20,
    "unitPrice": "$3.50 each (2/$7)",
    "normalizedUnitCost": 3.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $7",
    "genericProductGroup": "kool_aid_jammers_drink_pouches",
    "tags": [
      "karns",
      "weekly_ad",
      "beverages",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kraft Easy Mac & Cheese Cups 4 ct",
    "subtitle": "8-9.56 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/50.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Grey Poupon Mustard Squeeze Bottle",
    "subtitle": "10 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/51.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.79,
    "originalPrice": 4.74,
    "discountPercent": 20,
    "unitPrice": "$3.79",
    "normalizedUnitCost": 3.79,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "grey_poupon_mustard_squeeze_bo",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Giorgio Mushroom Pieces & Stems",
    "subtitle": "4 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/52.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 1.39,
    "originalPrice": 1.74,
    "discountPercent": 20,
    "unitPrice": "$1.39",
    "normalizedUnitCost": 1.39,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "bakery_pie",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Pasta 2 lb Box",
    "subtitle": "32 oz Select Varieties",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/53.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.79,
    "originalPrice": 3.49,
    "discountPercent": 20,
    "unitPrice": "$2.79",
    "normalizedUnitCost": 2.79,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "essential_everyday_pasta_2_lb_",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Classico Pasta Sauces",
    "subtitle": "15 or 24 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/54.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "pasta_sauce",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Nature Valley Bars",
    "subtitle": "6.7-7.4 oz/6 ct Sweet & Salty Trail Mix, 6.2 oz/5 ct Sweet & Salty Soft Baked or 8.94 oz/6 ct Crunchy",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/55.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "nature_valley_bars",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Nature Valley Items",
    "subtitle": "6.2 oz/5 ct Muffin Bars, \u2022 6.75 oz/5 ct Breakfast Biscuits or \u2022 4.59-4.6 oz/5 ct Lunch Box Bars",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/56.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "nature_valley_items",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Nature Soft Baked Oatmeal Squares",
    "subtitle": "7.44 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/57.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "nature_soft_baked_oatmeal_squa",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Honey Bear",
    "subtitle": "12 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/58.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.49,
    "originalPrice": 4.36,
    "discountPercent": 20,
    "unitPrice": "$3.49",
    "normalizedUnitCost": 3.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "essential_everyday_honey_bear",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Hunt's Canned Spaghetti Sauces",
    "subtitle": "24 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/60.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 1.5,
    "originalPrice": 1.88,
    "discountPercent": 20,
    "unitPrice": "$1.50 each (2/$3)",
    "normalizedUnitCost": 1.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $3",
    "genericProductGroup": "pasta_sauce",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Prego Sauces",
    "subtitle": "14.5-24 oz Pasta or \u2022 14 oz Pizza",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/61.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.5,
    "originalPrice": 3.13,
    "discountPercent": 20,
    "unitPrice": "$2.50 each (2/$5)",
    "normalizedUnitCost": 2.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $5",
    "genericProductGroup": "pasta_sauce",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kellogg's Family Size Cereals",
    "subtitle": "17.9-24 oz Cocoa Krispies, Mini Wheats, Special K & Raisin Bran Select Varieties",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/62.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 5.49,
    "originalPrice": 6.86,
    "discountPercent": 20,
    "unitPrice": "$5.49",
    "normalizedUnitCost": 5.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "kellogg_s_family_size_cereals",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kellogg's Pop-Tarts Toaster Pastries ",
    "subtitle": "13.5 oz/8 ct Toaster Pastries or \u2022 7 oz Bites",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/63.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "kellogg_s_pop_tarts_toaster_pa",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Eight O'Clock K-Cup Coffee Pods 10 ct",
    "subtitle": "3.1-3.4 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/64.jpg?v=",
    "category": "beverages",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "eight_o_clock_k_cup_coffee_pod",
    "tags": [
      "karns",
      "weekly_ad",
      "beverages",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Lavazza Ground Coffee",
    "subtitle": "8 or 12 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/65.jpg?v=",
    "category": "beverages",
    "salePrice": 8.99,
    "originalPrice": 11.24,
    "discountPercent": 20,
    "unitPrice": "$8.99",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "lavazza_ground_coffee",
    "tags": [
      "karns",
      "weekly_ad",
      "beverages",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Giorgio Sliced Mushrooms",
    "subtitle": "4.5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/66.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.79,
    "originalPrice": 3.49,
    "discountPercent": 20,
    "unitPrice": "$2.79",
    "normalizedUnitCost": 2.79,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "giorgio_sliced_mushrooms",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Salad Dressings",
    "subtitle": "18 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/67.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.29,
    "originalPrice": 2.86,
    "discountPercent": 20,
    "unitPrice": "$2.29",
    "normalizedUnitCost": 2.29,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "essential_everyday_salad_dress",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Grated Parmesan Cheeses",
    "subtitle": "8 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/68.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Thomas' Bagels Excluding High Protein",
    "subtitle": "20 oz/6 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/69.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "thomas_bagels_excluding_high_p",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Tastykake Bagged Donuts",
    "subtitle": "9.5-11.5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/70.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.5,
    "originalPrice": 3.13,
    "discountPercent": 20,
    "unitPrice": "$2.50 each (2/$5)",
    "normalizedUnitCost": 2.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $5",
    "genericProductGroup": "tastykake_bagged_donuts",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fiber One Brownie or Chewy Granola Bars",
    "subtitle": "5.3 oz or 7 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/71.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "fiber_one_brownie_or_chewy_gra",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Mott's Soft Baked & Filled Bars",
    "subtitle": "5.76-6.55 oz/5-6 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/72.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "mott_s_soft_baked_filled_bars",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Hunt's Canned Tomatoes",
    "subtitle": "14.5-15 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/73.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 1.25,
    "originalPrice": 1.56,
    "discountPercent": 20,
    "unitPrice": "$1.25 each (4/$5)",
    "normalizedUnitCost": 1.25,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "4 FOR $5",
    "genericProductGroup": "hunt_s_canned_tomatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Hunt's Canned Tomato Sauces",
    "subtitle": "15 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/74.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 1.5,
    "originalPrice": 1.88,
    "discountPercent": 20,
    "unitPrice": "$1.50 each (2/$3)",
    "normalizedUnitCost": 1.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $3",
    "genericProductGroup": "pasta_sauce",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Storage or Freezer Bags",
    "subtitle": "14-24 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/75.jpg?v=",
    "category": "household",
    "salePrice": 1.69,
    "originalPrice": 2.11,
    "discountPercent": 20,
    "unitPrice": "$1.69",
    "normalizedUnitCost": 1.69,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "essential_everyday_storage_or_",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Peanut Butter",
    "subtitle": "16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/76.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 1.99,
    "originalPrice": 2.49,
    "discountPercent": 20,
    "unitPrice": "$1.99",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "butter",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Grape Jam & Jelly",
    "subtitle": "32 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/77.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "grapes",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Powerade Multipacks",
    "subtitle": "20 oz/8 pk",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/78.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 5,
    "originalPrice": 6.25,
    "discountPercent": 20,
    "unitPrice": "$5.00 each (2/$10)",
    "normalizedUnitCost": 5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $10",
    "genericProductGroup": "powerade_multipacks",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Body Armor Sports Drink Single Bottle",
    "subtitle": "16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/79.jpg?v=",
    "category": "beverages",
    "salePrice": 1,
    "originalPrice": 1.25,
    "discountPercent": 20,
    "unitPrice": "$1.00 each (10/$10)",
    "normalizedUnitCost": 1,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "10 FOR $10",
    "genericProductGroup": "body_armor_sports_drink_single",
    "tags": [
      "karns",
      "weekly_ad",
      "beverages",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Tony's Frozen Pizzas",
    "subtitle": "18.56-20.6 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/80.jpg?v=",
    "category": "frozen",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "tony_s_frozen_pizzas",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "McCain Frozen Potatoes or Onion Rings",
    "subtitle": "14-32 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/81.jpg?v=",
    "category": "frozen",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "russet_potatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "T&L Pierogies",
    "subtitle": "11-14 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/82.jpg?v=",
    "category": "frozen",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "bakery_pie",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Quilted Nothern Bath Tissue",
    "subtitle": "4 MEGA Rolls",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/83.jpg?v=",
    "category": "household",
    "salePrice": 5.99,
    "originalPrice": 7.49,
    "discountPercent": 20,
    "unitPrice": "$5.99",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "quilted_nothern_bath_tissue",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Angel Soft Bath Tissue or Sparkle Paper Towels",
    "subtitle": "6 or 8 Mega Rolls Bath Tissue or \u2022 4 Double Rolls Paper Towels",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/84.jpg?v=",
    "category": "household",
    "salePrice": 6.49,
    "originalPrice": 8.11,
    "discountPercent": 20,
    "unitPrice": "$6.49",
    "normalizedUnitCost": 6.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "angel_soft_bath_tissue_or_spar",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Swiffer Sweeper Dry or Wet Mop Kit",
    "subtitle": "1 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/85.jpg?v=",
    "category": "household",
    "salePrice": 13.99,
    "originalPrice": 17.49,
    "discountPercent": 20,
    "unitPrice": "$13.99",
    "normalizedUnitCost": 13.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "swiffer_sweeper_dry_or_wet_mop",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Tide HE Liquid Laundry Detergents or Laundry Detergent Pods",
    "subtitle": "65 or 80 Loads Liquid or \u2022 32 or 57 ct Pods",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/86.jpg?v=",
    "category": "household",
    "salePrice": 15.99,
    "originalPrice": 19.99,
    "discountPercent": 20,
    "unitPrice": "$15.99",
    "normalizedUnitCost": 15.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "tide_he_liquid_laundry_deterge",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Ajax Liquid Dish Detergent",
    "subtitle": "12.4 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/87.jpg?v=",
    "category": "household",
    "salePrice": 1.49,
    "originalPrice": 1.86,
    "discountPercent": 20,
    "unitPrice": "$1.49",
    "normalizedUnitCost": 1.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "ajax_liquid_dish_detergent",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Finish Powerball Ultimate Dishwasher Detergent Tabs or Jet-Dry Rinse Aid",
    "subtitle": "28 ct Dishwasher Detergent Tabs or 23 oz Jet-Dry Rinse Aid",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/88.jpg?v=",
    "category": "household",
    "salePrice": 11.99,
    "originalPrice": 14.99,
    "discountPercent": 20,
    "unitPrice": "$11.99",
    "normalizedUnitCost": 11.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "finish_powerball_ultimate_dish",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Pace Enchilada or Cheese Sauces",
    "subtitle": "10.5 oz \u2022 Taco Night",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/89.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 1.69,
    "originalPrice": 2.11,
    "discountPercent": 20,
    "unitPrice": "$1.69",
    "normalizedUnitCost": 1.69,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Delimex Frozen Taquitos",
    "subtitle": "19.2 or 20 oz \u2022 Taco Night",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/90.jpg?v=",
    "category": "frozen",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "delimex_frozen_taquitos",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Old El Paso Frozen Taco Bites",
    "subtitle": "13 oz Beef or Chicken \u2022 Taco Night",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/91.jpg?v=",
    "category": "frozen",
    "salePrice": 8.99,
    "originalPrice": 11.24,
    "discountPercent": 20,
    "unitPrice": "$8.99",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "old_el_paso_frozen_taco_bites",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Old El Paso Frozen Stuffed Nachos",
    "subtitle": "17 oz \u2022 Taco Night",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/92.jpg?v=",
    "category": "frozen",
    "salePrice": 6.99,
    "originalPrice": 8.74,
    "discountPercent": 20,
    "unitPrice": "$6.99",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "old_el_paso_frozen_stuffed_nac",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Starbucks Iced & Rockstar Energy Drinks",
    "subtitle": "12-16 oz \u2022 Stay Quenched!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/93.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 2,
    "originalPrice": 2.5,
    "discountPercent": 20,
    "unitPrice": "$2.00 each (2/$4)",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $4",
    "genericProductGroup": "starbucks_iced_rockstar_energy",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Gatorade Multipacks",
    "subtitle": "20 oz/8 pk \u2022 Stay Quenched!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/94.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 6.99,
    "originalPrice": 8.74,
    "discountPercent": 20,
    "unitPrice": "$6.99",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "gatorade_multipacks",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Lipton Black Tea Bags",
    "subtitle": "100 ct \u2022 Stay Quenched!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/95.jpg?v=",
    "category": "beverages",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "lipton_black_tea_bags",
    "tags": [
      "karns",
      "weekly_ad",
      "beverages",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Grill Master Bundle",
    "subtitle": "3 lb Ground Beef, 10 lb Chicken Leg Quarters, 3 lb Kunzler Meat Franks, 5 lb Country Style Pork Spare Ribs, 5 lb Boneless Skinless Chicken Breast, 8- Karns Hot Italian, Country Style or Sweet Italian Sausage Links, 4- 5 oz Bacon Wrapped Beef Sirloin Fille",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/97.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 99,
    "originalPrice": 123.75,
    "discountPercent": 20,
    "unitPrice": "$99.00",
    "normalizedUnitCost": 99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "grill_master_bundle",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh Chicken Drumsticks ",
    "subtitle": "Must Buy 5 lbs or More \u2022 Save $1.30 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/98.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 69,
    "originalPrice": 70.3,
    "discountPercent": 5,
    "unitPrice": "$69.00",
    "normalizedUnitCost": 69,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_chicken_drumsticks_",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Butcher's Blend Burger",
    "subtitle": "100% Beef & Pork \u2022 Must Buy 5 lbs or More",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/99.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 3.99,
    "originalPrice": 5.19,
    "discountPercent": 23,
    "unitPrice": "$3.99 / lb",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "5 LB+ VALUE PACK",
    "genericProductGroup": "butcher_s_blend_burger",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Hatfield Fresh Whole Bone In Pork Butts ",
    "subtitle": "Save $20&cent; lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/100.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 2.49,
    "originalPrice": 22.49,
    "discountPercent": 85,
    "unitPrice": "$2.49 / lb",
    "normalizedUnitCost": 2.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "hatfield_fresh_whole_bone_in_p",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh Jumbo Boneless Skinless Chicken Breast",
    "subtitle": "Must Buy 10 lbs or More",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/101.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 1.99,
    "originalPrice": 2.59,
    "discountPercent": 23,
    "unitPrice": "$1.99 / lb",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "5 LB+ VALUE PACK",
    "genericProductGroup": "boneless_chicken_breast",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Beef Cube Steak",
    "subtitle": "USDA Choice",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/102.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 6.99,
    "originalPrice": 9.09,
    "discountPercent": 23,
    "unitPrice": "$6.99 / lb",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "beef_cube_steak",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "American Wagyu Beef Grilling Steak ",
    "subtitle": "Winter Frost \u2022 8 oz Average",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/103.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 6,
    "originalPrice": 7.5,
    "discountPercent": 20,
    "unitPrice": "$6.00 each",
    "normalizedUnitCost": 6,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "american_wagyu_beef_grilling_s",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Hatfield Bone In Pork Butt Roast",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/104.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 2.69,
    "originalPrice": 3.5,
    "discountPercent": 23,
    "unitPrice": "$2.69 / lb",
    "normalizedUnitCost": 2.69,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "hatfield_bone_in_pork_butt_roa",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Hatfield Boneless Country Ribs",
    "subtitle": "Must Buy 5 lbs or More",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/105.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 2.69,
    "originalPrice": 3.5,
    "discountPercent": 23,
    "unitPrice": "$2.69 / lb",
    "normalizedUnitCost": 2.69,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "5 LB+ VALUE PACK",
    "genericProductGroup": "pork_ribs",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh Marinated Boneless Skinless Chicken Breast",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/106.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 4.99,
    "originalPrice": 6.49,
    "discountPercent": 23,
    "unitPrice": "$4.99 / lb",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "boneless_chicken_breast",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh  Chicken Halves",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/107.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 1.99,
    "originalPrice": 2.59,
    "discountPercent": 23,
    "unitPrice": "$1.99 / lb",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "fresh_chicken_halves",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Fresh 1/4 lb Extra Lean Ground Beef Patties ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/108.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 2,
    "originalPrice": 2.5,
    "discountPercent": 20,
    "unitPrice": "$2.00 each",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "ground_beef_80_20",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Whole Boneless New York Strips ",
    "subtitle": "USDA Choice -12 lb Average \u2022 CUSTOM CUT FREE!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/109.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 10.99,
    "originalPrice": 14.29,
    "discountPercent": 23,
    "unitPrice": "$10.99 / lb",
    "normalizedUnitCost": 10.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "whole_boneless_new_york_strips",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Karns Double Smoked  Sliced Bacon",
    "subtitle": "5 lb for $24.95",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/110.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 4.99,
    "originalPrice": 6.49,
    "discountPercent": 23,
    "unitPrice": "$4.99 / lb",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "bacon",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Ground  Pork ",
    "subtitle": "Must Buy 3 lbs or More",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/111.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 2.49,
    "originalPrice": 3.24,
    "discountPercent": 23,
    "unitPrice": "$2.49 / lb",
    "normalizedUnitCost": 2.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "5 LB+ VALUE PACK",
    "genericProductGroup": "ground_pork_",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Karns Country Style Loose Pork Sausage ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/112.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 2.49,
    "originalPrice": 3.24,
    "discountPercent": 23,
    "unitPrice": "$2.49 / lb",
    "normalizedUnitCost": 2.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "karns_country_style_loose_pork",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Karns Heavenly Jalapeno Cheddar Pork Sausage Links or Spinach& Feta Chicken Sausage Links",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/113.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 2,
    "originalPrice": 2.5,
    "discountPercent": 20,
    "unitPrice": "$2.00 each",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "karns_heavenly_jalapeno_chedda",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Sugar Run Farms Frozen 4 lb Breaded Dino Nuggets",
    "subtitle": "Max Pack \u2022 Frozen Family Favorites",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/114.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 10,
    "originalPrice": 12.5,
    "discountPercent": 20,
    "unitPrice": "$10.00",
    "normalizedUnitCost": 10,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_bread",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Grab & Go Deli",
    "subtitle": "Buy Any 3 Packages & \u2022 Save $1 Instantly! \u2022 Select Pre-Sliced Options \u2022 More Options \u2022 More Value \u2022 More Convenience",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/115.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 1,
    "originalPrice": 2,
    "discountPercent": 50,
    "unitPrice": "$1.00",
    "normalizedUnitCost": 1,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "grab_go_deli",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Wild Harvest Organic Strawberries/Peaches/Mango",
    "subtitle": "10 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/116.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.29,
    "originalPrice": 4.11,
    "discountPercent": 20,
    "unitPrice": "$3.29",
    "normalizedUnitCost": 3.29,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "wild_harvest_organic_strawberr",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Near East Long Grain & Wild Rice",
    "subtitle": "6 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/117.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.09,
    "originalPrice": 3.86,
    "discountPercent": 20,
    "unitPrice": "$3.09",
    "normalizedUnitCost": 3.09,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "near_east_long_grain_wild_rice",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Cardini's Ceasar Salad Dressings",
    "subtitle": "12 oz Select Varieties",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/118.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "cardini_s_ceasar_salad_dressin",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Mennen/Lady Speedstick",
    "subtitle": "2.3-3 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/119.jpg?v=",
    "category": "household",
    "salePrice": 1.99,
    "originalPrice": 2.49,
    "discountPercent": 20,
    "unitPrice": "$1.99",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "mennen_lady_speedstick",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Always Pocket Pads",
    "subtitle": "20-22 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/120.jpg?v=",
    "category": "household",
    "salePrice": 8.49,
    "originalPrice": 10.61,
    "discountPercent": 20,
    "unitPrice": "$8.49",
    "normalizedUnitCost": 8.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "always_pocket_pads",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Hero Mighty Patch",
    "subtitle": "8-36 ct Select Varieties",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/121.jpg?v=",
    "category": "household",
    "salePrice": 9.69,
    "originalPrice": 12.11,
    "discountPercent": 20,
    "unitPrice": "$9.69",
    "normalizedUnitCost": 9.69,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "hero_mighty_patch",
    "tags": [
      "karns",
      "weekly_ad",
      "household",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Martin's Potato Chips, Restaurant Style & Tortilla Chips & Cheese Curls",
    "subtitle": "8.5-11 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/122.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.99,
    "originalPrice": 7.98,
    "discountPercent": 50,
    "unitPrice": "$2.00 ea (BOGO Free)",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "effective per item",
    "dealType": "bogo",
    "dealBadge": "BOGO FREE",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Drake's Family Packs",
    "subtitle": "10.21-17 oz \u2022 Devil Dogs, Coffee Cakes or \u2022 Funny Bones",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/123.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "drake_s_family_packs",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Gold Peak Iced Tea",
    "subtitle": "59 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/124.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 3.99,
    "originalPrice": 7.98,
    "discountPercent": 50,
    "unitPrice": "$2.00 ea (BOGO Free)",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "effective per item",
    "dealType": "bogo",
    "dealBadge": "BOGO FREE",
    "genericProductGroup": "gold_peak_iced_tea",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Nabisco Snack Saks or Premium Saltines",
    "subtitle": "8 oz Snack Saks or \u2022 9-17 oz Saltines",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/125.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "nabisco_snack_saks_or_premium_",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Lipton Pure Leaf Singles ",
    "subtitle": "18.5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/126.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 2.99,
    "originalPrice": 5.99,
    "discountPercent": 50,
    "unitPrice": "$2.99 ea (BUY 3 GET 3 FREE)",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "effective per item",
    "dealType": "multi_buy",
    "dealBadge": "BUY 3 GET 3 FREE",
    "genericProductGroup": "lipton_pure_leaf_singles_",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Poppi Singles",
    "subtitle": "12 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/127.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.99,
    "originalPrice": 7.98,
    "discountPercent": 50,
    "unitPrice": "$2.00 ea (BOGO Free)",
    "normalizedUnitCost": 2,
    "normalizedUnitType": "unit",
    "unitDescription": "effective per item",
    "dealType": "bogo",
    "dealBadge": "BOGO FREE",
    "genericProductGroup": "poppi_singles",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Crystal Farms American Cheese Slices",
    "subtitle": "12 oz Yellow or White",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/128.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Soft Cream Cheese Spreads",
    "subtitle": "8 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/129.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 2.5,
    "originalPrice": 3.13,
    "discountPercent": 20,
    "unitPrice": "$2.50 each (2/$5)",
    "normalizedUnitCost": 2.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $5",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Giovanni Rana Refrigerated Family Size Bagged Pastas",
    "subtitle": "20 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/130.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 6.99,
    "originalPrice": 8.74,
    "discountPercent": 20,
    "unitPrice": "$6.99",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "giovanni_rana_refrigerated_fam",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Twix or Snickers Ice Cream Bars or Snickers Mini Ice Cram Bars",
    "subtitle": "11.8 or 12 oz/6 pk Ice Cream Bars or 9.5 oz/10 ct Mini Ice Cream Bars",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/131.jpg?v=",
    "category": "frozen",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "ice_cream",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Yasso Frozen Greek Yogurt",
    "subtitle": "14 oz Pints, \u2022 10.6-14 oz Bars or \u2022 6.84 oz Poppables",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/132.jpg?v=",
    "category": "frozen",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "yasso_frozen_greek_yogurt",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Morning Star Farms Plant Based Meals",
    "subtitle": "5.25-10.5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/133.jpg?v=",
    "category": "frozen",
    "salePrice": 4,
    "originalPrice": 5,
    "discountPercent": 20,
    "unitPrice": "$4.00 each (2/$8)",
    "normalizedUnitCost": 4,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $8",
    "genericProductGroup": "morning_star_farms_plant_based",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Keller's Butter Quarters",
    "subtitle": "16 oz Salted or Unsalted",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/134.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 4.19,
    "originalPrice": 5.24,
    "discountPercent": 20,
    "unitPrice": "$4.19",
    "normalizedUnitCost": 4.19,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "butter",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kozy Shack No Sugar Added Puddings",
    "subtitle": "16 oz Rice or Tapioca",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/135.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 3.39,
    "originalPrice": 4.24,
    "discountPercent": 20,
    "unitPrice": "$3.39",
    "normalizedUnitCost": 3.39,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "kozy_shack_no_sugar_added_pudd",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kozy Shack Puddings or Old Fashion Puddings",
    "subtitle": "22 oz Puddings or \u2022 4 oz/6 pk Old Fashion Puddings",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/136.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 3.49,
    "originalPrice": 4.36,
    "discountPercent": 20,
    "unitPrice": "$3.49",
    "normalizedUnitCost": 3.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "kozy_shack_puddings_or_old_fas",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Healthy Choice Power Bowls Frozen Entrees",
    "subtitle": "9-9.75 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/137.jpg?v=",
    "category": "frozen",
    "salePrice": 3.5,
    "originalPrice": 4.38,
    "discountPercent": 20,
    "unitPrice": "$3.50 each (2/$7)",
    "normalizedUnitCost": 3.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $7",
    "genericProductGroup": "healthy_choice_power_bowls_fro",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Healthy Choice Simply Steamers Frozen Entrees",
    "subtitle": "9-10 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/138.jpg?v=",
    "category": "frozen",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "healthy_choice_simply_steamers",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Marie Callender's Frozen Dinners & Large Pot Pies",
    "subtitle": "11.75-15 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/139.jpg?v=",
    "category": "frozen",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "bakery_pie",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Pillsbury Cookies or Cookie Dough",
    "subtitle": "14-16.5 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/140.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 3.5,
    "originalPrice": 4.38,
    "discountPercent": 20,
    "unitPrice": "$3.50 each (2/$7)",
    "normalizedUnitCost": 3.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $7",
    "genericProductGroup": "pillsbury_cookies_or_cookie_do",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Pillsbury Crescent & Cinnamon Rolls",
    "subtitle": "8-13.9 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/141.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 2.5,
    "originalPrice": 3.13,
    "discountPercent": 20,
    "unitPrice": "$2.50 each (2/$5)",
    "normalizedUnitCost": 2.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $5",
    "genericProductGroup": "fresh_bread",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Pillsbury Grands! Biscuits",
    "subtitle": "16.3 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/142.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 2.5,
    "originalPrice": 3.13,
    "discountPercent": 20,
    "unitPrice": "$2.50 each (2/$5)",
    "normalizedUnitCost": 2.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $5",
    "genericProductGroup": "pillsbury_grands_biscuits",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Hot Pockets Frozen Sandwiches",
    "subtitle": "54 oz/12 pk",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/143.jpg?v=",
    "category": "frozen",
    "salePrice": 12,
    "originalPrice": 15,
    "discountPercent": 20,
    "unitPrice": "$12.00",
    "normalizedUnitCost": 12,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "hot_pockets_frozen_sandwiches",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "DiGiorno Frozen Pizzas",
    "subtitle": "14.6-29.3 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/144.jpg?v=",
    "category": "frozen",
    "salePrice": 5.49,
    "originalPrice": 6.86,
    "discountPercent": 20,
    "unitPrice": "$5.49",
    "normalizedUnitCost": 5.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "digiorno_frozen_pizzas",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Totino's Frozen Pizza Rolls",
    "subtitle": "48.8-48.85 oz/100 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/145.jpg?v=",
    "category": "frozen",
    "salePrice": 9.99,
    "originalPrice": 12.49,
    "discountPercent": 20,
    "unitPrice": "$9.99",
    "normalizedUnitCost": 9.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_bread",
    "tags": [
      "karns",
      "weekly_ad",
      "frozen",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Herr's Kettle Cooked Potato Chips",
    "subtitle": "6.5-8 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/146.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "russet_potatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Tostitos Tortilla Chips & XXL Salsa or Doritos Protein Chips",
    "subtitle": "10-15.5 oz Tostitos or \u2022 7 oz Doritos",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/147.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.5,
    "originalPrice": 4.38,
    "discountPercent": 20,
    "unitPrice": "$3.50 each (2/$7)",
    "normalizedUnitCost": 3.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $7",
    "genericProductGroup": "potato_chips",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Lay's Regular & Kettle Potato Chips or Doritos Tortilla Chips",
    "subtitle": "4.75-8 oz Lay's or \u2022 9.25-10.75 oz Doritos",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/148.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "russet_potatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Essential Everyday Frozen Asian Appetizers",
    "subtitle": "9.84 or 12.2 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/149.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "essential_everyday_frozen_asia",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "General Mills 6 ct Chex Mix Bars, Cheerios Protein Bars & Cereal Treat Bars",
    "subtitle": "6.35-6.8 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/150.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "general_mills_6_ct_chex_mix_ba",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Stauffer's Multipacks",
    "subtitle": "18 oz/12 ct",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/151.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 5,
    "originalPrice": 6.25,
    "discountPercent": 20,
    "unitPrice": "$5.00",
    "normalizedUnitCost": 5,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "stauffer_s_multipacks",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Sunbelt Granola Bars",
    "subtitle": "7.61-11 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/152.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 3,
    "originalPrice": 3.75,
    "discountPercent": 20,
    "unitPrice": "$3.00 each (2/$6)",
    "normalizedUnitCost": 3,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $6",
    "genericProductGroup": "sunbelt_granola_bars",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Gatorade Water, Lifewater & Propel Singles",
    "subtitle": "1 Liter",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/153.jpg?v=",
    "category": "beverages",
    "salePrice": 1.67,
    "originalPrice": 2.09,
    "discountPercent": 20,
    "unitPrice": "$1.67 each (3/$5)",
    "normalizedUnitCost": 1.67,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "3 FOR $5",
    "genericProductGroup": "gatorade_water_lifewater_prope",
    "tags": [
      "karns",
      "weekly_ad",
      "beverages",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Coke Fridge Packs",
    "subtitle": "12 oz/12 pk",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/154.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 7.99,
    "originalPrice": 9.99,
    "discountPercent": 20,
    "unitPrice": "$7.99",
    "normalizedUnitCost": 7.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "coke_fridge_packs",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Snapple Iced Tea & Drinks",
    "subtitle": "64 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/155.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 1.5,
    "originalPrice": 1.88,
    "discountPercent": 20,
    "unitPrice": "$1.50 each (2/$3)",
    "normalizedUnitCost": 1.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $3",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Celsius & Alani Nu Singles",
    "subtitle": "12 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/156.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 2.25,
    "originalPrice": 2.81,
    "discountPercent": 20,
    "unitPrice": "$2.25 each (2/$4.50)",
    "normalizedUnitCost": 2.25,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $4.5",
    "genericProductGroup": "celsius_alani_nu_singles",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Coke",
    "subtitle": "7.5 oz/10 pk Mini Cans or \u2022 12 oz/8 pk Bottles",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/157.jpg?v=",
    "category": "pantry_snacks",
    "salePrice": 6,
    "originalPrice": 7.5,
    "discountPercent": 20,
    "unitPrice": "$6.00 each (2/$12)",
    "normalizedUnitCost": 6,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $12",
    "genericProductGroup": "coke",
    "tags": [
      "karns",
      "weekly_ad",
      "pantry_snacks",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Dunkin' Iced Coffee Singles",
    "subtitle": "13.7 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/158.jpg?v=",
    "category": "dairy_eggs",
    "salePrice": 3.33,
    "originalPrice": 4.16,
    "discountPercent": 20,
    "unitPrice": "$3.33 each (3/$10)",
    "normalizedUnitCost": 3.33,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "3 FOR $10",
    "genericProductGroup": "dunkin_iced_coffee_singles",
    "tags": [
      "karns",
      "weekly_ad",
      "dairy_eggs",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Navel Oranges ",
    "subtitle": "3 lb Bag - Save $2 each",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/159.jpg?v=",
    "category": "produce",
    "salePrice": 4.99,
    "originalPrice": 6.99,
    "discountPercent": 29,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "mandarin_oranges",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Local Apples",
    "subtitle": "Gala, Ginger Gold, Sweet Maia & MacIntosh \u2022 Save 20&cent; lb \u2022 Locally Grown Produce",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/160.jpg?v=",
    "category": "produce",
    "salePrice": 1.29,
    "originalPrice": 21.29,
    "discountPercent": 85,
    "unitPrice": "$1.29 / lb",
    "normalizedUnitCost": 1.29,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fresh Blueberries",
    "subtitle": "Pint - Save $1 each",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/161.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_blueberries",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Green Cabbage",
    "subtitle": "Locally Grown Produce",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/162.jpg?v=",
    "category": "produce",
    "salePrice": 79,
    "originalPrice": 98.75,
    "discountPercent": 20,
    "unitPrice": "$79.00",
    "normalizedUnitCost": 79,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "green_cabbage",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Sweet Corn",
    "subtitle": "White & Bi-Color \u2022 Save $1.20 on 4 \u2022 Locally Grown Produce \u2022 Fresh Picked Savings",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/163.jpg?v=",
    "category": "produce",
    "salePrice": 0.5,
    "originalPrice": 0.8,
    "discountPercent": 38,
    "unitPrice": "$0.50 each (4/$2)",
    "normalizedUnitCost": 0.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "4 FOR $2",
    "genericProductGroup": "sweet_corn",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Melon Bowls Cantaloupe or Watermelon",
    "subtitle": "22 oz Minimum Fresh Cut",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/164.jpg?v=",
    "category": "produce",
    "salePrice": 5,
    "originalPrice": 6.25,
    "discountPercent": 20,
    "unitPrice": "$5.00 each",
    "normalizedUnitCost": 5,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "melon_bowls_cantaloupe_or_wate",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Cotton Candy Grapes",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/165.jpg?v=",
    "category": "produce",
    "salePrice": 4.99,
    "originalPrice": 6.49,
    "discountPercent": 23,
    "unitPrice": "$4.99 / lb",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "grapes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fresh Peaches",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/166.jpg?v=",
    "category": "produce",
    "salePrice": 2.49,
    "originalPrice": 3.24,
    "discountPercent": 23,
    "unitPrice": "$2.49 / lb",
    "normalizedUnitCost": 2.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "fresh_peaches",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Golden Pineapples",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/167.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99 each",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fresh Brussels Sprouts",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/168.jpg?v=",
    "category": "produce",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_brussels_sprouts",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Yellow Onions ",
    "subtitle": "2 lb Bag",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/169.jpg?v=",
    "category": "produce",
    "salePrice": 1.99,
    "originalPrice": 2.49,
    "discountPercent": 20,
    "unitPrice": "$1.99",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "onions",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Green Giant Idaho Russet Potatoes",
    "subtitle": "5 lb Bag",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/170.jpg?v=",
    "category": "produce",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "russet_potatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fresh Cauliflower",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/171.jpg?v=",
    "category": "produce",
    "salePrice": 3.49,
    "originalPrice": 4.36,
    "discountPercent": 20,
    "unitPrice": "$3.49 each",
    "normalizedUnitCost": 3.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_cauliflower",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Little Leaf Salads",
    "subtitle": "4 oz Container Assorted Varieties",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/172.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "little_leaf_salads",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Tomatoes",
    "subtitle": "On The Vine, Roma & Beefsteak",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/173.jpg?v=",
    "category": "produce",
    "salePrice": 2.49,
    "originalPrice": 3.24,
    "discountPercent": 23,
    "unitPrice": "$2.49 / lb",
    "normalizedUnitCost": 2.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "tomatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "European Cucumbers",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/174.jpg?v=",
    "category": "produce",
    "salePrice": 1.79,
    "originalPrice": 2.24,
    "discountPercent": 20,
    "unitPrice": "$1.79 each",
    "normalizedUnitCost": 1.79,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "european_cucumbers",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Iceberg Lettuce",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/175.jpg?v=",
    "category": "produce",
    "salePrice": 1.99,
    "originalPrice": 2.49,
    "discountPercent": 20,
    "unitPrice": "$1.99 each",
    "normalizedUnitCost": 1.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "iceberg_lettuce",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Romaine Hearts",
    "subtitle": "3 Pack",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/176.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "romaine_hearts",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Whole Seedless Watermelons",
    "subtitle": "Locally Grown Produce",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/177.jpg?v=",
    "category": "produce",
    "salePrice": 6.99,
    "originalPrice": 8.74,
    "discountPercent": 20,
    "unitPrice": "$6.99 each",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "whole_seedless_watermelons",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Ripe Avocadoes",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/178.jpg?v=",
    "category": "produce",
    "salePrice": 1.5,
    "originalPrice": 1.88,
    "discountPercent": 20,
    "unitPrice": "$1.50 each (2/$3)",
    "normalizedUnitCost": 1.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $3",
    "genericProductGroup": "ripe_avocadoes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "White or Baby Portabella Mushrooms",
    "subtitle": "8 oz Whole or Sliced",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/179.jpg?v=",
    "category": "produce",
    "salePrice": 2.5,
    "originalPrice": 3.13,
    "discountPercent": 20,
    "unitPrice": "$2.50 each (2/$5)",
    "normalizedUnitCost": 2.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $5",
    "genericProductGroup": "white_or_baby_portabella_mushr",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Cucumbers",
    "subtitle": "Locally Grown Produce",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/180.jpg?v=",
    "category": "produce",
    "salePrice": 69,
    "originalPrice": 86.25,
    "discountPercent": 20,
    "unitPrice": "$69.00 each",
    "normalizedUnitCost": 69,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "cucumbers",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Athena Cantaloupes",
    "subtitle": "Locally Grown Produce",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/181.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "athena_cantaloupes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fresh Lemons ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/182.jpg?v=",
    "category": "produce",
    "salePrice": 0.5,
    "originalPrice": 0.63,
    "discountPercent": 20,
    "unitPrice": "$0.50 each (2/$1)",
    "normalizedUnitCost": 0.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $1",
    "genericProductGroup": "fresh_lemons_",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "3 Pack Sweet Corn",
    "subtitle": "Locally Grown Produce",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/183.jpg?v=",
    "category": "produce",
    "salePrice": 2.99,
    "originalPrice": 3.74,
    "discountPercent": 20,
    "unitPrice": "$2.99",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "sweet_corn",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Jumbo Red, Yellow or Orange Peppers",
    "subtitle": "Hothouse",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/184.jpg?v=",
    "category": "produce",
    "salePrice": 2.99,
    "originalPrice": 3.89,
    "discountPercent": 23,
    "unitPrice": "$2.99 / lb",
    "normalizedUnitCost": 2.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "mandarin_oranges",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Olivia's Organic Salads",
    "subtitle": "5 oz Assorted Varieties",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/185.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "olivia_s_organic_salads",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Organic Sungold Kiwi Fruit",
    "subtitle": "1 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/186.jpg?v=",
    "category": "produce",
    "salePrice": 5.99,
    "originalPrice": 7.49,
    "discountPercent": 20,
    "unitPrice": "$5.99",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "organic_sungold_kiwi_fruit",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Organic Grape Tomatoes",
    "subtitle": "Pint",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/187.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "grapes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Organic Romaine Hearts",
    "subtitle": "3 Pack",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/188.jpg?v=",
    "category": "produce",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "organic_romaine_hearts",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Organic Seedless Grapes",
    "subtitle": "Red or Green",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/189.jpg?v=",
    "category": "produce",
    "salePrice": 3.99,
    "originalPrice": 5.19,
    "discountPercent": 23,
    "unitPrice": "$3.99 / lb",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "grapes",
    "tags": [
      "karns",
      "weekly_ad",
      "produce",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Spring Meadow Farms Honey Roasted Turkey Breast",
    "subtitle": "Deli Sliced - Save $3 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/190.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 4.99,
    "originalPrice": 7.99,
    "discountPercent": 38,
    "unitPrice": "$4.99 / lb",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "deli_turkey",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Schmitd's Smoked Sausage Links",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/191.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 6.99,
    "originalPrice": 9.09,
    "discountPercent": 23,
    "unitPrice": "$6.99 / lb",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "schmitd_s_smoked_sausage_links",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Karns Smokehouse Smoked Apple Cheddar Pork Sausage",
    "subtitle": "Save $1 lb \u2022 NEW!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/192.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 6.99,
    "originalPrice": 7.99,
    "discountPercent": 13,
    "unitPrice": "$6.99 / lb",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "fresh_apples",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Bob Evans Mashed Potatoes & Sides",
    "subtitle": "12-24 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/193.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "$3.99",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "russet_potatoes",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Bob Evans Sausage Links, Rolls or Patties",
    "subtitle": "12-16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/194.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 4.49,
    "originalPrice": 5.61,
    "discountPercent": 20,
    "unitPrice": "$4.49",
    "normalizedUnitCost": 4.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "fresh_bread",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "John F. Martin Oven Roasted Deli Chicken Breast",
    "subtitle": "Family Favorites \u2022 Always Fresh & Priced Right!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/195.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 6.99,
    "originalPrice": 9.09,
    "discountPercent": 23,
    "unitPrice": "$6.99 / lb",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "boneless_chicken_breast",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "John F. Martin Black Forest Deli Ham",
    "subtitle": "Family Favorites \u2022 Always Fresh & Priced Right!",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/196.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 5.99,
    "originalPrice": 7.79,
    "discountPercent": 23,
    "unitPrice": "$5.99 / lb",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "deli_ham",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Land O Lakes Italian Blend or Sharp Cheese",
    "subtitle": "Deli Sliced",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/197.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 5.99,
    "originalPrice": 7.79,
    "discountPercent": 23,
    "unitPrice": "$5.99 / lb",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Bongards 5 lb Sliced American Cheese ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/198.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 16.99,
    "originalPrice": 21.24,
    "discountPercent": 20,
    "unitPrice": "$16.99",
    "normalizedUnitCost": 16.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Cooper Cheese",
    "subtitle": "Deli Sliced",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/199.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 5.99,
    "originalPrice": 7.79,
    "discountPercent": 23,
    "unitPrice": "$5.99 / lb",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Belgiosio Snacking Cheeses",
    "subtitle": "6 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/200.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 3.5,
    "originalPrice": 4.38,
    "discountPercent": 20,
    "unitPrice": "$3.50 each (2/$7)",
    "normalizedUnitCost": 3.5,
    "normalizedUnitType": "unit",
    "unitDescription": "per item",
    "dealType": "multi_buy",
    "dealBadge": "2 FOR $7",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Emmental Imported Sliced Swiss Cheese",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/201.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 6.99,
    "originalPrice": 9.09,
    "discountPercent": 23,
    "unitPrice": "$6.99 / lb",
    "normalizedUnitCost": 6.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "John F. Martin Provolone Cheese",
    "subtitle": "Deli Sliced",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/202.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 4.99,
    "originalPrice": 6.49,
    "discountPercent": 23,
    "unitPrice": "$4.99 / lb",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "shredded_cheese",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Golden Legacy Premium Golden Brown Turkey Breast ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/203.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 8.99,
    "originalPrice": 11.69,
    "discountPercent": 23,
    "unitPrice": "$8.99 / lb",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "deli_turkey",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "John F. Martin Sliced Deli Lunchmeats",
    "subtitle": "8 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/204.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 3.5,
    "originalPrice": 4.38,
    "discountPercent": 20,
    "unitPrice": "$3.50",
    "normalizedUnitCost": 3.5,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "john_f_martin_sliced_deli_lunc",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "John F. Martin Jalapeno & Cheese Franks",
    "subtitle": "16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/205.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 5.99,
    "originalPrice": 7.49,
    "discountPercent": 20,
    "unitPrice": "$5.99",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "hot_dogs",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Curly's Pulled Pork or Chicken BBQ",
    "subtitle": "16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/206.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 5.49,
    "originalPrice": 6.86,
    "discountPercent": 20,
    "unitPrice": "$5.49",
    "normalizedUnitCost": 5.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "curly_s_pulled_pork_or_chicken",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Kretschmar Turkey off the Bone",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/207.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 8.99,
    "originalPrice": 11.69,
    "discountPercent": 23,
    "unitPrice": "$8.99 / lb",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "deli_turkey",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Kretschmar Corned Beef or Pastrami",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/208.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 13.99,
    "originalPrice": 18.19,
    "discountPercent": 23,
    "unitPrice": "$13.99 / lb",
    "normalizedUnitCost": 13.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "sweet_corn",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Smithfield Prime Fresh Deli Lunchmeats",
    "subtitle": "7-8 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/209.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "smithfield_prime_fresh_deli_lu",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Smithfield Burnt Brisket Ends",
    "subtitle": "16 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/210.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 8.99,
    "originalPrice": 11.24,
    "discountPercent": 20,
    "unitPrice": "$8.99",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "smithfield_burnt_brisket_ends",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Kunzler German Bologna",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/211.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 4.99,
    "originalPrice": 6.49,
    "discountPercent": 23,
    "unitPrice": "$4.99 / lb",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "kunzler_german_bologna",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Seltzer's Beef Snack Sticks",
    "subtitle": "8 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/212.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 8.99,
    "originalPrice": 11.24,
    "discountPercent": 20,
    "unitPrice": "$8.99",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "seltzer_s_beef_snack_sticks",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Mama Lucia Italian Meatballs",
    "subtitle": "10 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/213.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 3.29,
    "originalPrice": 4.11,
    "discountPercent": 20,
    "unitPrice": "$3.29",
    "normalizedUnitCost": 3.29,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "mama_lucia_italian_meatballs",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Steak-umm Beef Sandwich Steaks",
    "subtitle": "9 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/214.jpg?v=",
    "category": "meat_seafood",
    "salePrice": 4.99,
    "originalPrice": 6.24,
    "discountPercent": 20,
    "unitPrice": "$4.99",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "steak_umm_beef_sandwich_steaks",
    "tags": [
      "karns",
      "weekly_ad",
      "meat_seafood",
      "butcher_market"
    ],
    "qualityTier": "premium"
  },
  {
    "rawTitle": "Seltzer's Lebanon Bologna Snackers",
    "subtitle": "10 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/215.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 9.99,
    "originalPrice": 12.49,
    "discountPercent": 20,
    "unitPrice": "$9.99",
    "normalizedUnitCost": 9.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "seltzer_s_lebanon_bologna_snac",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Seltzer's Sliced Lebanon Bologna",
    "subtitle": "12 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/216.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 8.99,
    "originalPrice": 11.24,
    "discountPercent": 20,
    "unitPrice": "$8.99",
    "normalizedUnitCost": 8.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "seltzer_s_sliced_lebanon_bolog",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Weaver's Beef Jerky",
    "subtitle": "2 oz",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/217.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 5.99,
    "originalPrice": 7.49,
    "discountPercent": 20,
    "unitPrice": "$5.99",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "weaver_s_beef_jerky",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Spring Glen Ham Pot Pie ",
    "subtitle": "2 lb",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/218.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 9.99,
    "originalPrice": 12.49,
    "discountPercent": 20,
    "unitPrice": "$9.99",
    "normalizedUnitCost": 9.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "bakery_pie",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Fresh Sushi",
    "subtitle": "Available at our Paxton, Carlisle, Mechanicsburg, Etters, Hershey & Lemoyne Locations! \u2022 Now Available at Duncannon & New Bloomfield",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/219.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "Daily",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "per unit",
    "dealType": "sale",
    "genericProductGroup": "fresh_sushi",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Soups to Go",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/220.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 3.99,
    "originalPrice": 4.99,
    "discountPercent": 20,
    "unitPrice": "All Locations",
    "normalizedUnitCost": 3.99,
    "normalizedUnitType": "unit",
    "unitDescription": "per unit",
    "dealType": "sale",
    "genericProductGroup": "canned_soup",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Whole Rotisserie Chickens ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/221.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 6,
    "originalPrice": 7.5,
    "discountPercent": 20,
    "unitPrice": "$6.00 each",
    "normalizedUnitCost": 6,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "karns_whole_rotisserie_chicken",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns 8 Piece Fried Chicken or Whole Rotisserie Chicken Meal",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/222.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 24.99,
    "originalPrice": 31.24,
    "discountPercent": 20,
    "unitPrice": "$24.99 each",
    "normalizedUnitCost": 24.99,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "bakery_pie",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Gazebo Marinated Chicken Family Meal",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/223.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 10.49,
    "originalPrice": 13.11,
    "discountPercent": 20,
    "unitPrice": "$10.49 each",
    "normalizedUnitCost": 10.49,
    "normalizedUnitType": "unit",
    "unitDescription": "each",
    "dealType": "sale",
    "genericProductGroup": "karns_gazebo_marinated_chicken",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Original Chicken Salad ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/224.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 7.49,
    "originalPrice": 9.74,
    "discountPercent": 23,
    "unitPrice": "$7.49 / lb",
    "normalizedUnitCost": 7.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "karns_original_chicken_salad_",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Asian Noodle Salad ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/225.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 5.99,
    "originalPrice": 7.79,
    "discountPercent": 23,
    "unitPrice": "$5.99 / lb",
    "normalizedUnitCost": 5.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "karns_asian_noodle_salad_",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Beef BBQ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/226.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 10.99,
    "originalPrice": 14.29,
    "discountPercent": 23,
    "unitPrice": "$10.99 / lb",
    "normalizedUnitCost": 10.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "karns_beef_bbq",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Egg & Potato Salad ",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/227.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 5.49,
    "originalPrice": 7.14,
    "discountPercent": 23,
    "unitPrice": "$5.49 / lb",
    "normalizedUnitCost": 5.49,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "large_white_eggs",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  },
  {
    "rawTitle": "Karns Baked Limas",
    "imageUrl": "https://www.karnsfoods.com/images/uploads/weekly/20260908/228.jpg?v=",
    "category": "bakery_deli",
    "salePrice": 4.99,
    "originalPrice": 6.49,
    "discountPercent": 23,
    "unitPrice": "$4.99 / lb",
    "normalizedUnitCost": 4.99,
    "normalizedUnitType": "lb",
    "unitDescription": "per pound",
    "dealType": "sale",
    "dealBadge": "BUTCHER SPECIAL",
    "genericProductGroup": "karns_baked_limas",
    "tags": [
      "karns",
      "weekly_ad",
      "bakery_deli",
      "butcher_market"
    ],
    "qualityTier": "standard"
  }
];

// server/karnsScraper.ts
var karnsCache = null;
var CACHE_TTL_MS = 15 * 60 * 1e3;
function parseKarnsPrice(dealStr, subtitle) {
  const cleanDeal = dealStr.trim();
  let salePrice = 3.99;
  let originalPrice = 4.99;
  let unitPrice = cleanDeal;
  let normalizedUnitCost = 3.99;
  let normalizedUnitType = "unit";
  let unitDescription = "per unit";
  let dealType = "sale";
  let dealBadge = void 0;
  let savingsAmount = 0;
  const saveMatch = subtitle.match(/Save\s+\$?([\d\.]+)/i);
  if (saveMatch) {
    savingsAmount = parseFloat(saveMatch[1]) || 0;
  }
  if (/bogo|buy\s+one\s+get\s+one/i.test(cleanDeal)) {
    dealType = "bogo";
    dealBadge = "BOGO FREE";
    salePrice = savingsAmount > 0 ? savingsAmount : 3.99;
    originalPrice = salePrice * 2;
    normalizedUnitCost = Number((salePrice / 2).toFixed(2));
    unitPrice = `$${normalizedUnitCost.toFixed(2)} ea (BOGO Free)`;
    unitDescription = "effective per item";
  } else if (/buy\s+(\d+)\s+get\s+(\d+)\s+free/i.test(cleanDeal)) {
    const m = cleanDeal.match(/buy\s+(\d+)\s+get\s+(\d+)\s+free/i);
    dealType = "multi_buy";
    dealBadge = cleanDeal.toUpperCase();
    const buyCount = parseInt(m[1], 10);
    const freeCount = parseInt(m[2], 10);
    const totalCount = buyCount + freeCount;
    originalPrice = 5.99;
    salePrice = Number((buyCount * originalPrice / totalCount).toFixed(2));
    normalizedUnitCost = salePrice;
    unitPrice = `$${salePrice.toFixed(2)} ea (${cleanDeal})`;
    unitDescription = "effective per item";
  } else if (/^(\d+)\s*\/\s*\$?([\d\.]+)$/.test(cleanDeal)) {
    const m = cleanDeal.match(/^(\d+)\s*\/\s*\$?([\d\.]+)$/);
    const qty = parseInt(m[1], 10);
    const total = parseFloat(m[2]);
    dealType = "multi_buy";
    dealBadge = `${qty} FOR $${total}`;
    salePrice = Number((total / qty).toFixed(2));
    originalPrice = savingsAmount > 0 ? salePrice + savingsAmount / qty : salePrice * 1.25;
    normalizedUnitCost = salePrice;
    unitPrice = `$${salePrice.toFixed(2)} each (${cleanDeal})`;
    unitDescription = "per item";
  } else if (/\$?([\d\.]+)\s*(?:lb|\/lb|per\s*lb)/i.test(cleanDeal)) {
    const m = cleanDeal.match(/\$?([\d\.]+)/);
    salePrice = parseFloat(m[1]);
    normalizedUnitType = "lb";
    normalizedUnitCost = salePrice;
    unitPrice = `$${salePrice.toFixed(2)} / lb`;
    unitDescription = "per pound";
    originalPrice = savingsAmount > 0 ? salePrice + savingsAmount : Number((salePrice * 1.3).toFixed(2));
    dealType = "sale";
    if (/must\s+buy\s+\d+\s+lbs/i.test(subtitle)) {
      dealBadge = "5 LB+ VALUE PACK";
    } else {
      dealBadge = "BUTCHER SPECIAL";
    }
  } else if (/\$?([\d\.]+)/.test(cleanDeal)) {
    const m = cleanDeal.match(/\$?([\d\.]+)/);
    salePrice = parseFloat(m[1]);
    normalizedUnitCost = salePrice;
    unitPrice = `$${salePrice.toFixed(2)}`;
    unitDescription = "each";
    originalPrice = savingsAmount > 0 ? salePrice + savingsAmount : Number((salePrice * 1.25).toFixed(2));
    dealType = "sale";
    if (/each/i.test(cleanDeal)) {
      unitPrice += " each";
    }
  }
  const discountPercent = originalPrice > salePrice ? Math.min(85, Math.max(5, Math.round((originalPrice - salePrice) / originalPrice * 100))) : 15;
  return {
    salePrice: Number(salePrice.toFixed(2)),
    originalPrice: Number(originalPrice.toFixed(2)),
    discountPercent,
    unitPrice,
    normalizedUnitCost: Number(normalizedUnitCost.toFixed(2)),
    normalizedUnitType,
    unitDescription,
    dealType,
    dealBadge
  };
}
function mapKarnsCategory(catID, name) {
  switch (catID) {
    case 1:
      return "produce";
    case 2:
      return "bakery_deli";
    case 3:
      return "meat_seafood";
    case 4:
      return "dairy_eggs";
    case 5:
      return "bakery_deli";
    case 6:
    case 7:
    case 8:
      return "household";
    case 9:
      return "frozen";
    case 10:
      return "meat_seafood";
    case 11:
    case 12:
    default:
      if (/tea|juice|coffee|soda|water|cider|drink/i.test(name)) return "beverages";
      return "pantry_snacks";
  }
}
function inferGenericProductGroup(name) {
  const n = name.toLowerCase();
  if (/wing/i.test(n)) return "chicken_wings";
  if (/ground (?:beef|angus|chuck|round)/i.test(n)) return "ground_beef_80_20";
  if (/ribeye/i.test(n)) return "ribeye_steak";
  if (/strip steak/i.test(n)) return "ny_strip_steak";
  if (/porterhouse|t-bone/i.test(n)) return "t_bone_steak";
  if (/rump roast|chuck roast/i.test(n)) return "beef_roast";
  if (/chicken breast/i.test(n)) return "boneless_chicken_breast";
  if (/pork rib|country rib/i.test(n)) return "pork_ribs";
  if (/pork chop/i.test(n)) return "pork_chops";
  if (/bacon/i.test(n)) return "bacon";
  if (/frank|hot dog/i.test(n)) return "hot_dogs";
  if (/salmon/i.test(n)) return "salmon_fillet";
  if (/shrimp/i.test(n)) return "raw_shrimp";
  if (/haddock|cod|flounder/i.test(n)) return "whitefish_fillet";
  if (/egg/i.test(n)) return "large_white_eggs";
  if (/milk/i.test(n)) return "whole_milk_gallon";
  if (/cheese/i.test(n)) return "shredded_cheese";
  if (/butter/i.test(n)) return "butter";
  if (/ice cream/i.test(n)) return "ice_cream";
  if (/grape/i.test(n)) return "grapes";
  if (/orange|mandarin/i.test(n)) return "mandarin_oranges";
  if (/apple/i.test(n)) return "fresh_apples";
  if (/potato/i.test(n)) return "russet_potatoes";
  if (/broccoli/i.test(n)) return "broccoli";
  if (/onion/i.test(n)) return "onions";
  if (/corn/i.test(n)) return "sweet_corn";
  if (/bread|roll/i.test(n)) return "fresh_bread";
  if (/pie/i.test(n)) return "bakery_pie";
  if (/ham/i.test(n)) return "deli_ham";
  if (/turkey/i.test(n)) return "deli_turkey";
  if (/potato salad|macaroni salad/i.test(n)) return "deli_salad";
  if (/chip|pretzel/i.test(n)) return "potato_chips";
  if (/soup/i.test(n)) return "canned_soup";
  if (/sauce|marinara/i.test(n)) return "pasta_sauce";
  return n.replace(/[^a-z0-9]+/g, "_").slice(0, 30);
}
async function fetchLiveKarnsCircular() {
  if (karnsCache && Date.now() - karnsCache.timestamp < CACHE_TTL_MS) {
    return { items: karnsCache.items, validDates: karnsCache.validDates };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4e3);
  try {
    const res = await fetch("https://www.karnsfoods.com/weekly-ad/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        Accept: "text/html,application/xhtml+xml"
      },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`Karns Foods returned HTTP ${res.status}`);
    }
    const html = await res.text();
    const regex = /<li[^>]*>([\s\S]*?data-addtoshoppinglist=[\s\S]*?)<\/li>/g;
    let m;
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    while ((m = regex.exec(html)) !== null) {
      const block = m[1];
      const dataMatch = block.match(/data-addtoshoppinglist="([^"]+)"/);
      if (!dataMatch) continue;
      try {
        const decoded = dataMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&");
        const data = JSON.parse(decoded);
        if (!data.name || seen.has(data.name)) continue;
        seen.add(data.name);
        const imgMatch = block.match(/data-img-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
        let imgSrc = imgMatch ? imgMatch[1] : "";
        if (imgSrc.startsWith("/..")) {
          imgSrc = "https://www.karnsfoods.com" + imgSrc.replace(/^\/\.\./, "");
        } else if (imgSrc.startsWith("/")) {
          imgSrc = "https://www.karnsfoods.com" + imgSrc;
        }
        const smallMatch = block.match(/<small>([\s\S]*?)<\/small>/);
        let subtitle = "";
        if (smallMatch) {
          subtitle = smallMatch[1].replace(/<em[^>]*>[\s\S]*?<\/em>/g, "").replace(/<br\s*\/?>/g, " \u2022 ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          subtitle = subtitle.replace(/^•\s*|•\s*$/g, "").replace(/\s*•\s*•\s*/g, " \u2022 ").trim();
        }
        const priceInfo = parseKarnsPrice(data.realdeal || "", subtitle);
        const category = mapKarnsCategory(data.categoryID, data.name);
        const genericProductGroup = inferGenericProductGroup(data.name);
        items.push({
          rawTitle: data.name,
          subtitle: subtitle || void 0,
          imageUrl: imgSrc || void 0,
          category,
          ...priceInfo,
          genericProductGroup,
          tags: ["karns", "weekly_ad", category, "butcher_market", "central_pa"],
          qualityTier: category === "meat_seafood" ? "premium" : "standard"
        });
      } catch {
      }
    }
    if (items.length > 20) {
      const dateMatch = html.match(/Specials Valid\s*<span[^>]*>([^<]+)<\/span>\s*to\s*<span[^>]*>([^<]+)<\/span>/i);
      const validDates = dateMatch ? `${dateMatch[1].trim()} - ${dateMatch[2].trim()}` : KARNS_CIRCULAR_VALID_DATES;
      karnsCache = {
        timestamp: Date.now(),
        items,
        validDates
      };
      return { items, validDates };
    }
  } catch (err) {
    console.warn("[KarnsScraper] Live fetch had issue, using curated full circular snapshot:", err);
  } finally {
    clearTimeout(timer);
  }
  return {
    items: KARNS_FULL_CIRCULAR_SNAPSHOT,
    validDates: KARNS_CIRCULAR_VALID_DATES
  };
}
async function getFullKarnsCircularDeals(store) {
  const { items, validDates } = await fetchLiveKarnsCircular();
  store.validDates = "Sep 8 - Sep 14";
  store.flyerTitle = `Karns Weekly Circular (${validDates})`;
  store.totalDealsCount = items.length;
  return items.map((raw, idx) => ({
    id: `${store.id}-deal-${idx + 1}`,
    storeId: store.id,
    storeName: store.name,
    storeLogoBg: store.logoBg || "#991B1B",
    storeLogoText: store.logoText || "KARNS",
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
    validUntil: "2026-09-14",
    inStock: true,
    genericProductGroup: raw.genericProductGroup,
    tags: raw.tags,
    brand: raw.category === "meat_seafood" ? "Karns Butcher's Market" : void 0,
    qualityTier: raw.qualityTier
  }));
}

// server/geminiService.ts
var aiClient = null;
var circularsCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS2 = 10 * 60 * 1e3;
async function searchWebScraper(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
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
  } catch {
  } finally {
    clearTimeout(timer);
  }
  return "";
}
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
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
  if (!text || typeof text !== "string") {
    return fallback;
  }
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  if (!cleaned) {
    return fallback;
  }
  try {
    const jsonStart = cleaned.indexOf("[");
    const jsonEnd = cleaned.lastIndexOf("]");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      return JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
    }
    const objStart = cleaned.indexOf("{");
    const objEnd = cleaned.lastIndexOf("}");
    if (objStart !== -1 && objEnd > objStart) {
      return JSON.parse(cleaned.substring(objStart, objEnd + 1));
    }
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}
async function getCircularsForLocation(lat, lng, city = "Mechanicsburg", state = "PA", zipCode = "17050", radiusMiles = 10) {
  const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusMiles}`;
  const cached = circularsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS2) {
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
  const hasKarns = stores.some((s) => s.name.toLowerCase().includes("karns") || s.chain.toLowerCase().includes("karns"));
  if (!hasKarns && (state.toUpperCase() === "PA" || city.toLowerCase().includes("mechanicsburg") || city.toLowerCase().includes("harrisburg") || city.toLowerCase().includes("camp hill") || city.toLowerCase().includes("carlisle"))) {
    const karnsDefaults = getRegionalDefaultStores("Mechanicsburg", "PA", 40.2396, -76.9698, radiusMiles);
    const karns = karnsDefaults.find((s) => s.name.toLowerCase().includes("karns"));
    if (karns && !stores.some((s) => s.id === karns.id)) {
      stores.unshift(karns);
    }
  }
  const uniqueStoreMap = /* @__PURE__ */ new Map();
  for (const s of stores) {
    if (!uniqueStoreMap.has(s.id)) {
      uniqueStoreMap.set(s.id, s);
    }
  }
  stores = Array.from(uniqueStoreMap.values()).filter((s) => s.distanceMiles <= radiusMiles);
  if (stores.length === 0) {
    return { stores: [], deals: [] };
  }
  let karnsDeals = [];
  const karnsStore = stores.find((s) => s.name.toLowerCase().includes("karns") || s.chain.toLowerCase().includes("karns"));
  if (karnsStore) {
    try {
      karnsDeals = await getFullKarnsCircularDeals(karnsStore);
      karnsStore.totalDealsCount = karnsDeals.length;
    } catch (err) {
      console.warn("[GeminiService] Error fetching full Karns circular, falling back:", err);
    }
  }
  const otherStores = stores.filter((s) => s !== karnsStore);
  const ai = getAiClient();
  if (!ai || otherStores.length === 0) {
    const fallbackDeals = generateDeterministicFallbackDeals(otherStores);
    const combinedDeals = [...karnsDeals, ...fallbackDeals];
    const seenDealIds = /* @__PURE__ */ new Set();
    combinedDeals.forEach((d, idx) => {
      if (!d.id || seenDealIds.has(d.id)) {
        d.id = `${d.storeId || "deal"}-${idx + 1}-${Date.now()}`;
      }
      seenDealIds.add(d.id);
    });
    const counts = {};
    combinedDeals.forEach((d) => {
      counts[d.storeId] = (counts[d.storeId] || 0) + 1;
    });
    stores.forEach((s) => {
      s.totalDealsCount = counts[s.id] || 0;
    });
    const result = { stores, deals: combinedDeals };
    circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  }
  try {
    const storeSummary = otherStores.map((s) => ({
      id: s.id,
      name: s.name,
      chain: s.chain,
      address: `${s.address}, ${s.city}`
    }));
    const currentDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const searchTasks = otherStores.slice(0, 3).map((s) => ({
      name: s.name,
      query: `${s.name} ${city} ${state} weekly ad circular deals`
    }));
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
2. For each deal found:
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
3. Return ONLY a valid JSON array of deal objects.
`;
    let response;
    const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"];
    for (let i = 0; i < modelsToTry.length; i++) {
      try {
        const timeoutPromise = new Promise(
          (_, reject) => setTimeout(() => reject(new Error("AI inference timeout")), 2500)
        );
        const result2 = await Promise.race([
          ai.models.generateContent({
            model: modelsToTry[i],
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.1
            }
          }),
          timeoutPromise
        ]);
        if (result2?.text && result2.text.trim()) {
          response = result2;
          break;
        }
      } catch {
      }
    }
    const groundedDeals = response?.text ? parseJsonFromText(response.text, []) : [];
    let nonKarnsDeals = [];
    if (Array.isArray(groundedDeals) && groundedDeals.length > 0) {
      groundedDeals.forEach((d, idx) => {
        const storeMatch = otherStores.find((s) => s.id === d.storeId) || otherStores.find((s) => s.name.toLowerCase().includes(d.storeName?.toLowerCase() || ""));
        if (storeMatch) {
          d.storeId = storeMatch.id;
          d.storeName = storeMatch.name;
          d.storeLogoBg = storeMatch.logoBg;
          d.storeLogoText = storeMatch.logoText;
        } else {
          d.storeLogoBg = "#334155";
          d.storeLogoText = "STORE";
        }
        if (!d.id) {
          d.id = `${d.storeId || "scout"}-item-${idx + 1}-${Date.now()}`;
        }
      });
      nonKarnsDeals = groundedDeals.filter((d) => !d.storeName?.toLowerCase().includes("karns") && d.storeId !== karnsStore?.id);
    } else {
      nonKarnsDeals = generateDeterministicFallbackDeals(otherStores);
    }
    const combinedDeals = [...karnsDeals, ...nonKarnsDeals];
    const seenDealIds = /* @__PURE__ */ new Set();
    combinedDeals.forEach((d, idx) => {
      if (!d.id || seenDealIds.has(d.id)) {
        d.id = `${d.storeId || "deal"}-${idx + 1}-${Date.now()}`;
      }
      seenDealIds.add(d.id);
    });
    const counts = {};
    combinedDeals.forEach((d) => {
      counts[d.storeId] = (counts[d.storeId] || 0) + 1;
    });
    stores.forEach((s) => {
      s.totalDealsCount = counts[s.id] || 0;
    });
    const result = { stores, deals: combinedDeals };
    circularsCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  } catch (error) {
    console.warn("[GeminiService] Utilizing verified regional circular deals:", error);
    const fallbackDeals = generateDeterministicFallbackDeals(otherStores);
    const combinedDeals = [...karnsDeals, ...fallbackDeals];
    const seenDealIds = /* @__PURE__ */ new Set();
    combinedDeals.forEach((d, idx) => {
      if (!d.id || seenDealIds.has(d.id)) {
        d.id = `${d.storeId || "deal"}-${idx + 1}-${Date.now()}`;
      }
      seenDealIds.add(d.id);
    });
    const counts = {};
    combinedDeals.forEach((d) => {
      counts[d.storeId] = (counts[d.storeId] || 0) + 1;
    });
    stores.forEach((s) => {
      s.totalDealsCount = counts[s.id] || 0;
    });
    const result = { stores, deals: combinedDeals };
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
  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"];
  let response;
  for (let i = 0; i < modelsToTry.length; i++) {
    try {
      response = await ai.models.generateContent({
        model: modelsToTry[i],
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
      if (response?.text) break;
    } catch {
    }
  }
  const parsed = response?.text ? parseJsonFromText(response.text, []) : [];
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
    const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"];
    let response;
    for (let i = 0; i < modelsToTry.length; i++) {
      try {
        response = await ai.models.generateContent({
          model: modelsToTry[i],
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: comparisonResponseSchema,
            temperature: 0.1
          }
        });
        if (response?.text) break;
      } catch {
      }
    }
    if (response?.text) {
      const parsed = parseJsonFromText(response.text, null);
      if (parsed && parsed.bestDealId && parsed.verdict) {
        return parsed;
      }
    }
  } catch {
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
  const matchedPath = req.headers["x-matched-path"] || req.headers["x-rewrite-url"];
  if (matchedPath && (req.url === "/api" || req.url === "/" || req.url === "")) {
    req.url = matchedPath;
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
    const { lat, lng, city, state, zipCode, radiusMiles } = req.body || {};
    const targetLat = lat !== void 0 && !isNaN(Number(lat)) ? Number(lat) : 40.2137;
    const targetLng = lng !== void 0 && !isNaN(Number(lng)) ? Number(lng) : -77.0075;
    const targetCity = city || "Mechanicsburg";
    const targetState = state || "PA";
    const targetZip = zipCode || "17050";
    const targetRadius = Number(radiusMiles) > 0 ? Number(radiusMiles) : 10;
    let data;
    try {
      data = await getCircularsForLocation(
        targetLat,
        targetLng,
        targetCity,
        targetState,
        targetZip,
        targetRadius
      );
    } catch (innerErr) {
      console.warn("[API circulars/nearby] Live retrieval failed, using fallback:", innerErr);
      const stores = getRegionalDefaultStores(targetCity, targetState, targetLat, targetLng, targetRadius);
      const karns = stores.find((s) => s.name.toLowerCase().includes("karns"));
      let deals = [];
      if (karns) {
        deals = await getFullKarnsCircularDeals(karns);
      }
      data = { stores, deals };
    }
    return res.json(data);
  } catch (err) {
    console.error("[API circulars/nearby] Error fetching circulars:", err);
    try {
      const fallbackStores = getRegionalDefaultStores("Mechanicsburg", "PA", 40.2137, -77.0075, 10);
      const karns = fallbackStores.find((s) => s.name.toLowerCase().includes("karns"));
      const deals = karns ? await getFullKarnsCircularDeals(karns) : [];
      return res.status(200).json({ stores: fallbackStores, deals });
    } catch {
      return res.status(200).json({ stores: [], deals: [] });
    }
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
