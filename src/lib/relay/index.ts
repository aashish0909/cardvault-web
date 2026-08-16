// Relay client: device registration, E2E blob delivery, and inbox dispatch.
// Ported 1:1 from the native app's lib/relay.ts (zustand -> createStore,
// expo-crypto -> crypto.randomUUID, Platform -> 'web').
//
// All payloads are sealed with lib/e2e.ts before touching the relay - the
// server only ever sees opaque base64.

export { useInboxStore, notifyInboxEvent } from './inbox';
export { type IncomingCtx } from './types';
export { registerDevice, sendBlob, sendBlobToPub } from './client';
export {
  unshareCard,
  sendNameUpdate,
  requestDetails,
  requestOtp,
  approveDetails,
  approveOtp,
  denyRequest,
  cancelRequest,
  revokeRequest,
} from './actions';
export { handleIncomingBlob } from './incoming';
export { pollInbox, startPolling, stopPolling } from './poll';
