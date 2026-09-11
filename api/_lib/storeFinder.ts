import { Store } from '../../src/types';

const NOMINATIM_USER_AGENT = 'DealScout-Grocery-App/2.0 (contact: support@dealscout.local)';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const OVERPASS_BASE_URL = 'https://overpass-api.de/api/interpreter';

const geocodeCache = new Map<string, { lat: number; lng: number; city: string; state: string; zipCode: string; formattedAddress: string }>();

geocodeCache.set('17050', {
  lat: 40.2137,
  lng: -77.0075,
  city: 'Mechanicsburg',
  state: 'PA',
  zipCode: '17050',
  formattedAddress: 'Mechanicsburg, PA 17050, USA',
});
geocodeCache.set('mechanicsburg, pa', {
  lat: 40.2137,
  lng: -77.0075,
  city: 'Mechanicsburg',
  state: 'PA',
  zipCode: '17050',
  formattedAddress: 'Mechanicsburg, PA 17050, USA',
});

export function calculateDistanceInMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_MILES = 3958.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const radLat1 = toRadians(lat1);
  const radLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((EARTH_RADIUS_MILES * c).toFixed(1));
}

export async function geocodeQuery(query: string): Promise<{
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  zipCode: string;
  formattedAddress: string;
}> {
  const normalizedQuery = query.trim().toLowerCase();

  if (geocodeCache.has(normalizedQuery)) {
    const cached = geocodeCache.get(normalizedQuery)!;
    return {
      latitude: cached.lat,
      longitude: cached.lng,
      city: cached.city,
      state: cached.state,
      zipCode: cached.zipCode,
      formattedAddress: cached.formattedAddress,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const url = `${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
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
    const city = addr.city || addr.town || addr.borough || addr.village || addr.suburb || 'Local Area';
    const state = addr.state ? getStateAbbreviation(addr.state) : 'US';
    const zipCode = addr.postcode || (query.match(/\b\d{5}\b/) ? query.match(/\b\d{5}\b/)![0] : '');
    const formattedAddress = result.display_name || `${city}, ${state}`;

    const resolved = {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      city,
      state,
      zipCode,
      formattedAddress,
    };

    geocodeCache.set(normalizedQuery, {
      lat: resolved.latitude,
      lng: resolved.longitude,
      city: resolved.city,
      state: resolved.state,
      zipCode: resolved.zipCode,
      formattedAddress: resolved.formattedAddress,
    });

    return resolved;
  } catch (error) {
    console.warn(`[storeFinder] Geocode failed for "${query}", checking fallback:`, error);
    if (normalizedQuery.includes('17050') || normalizedQuery.includes('mechanicsburg')) {
      const fallback = geocodeCache.get('17050')!;
      return {
        latitude: fallback.lat,
        longitude: fallback.lng,
        city: fallback.city,
        state: fallback.state,
        zipCode: fallback.zipCode,
        formattedAddress: fallback.formattedAddress,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function reverseGeocodeCoords(
  lat: number,
  lng: number
): Promise<{ city: string; state: string; zipCode: string; formattedAddress: string }> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (geocodeCache.has(cacheKey)) {
    const cached = geocodeCache.get(cacheKey)!;
    return {
      city: cached.city,
      state: cached.state,
      zipCode: cached.zipCode,
      formattedAddress: cached.formattedAddress,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const url = `${NOMINATIM_BASE_URL}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Reverse geocode failed with status: ${response.status}`);
    }

    const data = await response.json();
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.borough || addr.village || addr.suburb || 'Local Area';
    const state = addr.state ? getStateAbbreviation(addr.state) : 'US';
    const zipCode = addr.postcode || '';
    const formattedAddress = data.display_name || `${city}, ${state}`;

    const resolved = { city, state, zipCode, formattedAddress };

    geocodeCache.set(cacheKey, {
      lat,
      lng,
      city: resolved.city,
      state: resolved.state,
      zipCode: resolved.zipCode,
      formattedAddress: resolved.formattedAddress,
    });

    return resolved;
  } catch (error) {
    console.warn('[storeFinder] Reverse geocode lookup failed, returning default:', error);
    return {
      city: 'Local Area',
      state: 'PA',
      zipCode: '',
      formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function findPhysicalGroceryStoresOSM(
  lat: number,
  lng: number,
  radiusMiles: number = 10
): Promise<Store[]> {
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Overpass API responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.elements || !Array.isArray(data.elements) || data.elements.length === 0) {
      return [];
    }

    const seenNames = new Set<string>();
    const stores: Store[] = [];

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + 6);
    const validDates = `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${futureDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    for (const el of data.elements) {
      const tags = el.tags || {};
      const rawName = tags.name || tags.brand || tags.operator;
      if (!rawName) continue;

      const storeLat = el.lat || (el.center && el.center.lat);
      const storeLng = el.lon || (el.center && el.center.lon);
      if (!storeLat || !storeLng) continue;

      const distance = calculateDistanceInMiles(lat, lng, storeLat, storeLng);
      if (distance > radiusMiles) continue;

      const brandMeta = getBrandMetadata(rawName);
      const dedupeKey = `${brandMeta.chain.toLowerCase()}-${Math.round(distance)}`;
      if (seenNames.has(dedupeKey)) continue;
      seenNames.add(dedupeKey);

      const street = tags['addr:street'] ? `${tags['addr:housenumber'] || ''} ${tags['addr:street']}`.trim() : 'Local Route';
      const storeCity = tags['addr:city'] || 'Nearby';
      const storeState = tags['addr:state'] || 'PA';
      const storeZip = tags['addr:postcode'] || '';

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
        operatingHours: tags.opening_hours || '7:00 AM - 10:00 PM',
      });
    }

    return stores.sort((a, b) => a.distanceMiles - b.distanceMiles);
  } catch (error) {
    console.warn('[storeFinder] Overpass query failed or timed out:', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function getRegionalDefaultStores(
  city: string,
  state: string,
  userLat: number,
  userLng: number,
  radiusMiles: number = 10
): Store[] {
  const normalizedState = state.trim().toUpperCase();
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(now.getDate() + 6);
  const validDates = `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${futureDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  let candidateTemplates: Array<{
    name: string;
    chain: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    lat: number;
    lng: number;
    hours: string;
  }> = [];

  if (normalizedState === 'PA' || city.toLowerCase().includes('mechanicsburg')) {
    candidateTemplates = [
      {
        name: 'Karns Quality Foods',
        chain: 'Karns Quality Foods',
        address: '4851 Carlisle Pike',
        city: 'Mechanicsburg',
        state: 'PA',
        zip: '17050',
        lat: 40.2396,
        lng: -76.9698,
        hours: '7:00 AM - 9:00 PM',
      },
      {
        name: 'Giant Food Stores',
        chain: 'Giant Food Stores',
        address: '6560 Carlisle Pike',
        city: 'Mechanicsburg',
        state: 'PA',
        zip: '17050',
        lat: 40.2443,
        lng: -77.0189,
        hours: '6:00 AM - 11:00 PM',
      },
      {
        name: 'Weis Markets',
        chain: 'Weis Markets',
        address: '5140 Simpson Ferry Rd',
        city: 'Mechanicsburg',
        state: 'PA',
        zip: '17055',
        lat: 40.2104,
        lng: -76.9856,
        hours: '7:00 AM - 10:00 PM',
      },
      {
        name: 'ALDI',
        chain: 'ALDI',
        address: '6444 Carlisle Pike',
        city: 'Mechanicsburg',
        state: 'PA',
        zip: '17050',
        lat: 40.2435,
        lng: -77.0118,
        hours: '9:00 AM - 8:00 PM',
      },
      {
        name: 'Wegmans',
        chain: 'Wegmans',
        address: '6416 Carlisle Pike',
        city: 'Mechanicsburg',
        state: 'PA',
        zip: '17050',
        lat: 40.2431,
        lng: -77.0094,
        hours: '6:00 AM - Midnight',
      },
      {
        name: 'Trader Joe\'s',
        chain: 'Trader Joe\'s',
        address: '3446 Simpson Ferry Rd',
        city: 'Camp Hill',
        state: 'PA',
        zip: '17011',
        lat: 40.2312,
        lng: -76.9312,
        hours: '8:00 AM - 9:00 PM',
      },
      {
        name: 'Target Grocery',
        chain: 'Target Grocery',
        address: '6416 Carlisle Pike Ste 100',
        city: 'Mechanicsburg',
        state: 'PA',
        zip: '17050',
        lat: 40.2425,
        lng: -77.0088,
        hours: '8:00 AM - 10:00 PM',
      },
    ];
  } else if (normalizedState === 'TX') {
    candidateTemplates = [
      {
        name: 'H-E-B',
        chain: 'H-E-B',
        address: 'Central Market Blvd',
        city: city || 'Austin',
        state: 'TX',
        zip: '78701',
        lat: userLat + 0.02,
        lng: userLng + 0.02,
        hours: '6:00 AM - 11:00 PM',
      },
      {
        name: 'ALDI',
        chain: 'ALDI',
        address: 'Commerce Way',
        city: city || 'Austin',
        state: 'TX',
        zip: '78701',
        lat: userLat - 0.015,
        lng: userLng - 0.018,
        hours: '9:00 AM - 8:00 PM',
      },
      {
        name: 'Kroger',
        chain: 'Kroger',
        address: 'Main Street',
        city: city || 'Dallas',
        state: 'TX',
        zip: '75001',
        lat: userLat + 0.03,
        lng: userLng - 0.02,
        hours: '6:00 AM - 10:00 PM',
      },
    ];
  } else if (normalizedState === 'FL') {
    candidateTemplates = [
      {
        name: 'Publix Super Market',
        chain: 'Publix',
        address: 'Coastal Highway',
        city: city || 'Orlando',
        state: 'FL',
        zip: '32801',
        lat: userLat + 0.018,
        lng: userLng + 0.012,
        hours: '7:00 AM - 10:00 PM',
      },
      {
        name: 'Winn-Dixie',
        chain: 'Winn-Dixie',
        address: 'Biscayne Blvd',
        city: city || 'Miami',
        state: 'FL',
        zip: '33101',
        lat: userLat - 0.02,
        lng: userLng + 0.015,
        hours: '7:00 AM - 10:00 PM',
      },
      {
        name: 'ALDI',
        chain: 'ALDI',
        address: 'Federal Highway',
        city: city || 'Tampa',
        state: 'FL',
        zip: '33601',
        lat: userLat + 0.01,
        lng: userLng - 0.01,
        hours: '9:00 AM - 8:00 PM',
      },
    ];
  } else {
    candidateTemplates = [
      {
        name: 'ALDI',
        chain: 'ALDI',
        address: '100 Market St',
        city,
        state,
        zip: '',
        lat: userLat + 0.015,
        lng: userLng + 0.012,
        hours: '9:00 AM - 8:00 PM',
      },
      {
        name: 'Kroger Supermarket',
        chain: 'Kroger',
        address: '250 Grand Ave',
        city,
        state,
        zip: '',
        lat: userLat - 0.02,
        lng: userLng + 0.015,
        hours: '6:00 AM - 11:00 PM',
      },
      {
        name: 'Trader Joe\'s',
        chain: 'Trader Joe\'s',
        address: '400 Plaza Blvd',
        city,
        state,
        zip: '',
        lat: userLat + 0.025,
        lng: userLng - 0.02,
        hours: '8:00 AM - 9:00 PM',
      },
      {
        name: 'Target Grocery',
        chain: 'Target Grocery',
        address: '500 Center Way',
        city,
        state,
        zip: '',
        lat: userLat - 0.012,
        lng: userLng - 0.018,
        hours: '8:00 AM - 10:00 PM',
      },
    ];
  }

  const stores: Store[] = [];

  for (let i = 0; i < candidateTemplates.length; i++) {
    const t = candidateTemplates[i];
    const distance = calculateDistanceInMiles(userLat, userLng, t.lat, t.lng);

    if (distance <= radiusMiles) {
      const meta = getBrandMetadata(t.name);
      stores.push({
        id: `reg-${i}-${t.chain.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
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
        operatingHours: t.hours,
      });
    }
  }

  return stores.sort((a, b) => a.distanceMiles - b.distanceMiles);
}

