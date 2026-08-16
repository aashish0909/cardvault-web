// Shared tab (borrower side): cards friends shared with you.

import { useCallback, useEffect, useState } from 'react';

import * as db from '../lib/db';
import { useInboxStore } from '../lib/relay';
import { useStore } from '../lib/store';
import { CardFace, Modal } from './common';
import SharedCardDetail from './SharedCardDetail';

export default function SharedTab({ onReceive }: { onReceive: () => void }) {
  const [cards, setCards] = useState<db.SharedCardRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const inbox = useStore(useInboxStore);

  const reload = useCallback(() => {
    void db.listSharedCards().then(setCards);
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [reload, inbox.eventId]);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Shared</h1>
          <p className="muted">Cards friends shared with you.</p>
        </div>
        <button className="btn" onClick={onReceive}>
          Receive
        </button>
      </div>
      {cards === null ? null : cards.length === 0 ? (
        <div className="empty">
          <p>Nothing shared with you yet.</p>
          <p>Cards appear here once a friend shares them.</p>
        </div>
      ) : (
        <div className="card-grid">
          {cards.map((c, i) => (
            <CardFace
              key={c.id}
              nickname={c.label ?? c.nickname}
              network={c.network}
              last4={c.last4}
              color={c.color}
              style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              onClick={() => setOpenId(c.id)}
            />
          ))}
        </div>
      )}
      {openId && (
        <SharedCardDetail
          sharedId={openId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
