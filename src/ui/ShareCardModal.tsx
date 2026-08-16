// Share cards with paired friends (owner side). Supports one or many cards.

import { useEffect, useState } from 'react';

import * as db from '../lib/db';
import { sendBlob, unshareCard } from '../lib/relay';
import { Modal } from './common';
import NearbyShareModal from './NearbyShareModal';

export default function ShareCardModal({
  cardIds,
  onClose,
}: {
  cardIds: string[];
  onClose: () => void;
}) {
  const [peers, setPeers] = useState<db.PeerRow[]>([]);
  const [shares, setShares] = useState<db.ShareRow[]>([]);
  const [cards, setCards] = useState<db.CardRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nearby, setNearby] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, allShares, allCards] = await Promise.all([
        db.listPeers(),
        Promise.all(cardIds.map((id) => db.listShares(id))),
        Promise.all(cardIds.map((id) => db.getCard(id))),
      ]);
      setPeers(p.filter((x) => x.status === 'paired'));
      setShares(allShares.flat());
      setCards(allCards.filter((c): c is db.CardRow => c !== null));
    })();
  }, [cardIds]);

  const sharedIdsFor = (peerId: string) =>
    new Set(shares.filter((s) => s.peerId === peerId).map((s) => s.cardId));

  const toggle = async (peer: db.PeerRow) => {
    const sharedIds = sharedIdsFor(peer.id);
    const stopping = sharedIds.size === cardIds.length && cardIds.length > 0;
    // Share everything not yet shared, or stop sharing everything that is.
    setBusyId(peer.id);
    try {
      if (stopping) {
        for (const cardId of cardIds) {
          const share = shares.find((s) => s.peerId === peer.id && s.cardId === cardId);
          if (share) {
            await unshareCard(cardId, share);
          } else {
            await sendBlob(peer.id, 'card-unshare', { cardId }).catch(() => {});
            await db.removeShare(cardId, peer.id);
          }
        }
      } else {
        for (const card of cards) {
          if (sharedIds.has(card.id)) continue;
          await sendBlob(peer.id, 'card-share', {
            cardId: card.id,
            nickname: card.nickname,
            network: card.network,
            last4: card.last4,
            color: card.color,
          });
          await db.addShare(card.id, peer.id, { name: peer.name });
        }
      }
      const allShares = await Promise.all(cardIds.map((id) => db.listShares(id)));
      setShares(allShares.flat());
    } finally {
      setBusyId(null);
    }
  };

  if (nearby) {
    return <NearbyShareModal cardId={cardIds[0]!} onClose={() => setNearby(false)} />;
  }

  const subject =
    cards.length === 1 ? (cards[0]?.nickname ?? 'card') : `${cards.length} cards`;

  return (
    <Modal title={`Share ${subject}`} onClose={onClose}>
      {peers.length === 0 ? (
        <p className="muted">Pair with a friend first (Friends tab).</p>
      ) : (
        peers.map((p) => {
          const count = sharedIdsFor(p.id).size;
          const all = count === cardIds.length && cardIds.length > 0;
          return (
            <div className="list-item" key={p.id}>
              <div className="title">
                {p.name}
                {cardIds.length > 1 && (
                  <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                    {count} of {cardIds.length} shared
                  </span>
                )}
              </div>
              <button
                className={`btn ${all ? 'btn-danger' : 'btn-primary'}`}
                style={{ marginTop: 8 }}
                disabled={busyId === p.id}
                onClick={() => void toggle(p)}
              >
                {all ? 'Stop sharing' : 'Share'}
              </button>
            </div>
          );
        })
      )}
      {cardIds.length === 1 && (
        <button className="btn btn-block section-gap" onClick={() => setNearby(true)}>
          Share nearby (no internet)
        </button>
      )}
    </Modal>
  );
}
