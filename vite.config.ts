// Vite config + strict Content-Security-Policy injection.
//
// Production CSP is the web app's backstop against XSS: no 'unsafe-inline' /
// 'unsafe-eval', no remote script/style, connect-src locked to this origin
// (plus VITE_RELAY_URL when the relay is hosted separately). Dev is looser
// because Vite's HMR preamble is an inline module script.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { devCert } from './scripts/dev-cert.mjs';

function buildStamp(): string {
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // CI / unpacked tarball
  }
  const utc = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return `${sha} · ${utc}`;
}

// Baked into the client so Profile can show whether this PWA is the latest deploy.
process.env.VITE_BUILD = process.env.VITE_BUILD || buildStamp();

const RELAY_ORIGIN = process.env.VITE_RELAY_URL ?? '';
const relayHost = (() => {
  try {
    return new URL(RELAY_ORIGIN).origin;
  } catch {
    return '';
  }
})();

function productionCsp(): string {
  const connectSrc = relayHost ? `'self' ${relayHost}` : "'self'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "font-src 'self'",
    "frame-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function cspPlugin(): Plugin {
  return {
    name: 'cardvault-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) {
          const devCsp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            // LAN devices load over https://<lan-ip>; HMR is wss on the same host.
            "connect-src 'self' http://*:* https://*:* ws://*:* wss://*:*",
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
        const meta = `<meta http-equiv="Content-Security-Policy" content="${productionCsp()}" />`;
        return html.replace('<head>', `<head>\n    ${meta}`);
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
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    https: { key: readFileSync(key), cert: readFileSync(cert) },
    // Dev: relay calls are same-origin (/v1/*) so LAN devices work over
    // HTTPS only; proxy them to the local relay. Timeout must exceed the
    // relay's 25s long-poll.
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        timeout: 35_000,
        proxyTimeout: 35_000,
      },
      '/health': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    cssMinify: true,
  },
});
