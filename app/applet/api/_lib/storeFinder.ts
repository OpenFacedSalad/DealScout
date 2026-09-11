import { Store } from './types.js';

export async function findPhysicalGroceryStoresOSM(
  lat: number,
  lng: number,
  radiusMiles: number = 10
): Promise<Store[]> {
  const radiusMeters = Math.min(radiusMiles * 1609.34, 25000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  const overpassQuery = `
    [out:json][timeout:2];
    (
      node["shop"="supermarket"](around:${radiusMeters},${lat},${lng});
      way["shop"="supermarket"](around:${radiusMeters},${lat},${lng});
    );
    out center 15;
  `;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.elements || !Array.isArray(data.elements)) return [];

    return data.elements.map((el: any, idx: number) => {
      const storeName = el.tags?.name || 'Local Grocery';
      const chain = el.tags?.brand || storeName;
      const storeLat = el.lat || el.center?.lat || lat;
      const storeLng = el.lon || el.center?.lon || lng;
      const dist = calculateDistanceMiles(lat, lng, storeLat, storeLng);

      return {
        id: \`osm-\${el.id || idx}\`,
        name: storeName,
        chain,
        address: el.tags?.['addr:street'] ? \`\${el.tags['addr:housenumber'] || ''} \${el.tags['addr:street']}\`.trim() : 'Local Area',
        city: el.tags?.['addr:city'] || '',
        state: el.tags?.['addr:state'] || 'PA',
        zipCode: el.tags?.['addr:postcode'] || '',
        latitude: storeLat,
        longitude: storeLng,
        distanceMiles: Number(dist.toFixed(1)),
        logoBg: getStoreBrandColor(chain),
        logoText: chain.slice(0, 5).toUpperCase(),
        totalDealsCount: 0,
      };
    });
  } catch {
    clearTimeout(timeoutId);
    return [];
  }
}

export function getRegionalDefaultStores(
  city: string,
  state: string,
  lat: number,
  lng: number,
  radiusMiles: number = 10
): Store[] {
  const isHorsham =
    city.toLowerCase().includes('horsham') ||
    city.toLowerCase().includes('hatboro') ||
    city.toLowerCase().includes('ambler') ||
    city.toLowerCase().includes('north wales') ||
    (lat > 40.1 && lat < 40.28 && lng > -75.3 && lng < -75.05);

  if (isHorsham) {
    return [
      {
        id: 'aldi-horsham',
        name: 'ALDI',
        chain: 'ALDI',
        address: '280 N York Rd',
        city: 'Hatboro',
        state: 'PA',
        zipCode: '19040',
        latitude: 40.182,
        longitude: -75.105,
        distanceMiles: 2.1,
        logoBg: '#002B49',
        logoText: 'ALDI',
        totalDealsCount: 0,
      },
      {
        id: 'giant-horsham',
        name: 'Giant Food Stores',
        chain: 'Giant',
        address: '314 Horsham Rd',
        city: 'Horsham',
        state: 'PA',
        zipCode: '19044',
        latitude: 40.177,
        longitude: -75.132,
        distanceMiles: 1.2,
        logoBg: '#DA291C',
        logoText: 'GIANT',
        totalDealsCount: 0,
      },
      {
        id: 'fresh-market-horsham',
        name: 'The Fresh Market',
        chain: 'The Fresh Market',
        address: '1440 Bethlehem Pike',
        city: 'Ambler',
        state: 'PA',
        zipCode: '19002',
        latitude: 40.165,
        longitude: -75.215,
        distanceMiles: 4.8,
        logoBg: '#00543D',
        logoText: 'FRESH',
        totalDealsCount: 0,
      },
      {
        id: 'trader-joes-horsham',
        name: "Trader Joe's",
        chain: "Trader Joe's",
        address: '1460 Bethlehem Pike',
        city: 'North Wales',
        state: 'PA',
        zipCode: '19454',
        latitude: 40.218,
        longitude: -75.228,
        distanceMiles: 5.4,
        logoBg: '#C8102E',
        logoText: "TJ'S",
        totalDealsCount: 0,
      },
    ];
  }

  // Central PA / Mechanicsburg Region
  return [
    {
      id: 'karns-mechanicsburg',
      name: "Karns Quality Foods",
      chain: "Karns",
      address: '4851 Carlisle Pike',
      city: 'Mechanicsburg',
      state: 'PA',
      zipCode: '17050',
      latitude: 40.245,
      longitude: -76.972,
      distanceMiles: 2.4,
      logoBg: '#B91C1C',
      logoText: 'KARNS',
      totalDealsCount: 0,
    },
    {
      id: 'aldi-mechanicsburg',
      name: 'ALDI',
      chain: 'ALDI',
      address: '6444 Carlisle Pike',
      city: 'Mechanicsburg',
      state: 'PA',
      zipCode: '17050',
      latitude: 40.252,
      longitude: -77.012,
      distanceMiles: 1.8,
      logoBg: '#002B49',
      logoText: 'ALDI',
      totalDealsCount: 0,
    },
    {
      id: 'giant-mechanicsburg',
      name: 'Giant Food Stores',
      chain: 'Giant',
      address: '6560 Carlisle Pike',
      city: 'Mechanicsburg',
      state: 'PA',
      zipCode: '17050',
      latitude: 40.254,
      longitude: -77.018,
      distanceMiles: 2.1,
      logoBg: '#DA291C',
      logoText: 'GIANT',
      totalDealsCount: 0,
    },
    {
      id: 'trader-joes-camp-hill',
      name: "Trader Joe's",
      chain: "Trader Joe's",
      address: '3530 Capital City Mall Dr',
      city: 'Camp Hill',
      state: 'PA',
      zipCode: '17011',
      latitude: 40.231,
      longitude: -76.924,
      distanceMiles: 4.6,
      logoBg: '#C8102E',
      logoText: "TJ'S",
      totalDealsCount: 0,
    },
  ];
}

function getStoreBrandColor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('aldi')) return '#002B49';
  if (c.includes('giant')) return '#DA291C';
  if (c.includes('karns')) return '#B91C1C';
  if (c.includes('fresh market')) return '#00543D';
  if (c.includes('trader')) return '#C8102E';
  return '#334155';
}

function calculateDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function geocodeQuery(query: string) {
  const isHorsham = query.includes('19044') || query.toLowerCase().includes('horsham');
  if (isHorsham) {
    return {
      latitude: 40.177,
      longitude: -75.132,
      city: 'Horsham',
      state: 'PA',
      zipCode: '19044',
      formattedAddress: 'Horsham, PA 19044, USA',
    };
  }

  return {
    latitude: 40.2137,
    longitude: -77.0075,
    city: 'Mechanicsburg',
    state: 'PA',
    zipCode: '17050',
    formattedAddress: \`\${query}, USA\`,
  };
}

export async function reverseGeocodeCoords(lat: number, lng: number) {
  const isHorsham = lat > 40.1 && lat < 40.28 && lng > -75.3 && lng < -75.05;
  if (isHorsham) {
    return {
      city: 'Horsham',
      state: 'PA',
      zipCode: '19044',
      formattedAddress: 'Horsham, PA 19044, USA',
    };
  }

  return {
    city: 'Mechanicsburg',
    state: 'PA',
    zipCode: '17050',
    formattedAddress: \`Lat: \${lat.toFixed(3)}, Lng: \${lng.toFixed(3)}\`,
  };
}
