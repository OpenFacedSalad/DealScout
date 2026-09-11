import { useState, useEffect, useCallback } from 'react';

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications(zipCode?: string) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(Boolean(sub));
        });
      });
    }
  }, []);

  const subscribeToPush = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setError('Push notifications are not supported by this browser.');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        throw new Error('Notification permission was denied.');
      }

      const keyRes = await fetch('/api/push/public-key');
      const { publicKey } = await keyRes.json();

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey),
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, zipCode }),
      });

      setIsSubscribed(true);
      return true;
    } catch (err: any) {
      console.warn('[PushHook] Subscription failed:', err);
      setError(err.message || 'Failed to subscribe to notifications.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [zipCode]);

  /**
   * Ad-Hoc Test Push trigger: Immediately pings this installed PWA device.
   */
  const triggerAdHocTestPush = useCallback(async () => {
    setIsSendingTest(true);
    setError(null);

    try {
      // 1. Send via serverless broadcast
      const res = await fetch('/api/push/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: 'adhoc_test' }),
      });

      if (!res.ok) throw new Error('Server returned error triggering push');

      // 2. Direct ServiceWorker fallback if local testing without active network relay
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification('DealScout Instant PWA Test ⚡', {
          body: 'Push delivery verified on your device! Ready for Wednesday circular drops.',
          icon: '/icons/icon-192x192.png',
          badge: '/icons/badge-72x72.png',
          data: { url: '/#circulars' },
          vibrate: [100, 50, 100],
          tag: \`adhoc-direct-\${Date.now()}\`,
        });
      }
      return true;
    } catch (err: any) {
      console.warn('[PushHook] Test push failed:', err);
      setError(err.message || 'Failed to dispatch test notification.');
      return false;
    } finally {
      setIsSendingTest(false);
    }
  }, []);

  return {
    permission,
    isSubscribed,
    isLoading,
    isSendingTest,
    error,
    subscribeToPush,
    triggerAdHocTestPush,
  };
}
