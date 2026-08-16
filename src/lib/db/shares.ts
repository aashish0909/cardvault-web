import { openDb, tx } from './idb';
import type { RequestRow, SharedCardRow, SharedCardStatus, ShareRow } from './types';

function normalizeShare(r: ShareRow): ShareRow {
  return {
    ...r,
    name: r.name ?? null,
    publicKey: r.publicKey ?? null,
    nearby: r.nearby === true,
  };
}

export async function listShares(cardId?: string): Promise<ShareRow[]> {
  const rows = await tx<ShareRow[]>('shares', 'readonly', (s) => s.getAll());
  const filtered = cardId ? rows.filter((r) => r.cardId === cardId) : rows;
  return filtered.map(normalizeShare).sort((a, b) => b.createdAt - a.createdAt);
}

export async function addShare(
  cardId: string,
  peerId: string,
  meta: { name?: string | null; publicKey?: string | null; nearby?: boolean } = {}
): Promise<void> {
  await tx('shares', 'readwrite', (s) =>
    s.put({
      id: crypto.randomUUID(),
      cardId,
      peerId,
      name: meta.name ?? null,
      publicKey: meta.publicKey ?? null,
      nearby: meta.nearby === true,
      createdAt: Date.now(),
    })
  );
}

export async function removeShare(cardId: string, peerId: string): Promise<void> {
  const rows = await tx<ShareRow[]>('shares', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.cardId === cardId && r.peerId === peerId)
      .map((r) => tx('shares', 'readwrite', (s) => s.delete(r.id)))
  );
}

function normalizeSharedCard(r: SharedCardRow): SharedCardRow {
  return { ...r, sealed: r.sealed ?? null, ownerPub: r.ownerPub ?? null };
}

export async function listSharedCards(): Promise<SharedCardRow[]> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  const visible = rows
    .filter((r) => r.status !== 'removed')
    .map(normalizeSharedCard)
    .sort((a, b) => b.createdAt - a.createdAt);
  const seen = new Set<string>();
  const unique: SharedCardRow[] = [];
  const extras: SharedCardRow[] = [];
  for (const r of visible) {
    const key = `${r.peerId}:${r.ownerCardId}`;
    if (seen.has(key)) extras.push(r);
    else {
      seen.add(key);
      unique.push(r);
    }
  }
  if (extras.length > 0) {
    void Promise.all(
      extras.map((r) =>
        tx('shared_cards', 'readwrite', (s) => s.put({ ...r, status: 'removed' as const }))
      )
    );
  }
  return unique;
}

export async function getSharedCard(id: string): Promise<SharedCardRow | null> {
  const row = await tx<SharedCardRow | undefined>('shared_cards', 'readonly', (s) => s.get(id));
  return row ? normalizeSharedCard(row) : null;
}

/** Find the currently-shared card from a specific owner, by the owner's card
 *  id. Used by the relay to locate sealed offline details on approval. */
export async function findSharedCard(
  peerId: string,
  ownerCardId: string
): Promise<SharedCardRow | null> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  const row = rows
    .filter(
      (r) => r.peerId === peerId && r.ownerCardId === ownerCardId && r.status !== 'removed'
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return row ? normalizeSharedCard(row) : null;
}

export async function insertSharedCard(
  shared: Omit<SharedCardRow, 'id' | 'createdAt' | 'label' | 'sealed' | 'ownerPub'> & {
    label?: string | null;
    sealed?: string | null;
    ownerPub?: string | null;
  }
): Promise<void> {
  const dbh = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = dbh.transaction('shared_cards', 'readwrite');
    const store = t.objectStore('shared_cards');
    const req = store.getAll();
    req.onsuccess = () => {
      const matches = (req.result as SharedCardRow[]).filter(
        (r) => r.peerId === shared.peerId && r.ownerCardId === shared.ownerCardId
      );
      const active = matches
        .filter((r) => r.status !== 'removed')
        .sort((a, b) => b.createdAt - a.createdAt);
      const keep =
        active[0] ?? matches.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      const label = shared.label !== undefined ? shared.label : (keep?.label ?? null);
      const row = normalizeSharedCard({
        ...shared,
        id: keep?.id ?? crypto.randomUUID(),
        label,
        sealed: shared.sealed ?? keep?.sealed ?? null,
        ownerPub: shared.ownerPub ?? keep?.ownerPub ?? null,
        createdAt: keep?.createdAt ?? Date.now(),
      });
      store.put(row);
      for (const extra of matches) {
        if (extra.id !== row.id) {
          store.put({ ...normalizeSharedCard(extra), status: 'removed' });
        }
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function setSharedCardLabel(id: string, label: string | null): Promise<void> {
  const row = await getSharedCard(id);
  if (row) {
    const value = label == null ? null : label.trim().slice(0, 40) || null;
    await tx('shared_cards', 'readwrite', (s) => s.put({ ...row, label: value }));
  }
}

export async function setSharedCardStatus(id: string, status: SharedCardStatus): Promise<void> {
  const row = await getSharedCard(id);
  if (row) await tx('shared_cards', 'readwrite', (s) => s.put({ ...row, status }));
}

export async function removeSharedByOwner(peerId: string, ownerCardId: string): Promise<void> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId && r.ownerCardId === ownerCardId && r.status !== 'removed')
      .map((r) => tx('shared_cards', 'readwrite', (s) => s.put({ ...r, status: 'removed' as const })))
  );
}

export async function cancelRequestsForCard(peerId: string, ownerCardId: string): Promise<void> {
  const rows = await tx<RequestRow[]>('requests', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId && r.cardId === ownerCardId && r.status === 'pending')
      .map((r) => tx('requests', 'readwrite', (s) => s.put({ ...r, status: 'cancelled' as const, resolvedAt: Date.now() })))
  );
}

export async function removeSharedCardsByPeer(peerId: string): Promise<void> {
  const rows = await tx<SharedCardRow[]>('shared_cards', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId && r.status !== 'removed')
      .map((r) => tx('shared_cards', 'readwrite', (s) => s.put({ ...r, status: 'removed' as const })))
  );
}

export async function removeSharesByPeer(peerId: string): Promise<void> {
  const rows = await tx<ShareRow[]>('shares', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.peerId === peerId)
      .map((r) => tx('shares', 'readwrite', (s) => s.delete(r.id)))
  );
}
