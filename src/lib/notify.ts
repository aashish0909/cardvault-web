// In-app notification banner. Background delivery is handled separately by
// the service worker and relay Web Push subscription.

import { createStore, useStore } from './store';

export interface Toast {
  id: number;
  title: string;
  body: string;
}

interface NotifyState {
  toasts: Toast[];
  push: (title: string, body: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useNotifyStore = createStore<NotifyState>({
  toasts: [],
  push: (title, body) => {
    const id = nextId++;
    useNotifyStore.set((s) => ({ toasts: [...s.toasts, { id, title, body }] }));
    setTimeout(() => useNotifyStore.get().dismiss(id), 6000);
  },
  dismiss: (id) => {
    useNotifyStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
});

export function notify(title: string, body: string): void {
  useNotifyStore.get().push(title, body);
}

export function useToasts(): Toast[] {
  return useStore(useNotifyStore).toasts;
}
