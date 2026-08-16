// Friends tab: paired peers, pending requests, unfriend.

import { useCallback, useEffect, useState } from 'react';

import * as db from '../lib/db';
import { sendBlob, unshareCard } from '../lib/relay';
import { useInboxStore } from '../lib/relay';
import { useStore } from '../lib/store';

export default function FriendsTab({ onPair }: { onPair: () => void }) {
  const [peers, setPeers] = useState<db.PeerRow[] | null>(null);
  const inbox = useStore(useInboxStore);

  const reload = useCallback(() => {
    void db.listPeers().then(setPeers);
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [reload, inbox.eventId]);

  const accept = async (peer: db.PeerRow) => {
    await sendBlob(peer.id, 'pair-accept', {});
    await db.setPeerStatus(peer.id, 'paired');
    reload();
  };

  // Sever the relationship on this device: revoke every card shared with this
  // peer (best effort), drop the cards they shared with us, and cancel any
  // pending requests. Runs before the peer record is deleted so revoke blobs
  // can still be sealed with their key.
  const cleanupPeer = async (peer: db.PeerRow) => {
    const shares = await db.listShares();
    await Promise.all(
      shares
        .filter((s) => s.peerId === peer.id)
        .map((s) => unshareCard(s.cardId, s).catch(() => {}))
    );
    await db.removeSharedCardsByPeer(peer.id);
    const requests = await db.listRequests();
    await Promise.all(
      requests
        .filter((r) => r.peerId === peer.id && r.status === 'pending')
        .map((r) => db.setRequestStatus(r.id, 'cancelled'))
    );
  };

  const decline = async (peer: db.PeerRow) => {
    // Send pair-decline BEFORE removing the local row (sendBlob needs the key).
    await sendBlob(peer.id, 'pair-decline', {}).catch(() => {});
    await cleanupPeer(peer);
    await db.deletePeer(peer.id);
    reload();
  };

  const unfriend = async (peer: db.PeerRow) => {
    await cleanupPeer(peer);
    await sendBlob(peer.id, 'pair-decline', {}).catch(() => {});
    await db.deletePeer(peer.id);
    reload();
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Friends</h1>
          <p className="muted">Paired devices can request details and OTPs.</p>
        </div>
        <button className="btn btn-primary" onClick={onPair}>
          Pair
        </button>
      </div>

      {peers === null ? null : peers.length === 0 ? (
        <div className="empty">
          <p>No friends yet.</p>
          <p>Tap Pair and scan their QR (or enter their code).</p>
        </div>
      ) : (
        peers.map((p) => (
          <div className="list-item" key={p.id}>
            <div className="title">
              {p.name}
              {p.status === 'pending' && (
                <span className={`badge ${p.status}`}>{p.direction === 'in' ? 'incoming' : 'outgoing'}</span>
              )}
            </div>
            <div className="sub">{p.id.slice(0, 8)}…</div>
            <div className="row" style={{ marginTop: 10 }}>
              {p.status === 'pending' && p.direction === 'in' && (
                <>
                  <button className="btn btn-primary" onClick={() => void accept(p)}>
                    Accept
                  </button>
                  <button className="btn btn-danger" onClick={() => void decline(p)}>
                    Decline
                  </button>
                </>
              )}
              {p.status === 'pending' && p.direction === 'out' && (
                <button className="btn btn-danger" onClick={() => void decline(p)}>
                  Cancel
                </button>
              )}
              {p.status === 'paired' && (
                <button className="btn btn-danger" onClick={() => void unfriend(p)}>
                  Unfriend
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
