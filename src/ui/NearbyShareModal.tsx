// Nearby share (sender): send a card to someone standing next to you.
//
// Step 1: scan the friend's identity QR (a public key - see Friends > Pair).
// Step 2: hold up a QR carrying the card sealed to their key. Only they can
// open it, but it does NOT reveal anything yet - accepting it only saves the
// masked card. The consent part (request details -> approve with a window)
// is the normal relay flow; the full details travel offline only and are
// decrypted locally after the owner approves.

import { useState } from 'react';

import {
  buildNearbyShare,
  NEARBY_QR_TTL_MS,
} from '../lib/nearby';
import { qrDataUrl } from '../lib/qr';
import { decryptJSON } from '../lib/crypto';
import * as db from '../lib/db';
import { getIdentity, getSessionKey } from '../lib/vault';
import { Modal } from './common';
import Scanner from './Scanner';

interface PairPayload {
  v: number;
  deviceId: string;
  name: string;
  pub: string;
}

type Step = 'scan' | 'show';

export default function NearbyShareModal({
  cardId,
  onClose,
}: {
  cardId: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('scan');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState<PairPayload | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);

  const makeQr = async (p: PairPayload, card: db.CardRow, secrets: db.CardSecrets) => {
    const me = await getIdentity();
    const payload = await buildNearbyShare({
      from: me.deviceId,
      fromName: me.name,
      fromPub: me.pubHex,
      cardId: card.id,
      nickname: card.nickname,
      network: card.network,
      last4: card.last4,
      color: card.color,
      recipientPubHex: p.pub,
      secrets,
    });
    const img = await qrDataUrl(payload);
    setQrData(img);
  };

  const scanFriend = async (raw: unknown) => {
    const p = raw as Partial<PairPayload> | null;
    if (
      !p ||
      p.v !== 1 ||
      typeof p.deviceId !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.pub !== 'string'
    ) {
      setError('Not a valid identity QR. Ask them to open Friends > Pair > My QR.');
      return;
    }
    const me = await getIdentity();
    if (p.deviceId === me.deviceId) {
      setError('That is your own QR.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const key = await getSessionKey();
      const card = await db.getCard(cardId);
      if (!card) throw new Error('Card not found.');
      const secrets = await decryptJSON<db.CardSecrets>(key, card.payload);
      await makeQr(p as PairPayload, card, secrets);
      // Track the share locally (recipient name + pub key) so it shows in
      // "Shared with" and can be revoked via a best-effort relay message.
      const existing = await db.listShares(cardId);
      if (!existing.some((s) => s.peerId === p.deviceId)) {
        await db.addShare(cardId, p.deviceId, { name: p.name, publicKey: p.pub });
      }
      // Treat the recipient as a paired friend so the consent flow (details
      // / OTP requests) can ride the relay later. The card details
      // themselves stay offline, sealed in the QR.
      await db.upsertPeer({
        id: p.deviceId,
        name: p.name,
        publicKey: p.pub,
        direction: 'out',
        status: 'paired',
      });
      setRecipient(p as PairPayload);
      setStep('show');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const refresh = async () => {
    if (!recipient) return;
    setError(null);
    try {
      const key = await getSessionKey();
      const card = await db.getCard(cardId);
      if (!card) throw new Error('Card not found.');
      const secrets = await decryptJSON<db.CardSecrets>(key, card.payload);
      await makeQr(recipient, card, secrets);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Share nearby" onClose={onClose}>
      {step === 'scan' && (
        <>
          <p className="muted">
            Ask your friend to open Friends {'>'} Pair {'>'} My QR, then scan their QR.
            The card is sealed to their key - only they can open it.
          </p>
          {error && <p className="error">{error}</p>}
          <Scanner onPayload={(p) => void scanFriend(p)} busy={busy} busyLabel="Preparing share…" />
        </>
      )}

      {step === 'show' && (
        <>
          {error && <p className="error">{error}</p>}
          <p className="muted" style={{ textAlign: 'center' }}>
            Hold this up for {recipient?.name} to scan. It expires in{' '}
            {NEARBY_QR_TTL_MS / 60000} minutes. Accepting only adds the masked
            card - the details reveal only after you approve the request from
            your Requests tab.
          </p>
          <div style={{ textAlign: 'center' }}>
            {qrData && (
              <div className="qr-wrap">
                <img src={qrData} alt="Nearby share QR" />
              </div>
            )}
          </div>
          <div className="row section-gap">
            <button className="btn" onClick={() => void refresh()}>
              Refresh
            </button>
            <button className="btn" onClick={() => setStep('scan')}>
              Rescan
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}