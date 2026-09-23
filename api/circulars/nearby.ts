export const runtime = 'edge';

import { getCircularsForLocation } from '../_lib/geminiService.js';
import { getRegionalDefaultStores } from '../_lib/storeFinder.js';
import { getFullKarnsCircularDeals } from '../_lib/karnsScraper.js';
import { DealItem } from '../../src/types.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  'Content-Type': 'application/json',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { lat, lng, city, state, zipCode, radiusMiles } = body || {};

    const targetLat = lat !== undefined && !isNaN(Number(lat)) ? Number(lat) : 40.2137;
    const targetLng = lng !== undefined && !isNaN(Number(lng)) ? Number(lng) : -77.0075;
    const targetCity = city || 'Mechanicsburg';
    const targetState = state || 'PA';
    const targetZip = zipCode || '17050';
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
    } catch (innerErr: any) {
      console.warn('[Edge API circulars/nearby] Live retrieval failed, using fallback stores:', innerErr);
      const stores = getRegionalDefaultStores(targetCity, targetState, targetLat, targetLng, targetRadius);
      const karns = stores.find((s) => s.name.toLowerCase().includes('karns'));
      let deals: DealItem[] = [];
      if (karns) {
        deals = await getFullKarnsCircularDeals(karns);
      }
      data = { stores, deals };
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err: any) {
    console.error('[Edge API /circulars/nearby Error]:', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Failed to fetch circulars' }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

export default POST;
