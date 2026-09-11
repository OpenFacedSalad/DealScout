import React, { useState, useEffect } from 'react';
import { Bell, Check, Sparkles, Loader2, Send } from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';

interface NotificationOptInBannerProps {
  zipCode?: string;
}

export default function NotificationOptInBanner({ zipCode }: NotificationOptInBannerProps) {
  const {
    isSubscribed,
    permission,
    isLoading,
    isSendingTest,
    subscribeToPush,
    triggerAdHocTestPush,
  } = usePushNotifications(zipCode);

  const [dismissed, setDismissed] = useState(false);
  const [testSentSuccess, setTestSentSuccess] = useState(false);

  useEffect(() => {
    const isDismissed = localStorage.getItem('dealscout_push_dismissed');
    if (isDismissed && !isSubscribed) setDismissed(true);
  }, [isSubscribed]);

  if (dismissed && !isSubscribed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('dealscout_push_dismissed', 'true');
  };

  const handleSendTest = async () => {
    const ok = await triggerAdHocTestPush();
    if (ok) {
      setTestSentSuccess(true);
      setTimeout(() => setTestSentSuccess(false), 3000);
    }
  };

  return (
    <div className="mx-4 sm:mx-auto max-w-4xl mb-4 p-3.5 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 rounded-2xl shadow-lg border border-emerald-500/30 text-white flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="flex items-center space-x-3 text-left w-full sm:w-auto">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Bell className="w-5 h-5 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              {isSubscribed ? 'Web Push Active on This Device' : 'Weekly Flyer Drop Alerts'}
            </span>
            <Sparkles className="w-3 h-3 text-amber-300" />
          </div>
          <p className="text-xs text-slate-200 mt-0.5">
            {isSubscribed
              ? 'Alerts configured for Wednesday 5:30 PM & Saturday 8:15 AM runs.'
              : "Get notified Wednesdays when ALDI, Giant, Karns & Trader Joe's release circulars."}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
        {isSubscribed ? (
          <button
            onClick={handleSendTest}
            disabled={isSendingTest}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
            title="Send an instant test notification to your installed PWA"
          >
            {isSendingTest ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : testSentSuccess ? (
              <Check className="w-3.5 h-3.5 text-emerald-200" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>{testSentSuccess ? 'Push Delivered!' : 'Send Test Push'}</span>
          </button>
        ) : (
          <>
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition"
            >
              Not now
            </button>
            <button
              onClick={subscribeToPush}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Enable Alerts</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
