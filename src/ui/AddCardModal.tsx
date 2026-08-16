// Add a card: validated form that encrypts CardSecrets under the vault key.

import { useRef, useState } from 'react';

import {
  colorForNetwork,
  detectNetwork,
  digitsOnly,
  formatPan,
  isValidCvv,
  isValidExpiry,
  luhnCheck,
  NETWORK_LABELS,
} from '../lib/cards';
import { decryptJSON, encryptJSON } from '../lib/crypto';
import * as db from '../lib/db';
import { getSessionKey } from '../lib/vault';
import { Modal } from './common';

export default function AddCardModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<() => void>(() => onClose());
  const [holder, setHolder] = useState('');
  const [pan, setPan] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const panDigits = digitsOnly(pan);
    if (!luhnCheck(panDigits)) return setError('Card number failed validation (Luhn).');
    if (!isValidExpiry(expiry)) return setError('Expiry must be a valid future MM/YY.');
    const network = detectNetwork(panDigits);
    if (!isValidCvv(cvv, network)) return setError(`CVV must be ${network === 'amex' ? 4 : 3} digits.`);
    if (holder.trim().length < 2) return setError('Enter the card holder name.');
    if (nickname.trim().length < 1) return setError('Give the card a nickname.');

    setBusy(true);
    try {
      const key = await getSessionKey();
      const payload = await encryptJSON(key, {
        holderName: holder.trim(),
        pan: panDigits,
        expiry: expiry.trim(),
        cvv: cvv.trim(),
      } satisfies db.CardSecrets);
      await db.insertCard({
        nickname: nickname.trim().slice(0, 40),
        network,
        last4: panDigits.slice(-4),
        color: colorForNetwork(network),
        payload,
      });
      closeRef.current();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Add card" onClose={onClose} closeRef={closeRef}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="nick">Nickname</label>
          <input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} />
        </div>
        <div className="field">
          <label htmlFor="holder">Card holder</label>
          <input id="holder" value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="pan">Card number</label>
          <input
            id="pan"
            inputMode="numeric"
            className="mono"
            value={formatPan(pan)}
            onChange={(e) => setPan(e.target.value)}
            autoComplete="off"
            placeholder="4242 4242 4242 4242"
          />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="exp">Expiry (MM/YY)</label>
            <input
              id="exp"
              inputMode="numeric"
              value={expiry}
              onChange={(e) => {
                const d = digitsOnly(e.target.value).slice(0, 4);
                setExpiry(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
              }}
              placeholder="12/28"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="cvv">CVV</label>
            <input
              id="cvv"
              type="password"
              inputMode="numeric"
              value={cvv}
              onChange={(e) => setCvv(e.target.value)}
              autoComplete="off"
              placeholder="123"
            />
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row section-gap">
          <button className="btn btn-ghost" type="button" onClick={() => closeRef.current()}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Save card
          </button>
        </div>
      </form>
    </Modal>
  );
}
