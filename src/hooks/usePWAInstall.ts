import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PWAInstallInfo {
  canInstallPrompt: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  isIOSSafari: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const matchStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return matchStandalone || iosStandalone;
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports MacIntel with touch support
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function detectIOSSafari(): boolean {
  if (!detectIOS()) return false;
  const ua = navigator.userAgent || '';
  // Exclude Chrome, Firefox, Edge, Opera, LINE, Instagram, etc. on iOS
  return !/CriOS|FxiOS|EdgiOS|OPiOS|Line|FBAN|FBAV|Instagram/i.test(ua) && /Safari/i.test(ua);
}

export function usePWAInstall(): PWAInstallInfo {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() => detectStandalone());
  const [isIOS] = useState<boolean>(() => detectIOS());
  const [isIOSSafari] = useState<boolean>(() => detectIOSSafari());

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayModeChange = () => setIsStandalone(detectStandalone());

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    mql?.addEventListener?.('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
      mql?.removeEventListener?.('change', onDisplayModeChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return 'unavailable';
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  return {
    canInstallPrompt: Boolean(deferredPrompt) && !isStandalone,
    isStandalone,
    isIOS,
    isIOSSafari,
    install,
  };
}
