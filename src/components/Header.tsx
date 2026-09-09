import React from 'react';
import { MapPin, Navigation, ShoppingBag, ArrowLeftRight, Sparkles, Store as StoreIcon, Loader2, Compass } from 'lucide-react';
import { UserLocation } from '../types';

interface HeaderProps {
  location: UserLocation;
  isLoadingLocation: boolean;
  onOpenLocationModal: () => void;
  onDetectGps: () => void;
  activeTab: 'circulars' | 'compare' | 'list';
  setActiveTab: (tab: 'circulars' | 'compare' | 'list') => void;
  shoppingListCount: number;
  totalSavings: number;
  comparisonCount: number;
  radiusMiles: number;
  onChangeRadius: (radius: number) => void;
}

export const Header: React.FC<HeaderProps> = ({
  location,
  isLoadingLocation,
  onOpenLocationModal,
  onDetectGps,
  activeTab,
  setActiveTab,
  shoppingListCount,
  totalSavings,
  comparisonCount,
  radiusMiles,
  onChangeRadius,
}) => {
  const radiusChoices = [1, 5, 10, 25];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-3">
          
          {/* Brand & Tagline */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-xs shadow-emerald-200">
              <StoreIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-stone-900 tracking-tight leading-tight">
                  DealScout
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Sparkles className="w-3 h-3 mr-1 text-emerald-600" />
                  Live Local Matcher
                </span>
              </div>
              <p className="text-xs text-stone-500 hidden md:block">
                Weekly circular flyers compared by unit price for best local grocery savings
              </p>
            </div>
          </div>

          {/* Location & Radius Controls */}
          <div className="flex items-center gap-2">
            
            {/* Radius Selector Pill */}
            <div className="hidden lg:flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs">
              <span className="px-2 font-semibold text-stone-500 flex items-center gap-1">
                <Compass className="w-3 h-3 text-stone-400" />
                Radius:
              </span>
              <div className="flex items-center gap-0.5">
                {radiusChoices.map((r) => (
                  <button
                    key={r}
                    id={`header-radius-btn-${r}`}
                    onClick={() => onChangeRadius(r)}
                    className={`px-2 py-1 rounded-lg font-bold transition cursor-pointer ${
                      radiusMiles === r
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                    }`}
                  >
                    {r}mi
                  </button>
                ))}
              </div>
            </div>

            {/* Location Pill */}
            <button
              id="location-selector-btn"
              onClick={onOpenLocationModal}
              className="flex items-center gap-2 px-3 py-1.5 sm:px-3.5 sm:py-2 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg text-xs sm:text-sm font-medium text-stone-700 transition cursor-pointer"
              title="Change location or enter zip code"
            >
              <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 flex-shrink-0" />
              <div className="text-left">
                <span className="font-semibold text-stone-900 block truncate max-w-[120px] sm:max-w-[170px]">
                  {location.city}, {location.state}
                </span>
                <span className="text-[10px] text-stone-400 block -mt-0.5">
                  {location.zipCode ? `ZIP ${location.zipCode}` : location.isGps ? 'GPS Location' : 'Local Region'} • {radiusMiles}mi
                </span>
              </div>
            </button>

            {/* GPS Detection Button */}
            <button
              id="detect-gps-header-btn"
              onClick={onDetectGps}
              disabled={isLoadingLocation}
              className="p-2 sm:px-2.5 sm:py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
              title="Auto-detect current GPS location"
            >
              {isLoadingLocation ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              ) : (
                <Navigation className="w-4 h-4 text-emerald-600" />
              )}
              <span className="hidden md:inline font-semibold">Live GPS</span>
            </button>
          </div>

          {/* View Mode Tabs */}
          <div className="flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs sm:text-sm font-medium">
            <button
              id="tab-circulars-btn"
              onClick={() => setActiveTab('circulars')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                activeTab === 'circulars'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <StoreIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Circulars</span>
            </button>

            <button
              id="tab-compare-btn"
              onClick={() => setActiveTab('compare')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer relative ${
                activeTab === 'compare'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <ArrowLeftRight className="w-4 h-4 text-amber-600" />
              <span className="hidden sm:inline">Compare</span>
              {comparisonCount > 0 && (
                <span className="px-1.5 py-0.2 bg-amber-500 text-white rounded-full text-[10px] font-bold">
                  {comparisonCount}
                </span>
              )}
            </button>

            <button
              id="tab-list-btn"
              onClick={() => setActiveTab('list')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer relative ${
                activeTab === 'list'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <ShoppingBag className="w-4 h-4 text-emerald-600" />
              <span className="hidden sm:inline">List</span>
              {shoppingListCount > 0 && (
                <span className="px-1.5 py-0.2 bg-emerald-600 text-white rounded-full text-[10px] font-bold">
                  {shoppingListCount}
                </span>
              )}
              {totalSavings > 0 && (
                <span className="hidden xl:inline text-[11px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-md ml-1">
                  Save ${totalSavings.toFixed(2)}
                </span>
              )}
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
