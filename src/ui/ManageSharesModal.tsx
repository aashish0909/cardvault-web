// Manage shares (owner side): every card this device has shared, with whom,
// and one-tap revoke. Covers both relay shares (paired peers) and nearby
// (offline) shares.

import { useCallback, useEffect, useState } from 'react';

import * as db from '../lib/db';
import { unshareCard } from '../lib/relay';
import { Modal } from './common';

interface ShareEntry extends db.ShareRow {
  cardNickname: string;
  peerName: string | null;
}

export default function ManageSharesModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ShareEntry[] | null>(null);

  const reload = useCallback(async () => {
    const [shares, cards, peers] = await Promise.all([
      db.listShares(),
      db.listCards(),
      db.listPeers(),
    ]);
    const cardNames = new Map(cards.map((c) => [c.id, c.nickname]));
    const peerNames = new Map(peers.map((p) => [p.id, p.name]));
    setEntries(
      shares.map((s) => ({
        ...s,
        cardNickname: cardNames.get(s.cardId) ?? 'Deleted card',
        peerName: peerNames.get(s.peerId) ?? null,
      }))
    );
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [reload]);

  const revoke = async (entry: ShareEntry) => {
    await unshareCard(entry.cardId, entry);
    await reload();
  };

  return (
    <Modal title="Shared cards" onClose={onClose}>
      {entries === null ? null : entries.length === 0 ? (
        <div className="empty" style={{ flex: 'none', minHeight: 160 }}>
          <p>You haven't shared any cards yet.</p>
          <p>Open a card and tap Share to share it with a friend or nearby.</p>
        </div>
      ) : (
        entries.map((e) => (
          <div className="list-item" key={e.id}>
            <div className="title">
              {e.cardNickname}
              {e.publicKey && <span className="badge pending">nearby</span>}
            </div>
            <div className="sub">
              Shared with {e.peerName ?? e.name ?? 'Friend'}
              {e.publicKey ? ' · revoke needs both devices online' : ''}
            </div>
            <button
              className="btn btn-danger"
              style={{ marginTop: 8 }}
              onClick={() => void revoke(e)}
            >
              Stop sharing
            </button>
          </div>
        ))
      )}
    </Modal>
  );
}
