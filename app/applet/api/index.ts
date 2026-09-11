import express, { Request, Response } from 'express';
import { geocodeQuery, reverseGeocodeCoords } from './_lib/storeFinder.js';
import { getCircularsForLocation, compareDealsWithAI, parseFlyerWithAI } from './_lib/geminiService.js';
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  broadcastPushNotification,
  getPresetNotificationPayload,
  getSubscribersCount,
} from './_lib/pushService.js';

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'DealScout Vercel Gateway (5-Store Circulars & Push API)',
    version: '2.4.0',
    pwa: true,
    subscribers: getSubscribersCount(),
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/location/resolve', async (req: Request, res: Response) => {
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
    return res.status(500).json({ error: err.message || 'Location resolution failed' });
  }
});

app.post('/api/circulars/nearby', async (req: Request, res: Response) => {
  try {
    const { lat, lng, city, state, zipCode, radiusMiles } = req.body;

    if (lat === undefined || lng === undefined || isNaN(Number(lat)) || isNaN(Number(lng))) {
      return res.status(400).json({ error: 'Numeric lat and lng coordinates required.' });
    }

    const data = await getCircularsForLocation(
      Number(lat),
      Number(lng),
      city || 'Mechanicsburg',
      state || 'PA',
      zipCode || '17050',
      Number(radiusMiles) || 10
    );

    return res.json(data);
  } catch (err: any) {
    console.error('[API /circulars/nearby Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch circulars' });
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
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to parse flyer.' });
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
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Comparison failed' });
  }
});

// -----------------------------------------------------------------------------
// WEB PUSH SUBSCRIPTION & AD-HOC TEST DISPATCH
// -----------------------------------------------------------------------------
app.get('/api/push/public-key', (_req: Request, res: Response) => {
  res.json({ publicKey: getVapidPublicKey() });
});

app.post('/api/push/subscribe', (req: Request, res: Response) => {
  const { subscription, zipCode } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Invalid PushSubscription object provided.' });
  }

  saveSubscription({
    ...subscription,
    zipCode,
    createdAt: new Date().toISOString(),
  });

  return res.json({ status: 'subscribed', totalSubscribers: getSubscribersCount() });
});

app.post('/api/push/unsubscribe', (req: Request, res: Response) => {
  const { endpoint } = req.body;
  if (endpoint) {
    removeSubscription(endpoint);
  }
  return res.json({ status: 'unsubscribed' });
});

app.post('/api/push/trigger', async (req: Request, res: Response) => {
  try {
    const { preset, customPayload } = req.body;
    const payload = preset ? getPresetNotificationPayload(preset) : customPayload;

    if (!payload || !payload.title) {
      return res.status(400).json({ error: 'Valid preset or customPayload with title required.' });
    }

    const result = await broadcastPushNotification(payload);
    return res.json({ status: 'broadcast_complete', ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Push dispatch failed.' });
  }
});

export default app;
