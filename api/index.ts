import express, { Request, Response } from 'express';
import { geocodeQuery, reverseGeocodeCoords } from '../server/storeFinder';
import { getCircularsForLocation, compareDealsWithAI, parseFlyerWithAI } from '../server/geminiService';

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

const router = express.Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'DealScout Vercel Gateway (Search Grounding & Multimodal OCR)',
    version: '2.3.0',
    pwa: true,
    timestamp: new Date().toISOString(),
  });
});

router.post('/location/resolve', async (req: Request, res: Response) => {
  try {
    const { lat, lng, query } = req.body;

    if (query && typeof query === 'string' && query.trim().length > 0) {
      const resolved = await geocodeQuery(query.trim());
      return res.json({ ...resolved, isGps: false });
    }

    if (lat !== undefined && lng !== undefined && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
      const resolved = await reverseGeocodeCoords(Number(lat), Number(lng));
      return res.json({
        latitude: Number(lat),
        longitude: Number(lng),
        ...resolved,
        isGps: true,
      });
    }

    return res.status(400).json({ error: 'Valid query string or numeric lat/lng required.' });
  } catch (err: any) {
    console.error('[API location/resolve] Error:', err);
    return res.status(200).json({
      latitude: 40.2137,
      longitude: -77.0075,
      city: 'Mechanicsburg',
      state: 'PA',
      zipCode: '17050',
      formattedAddress: 'Mechanicsburg, PA 17050',
      isGps: false,
    });
  }
});

router.post('/circulars/nearby', async (req: Request, res: Response) => {
  try {
    const { lat, lng, city, state, zipCode, radiusMiles } = req.body;

    const data = await getCircularsForLocation(
      lat !== undefined && !isNaN(Number(lat)) ? Number(lat) : 40.2137,
      lng !== undefined && !isNaN(Number(lng)) ? Number(lng) : -77.0075,
      city || 'Mechanicsburg',
      state || 'PA',
      zipCode || '17050',
      Number(radiusMiles) || 10
    );

    return res.json(data);
  } catch (err: any) {
    console.error('[API circulars/nearby] Error fetching circulars:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch circulars' });
  }
});

router.post('/circulars/parse-flyer', async (req: Request, res: Response) => {
  try {
    const { fileBase64, mimeType, storeId, storeName, logoBg, logoText } = req.body;

    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: 'fileBase64 and valid mimeType are required.' });
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

    return res.json({ deals: parsedDeals, count: parsedDeals.length });
  } catch (err: any) {
    console.error('[API parse-flyer] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to parse flyer.' });
  }
});

router.post('/compare/deals', async (req: Request, res: Response) => {
  try {
    const { productGroupName, deals } = req.body;
    if (!productGroupName || !Array.isArray(deals) || deals.length === 0) {
      return res.status(400).json({ error: 'Valid productGroupName and non-empty deals array required.' });
    }

    const comparison = await compareDealsWithAI(productGroupName, deals);
    return res.json(comparison);
  } catch (err: any) {
    console.error('[API compare/deals] Error:', err);
    return res.status(500).json({ error: err.message || 'Comparison failed' });
  }
});

router.post('/cart/sync', (req: Request, res: Response) => {
  const { action, payload, timestamp } = req.body;
  console.log(`[Vercel Sync] Replaying ${action} mutation:`, payload, timestamp);
  return res.json({ status: 'applied', action });
});

// Mount on both /api and / to ensure Vercel rewrites match regardless of path prefix
app.use('/api', router);
app.use('/', router);

export default app;
