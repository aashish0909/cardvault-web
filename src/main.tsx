// CardVault web - entry point.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupPush } from './lib/push';
import './styles.css';

const standalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;
if (standalone) document.documentElement.classList.add('is-standalone');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Offline shell / PWA installability / Web Push transport. Guarded per
// feature: not all browsers or deployments support each one.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
  // Reload once a newer service worker takes control, so installed users
  // never sit on a stale shell whose cached assets were just deleted.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
  // The worker re-subscribed after a pushsubscriptionchange; mirror the new
  // subscription to the relay.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'push-subscription-changed') {
      void setupPush();
    }
  });
}
