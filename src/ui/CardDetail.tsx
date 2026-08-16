// Card detail (owner): decrypted secrets in memory, share management, delete.

import { useEffect, useRef, useState } from 'react';

import { formatPan } from '../lib/cards';
import { decryptJSON } from '../lib/crypto';
import * as db from '../lib/db';
import { unshareCard } from '../lib/relay';
import { getSessionKey } from '../lib/vault';
import { copySecret } from '../lib/clipboard';
import { Modal } from './common';

export default function CardDetail({
  cardId,
  onClose,
  onShare,
}: {
  cardId: string;
  onClose: () => void;
  onShare: () => void;
}) {
  const closeRef = useRef<() => void>(() => onClose());
  const [card, setCard] = useState<db.CardRow | null>(null);
  const [secrets, setSecrets] = useState<db.CardSecrets | null>(null);
  const [shares, setShares] = useState<db.ShareRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await db.getCard(cardId);
      if (!row) return;
      if (cancelled) return;
      setCard(row);
      try {
        const key = await getSessionKey();
        const s = await decryptJSON<db.CardSecrets>(key, row.payload);
        if (!cancelled) setSecrets(s);
      } catch {
        if (!cancelled) setError('Could not decrypt this card.');
      }
      if (!cancelled) setShares(await db.listShares(cardId));
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const unshare = async (share: db.ShareRow) => {
    await unshareCard(cardId, share);
    setShares(await db.listShares(cardId));
  };

  const removeCard = async () => {
    for (const s of shares) await unshare(s);
    await db.deleteCard(cardId);
    closeRef.current();
  };

  if (!card) return null;

  return (
    <Modal title={card.nickname} onClose={onClose} closeRef={closeRef}>
      {error && <p className="error">{error}</p>}
      {secrets && (
        <>
          <div className="reveal-box">
            <div className="label">Card number</div>
            <div className="value" style={{ fontSize: 18 }}>
              {formatPan(secrets.pan)}
            </div>
            <div className="row section-gap">
              <button className="btn" onClick={() => copySecret(formatPan(secrets.pan))}>
                Copy
              </button>
            </div>
          </div>
          <div className="reveal-box">
            <div className="label">Expiry / CVV</div>
            <div className="value" style={{ fontSize: 18 }}>
              {secrets.expiry} / {secrets.cvv}
            </div>
            <div className="row section-gap">
              <button className="btn" onClick={() => copySecret(`${secrets.expiry} ${secrets.cvv}`)}>
                Copy
              </button>
            </div>
          </div>
          <div className="reveal-box">
            <div className="label">Holder</div>
            <div className="value" style={{ fontSize: 16, letterSpacing: 0 }}>
              {secrets.holderName}
            </div>
          </div>
        </>
      )}

      <h2 className="section-gap">Shared with</h2>
      {shares.length === 0 ? (
        <p className="muted">Not shared with anyone.</p>
      ) : (
        <ShareList shares={shares} onUnshare={unshare} />
      )}
      <div className="row section-gap">
        <button className="btn" onClick={onShare}>
          Share
        </button>
        <button className="btn btn-danger" onClick={() => void removeCard()}>
          Delete card
        </button>
      </div>
    </Modal>
  );
}

function ShareList({
  shares,
  onUnshare,
}: {
  shares: db.ShareRow[];
  onUnshare: (share: db.ShareRow) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void Promise.all(shares.map((s) => db.getPeer(s.peerId))).then((peers) => {
      const map: Record<string, string> = {};
      for (const p of peers) if (p) map[p.id] = p.name;
      setNames(map);
    });
  }, [shares]);
  return (
    <>
      {shares.map((s) => (
        <div className="list-item" key={s.id}>
          <div className="title">{names[s.peerId] ?? s.name ?? 'Friend'}</div>
          <div className="sub">
            {s.publicKey ? 'Nearby share' : 'Shared'}
            {s.publicKey ? ' - revoke needs both devices online' : ''}
          </div>
          <button
            className="btn btn-danger"
            style={{ marginTop: 8 }}
            onClick={() => onUnshare(s)}
          >
            Stop sharing
          </button>
        </div>
      ))}
    </>
  );
}
