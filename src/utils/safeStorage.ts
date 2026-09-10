// Safe LocalStorage wrapper resilient to sandboxed iframes, private browsing, and partitioned storage

const memoryStore: Record<string, string> = {};

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(key);
        return val !== null ? val : (memoryStore[key] ?? null);
      }
    } catch (e) {
      console.warn('[SafeStorage] localStorage.getItem access denied, falling back to memory:', e);
    }
    return memoryStore[key] ?? null;
  },

  setItem(key: string, value: string): void {
    try {
      memoryStore[key] = value;
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn('[SafeStorage] localStorage.setItem access denied, saved to memory only:', e);
    }
  },

  removeItem(key: string): void {
    try {
      delete memoryStore[key];
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) {
      console.warn('[SafeStorage] localStorage.removeItem access denied:', e);
    }
  },
};
