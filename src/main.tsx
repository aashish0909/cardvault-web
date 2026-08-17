// CardVault web - entry point.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyDeepLinkFromKind, applyDeepLinkFromUrl, captureLocationDeepLink } from './lib/deepLink';
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
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Reload when a *new* worker takes over an already-controlled page.
  // Do not reload on the first claim (Safari/Chrome can loop: claim →
  // controllerchange → reload → claim again).
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  // The worker re-subscribed after a pushsubscriptionchange; mirror the new
  // subscription to the relay.
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'push-subscription-changed') {
      void setupPush();
      return;
    }
    if (data.type === 'notification-click') {
      if (typeof data.kind === 'string' && data.kind) applyDeepLinkFromKind(data.kind);
      else if (typeof data.url === 'string') applyDeepLinkFromUrl(data.url);
    }
  });
}

captureLocationDeepLink();
