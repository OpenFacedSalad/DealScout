import React, { useState } from 'react';
import { Download, Share, X, Sparkles } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export default function InstallBanner() {
  const {
    isInstallable,
    isIOS,
    isStandalone,
    isDismissed,
    dismissPrompt,
    triggerInstall,
  } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isStandalone || isDismissed) return null;
  if (!isInstallable && !isIOS) return null;

  return (
    <aside aria-label="Install DealScout" className="fixed bottom-4 left-4 right-4 z-50 max-w-lg mx-auto animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-xl border border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0 shadow-md">
            <Sparkles className="w-5 h-5 text-emerald-100" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              DealScout App
            </h2>
            <p className="text-xs font-semibold text-slate-200 truncate">
              Install for instant circular alerts & offline lists
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => (isIOS ? setShowIOSGuide(true) : triggerInstall())}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install</span>
          </button>

          <button
            onClick={dismissPrompt}
            className="p-1.5 text-slate-400 hover:text-slate-200 transition"
            aria-label="Dismiss banner for 7 days"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showIOSGuide && (
        <div className="mt-2 bg-white text-slate-900 p-3.5 rounded-xl shadow-lg border border-slate-200 text-xs animate-in fade-in duration-150">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center space-x-2 font-bold text-slate-800">
              <Share className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>To install on iOS:</span>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ol className="mt-1.5 pl-5 list-decimal text-slate-600 space-y-1 text-[11px]">
            <li>Tap Safari's <strong>Share</strong> button in the menu bar.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right corner.</li>
          </ol>
        </div>
      )}
    </aside>
  );
}
