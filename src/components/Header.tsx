import React, { useState, useRef, useEffect } from 'react';
import {
  MapPin,
  Crosshair,
  FileText,
  ShoppingCart,
  Layers,
  Scale,
  Sparkles,
  ChevronDown,
  Loader2,
  Code2,
  Download,
  Share,
  X,
  WifiOff,
  Camera,
} from 'lucide-react';
import { ActiveTab, RadiusOption, UserLocation } from '../types';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  location: UserLocation;
  radiusMiles: RadiusOption;
  setRadiusMiles: (radius: RadiusOption) => void;
  onOpenLocationModal: () => void;
  onOpenUploadModal: () => void;
  onDetectGPS: () => void;
  isGpsLocating: boolean;
  comparisonCount: number;
  shoppingListCount: number;
  totalSavings: number;
  onOpenDocViewer: (type: 'design' | 'code') => void;
}

const RADIUS_OPTIONS: RadiusOption[] = [1, 5, 10, 25];

export default function Header({
  activeTab,
  setActiveTab,
  location,
  radiusMiles,
  setRadiusMiles,
  onOpenLocationModal,
  onOpenUploadModal,
  onDetectGPS,
  isGpsLocating,
  comparisonCount,
  shoppingListCount,
  totalSavings,
  onOpenDocViewer,
}: HeaderProps) {
  const [isDocDropdownOpen, setIsDocDropdownOpen] = useState(false);
  const docDropdownRef = useRef<HTMLDivElement>(null);

  const isOnline = useNetworkStatus();
  const {
    isInstallable,
    isIOS,
    isStandalone,
    openManualInstallGuide,
    showInstallGuide,
    hideInstallGuide,
    triggerInstall,
  } = usePWAInstall();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (docDropdownRef.current && !docDropdownRef.current.contains(event.target as Node)) {
        setIsDocDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      showInstallGuide();
    } else {
      await triggerInstall();
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 sm:border-none">
          {/* Brand Identity */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-md shadow-emerald-700/20">
              <Sparkles className="w-5 h-5 text-emerald-100" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-black tracking-tight text-slate-900 font-sans">
                  Deal<span className="text-emerald-600">Scout</span>
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  v2.2
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                Live Grocery Circulars & Unit Price Matcher
              </p>
            </div>
          </div>

          {/* Location, Scan Flyer, GPS, Radius, Install, and Docs */}
          <div className="flex items-center space-x-2">
            {!isOnline && (
              <div className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold">
                <WifiOff className="w-3.5 h-3.5 text-amber-700" />
                <span className="hidden sm:inline">Offline (Cached)</span>
              </div>
            )}

            <button
              onClick={onOpenUploadModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition shadow-xs"
              title="Upload circular PDF or scan photo"
            >
              <Camera className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Scan Flyer</span>
            </button>

            <button
              onClick={onOpenLocationModal}
              className="group flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-medium text-slate-700 transition"
              title="Change search location"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-600 group-hover:scale-110 transition-transform" />
              <span className="font-semibold text-slate-900 truncate max-w-[130px] sm:max-w-[170px]">
                {location.city || 'Select Area'}, {location.state}
              </span>
              {location.zipCode && (
                <span className="text-slate-500 font-mono hidden sm:inline">
                  {location.zipCode}
                </span>
              )}
            </button>

            <button
              onClick={onDetectGPS}
              disabled={isGpsLocating}
              className={`p-2 rounded-lg border text-xs font-medium transition flex items-center justify-center ${
                location.isGps
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
              title={location.isGps ? 'GPS Location Active' : 'Acquire Live GPS Coordinates'}
            >
              {isGpsLocating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
              ) : (
                <Crosshair
                  className={`w-3.5 h-3.5 ${location.isGps ? 'text-emerald-600' : 'text-slate-500'}`}
                />
              )}
            </button>

            <div className="hidden md:flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <span className="px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Radius:
              </span>
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRadiusMiles(r)}
                  className={`px-2 py-1 rounded font-semibold text-[11px] transition ${
                    radiusMiles === r
                      ? 'bg-white text-emerald-700 shadow-xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {r}mi
                </button>
              ))}
            </div>

            {!isStandalone && (
              <button
                onClick={handleInstallClick}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-xs"
                title="Install DealScout on your home screen"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Install</span>
              </button>
            )}

            <div className="relative" ref={docDropdownRef}>
              <button
                onClick={() => setIsDocDropdownOpen(!isDocDropdownOpen)}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">Docs</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {isDocDropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                  <button
                    onClick={() => {
                      setIsDocDropdownOpen(false);
                      onOpenDocViewer('design');
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center space-x-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-600" />
                    <span>System Design Doc</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsDocDropdownOpen(false);
                      onOpenDocViewer('code');
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center space-x-2"
                  >
                    <Code2 className="w-3.5 h-3.5 text-teal-600" />
                    <span>Code Structure Spec</span>
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <a
                    href="/DESIGN_DOCUMENT.txt"
                    target="_blank"
                    rel="noreferrer"
                    className="block px-3.5 py-1.5 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    Open Raw Design .txt
                  </a>
                  <a
                    href="/CODE_STRUCTURE.txt"
                    target="_blank"
                    rel="noreferrer"
                    className="block px-3.5 py-1.5 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    Open Raw Code .txt
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between py-2 border-t border-slate-100 max-w-full overflow-x-auto overflow-y-hidden scrollbar-none">
          <nav className="flex items-center space-x-2 sm:space-x-4 min-w-max">
            <button
              onClick={() => setActiveTab('circulars')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'circulars'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Circulars</span>
            </button>

            <button
              onClick={() => setActiveTab('compare')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'compare'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Scale className="w-4 h-4" />
              <span>Compare Deals</span>
              {comparisonCount > 0 && (
                <span
                  className={`ml-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === 'compare'
                      ? 'bg-white/25 text-white'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {comparisonCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('list')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'list'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Shopping List</span>
              {shoppingListCount > 0 && (
                <span
                  className={`ml-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === 'list'
                      ? 'bg-white/25 text-white'
                      : 'bg-slate-200 text-slate-800'
                  }`}
                >
                  {shoppingListCount}
                </span>
              )}
            </button>
          </nav>

          {totalSavings > 0 && (
            <div className="hidden sm:flex items-center space-x-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs font-semibold text-amber-900">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Switch Deals & Save:</span>
              <span className="text-emerald-700 font-bold">${totalSavings.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {openManualInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white max-w-sm w-full p-5 rounded-2xl shadow-xl border border-slate-200 text-xs">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center space-x-2 font-black text-slate-900 text-sm">
                <Share className="w-4 h-4 text-emerald-600" />
                <span>Install DealScout</span>
              </div>
              <button
                onClick={hideInstallGuide}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-slate-600 mb-3">
              {isIOS
                ? "Safari does not support automatic prompts. You can add the app directly from your browser menu:"
                : "Your browser requires you to install manually from the menu:"}
            </p>
            <ol className="list-decimal pl-5 space-y-1.5 text-slate-700 font-medium">
              {isIOS ? (
                <>
                  <li>
                    Tap the <strong className="text-slate-900">Share</strong> icon at the bottom of Safari.
                  </li>
                  <li>
                    Scroll down the share sheet and tap <strong className="text-slate-900">Add to Home Screen</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-emerald-600">Add</strong> in the top-right corner.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    Tap the <strong className="text-slate-900">Browser Menu</strong> icon (⋮) in the top right.
                  </li>
                  <li>
                    Tap <strong className="text-slate-900">Install app</strong> or <strong className="text-slate-900">Add to Home screen</strong>.
                  </li>
                  <li>
                    Tap <strong className="text-emerald-600">Install</strong> to confirm.
                  </li>
                </>
              )}
            </ol>
            <button
              onClick={hideInstallGuide}
              className="mt-4 w-full py-2 bg-slate-900 text-white font-bold rounded-xl text-center"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
