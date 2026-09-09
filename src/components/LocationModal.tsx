import React, { useState } from 'react';
import { X, Navigation, MapPin, Search, Check, Sparkles, Building2, Loader2, Compass } from 'lucide-react';
import { POPULAR_LOCATIONS } from '../data/sampleCirculars';
import { UserLocation } from '../types';

interface LocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLocation: UserLocation;
  onSelectLocation: (loc: UserLocation) => void;
  onDetectGps: () => void;
  isLoadingLocation: boolean;
  radiusMiles: number;
  onChangeRadius: (radius: number) => void;
}

export const LocationModal: React.FC<LocationModalProps> = ({
  isOpen,
  onClose,
  currentLocation,
  onSelectLocation,
  onDetectGps,
  isLoadingLocation,
  radiusMiles,
  onChangeRadius,
}) => {
  const [zipOrCityInput, setZipOrCityInput] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const radiusChoices = [1, 5, 10, 25];

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = zipOrCityInput.trim();
    if (!query) return;

    setIsResolving(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/location/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (res.ok) {
        const data = await res.json();
        onSelectLocation({
          latitude: data.latitude,
          longitude: data.longitude,
          city: data.city,
          state: data.state,
          zipCode: data.zipCode,
          formattedAddress: data.formattedAddress,
          isGps: false,
          radiusMiles,
        });
        onClose();
        return;
      }
    } catch (err) {
      console.warn('Geocoding error:', err);
    } finally {
      setIsResolving(false);
    }

    // Fallback if network resolve fails
    onSelectLocation({
      latitude: 40.2234,
      longitude: -77.0016,
      city: query.length === 5 ? `ZIP ${query}` : query,
      state: 'PA',
      zipCode: query.length === 5 ? query : undefined,
      formattedAddress: query,
      isGps: false,
      radiusMiles,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-stone-200 animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-stone-100">
          <div>
            <h3 className="text-lg font-bold text-stone-900">Set Location & Search Radius</h3>
            <p className="text-xs text-stone-500">
              Pulls live weekly circulars and flyers from grocery stores physically near you
            </p>
          </div>
          <button
            id="close-location-modal-btn"
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Radius Selector */}
        <div className="mt-4 p-3.5 bg-stone-50 rounded-xl border border-stone-200">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-stone-700 uppercase tracking-wider flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-emerald-600" />
              Store Distance Radius
            </label>
            <span className="text-xs font-semibold text-emerald-700">
              Within {radiusMiles} {radiusMiles === 1 ? 'mile' : 'miles'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {radiusChoices.map((r) => (
              <button
                key={r}
                id={`modal-radius-btn-${r}`}
                type="button"
                onClick={() => onChangeRadius(r)}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition flex flex-col items-center justify-center cursor-pointer ${
                  radiusMiles === r
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white text-stone-700 hover:bg-stone-100 border border-stone-200'
                }`}
              >
                <span>{r} Mile{r > 1 ? 's' : ''}</span>
                <span className={`text-[10px] font-normal ${radiusMiles === r ? 'text-emerald-100' : 'text-stone-400'}`}>
                  {r <= 5 ? 'Very Local' : r === 10 ? 'Metro Area' : 'Wide Search'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* GPS Quick Action */}
        <div className="mt-4">
          <button
            id="modal-gps-detect-btn"
            onClick={() => {
              onDetectGps();
              onClose();
            }}
            disabled={isLoadingLocation}
            className="w-full flex items-center justify-between p-3.5 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 rounded-xl text-left transition group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-xs">
                {isLoadingLocation ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Navigation className="w-5 h-5 group-hover:scale-110 transition transform" />
                )}
              </div>
              <div>
                <span className="text-sm font-bold text-emerald-950 block">
                  Use My Current Live GPS Location
                </span>
                <span className="text-xs text-emerald-700">
                  Automatically detects your device coordinates & finds stores within {radiusMiles}mi
                </span>
              </div>
            </div>
            <span className="text-xs font-bold text-emerald-700 bg-white px-2.5 py-1 rounded-md border border-emerald-200 shadow-xs">
              Detect
            </span>
          </button>
        </div>

        {/* Manual City / Zip Input */}
        <form onSubmit={handleCustomSubmit} className="mt-4 space-y-2">
          <label className="text-xs font-bold text-stone-700 block uppercase tracking-wider">
            Or Enter ZIP Code or City (e.g. 17050, Mechanicsburg PA)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="zip-input-field"
                type="text"
                value={zipOrCityInput}
                onChange={(e) => setZipOrCityInput(e.target.value)}
                placeholder="Enter ZIP code (e.g. 17050) or City, State"
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            <button
              id="apply-custom-location-btn"
              type="submit"
              disabled={!zipOrCityInput.trim() || isResolving}
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-lg text-sm font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {isResolving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Finding...</span>
                </>
              ) : (
                <span>Find Stores</span>
              )}
            </button>
          </div>
          {errorMessage && <p className="text-xs text-red-600">{errorMessage}</p>}
        </form>

        {/* Popular Metro Areas */}
        <div className="mt-5">
          <label className="text-xs font-bold text-stone-500 block uppercase tracking-wider mb-2">
            Quick Select Common Regions
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {POPULAR_LOCATIONS.map((loc) => {
              const isSelected = currentLocation.city === loc.city || currentLocation.zipCode === loc.zipCode;
              return (
                <button
                  key={`${loc.city}-${loc.state}`}
                  id={`popular-loc-${loc.city.toLowerCase()}`}
                  onClick={() => {
                    onSelectLocation({
                      latitude: loc.latitude,
                      longitude: loc.longitude,
                      city: loc.city,
                      state: loc.state,
                      zipCode: loc.zipCode,
                      formattedAddress: `${loc.city}, ${loc.state} ${loc.zipCode}`,
                      isGps: false,
                      radiusMiles,
                    });
                    onClose();
                  }}
                  className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-400'
                      : 'bg-stone-50 hover:bg-stone-100 border-stone-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span className="text-xs font-bold text-stone-900 truncate">
                        {loc.city}, {loc.state} ({loc.zipCode})
                      </span>
                    </div>
                    <p className="text-[10px] text-stone-500 truncate mt-0.5 pl-5">
                      {loc.stores.slice(0, 3).join(', ')}
                    </p>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-emerald-600 ml-1 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};
