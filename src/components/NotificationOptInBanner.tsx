import React, { useState } from 'react';
import { Bell, X, Check } from 'lucide-react';

export default function NotificationOptInBanner() {
  const [isVisible, setIsVisible] = useState(true);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  if (!isVisible) return null;

  const handleSubscribe = async () => {
    setStatus('loading');
    try {
      // Simulate subscribing to push notifications
      await new Promise(resolve => setTimeout(resolve, 800));
      setStatus('success');
      setTimeout(() => setIsVisible(false), 3000);
    } catch (err) {
      setStatus('error');
    }
  };

  return (
    <div className="bg-emerald-600 text-white px-4 py-3 shadow-md flex items-center justify-between relative z-50">
      <div className="flex items-center gap-3">
        <div className="bg-emerald-500/50 p-2 rounded-full">
          <Bell className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-sm">Never Miss a Deal</span>
          <span className="text-xs text-emerald-100 hidden sm:inline">Get push notifications when your favorite items go on sale.</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubscribe}
          disabled={status !== 'idle'}
          className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
            status === 'success' ? 'bg-emerald-800 text-white' : 'bg-white text-emerald-700 hover:bg-emerald-50'
          }`}
        >
          {status === 'loading' ? 'Enabling...' : status === 'success' ? <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Enabled</span> : 'Enable Alerts'}
        </button>
        <button
          onClick={() => setIsVisible(false)}
          className="p-1.5 hover:bg-emerald-500 rounded-full transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4 text-emerald-100" />
        </button>
      </div>
    </div>
  );
}
