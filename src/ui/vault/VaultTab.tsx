// Vault tab: the owner's own cards. Long-press / right-click for the quick
// menu, "Select" enters multi-select for sharing several cards at once.

import { useCallback, useEffect, useState } from 'react';
import { Plus, Share2, X } from 'lucide-react';

import * as db from '../../lib/db';
import { CardFace } from '../components';

interface MenuState {
  cardId: string;
  x: number;
  y: number;
}

export default function VaultTab({
  onAdd,
  onOpen,
  onShare,
  onManageShares,
}: {
  onAdd: () => void;
  onOpen: (id: string) => void;
  onShare: (ids: string[]) => void;
  onManageShares: () => void;
}) {
  const [cards, setCards] = useState<db.CardRow[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    void db.listCards().then(setCards);
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [reload]);

  // Close the context menu on any scroll, Escape, or window resize.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const selectMode = selected.size > 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const menuCard = cards?.find((c) => c.id === menu?.cardId);

  return (
    <div className="screen">
      <div className="screen-head vault-head">
        <div className="vault-head-row">
          <div>
            <h1>{selectMode ? `${selected.size} selected` : 'Vault'}</h1>
          </div>
          {selectMode ? (
            <div className="row">
              <button className="btn" onClick={() => setSelected(new Set())}>
                <X size={16} aria-hidden /> Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onShare([...selected])}
              >
                <Share2 size={16} aria-hidden /> Share
              </button>
            </div>
          ) : (
            <div className="row">
              <button className="btn btn-soft" onClick={onManageShares}>
                <Share2 size={16} aria-hidden /> Shared
              </button>
              <button className="btn btn-primary btn-glow" onClick={onAdd}>
                <Plus size={18} aria-hidden /> Add card
              </button>
            </div>
          )}
        </div>
        <p className="muted">
          {selectMode
            ? 'Tap cards to add or remove them from the selection.'
            : 'Your cards, encrypted on this device.'}
        </p>
      </div>
      {cards === null ? null : cards.length === 0 ? (
        <div className="empty">
          <p>No cards yet.</p>
          <p>Add your first card to get started.</p>
        </div>
      ) : (
        <div className="card-grid">
          {cards.map((c, i) => (
            <CardFace
              key={c.id}
              nickname={c.nickname}
              network={c.network}
              last4={c.last4}
              color={c.color}
              selected={selectMode ? selected.has(c.id) : undefined}
              dim={selectMode && !selected.has(c.id)}
              style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              onClick={() => (selectMode ? toggleSelect(c.id) : onOpen(c.id))}
              onMenu={
                selectMode
                  ? undefined
                  : (pos) => setMenu({ cardId: c.id, x: pos.x, y: pos.y })
              }
            />
          ))}
        </div>
      )}

      {menu && menuCard && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="ctx-menu"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 180)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 170)),
            }}
          >
            <button
              onClick={() => {
                setMenu(null);
                onShare([menu.cardId]);
              }}
            >
              Share card
            </button>
            <button
              onClick={() => {
                setSelected(new Set([menu.cardId]));
                setMenu(null);
              }}
            >
              Select cards
            </button>
            <button
              onClick={() => {
                const id = menu.cardId;
                setMenu(null);
                onOpen(id);
              }}
            >
              Open details
            </button>
          </div>
        </>
      )}
    </div>
  );
}
