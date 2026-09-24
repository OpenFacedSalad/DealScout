export const runtime = 'edge';

import { geocodeQuery, reverseGeocodeCoords, getRegionalDefaultStores } from './_lib/storeFinder.js';
import { getCircularsForLocation, compareDealsWithAI, parseFlyerWithAI } from './_lib/geminiService.js';
import { getFullKarnsCircularDeals } from './_lib/karnsScraper.js';
import { DealItem } from '../src/types.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  'Content-Type': 'application/json',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}

function errorResponse(message: string, status = 500, details?: any): Response {
  return new Response(JSON.stringify({ error: message, ...(details ? { details } : {}) }), {
    status,
    headers: corsHeaders,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname.endsWith('/health') || pathname === '/api' || pathname === '/') {
    return jsonResponse({
      status: 'ok',
      service: 'DealScout Vercel Edge Gateway (Search Grounding & Multimodal OCR)',
      runtime: 'edge',
      version: '2.6.0',
      pwa: true,
      timestamp: new Date().toISOString(),
    });
  }

  return jsonResponse({ status: 'ok', runtime: 'edge' });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const matchedPath = req.headers.get('x-matched-path') || req.headers.get('x-rewrite-url');
  const pathname = matchedPath || url.pathname;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Route: /api/location/resolve
  if (pathname.includes('/location/resolve')) {
    try {
      const { lat, lng, query } = body;

      if (query && typeof query === 'string' && query.trim().length > 0) {
        const resolved = await geocodeQuery(query.trim());
        return jsonResponse({ ...resolved, isGps: false });
      }

      if (lat !== undefined && lng !== undefined && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
        const resolved = await reverseGeocodeCoords(Number(lat), Number(lng));
        return jsonResponse({
          latitude: Number(lat),
          longitude: Number(lng),
          ...resolved,
          isGps: true,
        });
      }

      return errorResponse('Valid query string or numeric lat/lng required.', 400);
    } catch (err: any) {
      console.error('[Edge API location/resolve] Error:', err);
      return jsonResponse({
        latitude: 40.2137,
        longitude: -77.0075,
        city: 'Mechanicsburg',
        state: 'PA',
        zipCode: '17050',
        formattedAddress: 'Mechanicsburg, PA 17050',
        isGps: false,
      });
    }
  }

  // Route: /api/circulars/nearby
  if (pathname.includes('/circulars/nearby')) {
    try {
      const { lat, lng, city, state, zipCode, radiusMiles } = body || {};

      const targetLat = lat !== undefined && !isNaN(Number(lat)) ? Number(lat) : 40.2137;
      const targetLng = lng !== undefined && !isNaN(Number(lng)) ? Number(lng) : -77.0075;
      const targetCity = city || 'Mechanicsburg';
      const targetState = state || 'PA';
      const targetZip = zipCode || '17050';
      const targetRadius = Number(radiusMiles) > 0 ? Number(radiusMiles) : 10;

      const data = await getCircularsForLocation(
        targetLat,
        targetLng,
        targetCity,
        targetState,
        targetZip,
        targetRadius
      );

      return jsonResponse(data);
    } catch (err: any) {
      console.error('[Edge API /circulars/nearby Error]:', err);
      return errorResponse(err?.message || 'Failed to fetch circulars', 500);
    }
  }

  // Route: /api/circulars/parse-flyer
  if (pathname.includes('/circulars/parse-flyer')) {
    try {
      const { fileBase64, mimeType, storeId, storeName, logoBg, logoText } = body;

      if (!fileBase64 || !mimeType) {
        return errorResponse('fileBase64 and valid mimeType are required.', 400);
      }

      const cleanBase64 = fileBase64.replace(/^data:.*?;base64,/, '');

      const parsedDeals = await parseFlyerWithAI(
        cleanBase64,
        mimeType,
        {
          id: storeId || 'custom-store',
          name: storeName || 'Local Grocer',
          logoBg: logoBg || '#059669',
          logoText: logoText || 'FLYER',
        }
      );

      return jsonResponse({ deals: parsedDeals, count: parsedDeals.length });
    } catch (err: any) {
      console.error('[Edge API parse-flyer] Error:', err);
      return errorResponse(err?.message || 'Failed to parse flyer.', 500);
    }
  }

  // Route: /api/compare/deals
  if (pathname.includes('/compare/deals')) {
    try {
      const { productGroupName, deals } = body;
      if (!productGroupName || !Array.isArray(deals) || deals.length === 0) {
        return errorResponse('Valid productGroupName and non-empty deals array required.', 400);
      }

      const comparison = await compareDealsWithAI(productGroupName, deals);
      return jsonResponse(comparison);
    } catch (err: any) {
      console.error('[Edge API compare/deals] Error:', err);
      return errorResponse(err?.message || 'Comparison failed', 500);
    }
  }

  // Route: /api/cart/sync
  if (pathname.includes('/cart/sync')) {
    const { action, payload, timestamp } = body;
    console.log(`[Edge Sync] Replaying ${action} mutation:`, payload, timestamp);
    return jsonResponse({ status: 'applied', action });
  }

  return errorResponse(`Route not found: ${pathname}`, 404);
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return OPTIONS();
  }
  if (req.method === 'GET') {
    return GET(req);
  }
  if (req.method === 'POST') {
    return POST(req);
  }
  return errorResponse(`Method ${req.method} not allowed`, 405);
}
