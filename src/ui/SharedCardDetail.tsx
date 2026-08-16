// Shared card detail (borrower): request details, then request an OTP.
//
// The consent flow is identical for every share: request details over the
// relay, the owner approves with a reveal window. For offline (nearby)
// shares the full details already sit sealed on this device - the approval
// simply opens the window and the details are decrypted locally, so the card
// details never travel over the internet.

import { useEffect, useState } from 'react';

import * as db from '../lib/db';
import {
  requestDetails,
  requestOtp,
  revokeRequest,
} from '../lib/relay';
import { useReveal } from '../lib/reveal';
import { Modal, DetailsReveal, OtpReveal } from './common';

export default function SharedCardDetail({
  sharedId,
  onClose,
}: {
  sharedId: string;
  onClose: () => void;
}) {
  const [shared, setShared] = useState<db.SharedCardRow | null>(null);
  const [ownerName, setOwnerName] = useState('Friend');
  const [requests, setRequests] = useState<db.RequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const reveal = useReveal();

  const reload = async () => {
    const s = await db.getSharedCard(sharedId);
    if (!s) return;
    setShared(s);
    const peer = await db.getPeer(s.peerId);
    if (peer) setOwnerName(peer.name);
    setRequests(await db.listRequests());
  };

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [sharedId]);

  if (!shared) return null;

  const isNearby = shared.sealed != null;
  const detailsReq = requests.find(
    (r) => r.kind === 'details' && r.cardId === shared.ownerCardId && r.direction === 'out'
  );
  const otpReqs = requests.filter(
    (r) => r.kind === 'otp' && r.cardId === shared.ownerCardId && r.direction === 'out'
  );
  const otpReq = otpReqs[0];
  const hasDetails = !!reveal.details[shared.ownerCardId];

  const askDetails = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestDetails(shared.peerId, shared.ownerCardId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const askOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestOtp(shared.peerId, shared.ownerCardId, amount.trim(), merchant.trim());
      setAmount('');
      setMerchant('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <Modal title={shared.label ?? shared.nickname} onClose={onClose}>
      {isNearby && (
        <p className="muted">
          Shared with you offline - the card details were delivered sealed and
          never went over the internet. Approval works exactly like a normal
          friend request.
        </p>
      )}

      <DetailsReveal cardId={shared.ownerCardId} />
      {otpReq && otpReq.status === 'approved' && (
        <>
          <OtpReveal requestId={otpReq.id} />
          <button
            className="btn btn-danger"
            onClick={() => {
              void revokeRequest(otpReq).then(() => void reload());
            }}
          >
            Revoke OTP
          </button>
        </>
      )}
      {otpReq && otpReq.status === 'pending' && (
        <p className="muted">OTP request sent - waiting for {ownerName}…</p>
      )}

      {error && <p className="error">{error}</p>}

      {!hasDetails && detailsReq?.status !== 'pending' && (
        <button
          className="btn btn-primary btn-block section-gap"
          onClick={() => void askDetails()}
          disabled={busy}
        >
          Request card details
        </button>
      )}
      {detailsReq?.status === 'pending' && (
        <p className="muted">Details request sent - waiting for {ownerName}…</p>
      )}
      {!hasDetails && detailsReq && detailsReq.status !== 'pending' && (
        <p className="muted">
          {detailsReq.status === 'approved'
            ? 'Details window ended.'
            : `Details request ${detailsReq.status}.`}
        </p>
      )}

      {hasDetails && (
        <form onSubmit={askOtp} className="section-gap">
          <h2>Request an OTP</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="otp-amount">Amount (₹)</label>
              <input
                id="otp-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="2500"
              />
            </div>
            <div className="field">
              <label htmlFor="otp-merchant">Merchant</label>
              <input
                id="otp-merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Big Bazaar"
                maxLength={60}
              />
            </div>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Request OTP
          </button>
        </form>
      )}
    </Modal>
  );
}