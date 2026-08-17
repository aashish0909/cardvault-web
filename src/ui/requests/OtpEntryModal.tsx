// Owner OTP entry: clash-safe fill from paste / clipboard / WebOTP.
// iOS keyboard suggestions (autocomplete=one-time-code) still write the
// field directly; the card + amount shown here is how the owner checks
// they are not sending the code from a different card's SMS.

import { useEffect, useRef, useState } from 'react';

import { maskedPan } from '../../lib/cards';
import type { CardRow, RequestRow } from '../../lib/db';
import { listenWebOtp, readClipboardText } from '../../lib/otpAutofill';
import { isBareOtp, matchOtpFromText, type OtpHints, type OtpMatchResult } from '../../lib/otpMatch';
import { Modal } from '../components';
import { CardLogo } from '../components/CardLogo';

export function OtpEntryModal({
  request,
  card,
  peerName,
  onSubmit,
  onClose,
}: {
  request: RequestRow;
  card: CardRow | undefined;
  peerName: string;
  onSubmit: (otp: string) => Promise<void>;
  onClose: () => void;
}) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<() => void>(() => onClose());
  const hints: OtpHints = {
    last4: card?.last4 ?? '',
    amount: request.amount,
    merchant: request.merchant,
  };

  const applyMatch = (result: OtpMatchResult, source: 'paste' | 'sms') => {
    setError(null);
    if (result.status === 'unique') {
      setOtp(result.code);
      setCandidates([]);
      setNote(
        card
          ? `Matched to ${card.nickname} ${maskedPan(card.last4)}`
          : 'Matched to this request'
      );
      return;
    }
    if (result.status === 'candidates') {
      setCandidates(result.codes);
      setNote(
        result.codes.length > 1
          ? 'More than one code — tap the one for this card.'
          : source === 'sms'
            ? 'Suggested from SMS. Confirm it is for this card, then tap to fill.'
            : 'Tap to fill. Confirm this code is for this card.'
      );
      return;
    }
    setCandidates([]);
    if (result.reason === 'other-card') {
      setNote(
        card
          ? `That message is for a different card. Look for the SMS that mentions ${maskedPan(card.last4)}.`
          : 'That message is for a different card.'
      );
    } else {
      setNote('No OTP found for this card in that text.');
    }
  };

  const hintsRef = useRef(hints);
  hintsRef.current = hints;

  useEffect(() => {
    return listenWebOtp((code) =>
      applyMatch(matchOtpFromText(code, hintsRef.current), 'sms')
    );
  }, []);

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text || isBareOtp(text)) return;
    e.preventDefault();
    applyMatch(matchOtpFromText(text, hints), 'paste');
  };

  const onPasteMessages = async () => {
    const text = await readClipboardText();
    if (!text) {
      setNote('Nothing on the clipboard. Copy the SMS, then try again.');
      return;
    }
    if (isBareOtp(text)) {
      applyMatch({ status: 'candidates', codes: [text.trim()] }, 'paste');
      return;
    }
    applyMatch(matchOtpFromText(text, hints), 'paste');
  };

  return (
    <Modal title="Enter OTP" onClose={onClose} closeRef={closeRef}>
      <p className="muted">
        Relayed end-to-end encrypted. {peerName} sees it for 60 seconds.
      </p>

      {card && (
        <div
          className="req-card-ref otp-target-card"
          style={{
            background: `color-mix(in srgb, ${card.color}, transparent 82%)`,
            borderColor: `color-mix(in srgb, ${card.color}, transparent 55%)`,
          }}
        >
          <CardLogo network={card.network} width={30} />
          <span className="req-card-nick">{card.nickname}</span>
          <span className="req-card-last4">{maskedPan(card.last4)}</span>
        </div>
      )}

      {(request.amount || request.merchant) && (
        <div className="req-amount otp-target-amount">
          {request.amount ? <span className="req-amount-value">₹{request.amount}</span> : null}
          {request.merchant ? (
            <span className="req-amount-merchant">at {request.merchant}</span>
          ) : null}
        </div>
      )}

      <p className="muted otp-sms-hint">
        {card
          ? `Use the bank SMS for ${maskedPan(card.last4)}${
              request.amount ? ` / ₹${request.amount}` : ''
            }${request.merchant ? ` at ${request.merchant}` : ''}. A code for a different card will not auto-fill.`
          : 'Use the bank SMS for this card. A code for a different card will not auto-fill.'}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (otp.trim().length < 4) return setError('Enter the OTP shown on the card screen.');
          setBusy(true);
          void onSubmit(otp.trim()).catch((err) => {
            setError((err as Error).message);
            setBusy(false);
          });
        }}
      >
        <div className="field section-gap">
          <label htmlFor="one-time-code">OTP</label>
          <input
            id="one-time-code"
            name="one-time-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            pattern="[0-9]*"
            maxLength={8}
            enterKeyHint="done"
            className="code-input mono"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            onPaste={onPaste}
            autoFocus
          />
        </div>

        {candidates.length > 0 && (
          <div className="otp-chips" role="list">
            {candidates.map((code) => (
              <button
                key={code}
                type="button"
                role="listitem"
                className="otp-chip"
                onClick={() => {
                  setOtp(code);
                  setCandidates([]);
                  setNote(null);
                }}
              >
                {code}
              </button>
            ))}
          </div>
        )}

        {note && <p className="muted otp-match-note">{note}</p>}
        {error && <p className="error">{error}</p>}

        <button
          className="btn btn-soft btn-block"
          type="button"
          style={{ marginTop: 8 }}
          onClick={() => void onPasteMessages()}
        >
          Paste from Messages
        </button>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" type="button" onClick={() => closeRef.current()}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Send OTP
          </button>
        </div>
      </form>
    </Modal>
  );
}
