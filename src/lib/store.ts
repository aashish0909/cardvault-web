// Minimal external-store helper (zustand-style) for React 19. Keeps the
// dependency surface as small as possible: this is all the app needs.

import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get: () => T;
  set: (fn: (state: T) => Partial<T>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (fn) => {
      state = { ...state, ...fn(state) };
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
