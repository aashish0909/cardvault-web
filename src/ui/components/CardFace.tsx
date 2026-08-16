// Shared card face used in vault, shared, and pairing lists.

import { useEffect, useRef, type CSSProperties } from 'react';

import { maskedPan, NETWORK_LABELS, normalizeNetwork } from '../../lib/cards';
import { CardLogo } from './CardLogo';

export function CardFace({
  nickname,
  network,
  last4,
  color,
  onClick,
  onMenu,
  small,
  selected,
  dim,
  style,
}: {
  nickname: string;
  network: string;
  last4: string;
  color: string;
  onClick?: () => void;
  /** Open a context menu at a screen position (right-click or long-press). */
  onMenu?: (pos: { x: number; y: number }) => void;
  small?: boolean;
  selected?: boolean;
  dim?: boolean;
  style?: CSSProperties;
}) {
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const longFired = useRef(false);

  const clearTimer = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    moved.current = false;
    longFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      if (moved.current) return;
      longFired.current = true;
      onMenu?.({ x: pressStart.current.x, y: pressStart.current.y });
    }, 450);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (
      Math.abs(e.clientX - pressStart.current.x) > 10 ||
      Math.abs(e.clientY - pressStart.current.y) > 10
    ) {
      moved.current = true;
    }
  };

  const handleClick = () => {
    if (longFired.current) {
      longFired.current = false;
      return;
    }
    onClick?.();
  };

  return (
    <div
      className={`${small ? 'card-face small' : 'card-face'} card-in${selected ? ' selected' : ''}${dim ? ' dim' : ''}`}
      style={{
        background: `linear-gradient(150deg, color-mix(in srgb, ${color}, #fff 8%) 0%, ${color} 45%, color-mix(in srgb, ${color}, #04060a 55%) 100%)`,
        ...style,
      }}
      onClick={handleClick}
      onPointerDown={onMenu ? onPointerDown : undefined}
      onPointerMove={onMenu ? onPointerMove : undefined}
      onPointerUp={onMenu ? clearTimer : undefined}
      onPointerCancel={onMenu ? clearTimer : undefined}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu({ x: e.clientX, y: e.clientY });
            }
          : undefined
      }
    >
      <div className="face-top">
        <span className="network">{NETWORK_LABELS[normalizeNetwork(network)]}</span>
        <CardLogo network={network} />
      </div>
      <div className="number">{maskedPan(last4)}</div>
      <div className="meta">{nickname}</div>
      {selected && (
        <div className="face-check" aria-hidden>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </div>
  );
}
