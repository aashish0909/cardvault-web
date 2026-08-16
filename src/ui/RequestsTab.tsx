// Requests tab: incoming approvals (owner) and outgoing status (borrower).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';

import { decryptJSON } from '../lib/crypto';
import * as db from '../lib/db';
import { maskedPan } from '../lib/cards';
import {
  approveDetails,
  approveOtp,
  cancelRequest,
  denyRequest,
  revokeRequest,
  useInboxStore,
} from '../lib/relay';
import { useReveal, useRevealStore } from '../lib/reveal';
import { getSessionKey } from '../lib/vault';
import { Modal, Countdown } from './common';
import { CardLogo } from './CardLogo';

const WINDOW_OPTIONS_MS = [2, 5, 10, 15].map((m) => ({ label: `${m} min`, ms: m * 60 * 1000 }));

export default function RequestsTab() {
  const [requests, setRequests] = useState<db.RequestRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<Record<string, db.CardRow>>({});
  const [approveId, setApproveId] = useState<string | null>(null);
  const [otpForId, setOtpForId] = useState<string | null>(null);
  const inbox = useStore(useInboxStore);
  const reveal = useReveal();

  const reload = useCallback(async () => {
    let rows = await db.listRequests();
    // Auto-expire: an approved window whose deadline has passed is no longer
    // open. Flip it to 'expired' so the UI shows the closed state (and drops
    // the Revoke action) instead of an open window at 00:00.
    const now = Date.now();
    let changed = false;
    for (const r of rows) {
      if (r.status === 'approved' && r.windowExpiresAt != null && r.windowExpiresAt <= now) {
        await db.setRequestStatus(r.id, 'expired');
        if (r.kind === 'details') useRevealStore.get().clearDetails(r.cardId);
        else useRevealStore.get().clearOtp(r.id);
        changed = true;
      }
    }
    if (changed) rows = await db.listRequests();
    setRequests(rows);
    const nameMap: Record<string, string> = {};
    const cardMap: Record<string, db.CardRow> = {};
    await Promise.all(
      rows.map(async (r) => {
        const peer = await db.getPeer(r.peerId);
        if (peer) nameMap[r.peerId] = peer.name;
        const card = await db.getCard(r.cardId);
        if (card) cardMap[r.cardId] = card;
      })
    );
    setNames(nameMap);
    setCards(cardMap);
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [reload, inbox.eventId]);

  const peersName = (id: string) => names[id] ?? 'Friend';
  const cardFor = (id: string) => cards[id];

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Requests</h1>
          <p className="muted">Incoming requests need your approval to proceed.</p>
        </div>
      </div>

      {requests === null ? null : requests.length === 0 ? (
        <div className="empty">
          <p>No requests.</p>
        </div>
      ) : (
        requests.map((r) => {
          const card = cardFor(r.cardId);
          return (
            <div className="list-item req-card" key={r.id}>
              <div className="req-top">
                <span className="req-kind">{r.kind === 'details' ? 'Card details' : 'OTP'}</span>
                <span className={`badge ${r.status}`}>{r.status}</span>
              </div>

              <div className="req-headline">
                {r.direction === 'in'
                  ? r.kind === 'details'
                    ? `${peersName(r.peerId)} wants your card details`
                    : `${peersName(r.peerId)} requests an OTP`
                  : r.kind === 'details'
                    ? 'You asked for card details'
                    : 'You requested an OTP'}
              </div>

              {card && (
                <div
                  className="req-card-ref"
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

              {r.kind === 'otp' && r.amount && (
                <div className="req-amount">
                  <span className="req-amount-value">₹{r.amount}</span>
                  {r.merchant ? <span className="req-amount-merchant">at {r.merchant}</span> : null}
                </div>
              )}

              {r.status === 'approved' && r.windowExpiresAt != null && (
                <div className={`req-window ${r.windowExpiresAt > Date.now() ? 'open' : 'closed'}`}>
                  {r.windowExpiresAt > Date.now() ? (
                    <>
                      {r.kind === 'details' ? 'Details visible for' : 'OTP visible for'}{' '}
                      <Countdown expiresAt={r.windowExpiresAt} />
                    </>
                  ) : (
                    'Reveal window closed'
                  )}
                </div>
              )}

              <div className="row" style={{ marginTop: 10 }}>
                {r.direction === 'in' && r.status === 'pending' && r.kind === 'details' && (
                  <>
                    <button className="btn btn-primary" onClick={() => setApproveId(r.id)}>
                      Approve
                    </button>
                    <button className="btn btn-danger" onClick={() => void denyRequest(r).then(reload)}>
                      Deny
                    </button>
                  </>
                )}
                {r.direction === 'in' && r.status === 'pending' && r.kind === 'otp' && (
                  <>
                    <button className="btn btn-primary" onClick={() => setOtpForId(r.id)}>
                      Enter OTP
                    </button>
                    <button className="btn btn-danger" onClick={() => void denyRequest(r).then(reload)}>
                      Deny
                    </button>
                  </>
                )}
                {r.direction === 'out' && r.status === 'pending' && (
                  <button className="btn btn-danger" onClick={() => void cancelRequest(r).then(reload)}>
                    Cancel
                  </button>
                )}
                {r.status === 'approved' && r.windowExpiresAt != null && r.windowExpiresAt > Date.now() && (
                  <button className="btn btn-danger" onClick={() => void revokeRequest(r).then(reload)}>
                    Revoke
                  </button>
                )}
              </div>

              {r.direction === 'out' && r.status === 'approved' && r.kind === 'otp' && (
                <OtpStatus requestId={r.id} />
              )}
            </div>
          );
        })
      )}

      {approveId && (
        <WindowPicker
          request={requests?.find((r) => r.id === approveId)!}
          onPick={(ms) => {
            void (async () => {
              const req = requests?.find((r) => r.id === approveId);
              if (!req) return;
              const key = await getSessionKey();
              const card = await db.getCard(req.cardId);
              if (!card) return;
              const secrets = await decryptJSON<db.CardSecrets>(key, card.payload);
              await approveDetails(req, secrets, ms);
              setApproveId(null);
              await reload();
            })();
          }}
          onClose={() => setApproveId(null)}
        />
      )}
      {otpForId && (
        <OtpEntryModal
          request={requests?.find((r) => r.id === otpForId)!}
          onSubmit={async (otp) => {
            const req = requests?.find((r) => r.id === otpForId);
            if (!req) return;
            await approveOtp(req, otp);
            setOtpForId(null);
            await reload();
          }}
          onClose={() => setOtpForId(null)}
        />
      )}
    </div>
  );
}

function OtpStatus({ requestId }: { requestId: string }) {
  const reveal = useReveal();
  const entry = reveal.otp[requestId];
  if (!entry) return null;
  return (
    <div className="reveal-box" style={{ marginTop: 10 }}>
      <div className="label">OTP delivered</div>
      <div className="value">{entry.otp}</div>
      <Countdown expiresAt={entry.expiresAt} />
    </div>
  );
}

function WindowPicker({
  request,
  onPick,
  onClose,
}: {
  request: db.RequestRow;
  onPick: (ms: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Reveal window" onClose={onClose}>
      <p className="muted">
        The borrower can see the full card details for the chosen window. You
        can revoke it anytime.
      </p>
      <div className="row section-gap">
        {WINDOW_OPTIONS_MS.map((o) => (
          <button key={o.ms} className="btn btn-primary" onClick={() => onPick(o.ms)}>
            {o.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function OtpEntryModal({
  request,
  onSubmit,
  onClose,
}: {
  request: db.RequestRow;
  onSubmit: (otp: string) => Promise<void>;
  onClose: () => void;
}) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<() => void>(() => onClose());
  return (
    <Modal title="Enter OTP" onClose={onClose} closeRef={closeRef}>
      <p className="muted">
        The OTP is relayed end-to-end encrypted and shown to the borrower for
        60 seconds.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (otp.trim().length < 4) return setError('Enter the OTP shown on the card screen.');
          void onSubmit(otp.trim()).catch((err) => setError((err as Error).message));
        }}
      >
        <div className="field section-gap">
          <label htmlFor="otp-input">OTP</label>
          <input
            id="otp-input"
            inputMode="numeric"
            className="code-input mono"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            autoComplete="one-time-code"
            autoFocus
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn btn-ghost" type="button" onClick={() => closeRef.current()}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit">
            Send OTP
          </button>
        </div>
      </form>
    </Modal>
  );
}
