import React, { useState, useEffect } from 'react';
import { Store } from 'lucide-react';

interface CircularLoadingProgressProps {
  isLoading: boolean;
}

export default function CircularLoadingProgress({ isLoading }: CircularLoadingProgressProps) {
  const [progress, setProgress] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setProgress(100);
      return;
    }

    setProgress(5);
    setSeconds(0);

    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
      setProgress((prev) => {
        // Smoothly approach 95% across ~45 seconds
        if (prev < 30) return prev + 3;
        if (prev < 65) return prev + 1.5;
        if (prev < 90) return prev + 0.8;
        return Math.min(prev + 0.2, 95);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading]);

  if (!isLoading) return null;

  const getStatusMessage = (sec: number) => {
    if (sec < 8) return 'Locating nearby supermarkets & butchers...';
    if (sec < 18) return 'Searching live circular flyers & weekly ads...';
    if (sec < 30) return 'Extracting advertised specials & multi-buys...';
    if (sec < 45) return 'Normalizing true unit costs ($/lb, $/oz, $/egg)...';
    return 'Finalizing price comparisons across chains...';
  };

  return (
    <div className="mx-4 my-8 max-w-lg sm:mx-auto p-6 bg-slate-900 border border-slate-800 rounded-3xl shadow-xl text-center text-white">
      <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
        <Store className="w-6 h-6 animate-pulse"/>
      </div>

      <h3 className="text-base font-bold text-slate-100 mb-1">
        Scanning Local Circulars
      </h3>
      <p className="text-xs text-slate-400 mb-5 min-h-[1.5rem] transition-all">
        {getStatusMessage(seconds)}
      </p>

      {/* Progress Bar Container */}
      <div className="w-full bg-slate-800 rounded-full h-3 mb-3 p-0.5 overflow-hidden border border-slate-700/50">
        <div
          className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.round(progress)}%` }}
        />
      </div>

      {/* Stats Line */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 font-mono">
        <span>{Math.round(progress)}% complete</span>
        <span>Elapsed: {seconds}s</span>
      </div>
    </div>
  );
}
