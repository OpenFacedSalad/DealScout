export const runtime = 'edge';

import { getCircularsForLocation } from '../_lib/geminiService.js';

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

    const data = await getCircularsForLocation(
      targetLat,
      targetLng,
      targetCity,
      targetState,
      targetZip,
      targetRadius
    );

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

