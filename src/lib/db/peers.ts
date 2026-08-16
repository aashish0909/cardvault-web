import { tx } from './idb';
import type { PeerRow, PeerStatus } from './types';

export async function listPeers(): Promise<PeerRow[]> {
  const rows = await tx<PeerRow[]>('peers', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPeer(deviceId: string): Promise<PeerRow | null> {
  return (await tx<PeerRow | undefined>('peers', 'readonly', (s) => s.get(deviceId))) ?? null;
}

export async function upsertPeer(peer: Omit<PeerRow, 'createdAt'>): Promise<void> {
  const existing = await getPeer(peer.id);
  const row: PeerRow = {
    ...peer,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await tx('peers', 'readwrite', (s) => s.put(row));
}

export async function setPeerStatus(deviceId: string, status: PeerStatus): Promise<void> {
  const row = await getPeer(deviceId);
  if (row) await tx('peers', 'readwrite', (s) => s.put({ ...row, status }));
}

export async function setPeerName(deviceId: string, name: string): Promise<void> {
  const row = await getPeer(deviceId);
  if (row) await tx('peers', 'readwrite', (s) => s.put({ ...row, name }));
}

export async function deletePeer(deviceId: string): Promise<void> {
  await tx('peers', 'readwrite', (s) => s.delete(deviceId));
}
