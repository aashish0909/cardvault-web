// PWA install support. Chrome/Edge/Android fire `beforeinstallprompt` once
// the app meets the installability criteria (manifest + service worker);
// Safari has no equivalent, so iOS users get instructions instead.

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const ios = () =>
  typeof navigator !== 'undefined' &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(navigator as Navigator & { standalone?: boolean }).standalone;

export function useAppInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone)
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    const p = prompt;
    if (!p) return false;
    setPrompt(null);
    await p.prompt();
    return (await p.userChoice).outcome === 'accepted';
  };

  return { canPrompt: !!prompt, installed, promptInstall, isIOS: ios() };
}
