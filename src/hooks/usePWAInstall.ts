import { useState, useEffect, useCallback } from 'react';
import { safeStorage } from '../utils/safeStorage';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'dealscout_pwa_dismissed_timestamp';
const COOLDOWN_DAYS = 7;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    try {
      const lastDismissed = safeStorage.getItem(DISMISS_STORAGE_KEY);
      if (lastDismissed) {
        const elapsed = Date.now() - parseInt(lastDismissed, 10);
        if (elapsed < COOLDOWN_MS) {
          setIsDismissed(true);
        } else {
          safeStorage.removeItem(DISMISS_STORAGE_KEY);
        }
      }
    } catch {
      // Ignore storage errors
    }

    try {
      const isStandaloneMode =
        (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        (typeof window !== 'undefined' && (window.navigator as any)?.standalone === true);

      setIsStandalone(Boolean(isStandaloneMode));
      if (isStandaloneMode) return;

      const userAgent = typeof window !== 'undefined' && window.navigator ? window.navigator.userAgent.toLowerCase() : '';
      const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
      setIsIOS(isIosDevice);

      const handleBeforeInstall = (e: Event) => {
        e.preventDefault();
        setInstallPrompt(e as BeforeInstallPromptEvent);
        setIsInstallable(true);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstall);
      return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    } catch (e) {
      console.warn('[PWA] usePWAInstall init error:', e);
    }
  }, []);

  const dismissPrompt = useCallback(() => {
    safeStorage.setItem(DISMISS_STORAGE_KEY, Date.now().toString());
    setIsDismissed(true);
  }, []);

  const triggerInstall = async (): Promise<'accepted' | 'dismissed' | null> => {
    if (!installPrompt) return null;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;

      if (outcome === 'accepted') {
        setIsInstallable(false);
        setInstallPrompt(null);
        safeStorage.removeItem(DISMISS_STORAGE_KEY);
      } else {
        dismissPrompt();
      }

      return outcome;
    } catch (e) {
      console.warn('[PWA] triggerInstall error:', e);
      return null;
    }
  };

  return {
    isInstallable,
    isIOS,
    isStandalone,
    isDismissed,
    dismissPrompt,
    triggerInstall,
  };
}
