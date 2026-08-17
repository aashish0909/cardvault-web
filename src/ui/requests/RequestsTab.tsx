// Requests tab: incoming approvals (owner) and outgoing status (borrower).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';

import { decryptJSON } from '../../lib/crypto';
import * as db from '../../lib/db';
import { useDeepLink, useDeepLinkStore } from '../../lib/deepLink';
import { maskedPan } from '../../lib/cards';
import {
  approveDetails,
  approveOtp,
  cancelRequest,
  denyRequest,
  revokeRequest,
  useInboxStore,
} from '../../lib/relay';
import { useReveal, useRevealStore } from '../../lib/reveal';
import { getSessionKey } from '../../lib/vault';
import { Modal, Countdown, DetailsReveal } from '../components';
import { CardLogo } from '../components/CardLogo';
import { OtpEntryModal } from './OtpEntryModal';

const WINDOW_OPTIONS_MS = [2, 5, 10, 15].map((m) => ({ label: `${m} min`, ms: m * 60 * 1000 }));

export default function RequestsTab() {
  const [requests, setRequests] = useState<db.RequestRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<Record<string, db.CardRow>>({});
  const [approveId, setApproveId] = useState<string | null>(null);
  const [otpForId, setOtpForId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [intentWaited, setIntentWaited] = useState(false);
  const inbox = useStore(useInboxStore);
  const link = useDeepLink();

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

  useEffect(() => {
    if (!link?.intent) {
      setIntentWaited(false);
      return;
    }
    const t = window.setTimeout(() => setIntentWaited(true), 2500);
    return () => window.clearTimeout(t);
  }, [link?.intent]);

  useEffect(() => {
    if (!link || link.tab !== 'requests' || !link.intent || requests === null) return;
    const pending = requests.filter(
      (r) => r.direction === 'in' && r.status === 'pending' && r.kind === link.intent
    );
    if (pending.length === 1) {
      const id = pending[0]!.id;
      setHighlightIds([id]);
      if (link.intent === 'otp') setOtpForId(id);
      else setApproveId(id);
      useDeepLinkStore.get().consume();
      return;
    }
    if (pending.length > 1) {
      setHighlightIds(pending.map((r) => r.id));
      useDeepLinkStore.get().consume();
      return;
    }
    if (inbox.eventId > 0 || intentWaited) useDeepLinkStore.get().consume();
  }, [link, requests, inbox.eventId, intentWaited]);

  const peersName = (id: string) => names[id] ?? 'Friend';
  const cardFor = (id: string) => cards[id];
  const otpReq = requests?.find((r) => r.id === otpForId) ?? null;

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
        <>
          {requests.some((r) => r.status === 'pending') ? (
            requests
              .filter((r) => r.status === 'pending')
              .map((r) => (
                <RequestCard
                  key={r.id}
                  r={r}
                  card={cardFor(r.cardId)}
                  peersName={peersName}
                  highlight={highlightIds.includes(r.id)}
                  onApproveDetails={() => setApproveId(r.id)}
                  onApproveOtp={() => setOtpForId(r.id)}
                  onDeny={() => void denyRequest(r).then(reload)}
                  onCancel={() => void cancelRequest(r).then(reload)}
                  onRevoke={() => void revokeRequest(r).then(reload)}
                />
              ))
          ) : (
            <div className="empty">
              <p>No open requests.</p>
            </div>
          )}
          {requests.some((r) => r.status !== 'pending') && (
            <>
              <h2 className="req-history-title">History</h2>
              {requests
                .filter((r) => r.status !== 'pending')
                .map((r) => (
                  <RequestCard
                    key={r.id}
                    r={r}
                    card={cardFor(r.cardId)}
                    peersName={peersName}
                    highlight={highlightIds.includes(r.id)}
                    onApproveDetails={() => setApproveId(r.id)}
                    onApproveOtp={() => setOtpForId(r.id)}
                    onDeny={() => void denyRequest(r).then(reload)}
                    onCancel={() => void cancelRequest(r).then(reload)}
                    onRevoke={() => void revokeRequest(r).then(reload)}
                  />
                ))}
            </>
          )}
        </>
      )}

      {approveId && (
        <WindowPicker
          request={requests?.find((r) => r.id === approveId)!}
          onPick={async (ms) => {
            const req = requests?.find((r) => r.id === approveId);
            if (!req) throw new Error('Request is no longer available.');
            const key = await getSessionKey();
            const card = await db.getCard(req.cardId);
            if (!card) throw new Error('Card not found on this device.');
            const secrets = await decryptJSON<db.CardSecrets>(key, card.payload);
            await approveDetails(req, secrets, ms);
            setApproveId(null);
            await reload();
          }}
          onClose={() => setApproveId(null)}
        />
      )}
      {otpReq && (
        <OtpEntryModal
          request={otpReq}
          card={cardFor(otpReq.cardId)}
          peerName={peersName(otpReq.peerId)}
          onSubmit={async (otp) => {
            await approveOtp(otpReq, otp);
            setOtpForId(null);
            await reload();
          }}
          onClose={() => setOtpForId(null)}
        />
      )}
    </div>
  );
}

function RequestCard({
  r,
  card,
  peersName,
  highlight,
  onApproveDetails,
  onApproveOtp,
  onDeny,
  onCancel,
  onRevoke,
}: {
  r: db.RequestRow;
  card: db.CardRow | undefined;
  peersName: (id: string) => string;
  highlight: boolean;
  onApproveDetails: () => void;
  onApproveOtp: () => void;
  onDeny: () => void;
  onCancel: () => void;
  onRevoke: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  return (
    <div ref={ref} className={`list-item req-card${highlight ? ' highlight' : ''}`}>
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
            <button className="btn btn-primary" onClick={onApproveDetails}>
              Approve
            </button>
            <button className="btn btn-danger" onClick={onDeny}>
              Deny
            </button>
          </>
        )}
        {r.direction === 'in' && r.status === 'pending' && r.kind === 'otp' && (
          <>
            <button className="btn btn-primary" onClick={onApproveOtp}>
              Enter OTP
            </button>
            <button className="btn btn-danger" onClick={onDeny}>
              Deny
            </button>
          </>
        )}
        {r.direction === 'out' && r.status === 'pending' && (
          <button className="btn btn-danger" onClick={onCancel}>
            Cancel
          </button>
        )}
        {r.status === 'approved' && r.windowExpiresAt != null && r.windowExpiresAt > Date.now() && (
          <button className="btn btn-danger" onClick={onRevoke}>
            Revoke
          </button>
        )}
      </div>

      {r.direction === 'out' && r.status === 'approved' && r.kind === 'details' && (
        <DetailsReveal cardId={r.cardId} />
      )}
      {r.direction === 'out' && r.status === 'approved' && r.kind === 'otp' && (
        <OtpStatus requestId={r.id} />
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
  onPick,
  onClose,
}: {
  request: db.RequestRow;
  onPick: (ms: number) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Reveal window" onClose={onClose}>
      <p className="muted">
        The borrower can see the full card details for the chosen window. You
        can revoke it anytime.
      </p>
      <div className="row section-gap">
        {WINDOW_OPTIONS_MS.map((o) => (
          <button
            key={o.ms}
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onPick(o.ms).catch((err) => {
                setError((err as Error).message);
                setBusy(false);
              });
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
