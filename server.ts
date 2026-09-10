import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express, { Request, Response, NextFunction } from 'express';
import { geocodeQuery, reverseGeocodeCoords, getRegionalDefaultStores } from './server/storeFinder';
import { getCircularsForLocation, compareDealsWithAI, parseFlyerWithAI } from './server/geminiService';
import { getFullKarnsCircularDeals } from './server/karnsScraper';
import { DealItem } from './src/types';

// In ESM, import.meta.url is defined. In CJS, __filename and __dirname are defined.
const _filename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '');
const _dirname = typeof __dirname !== 'undefined' ? __dirname : (_filename ? path.dirname(_filename) : process.cwd());

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();

  // 25MB Body limit to accommodate multi-page flyer PDFs and camera photos
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'DealScout API Gateway (Search Grounding & Multimodal OCR)',
      version: '2.2.0',
      pwa: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    });
  });

  app.post('/api/location/resolve', async (req: Request, res: Response) => {
    try {
      const { lat, lng, query } = req.body;

      if (query && typeof query === 'string' && query.trim().length > 0) {
        const resolved = await geocodeQuery(query.trim());
        return res.json({
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          city: resolved.city,
          state: resolved.state,
          zipCode: resolved.zipCode,
          formattedAddress: resolved.formattedAddress,
          isGps: false,
        });
      }

      if (lat !== undefined && lng !== undefined && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
        const latitude = Number(lat);
        const longitude = Number(lng);
        const resolved = await reverseGeocodeCoords(latitude, longitude);
        return res.json({
          latitude,
          longitude,
          city: resolved.city,
          state: resolved.state,
          zipCode: resolved.zipCode,
          formattedAddress: resolved.formattedAddress,
          isGps: true,
        });
      }

      return res.status(400).json({ error: 'Provide either a search query string or lat/lng numeric coordinates.' });
    } catch (error: any) {
      console.error('[API /location/resolve] Error:', error);
      return res.status(500).json({ error: error.message || 'Failed to resolve location' });
    }
  });

  app.post('/api/circulars/nearby', async (req: Request, res: Response) => {
    try {
      const { lat, lng, city, state, zipCode, radiusMiles } = req.body || {};

      const targetLat = lat !== undefined && !isNaN(Number(lat)) ? Number(lat) : 40.2137;
      const targetLng = lng !== undefined && !isNaN(Number(lng)) ? Number(lng) : -77.0075;
      const radius = Number(radiusMiles) > 0 ? Number(radiusMiles) : 10;
      const targetCity = city || 'Mechanicsburg';
      const targetState = state || 'PA';
      const targetZip = zipCode || '17050';

      let data;
      try {
        data = await getCircularsForLocation(
          targetLat,
          targetLng,
          targetCity,
          targetState,
          targetZip,
          radius
        );
      } catch (innerErr: any) {
        console.warn('[API /circulars/nearby] Live retrieval failed, using regional fallback:', innerErr);
        const stores = getRegionalDefaultStores(targetCity, targetState, targetLat, targetLng, radius);
        const karns = stores.find((s) => s.name.toLowerCase().includes('karns'));
        let deals: DealItem[] = [];
        if (karns) {
          deals = await getFullKarnsCircularDeals(karns);
        }
        data = { stores, deals };
      }

      return res.json(data);
    } catch (error: any) {
      console.error('[API /circulars/nearby] Critical error:', error);
      try {
        const fallbackStores = getRegionalDefaultStores('Mechanicsburg', 'PA', 40.2137, -77.0075, 10);
        const karns = fallbackStores.find((s) => s.name.toLowerCase().includes('karns'));
        const deals = karns ? await getFullKarnsCircularDeals(karns) : [];
        return res.status(200).json({ stores: fallbackStores, deals });
      } catch {
        return res.status(200).json({ stores: [], deals: [] });
      }
    }
  });

  app.post('/api/circulars/parse-flyer', async (req: Request, res: Response) => {
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
    } catch (error: any) {
      console.error('[API /circulars/parse-flyer] Error:', error);
      return res.status(500).json({ error: error.message || 'Failed to parse circular flyer.' });
    }
  });

  app.post('/api/compare/deals', async (req: Request, res: Response) => {
    try {
      const { productGroupName, deals } = req.body;

      if (!productGroupName || !Array.isArray(deals) || deals.length === 0) {
        return res.status(400).json({ error: 'Valid productGroupName and non-empty deals array required.' });
      }

      const comparison = await compareDealsWithAI(productGroupName, deals);
      return res.json(comparison);
    } catch (error: any) {
      console.error('[API /compare/deals] Error:', error);
      return res.status(500).json({ error: error.message || 'Failed to generate comparison analysis' });
    }
  });

  app.post('/api/cart/sync', (req: Request, res: Response) => {
    const { action, payload, timestamp } = req.body;
    console.log(`[Local Sync] Replaying ${action} mutation:`, payload, timestamp);
    return res.json({ status: 'applied', action });
  });

  const serveDoc = (fileName: string) => (req: Request, res: Response) => {
    const candidatePaths = [
      path.resolve(process.cwd(), 'public', fileName),
      path.resolve(_dirname, 'public', fileName),
      path.resolve(_dirname, fileName),
      path.resolve(process.cwd(), fileName),
    ];

    for (const filePath of candidatePaths) {
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return fs.createReadStream(filePath).pipe(res);
      }
    }

    res.status(404).type('text/plain').send(`File ${fileName} not found on server.`);
  };

  app.get('/DESIGN_DOCUMENT.txt', serveDoc('DESIGN_DOCUMENT.txt'));
  app.get('/CODE_STRUCTURE.txt', serveDoc('CODE_STRUCTURE.txt'));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));

    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Express Fatal Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DealScout] Server running on http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[DealScout] Failed to initialize server:', err);
  process.exit(1);
});
