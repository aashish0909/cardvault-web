// Shared UI primitives.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';

import { maskedPan, NETWORK_LABELS, normalizeNetwork } from '../lib/cards';
import { useReveal } from '../lib/reveal';
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

const CLOSE_MS = 240;
const CLOSE_THRESHOLD_PX = 110;
const CLOSE_VELOCITY = 0.6; // px per ms

export function Modal({
  title,
  onClose,
  children,
  closeRef,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Filled with the animated close function so the wrapping component can
      trigger the exit animation from anywhere (e.g. submit buttons). */
  closeRef?: MutableRefObject<() => void>;
}) {
  const [leaving, setLeaving] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef({
    startY: 0,
    lastY: 0,
    lastT: 0,
    dy: 0,
    velocity: 0,
    active: false,
    swiped: false,
    suppressClick: false,
  });

  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    if (closeRef) closeRef.current = close;
  }, [close, closeRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const onPointerDown = (e: React.PointerEvent) => {
    const sheet = sheetRef.current;
    if (!sheet || leaving) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Drag-to-close is for touch/pen only. Mouse pointers (mouse, trackpad)
    // drift a few px during any click, which would otherwise arm the drag
    // and swallow the click - breaking buttons like "Enter code" on laptops.
    const isTouchLike = e.pointerType === 'touch' || e.pointerType === 'pen';
    const target = e.target as HTMLElement | null;
    const onInteractive =
      !!target &&
      !!target.closest(
        'button, a, input, textarea, select, [role="button"], [contenteditable="true"]'
      );
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    drag.current = {
      startY: e.clientY,
      lastY: 0,
      lastT: e.timeStamp,
      dy: 0,
      velocity: 0,
      active: sheet.scrollTop === 0 && !reduced && isTouchLike && !onInteractive,
      swiped: false,
      suppressClick: false,
    };
    if (drag.current.active) {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // pointer may already be released; drag still works from events
      }
      sheet.style.transition = 'none';
      sheet.style.willChange = 'transform';
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const sheet = sheetRef.current;
    const d = drag.current;
    if (!sheet || !d.active) return;
    const dy = e.clientY - d.startY;
    if (dy <= 0) return;
    e.preventDefault();
    const t = e.timeStamp;
    const dt = t - d.lastT;
    if (dt > 0) d.velocity = (dy - d.lastY) / dt;
    d.lastY = dy;
    d.lastT = t;
    d.dy = dy;
    if (dy > 3) {
      d.swiped = true;
      d.suppressClick = true;
    }
    sheet.style.transform = `translateY(${Math.min(dy, sheet.offsetHeight * 0.5)}px)`;
  };

  const endDrag = () => {
    const sheet = sheetRef.current;
    const d = drag.current;
    if (!sheet || !d.active) return;
    d.active = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    sheet.style.willChange = '';
    if (d.swiped && (d.dy > CLOSE_THRESHOLD_PX || d.velocity > CLOSE_VELOCITY)) {
      close();
    }
  };

  return (
    <div
      className={`modal-backdrop${leaving ? ' closing' : ''}`}
      onClick={close}
    >
      <div
        ref={sheetRef}
        className={`modal${leaving ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onClickCapture={(e) => {
          if (drag.current.suppressClick) {
            drag.current.suppressClick = false;
            drag.current.swiped = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="modal-handle" />
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Countdown to a reveal-window expiry, ticking every second. */
export function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!Number.isFinite(expiresAt)) return <div className="countdown">no expiry</div>;
  const remaining = Math.max(0, expiresAt - now);
  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  return <div className="countdown">expires in {mm}:{ss}</div>;
}

/** Live reveal of approved card details (memory-only; dies with the tab). */
export function DetailsReveal({ cardId }: { cardId: string }) {
  const reveal = useReveal();
  const entry = reveal.details[cardId];
  if (!entry) return null;
  return (
    <div className="reveal-box">
      <div className="label">Card number</div>
      <div className="value">{entry.secrets.pan}</div>
      <div className="label">Expiry / CVV</div>
      <div className="value">
        {entry.secrets.expiry} / {entry.secrets.cvv}
      </div>
      <div className="label">Holder</div>
      <div className="value" style={{ fontSize: 16, letterSpacing: 0 }}>
        {entry.secrets.holderName}
      </div>
      <Countdown expiresAt={entry.expiresAt} />
    </div>
  );
}

/** Live reveal of an approved OTP (memory-only). */
export function OtpReveal({ requestId }: { requestId: string }) {
  const reveal = useReveal();
  const entry = reveal.otp[requestId];
  if (!entry) return null;
  return (
    <div className="reveal-box">
      <div className="label">OTP</div>
      <div className="value">{entry.otp}</div>
      <Countdown expiresAt={entry.expiresAt} />
    </div>
  );
}
