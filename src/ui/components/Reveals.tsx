// Live reveal of approved card details / OTP (memory-only).

import { useEffect, useState } from 'react';

import { useReveal } from '../../lib/reveal';

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
