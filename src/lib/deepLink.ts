// Navigation intent from a push notification (or a ?tab=&intent= URL).
// Survives vault unlock via sessionStorage: iOS opens the PWA locked, then
// Main reads the pending tab after the user authenticates.
//
// Push payloads are metadata-only (kind). They do not carry a request id,
// so an otp-request tap means "Requests, OTP intent" — the Requests tab
// opens a modal only when exactly one pending inbound OTP exists.

import { createStore, useStore, type Store } from './store';

export type TabId = 'vault' | 'shared' | 'friends' | 'requests' | 'profile';
export type OpenIntent = 'otp' | 'details';

export interface DeepLink {
  tab: TabId;
  intent: OpenIntent | null;
}

const STORAGE_KEY = 'cv-open';
const TABS = new Set<TabId>(['vault', 'shared', 'friends', 'requests', 'profile']);

const TAB_FOR_KIND: Record<string, DeepLink> = {
  'otp-request': { tab: 'requests', intent: 'otp' },
  'details-request': { tab: 'requests', intent: 'details' },
  'otp-approve': { tab: 'requests', intent: null },
  'otp-deny': { tab: 'requests', intent: null },
  'details-approve': { tab: 'requests', intent: null },
  'details-deny': { tab: 'requests', intent: null },
  'request-cancel': { tab: 'requests', intent: null },
  'request-revoke': { tab: 'requests', intent: null },
  'pair-request': { tab: 'friends', intent: null },
  'pair-accept': { tab: 'friends', intent: null },
  'card-share': { tab: 'shared', intent: null },
  'card-unshare': { tab: 'shared', intent: null },
};

interface DeepLinkState {
  link: DeepLink | null;
  setLink: (link: DeepLink) => void;
  consume: () => DeepLink | null;
}

export const useDeepLinkStore: Store<DeepLinkState> = createStore<DeepLinkState>({
  link: readStored(),
  setLink: (link) => {
    writeStored(link);
    useDeepLinkStore.set(() => ({ link }));
  },
  consume: () => {
    const current = useDeepLinkStore.get().link;
    writeStored(null);
    useDeepLinkStore.set(() => ({ link: null }));
    return current;
  },
});

export function useDeepLink(): DeepLink | null {
  return useStore(useDeepLinkStore).link;
}

export function applyDeepLink(link: DeepLink): void {
  useDeepLinkStore.get().setLink(link);
}

export function applyDeepLinkFromKind(kind: string): void {
  const link = TAB_FOR_KIND[kind];
  if (link) applyDeepLink(link);
}

export function applyDeepLinkFromUrl(url: string): void {
  try {
    const parsed = new URL(url, window.location.origin);
    const tab = parseTab(parsed.searchParams.get('tab'));
    if (!tab) {
      const kind = parsed.searchParams.get('kind');
      if (kind) applyDeepLinkFromKind(kind);
      return;
    }
    const intentRaw = parsed.searchParams.get('intent');
    const intent: OpenIntent | null =
      intentRaw === 'otp' || intentRaw === 'details' ? intentRaw : null;
    applyDeepLink({ tab, intent });
  } catch {
    // ignore malformed
  }
}

export function captureLocationDeepLink(): void {
  if (typeof window === 'undefined') return;
  applyDeepLinkFromUrl(window.location.href);
  const params = new URLSearchParams(window.location.search);
  if (params.has('tab') || params.has('kind') || params.has('intent')) {
    window.history.replaceState({}, '', window.location.pathname || '/');
  }
}

function parseTab(value: string | null): TabId | null {
  if (value && TABS.has(value as TabId)) return value as TabId;
  return null;
}

function readStored(): DeepLink | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tab?: unknown; intent?: unknown };
    const tab = parseTab(typeof parsed.tab === 'string' ? parsed.tab : null);
    if (!tab) return null;
    const intent: OpenIntent | null =
      parsed.intent === 'otp' || parsed.intent === 'details' ? parsed.intent : null;
    return { tab, intent };
  } catch {
    return null;
  }
}

function writeStored(link: DeepLink | null): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (!link) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(link));
  } catch {
    // private mode / quota
  }
}
