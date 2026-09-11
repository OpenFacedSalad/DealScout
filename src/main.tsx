import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary';
import { initSyncFallbackListeners } from './utils/syncQueue';

// Register service worker
try {
  if ('serviceWorker' in navigator && (import.meta.env.PROD || window.location.protocol === 'https:')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('[PWA] Service worker registered:', reg.scope);
      }).catch((e) => {
        console.warn('[PWA] Service worker registration failed:', e);
      });
    });
  }
} catch (e) {
  console.warn('[PWA] Service Worker registration non-fatal error:', e);
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
