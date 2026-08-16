// Vite config + strict Content-Security-Policy injection.
//
// The CSP is the web app's most important security control: it is the
// backstop against XSS, so the production bundle gets a nonce-based policy
// with no 'unsafe-inline'/'unsafe-eval' for scripts, no remote sources, and
// connect-src locked to the relay origin. Dev mode is intentionally looser
// (Vite's HMR preamble needs it) - the strict policy applies to `vite build`.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { devCert } from './scripts/dev-cert.mjs';

const RELAY_ORIGIN = process.env.VITE_RELAY_URL ?? '';
const relayHost = (() => {
  try {
    return new URL(RELAY_ORIGIN).origin;
  } catch {
    return '';
  }
})();

// The dev cert's SAN must include the LAN IP as an iPAddress entry or
// browsers on other devices hard-refuse the TLS handshake - see
// scripts/dev-cert.mjs.

function nonce(attrs: string): string {
  return attrs.includes('nonce') ? attrs : `nonce="${randomBytes(16).toString('base64')}" ${attrs}`;
}

function cspPlugin(): Plugin {
  return {
    name: 'cardvault-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) {
          // Dev only: Vite's HMR preamble is an inline module script, and a
          // nonce in the policy disables 'unsafe-inline' entirely, so dev
          // must use 'unsafe-inline'. The strict nonce policy applies to
          // `vite build`.
          const devCsp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            // Dev only: the app must reach the relay from any LAN device
            // (http://<lan-ip>:8787). Production locks connect-src to the
            // single relay origin in the nonce policy below.
            "connect-src 'self' http://*:* ws://*:*",
            "manifest-src 'self'",
            "worker-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'self'",
            "font-src 'self'",
          ].join('; ');
          return html.replace(
            '<head>',
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="${devCsp}" />`
          );
        }
        const nonceValue = randomBytes(16).toString('base64');
        const connectSrc = relayHost ? `'self' ${relayHost}` : "'self'";
        const csp = [
          "default-src 'self'",
          `script-src 'self' 'nonce-${nonceValue}'`,
          "style-src 'self'",
          "img-src 'self' data:",
          `connect-src ${connectSrc}`,
          "manifest-src 'self'",
          "worker-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "font-src 'self'",
          'upgrade-insecure-requests',
        ].join('; ');
        const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
        const withNonce = html.replace(/<script([^>]*)>/g, (_, attrs: string) =>
          `<script ${nonce(attrs.trim())}>`
        );
        return withNonce.replace('<head>', `<head>\n    ${meta}`);
      },
    },
  };
}

// Inject the hashed build asset URLs into dist/sw.js (replaces the
// __PRECACHE_ASSETS__ marker in public/sw.js) so the service worker precaches
// the whole app shell at install. Without this the installed PWA has no
// offline fallback for JS/CSS and shows a black screen when the network is
// missing (iOS home-screen apps in particular).
function precachePlugin(): Plugin {
  return {
    name: 'cardvault-precache',
    apply: 'build',
    closeBundle() {
      const outDir = resolve('dist');
      const swPath = resolve(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const assetsDir = resolve(outDir, 'assets');
      const assets = existsSync(assetsDir)
        ? readdirSync(assetsDir).map((f) => `/assets/${f}`)
        : [];
      const precache = [
        '/manifest.webmanifest',
        '/icons/apple-touch-icon.png',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/icons/icon-maskable-512.png',
        ...assets,
      ];
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes('__PRECACHE_ASSETS__')) return;
      writeFileSync(swPath, sw.replaceAll('__PRECACHE_ASSETS__', JSON.stringify(precache)));
    },
  };
}

// The dev cert's SAN must include the LAN IP as an iPAddress entry or
// browsers on other devices hard-refuse the TLS handshake (no "proceed
// anyway" for a cert that doesn't cover the hostname). basicSsl can't emit
// IP SANs, so we generate our own with openssl - see scripts/dev-cert.mjs.
const { key, cert } = devCert();

export default defineConfig({
  plugins: [react(), cspPlugin(), precachePlugin()],
  server: {
    host: true,
    port: 5173,
    https: { key: readFileSync(key), cert: readFileSync(cert) },
    // Dev: relay calls are same-origin (/v1/*) so LAN devices work over
    // HTTPS only; proxy them to the local relay.
    proxy: {
      '/v1': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    cssMinify: true,
  },
});
