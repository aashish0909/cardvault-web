// Bottom sheet modal with drag-to-close on touch.

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';

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
