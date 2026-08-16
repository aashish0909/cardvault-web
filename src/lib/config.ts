// Runtime configuration. The relay host is baked in at build time via
// VITE_RELAY_URL (e.g. https://relay.example.com). Unset, relay calls go to
// the same origin that served the page - in dev the Vite server proxies /v1/*
// to the local relay, so LAN devices talk HTTPS-only (no mixed content).

/** Git SHA + UTC time from the build that produced this bundle. */
export function getBuildId(): string {
  const fromEnv = (import.meta.env.VITE_BUILD as string | undefined)?.trim();
  return fromEnv || 'dev';
}

export function getRelayUrl(): string {
  const fromEnv = (import.meta.env.VITE_RELAY_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  // Callers append /v1/... themselves. An empty base keeps the production
  // fallback on the same origin instead of producing /v1/v1/....
  return '';
}
