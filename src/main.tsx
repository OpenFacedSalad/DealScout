import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import { initSyncFallbackListeners } from './utils/syncQueue';

// Safely register Service Worker ONLY in production builds, and unregister in dev mode to prevent Vite HMR interception
try {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    if (import.meta.env.DEV) {
      // In development mode, actively unregister any stale service workers and clear cache
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          reg.unregister().then(() => {
            console.log('[PWA] Unregistered stale dev service worker:', reg.scope);
          });
        }
      }).catch(() => {});
      if ('caches' in window) {
        caches.keys().then((keys) => {
          for (const key of keys) {
            caches.delete(key);
          }
        }).catch(() => {});
      }
    } else if (import.meta.env.PROD) {
      // Register Service Worker only on production
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => console.log('[PWA] Service Worker registered:', reg.scope))
          .catch((err) => console.warn('[PWA] Service Worker registration skipped:', err));
      });
    }
  }
} catch (e) {
  console.warn('[PWA] Service Worker access denied or failed:', e);
}

// Initialize sync listeners safely in background
try {
  initSyncFallbackListeners();
} catch (e) {
  console.warn('[Sync] Fallback listener initialization non-fatal error:', e);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element with id "root". Ensure index.html contains <div id="root"></div>.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
