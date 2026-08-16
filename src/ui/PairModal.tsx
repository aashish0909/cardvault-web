// Pairing: scan a friend's QR, enter their code, or show your own QR / code.
//
// The scanner also accepts a nearby card-share QR: scanning one from the
// Friends tab imports the masked card (details stay sealed until the owner
// approves) instead of erroring out.

import { useEffect, useRef, useState } from 'react';

import { qrDataUrl } from '../lib/qr';
import {
  createPairingCode,
  formatPairingCode,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MIN,
  resolvePairingCode,
  type PairPayload,
} from '../lib/pairing';
import {
  acceptNearbyShare,
  parseNearbyShare,
  type NearbySharePayload,
} from '../lib/nearby';
import { pairingFingerprint, pairingPayload, type Identity } from '../lib/identity';
import { getIdentity } from '../lib/vault';
import * as db from '../lib/db';
import { sendBlob } from '../lib/relay';
import { CardFace, Modal } from './common';
import Scanner from './Scanner';

type Mode = 'scan' | 'code' | 'mine';

export default function PairModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<() => void>(() => onClose());
  const [mode, setMode] = useState<Mode>('scan');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<NearbySharePayload | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pendingPair, setPendingPair] = useState<{
    payload: PairPayload;
    fingerprint: string;
  } | null>(null);

  const acceptPayload = async (payload: unknown) => {
    // Detect a nearby card-share QR (from the owner's "Share nearby") and
    // switch to the receive flow for it.
    let nearby: NearbySharePayload | null = null;
    try {
      nearby = parseNearbyShare(payload);
    } catch {
      nearby = null;
    }
    if (nearby) {
      const me = await getIdentity();
      if (nearby.from === me.deviceId) {
        setError('That is your own share.');
        return;
      }
      if (nearby.expiresAt <= Date.now()) {
        setError('That share has expired - ask them to refresh it.');
        return;
      }
      setShare(nearby);
      setError(null);
      return;
    }

    const p = payload as Partial<PairPayload> | null;
    if (
      !p ||
      p.v !== 1 ||
      typeof p.deviceId !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.pub !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(p.pub)
    ) {
      setError('That QR / code is not a valid pairing payload.');
      return;
    }
    if (p.deviceId === (await getIdentity()).deviceId) {
      setError('That is your own code.');
      return;
    }
    setError(null);
    setPendingPair({
      payload: p as PairPayload,
      fingerprint: await pairingFingerprint(p.pub),
    });
  };

  const confirmPair = async () => {
    if (!pendingPair) return;
    setBusy(true);
    setError(null);
    try {
      const me = await getIdentity();
      const p = pendingPair.payload;
      await db.upsertPeer({
        id: p.deviceId,
        name: p.name,
        publicKey: p.pub,
        direction: 'out',
        status: 'pending',
      });
      await sendBlob(p.deviceId, 'pair-request', {
        v: 1,
        deviceId: me.deviceId,
        name: me.name,
        pub: me.pubHex,
      });
      closeRef.current();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const acceptShare = async () => {
    if (!share) return;
    setBusy(true);
    setError(null);
    try {
      await acceptNearbyShare(share);
      setAccepted(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Modal title="Pair with a friend" onClose={onClose} closeRef={closeRef}>
      {pendingPair ? (
        <>
          <p className="muted">
            Compare this fingerprint with the number on {pendingPair.payload.name}'s
            screen before sending the request. If they differ, someone may be
            intercepting the pairing.
          </p>
          <FingerprintBox value={pendingPair.fingerprint} />
          {error && <p className="error">{error}</p>}
          <div className="row section-gap">
            <button
              className="btn"
              onClick={() => {
                setPendingPair(null);
                setError(null);
              }}
            >
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void confirmPair()} disabled={busy}>
              Fingerprints match
            </button>
          </div>
        </>
      ) : share ? (
        <>
          <p className="muted">Shared by {share.fromName} - still encrypted and masked.</p>
          <CardFace
            small
            nickname={share.nickname}
            network={share.network}
            last4={share.last4}
            color={share.color}
          />
          {error && <p className="error">{error}</p>}
          {accepted ? (
            <>
              <p className="muted">
                Card added to your Shared tab. The full details stay sealed on
                this device until {share.fromName} approves a request for them.
              </p>
              <button className="btn btn-primary btn-block section-gap" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <div className="row section-gap">
              <button
                className="btn"
                onClick={() => {
                  setShare(null);
                  setAccepted(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => void acceptShare()} disabled={busy}>
                Accept
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="row section-gap">
            <button type="button" className={`btn ${mode === 'scan' ? 'btn-primary' : ''}`} onClick={() => setMode('scan')}>
              Scan QR
            </button>
            <button type="button" className={`btn ${mode === 'code' ? 'btn-primary' : ''}`} onClick={() => setMode('code')}>
              Enter code
            </button>
            <button type="button" className={`btn ${mode === 'mine' ? 'btn-primary' : ''}`} onClick={() => setMode('mine')}>
              My QR
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {mode === 'scan' && <Scanner onPayload={(p) => void acceptPayload(p)} busy={busy} />}
          {mode === 'code' && (
            <CodeEntry
              onCode={(c) => {
                setError(null);
                void acceptCode(c, acceptPayload).catch((e) => setError((e as Error).message));
              }}
              disabled={busy}
            />
          )}
          {mode === 'mine' && <MyQr />}
        </>
      )}
    </Modal>
  );
}

function FingerprintBox({ value }: { value: string }) {
  return (
    <div className="fingerprint-box">
      <div className="fingerprint-label">Key fingerprint</div>
      <div className="fingerprint mono">{value}</div>
    </div>
  );
}

async function acceptCode(
  code: string,
  accept: (payload: unknown) => Promise<void>
): Promise<void> {
  const payload = await resolvePairingCode(code);
  await accept(payload);
}

function CodeEntry({
  onCode,
  disabled,
}: {
  onCode: (code: string) => void;
  disabled: boolean;
}) {
  const [raw, setRaw] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, PAIRING_CODE_LENGTH);
    if (code.length < PAIRING_CODE_LENGTH) return;
    void onCode(code);
  };

  return (
    <form onSubmit={submit} className="section-gap">
      <label htmlFor="pair-code">Friend's code (XXXX-XXXX)</label>
      <input
        id="pair-code"
        className="code-input mono"
        value={formatPairingCode(raw)}
        onChange={(e) => setRaw(e.target.value)}
        maxLength={9}
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
      />
      <button className="btn btn-primary btn-block section-gap" type="submit" disabled={disabled || raw.length < 8}>
        Pair
      </button>
      <p className="muted">
        Codes expire after {PAIRING_CODE_TTL_MIN} minutes - ask your friend for a fresh one.
      </p>
    </form>
  );
}

function MyQr() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = (id: Identity) => {
    void qrDataUrl(pairingPayload(id))
      .then(setQrData)
      .catch((e) => setError((e as Error).message));
  };

  useEffect(() => {
    void (async () => {
      try {
        const id = await getIdentity();
        setIdentity(id);
        refresh(id);
        void pairingFingerprint(id.pubHex).then(setFingerprint);
        void createPairingCode()
          .then(setCode)
          .catch((e) => setError((e as Error).message));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const newCode = async () => {
    setError(null);
    try {
      setCode(await createPairingCode());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!identity) {
    return error ? <p className="error">{error}</p> : <p className="muted">Loading your QR…</p>;
  }

  return (
    <div className="section-gap" style={{ textAlign: 'center' }}>
      <p className="muted">Show this QR - or the code - to the friend who should pair with you.</p>
      {qrData && (
        <div className="qr-wrap">
          <img src={qrData} alt="Pairing QR" />
        </div>
      )}
      {fingerprint && <FingerprintBox value={fingerprint} />}
      <p className="muted">
        Tell your friend this fingerprint. They must see the same number before
        they send a pairing request.
      </p>
      {code && <div className="code-display mono">{formatPairingCode(code)}</div>}
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn" onClick={newCode}>
        Refresh code
      </button>
      <p className="muted">{identity.name}</p>
    </div>
  );
}