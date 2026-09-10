const DB_NAME = 'dealscout_sync_db';
const STORE_NAME = 'cart_queue';

interface QueuedItem {
  id?: number;
  action: 'TOGGLE' | 'UPDATE_QTY' | 'REMOVE';
  payload: any;
  timestamp: number;
}

// In-memory fallback if IndexedDB is disabled, blocked, or unavailable in sandboxed iframes
let memoryQueue: QueuedItem[] = [];
let nextMemoryId = 1;

function isIndexedDBAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined' && window.indexedDB !== null;
  } catch {
    return false;
  }
}

function openSyncDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!isIndexedDBAvailable()) {
      return resolve(null);
    }
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        try {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        } catch (e) {
          console.warn('[SyncDB] onupgradeneeded failed:', e);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => {
        console.warn('[SyncDB] open failed, using memory fallback:', e);
        resolve(null);
      };
    } catch (e) {
      console.warn('[SyncDB] indexedDB.open threw exception:', e);
      resolve(null);
    }
  });
}

export async function getPendingSyncCount(): Promise<number> {
  try {
    const db = await openSyncDB();
    if (!db) return memoryQueue.length;

    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      const countReq = store.count();
      countReq.onsuccess = () => resolve((countReq.result || 0) + memoryQueue.length);
      countReq.onerror = () => resolve(memoryQueue.length);
    });
  } catch {
    return memoryQueue.length;
  }
}

export async function getPendingItemIds(): Promise<string[]> {
  try {
    const memIds = memoryQueue
      .map((entry) => {
        if (typeof entry.payload === 'string') return entry.payload;
        return entry.payload?.id || entry.payload?.itemId || null;
      })
      .filter(Boolean) as string[];

    const db = await openSyncDB();
    if (!db) return [...new Set(memIds)];

    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const entries = req.result || [];
        const ids = entries
          .map((entry: any) => {
            if (typeof entry.payload === 'string') return entry.payload;
            return entry.payload?.id || entry.payload?.itemId || null;
          })
          .filter(Boolean) as string[];

        resolve([...new Set([...ids, ...memIds])]);
      };
      req.onerror = () => resolve([...new Set(memIds)]);
    });
  } catch {
    return [];
  }
}

export async function notifyQueueChanged() {
  if (typeof window === 'undefined') return;
  try {
    const count = await getPendingSyncCount();
    const pendingIds = await getPendingItemIds();
    window.dispatchEvent(
      new CustomEvent('sync-queue-updated', {
        detail: { count, pendingIds },
      })
    );
  } catch (err) {
    console.warn('[SyncQueue] notifyQueueChanged error:', err);
  }
}

export async function flushSyncQueue(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.onLine) return;

    // Flush memory queue first
    if (memoryQueue.length > 0) {
      const remaining: QueuedItem[] = [];
      for (const item of memoryQueue) {
        try {
          const response = await fetch('/api/cart/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (!response.ok) {
            remaining.push(item);
          }
        } catch {
          remaining.push(item);
          break;
        }
      }
      memoryQueue = remaining;
    }

    const db = await openSyncDB();
    if (!db) {
      await notifyQueueChanged();
      return;
    }

    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const getItems = new Promise<any[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const items = await getItems;
    if (items.length === 0) {
      await notifyQueueChanged();
      return;
    }

    for (const item of items) {
      try {
        const response = await fetch('/api/cart/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });

        if (response.ok) {
          const deleteTx = db.transaction(STORE_NAME, 'readwrite');
          deleteTx.objectStore(STORE_NAME).delete(item.id);
        }
      } catch (err) {
        console.warn('[Sync Fallback] Connection lost during flush:', err);
        break;
      }
    }

    await notifyQueueChanged();
  } catch (err) {
    console.warn('[Sync Fallback] flushSyncQueue exception:', err);
  }
}

export async function queueCartAction(actionType: 'TOGGLE' | 'UPDATE_QTY' | 'REMOVE', payload: any) {
  try {
    const db = await openSyncDB();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add({
        action: actionType,
        payload,
        timestamp: Date.now(),
      });
    } else {
      memoryQueue.push({
        id: nextMemoryId++,
        action: actionType,
        payload,
        timestamp: Date.now(),
      });
    }

    await notifyQueueChanged();

    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
        try {
          const registration = await navigator.serviceWorker.ready;
          if (registration && (registration as any).sync) {
            await (registration as any).sync.register('sync-cart');
            return;
          }
        } catch (err) {
          console.warn('[Sync] Sync registration fallback:', err);
        }
      }
    } catch (e) {
      console.warn('[Sync] SyncManager access blocked:', e);
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await flushSyncQueue();
    }
  } catch (err) {
    console.warn('[SyncQueue] queueCartAction error:', err);
  }
}

export function initSyncFallbackListeners() {
  try {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      flushSyncQueue().catch(() => {});
    });

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      // Defer slightly to avoid blocking main thread initialization
      setTimeout(() => {
        flushSyncQueue().catch(() => {});
      }, 500);
    }
  } catch (e) {
    console.warn('[SyncQueue] initSyncFallbackListeners error:', e);
  }
}
