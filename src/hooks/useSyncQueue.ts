import { useState, useEffect } from 'react';
import { getPendingSyncCount, getPendingItemIds } from '../utils/syncQueue';

export function useSyncQueue() {
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    getPendingSyncCount().then(setPendingCount);
    getPendingItemIds().then((ids) => setPendingItemIds(new Set(ids)));

    const handleQueueChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ count: number; pendingIds?: string[] }>;
      setPendingCount(customEvent.detail?.count ?? 0);
      if (customEvent.detail?.pendingIds) {
        setPendingItemIds(new Set(customEvent.detail.pendingIds));
      }
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('sync-queue-updated', handleQueueChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('sync-queue-updated', handleQueueChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    pendingCount,
    pendingItemIds,
    isOnline,
    hasUnsyncedChanges: pendingCount > 0,
  };
}
