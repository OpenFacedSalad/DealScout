import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import { initSyncFallbackListeners } from './utils/syncQueue';

// Safely clean up and unregister any service workers and caches to prevent white-screen issues
try {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.unregister().then(() => {
          console.log('[PWA] Unregistered service worker:', reg.scope);
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
  }
} catch (e) {
  console.warn('[PWA] Service Worker cleanup non-fatal error:', e);
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
