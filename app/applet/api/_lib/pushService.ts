import webpush from 'web-push';
import { PushSubscriptionRecord, PushNotificationPayload } from './types.js';

const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BCmKzJ-0BqUf_1C3uXk1dO8Z-w8Y8y8ZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZ0=';
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@dealscout.app';

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn('[PushService] VAPID details setup warning:', err);
}

const subscriptions: Map<string, PushSubscriptionRecord> = new Map();

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function saveSubscription(sub: PushSubscriptionRecord): void {
  subscriptions.set(sub.endpoint, sub);
  console.log(`[PushService] Saved push subscription (${subscriptions.size} total registered)`);
}

export function removeSubscription(endpoint: string): void {
  subscriptions.delete(endpoint);
}

export function getSubscribersCount(): number {
  return subscriptions.size;
}

export function getPresetNotificationPayload(
  type: 'wednesday_drop' | 'saturday_rush' | 'adhoc_test'
): PushNotificationPayload {
  if (type === 'wednesday_drop') {
    return {
      title: 'New circulars just dropped 🥩',
      body: 'Chicken breast hit $1.99/lb at Giant; 80/20 beef is $3.49/lb at Karns. Tap to view flyers.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      data: { url: '/#circulars' },
      actions: [
        { action: 'view_deals', title: 'View Flyers' },
        { action: 'open_list', title: 'Open List' },
      ],
      tag: 'wednesday-drop',
    };
  }

  if (type === 'saturday_rush') {
    return {
      title: 'Ready for the grocery run? 🛒',
      body: 'Splitting meat at Karns and staples at ALDI saves $18.40 this morning. Tap to view your route.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      data: { url: '/#list' },
      actions: [
        { action: 'open_list', title: 'View Route' },
        { action: 'view_deals', title: 'Compare Deals' },
      ],
      tag: 'saturday-rush',
    };
  }

  // Ad-hoc live device test
  return {
    title: 'DealScout Live PWA Test ⚡',
    body: 'Push notifications are working cleanly on your device! Ready for Wednesday circular drops.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    data: { url: '/#circulars' },
    actions: [
      { action: 'view_deals', title: 'Explore Deals' },
      { action: 'open_list', title: 'Shopping Cart' },
    ],
    tag: `adhoc-test-${Date.now()}`,
  };
}

export async function broadcastPushNotification(
  payload: PushNotificationPayload
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;

  const payloadString = JSON.stringify(payload);

  for (const [endpoint, sub] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        payloadString
      );
      successful++;
    } catch (error: any) {
      failed++;
      console.warn(`[PushService] Push failed for ${endpoint.slice(0, 30)}:`, error?.statusCode);
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        subscriptions.delete(endpoint);
      }
    }
  }

  return { successful, failed };
}
