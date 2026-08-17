// Main unlocked shell: bottom tabs + overlay navigation.

import { useState } from 'react';
import { Inbox, Shield, Share2, User, Users } from 'lucide-react';

import { lockVault } from '../../lib/vault';
import VaultTab from '../vault/VaultTab';
import SharedTab from '../shared/SharedTab';
import FriendsTab from '../friends/FriendsTab';
import RequestsTab from '../requests/RequestsTab';
import ProfileTab from '../profile/ProfileTab';
import PushPrompt from './PushPrompt';
import AddCardModal from '../vault/AddCardModal';
import CardDetail from '../vault/CardDetail';
import ShareCardModal from '../vault/ShareCardModal';
import PairModal from '../friends/PairModal';
import NearbyReceiveModal from '../nearby/NearbyReceiveModal';
import ManageSharesModal from '../vault/ManageSharesModal';

type Tab = 'vault' | 'shared' | 'friends' | 'requests' | 'profile';

export type Overlay =
  | { kind: 'add-card' }
  | { kind: 'card'; id: string }
  | { kind: 'share'; cardIds: string[] }
  | { kind: 'pair' }
  | { kind: 'nearby-receive' }
  | { kind: 'manage-shares' };

const TABS: { id: Tab; label: string; Icon: typeof Shield }[] = [
  { id: 'vault', label: 'Vault', Icon: Shield },
  { id: 'shared', label: 'Shared', Icon: Share2 },
  { id: 'friends', label: 'Friends', Icon: Users },
  { id: 'requests', label: 'Requests', Icon: Inbox },
  { id: 'profile', label: 'Profile', Icon: User },
];

export default function Main({ onLocked }: { onLocked: () => void }) {
  const [tab, setTab] = useState<Tab>('vault');
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    const from = TABS.findIndex((t) => t.id === tab);
    const to = TABS.findIndex((t) => t.id === next);
    setDirection(to > from ? 'next' : 'prev');
    setTab(next);
  };

  return (
    <>
      <PushPrompt />
      <div key={tab} className={`tab-content tab-${direction}`}>
        {tab === 'vault' && (
          <VaultTab
            onAdd={() => setOverlay({ kind: 'add-card' })}
            onOpen={(id) => setOverlay({ kind: 'card', id })}
            onShare={(ids) => setOverlay({ kind: 'share', cardIds: ids })}
            onManageShares={() => setOverlay({ kind: 'manage-shares' })}
          />
        )}
        {tab === 'shared' && <SharedTab onReceive={() => setOverlay({ kind: 'nearby-receive' })} />}
        {tab === 'friends' && <FriendsTab onPair={() => setOverlay({ kind: 'pair' })} />}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'profile' && (
          <ProfileTab
            onLock={() => {
              lockVault();
              onLocked();
            }}
          />
        )}
      </div>

      <nav className="tabs">
        <div className="tabs-brand">
          Card<span>Vault</span>
        </div>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => switchTab(id)}
          >
            <Icon size={22} strokeWidth={2} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {overlay?.kind === 'add-card' && (
        <AddCardModal onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'card' && (
        <CardDetail
          cardId={overlay.id}
          onClose={() => setOverlay(null)}
          onShare={() => setOverlay({ kind: 'share', cardIds: [overlay.id] })}
        />
      )}
      {overlay?.kind === 'share' && (
        <ShareCardModal cardIds={overlay.cardIds} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'pair' && <PairModal onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'nearby-receive' && (
        <NearbyReceiveModal onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'manage-shares' && (
        <ManageSharesModal onClose={() => setOverlay(null)} />
      )}
    </>
  );
}