function getBrandMetadata(name: string): {
  chain: string;
  logoColor: string;
  logoBg: string;
  logoText: string;
  featuredCategory: string;
} {
  const lower = name.toLowerCase();

  if (lower.includes('karns')) {
    return {
      chain: 'Karns Quality Foods',
      logoColor: '#FFFFFF',
      logoBg: '#B91C1C',
      logoText: 'KARNS',
      featuredCategory: 'Butcher Shop & Fresh Meats',
    };
  }
  if (lower.includes('giant')) {
    return {
      chain: 'Giant Food Stores',
      logoColor: '#FFFFFF',
      logoBg: '#EA580C',
      logoText: 'GIANT',
      featuredCategory: 'Choice Rewards & Fresh Produce',
    };
  }
  if (lower.includes('weis')) {
    return {
      chain: 'Weis Markets',
      logoColor: '#FFFFFF',
      logoBg: '#1D4ED8',
      logoText: 'WEIS',
      featuredCategory: 'Pantry Deals & Digital Coupons',
    };
  }
  if (lower.includes('aldi')) {
    return {
      chain: 'ALDI',
      logoColor: '#FFFFFF',
      logoBg: '#0F172A',
      logoText: 'ALDI',
      featuredCategory: 'Super 6 Produce & Everyday Low Price',
    };
  }
  if (lower.includes('wegmans')) {
    return {
      chain: 'Wegmans',
      logoColor: '#FFFFFF',
      logoBg: '#1E3A8A',
      logoText: 'WEGMANS',
      featuredCategory: 'Bakery, Prepared Foods & Organic',
    };
  }
  if (lower.includes('trader joe')) {
    return {
      chain: 'Trader Joe\'s',
      logoColor: '#FFFFFF',
      logoBg: '#991B1B',
      logoText: "TJ'S",
      featuredCategory: 'Specialty Snacks & Frozen Finds',
    };
  }
  if (lower.includes('target')) {
    return {
      chain: 'Target Grocery',
      logoColor: '#FFFFFF',
      logoBg: '#DC2626',
      logoText: 'TARGET',
      featuredCategory: 'Pantry & Household Essentials',
    };
  }
  if (lower.includes('publix')) {
    return {
      chain: 'Publix',
      logoColor: '#FFFFFF',
      logoBg: '#047857',
      logoText: 'PUBLIX',
      featuredCategory: 'Pub Sub Deli & BOGO Deals',
    };
  }
  if (lower.includes('h-e-b') || lower.includes('heb')) {
    return {
      chain: 'H-E-B',
      logoColor: '#FFFFFF',
      logoBg: '#DC2626',
      logoText: 'H-E-B',
      featuredCategory: 'Texas Fresh & Meal Simple',
    };
  }
  if (lower.includes('kroger')) {
    return {
      chain: 'Kroger',
      logoColor: '#FFFFFF',
      logoBg: '#2563EB',
      logoText: 'KROGER',
      featuredCategory: 'Fresh For Everyone & Weekly Specials',
    };
  }

  const shortText = name.substring(0, 4).toUpperCase();
  return {
    chain: name,
    logoColor: '#FFFFFF',
    logoBg: '#475569',
    logoText: shortText,
    featuredCategory: 'Weekly Specials & Fresh Grocery',
  };
}

function getStateAbbreviation(stateName: string): string {
  const map: Record<string, string> = {
    pennsylvania: 'PA',
    texas: 'TX',
    florida: 'FL',
    california: 'CA',
    'new york': 'NY',
    ohio: 'OH',
    virginia: 'VA',
    maryland: 'MD',
    'new jersey': 'NJ',
    illinois: 'IL',
    georgia: 'GA',
    'north carolina': 'NC',
  };
  return map[stateName.toLowerCase()] || stateName.substring(0, 2).toUpperCase();
}
