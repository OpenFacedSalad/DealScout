import React, { useState } from 'react';

export default function PushNotificationTester() {
  const [status, setStatus] = useState<string>('Ready to test');

  const scheduleTestNotification = async () => {
    if (!('Notification' in window)) {
      setStatus('Notifications not supported in this browser.');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus('Permission denied by user or OS.');
      return;
    }

    setStatus('Scheduled! Background the app now. (Waiting 5s...)');

    setTimeout(async () => {
      try {
        // Requires an active service worker to fire in the background on mobile
        const registration = await navigator.serviceWorker.ready;
        await (registration as any).showNotification('DealScout Alert', {
          body: 'Prego Pasta Sauce is now 2/$7 at Giant!',
          icon: '/icon-192.png',
          badge: '/icon-192.png', // Small monochrome icon for Android status bar
          vibrate: [200, 100, 200, 100, 200],
          tag: 'deal-alert', // Prevents duplicate spam
        });
        setStatus('Notification sent natively.');
      } catch (err: any) {
        setStatus(`Error firing native notification: ${err?.message || 'Unknown error'}`);

        // Fallback for desktop Safari/Chrome if SW isn't ready
        try {
          new Notification('DealScout Alert', {
            body: 'Prego is on sale!',
            icon: '/icon-192.png',
          });
        } catch (fallbackErr) {
          console.warn('[Notification] Fallback error:', fallbackErr);
        }
      }
    }, 5000);
  };

  return (
    <div className="p-4 bg-slate-900 text-slate-300 rounded-xl mt-8">
      <h3 className="font-bold text-white mb-2">Dev Tools</h3>
      <button
        onClick={scheduleTestNotification}
        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white transition w-full"
      >
        Trigger Push Notification (5s Delay)
      </button>
      <p className="text-xs mt-2 text-slate-400">{status}</p>
    </div>
  );
}

export { PushNotificationTester };
