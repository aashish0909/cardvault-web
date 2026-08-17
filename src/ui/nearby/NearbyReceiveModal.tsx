// Nearby share (receiver): receive a card from someone standing next to you.
//
// Shows your identity QR (a public key) for the sender to scan, then scans
// their payload QR, shows a masked preview, and accepts. The sealed details
// are stored encrypted on this device but are NOT revealed yet - the owner
// has to approve a face-to-face request before they're decrypted into the
// memory-only reveal window. Nothing else is stored beyond the masked card
// entry.

import { useEffect, useState } from 'react';

import { qrDataUrl } from '../../lib/qr';
import { acceptNearbyShare, parseNearbyShare, type NearbySharePayload } from '../../lib/nearby';
import { pairingPayload, type Identity } from '../../lib/identity';
import { getIdentity } from '../../lib/vault';
import { CardFace, Modal } from '../components';
import Scanner from '../components/Scanner';

type Step = 'mine' | 'scan' | 'preview' | 'done';

export default function NearbyReceiveModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('mine');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [share, setShare] = useState<NearbySharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const id = await getIdentity();
      setIdentity(id);
      void qrDataUrl(pairingPayload(id)).then(setQrData).catch((e) => setError((e as Error).message));
    })();
  }, []);

  const onScan = async (raw: unknown) => {
    try {
      const p = parseNearbyShare(raw);
      const me = await getIdentity();
      if (p.from === me.deviceId) {
        setError('That is your own share.');
        return;
      }
      if (p.expiresAt <= Date.now()) {
        setError('That share has expired - ask them to refresh it.');
        return;
      }
      setShare(p);
      setError(null);
      setStep('preview');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const accept = async () => {
    if (!share) return;
    setBusy(true);
    setError(null);
    try {
      if (share.expiresAt <= Date.now()) {
        throw new Error('That share expired - ask them to refresh it.');
      }
      await acceptNearbyShare(share);
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Modal title="Receive nearby" onClose={onClose}>
      {step === 'mine' && (
        <div className="section-gap" style={{ textAlign: 'center' }}>
          <p className="muted">
            Show this QR to the person sharing a card. Then tap Scan and point
            your camera at their screen.
          </p>
          {qrData && identity && (
            <div className="qr-wrap">
              <img src={qrData} alt="Identity QR" />
            </div>
          )}
          {identity && <p className="muted">{identity.name}</p>}
          <button
            className="btn btn-primary btn-block section-gap"
            onClick={() => setStep('scan')}
          >
            Scan their QR
          </button>
        </div>
      )}

      {step === 'scan' && (
        <>
          <p className="muted">Point your camera at the QR on your friend's screen.</p>
          {error && <p className="error">{error}</p>}
          <Scanner onPayload={(p) => void onScan(p)} busy={busy} busyLabel="Opening…" />
          <button className="btn btn-block" onClick={() => setStep('mine')}>
            Back
          </button>
        </>
      )}

      {step === 'preview' && share && (
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
          <p className="muted">
            Accepting adds the masked card to your Shared tab. The full details
            stay sealed on this device until {share.fromName} approves a
            request for them - nothing is revealed yet.
          </p>
          <div className="row section-gap">
            <button className="btn btn-danger" onClick={() => setStep('mine')} disabled={busy}>
              Decline
            </button>
            <button className="btn btn-primary" onClick={() => void accept()} disabled={busy}>
              Accept
            </button>
          </div>
        </>
      )}

      {step === 'done' && share && (
        <div className="section-gap" style={{ textAlign: 'center' }}>
          <p>Card saved to your Shared tab.</p>
          <p className="muted">
            The details were delivered sealed and never went online. To see
            them, open the card and tap Request details - approval works like
            any normal friend request.
          </p>
          <button className="btn btn-primary btn-block section-gap" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}