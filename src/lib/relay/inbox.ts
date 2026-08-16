// Inbox event bus: bumped every time a blob is successfully handled, so
// screens can refresh live instead of only on focus.

import { createStore } from '../store';

export const useInboxStore = createStore({ eventId: 0 });

export function notifyInboxEvent(): void {
  useInboxStore.set((s) => ({ eventId: s.eventId + 1 }));
}
