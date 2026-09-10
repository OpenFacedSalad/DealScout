import React, { useState } from 'react';
import {
  X,
  MapPin,
  Crosshair,
  Search,
  Loader2,
  Check,
  Building2,
  Navigation,
} from 'lucide-react';
import { UserLocation, RadiusOption } from '../types';

interface LocationModalProps {
  isOpen: boolean;
  currentLocation: UserLocation;
  currentRadius: RadiusOption;
  onClose: () => void;
  onSave: (newLoc: UserLocation, newRadius: RadiusOption) => void;
  onDetectGPS: () => void;
  isGpsLocating: boolean;
}

const RADIUS_OPTIONS: RadiusOption[] = [1, 5, 10, 25];

const PRESET_LOCATIONS: Array<{
  name: string;
  query: string;
  city: string;
  state: string;
  zipCode: string;
  lat: number;
  lng: number;
}> = [
  {
    name: 'Mechanicsburg, PA (Central PA Hub)',
    query: '17050',
    city: 'Mechanicsburg',
    state: 'PA',
    zipCode: '17050',
    lat: 40.2137,
    lng: -77.0075,
  },
  {
    name: 'Philadelphia, PA',
    query: 'Philadelphia, PA',
    city: 'Philadelphia',
    state: 'PA',
    zipCode: '19104',
    lat: 39.9526,
    lng: -75.1652,
  },
  {
    name: 'Austin, TX',
    query: 'Austin, TX',
    city: 'Austin',
    state: 'TX',
    zipCode: '78701',
    lat: 30.2672,
    lng: -97.7431,
  },
  {
    name: 'Orlando, FL',
    query: 'Orlando, FL',
    city: 'Orlando',
    state: 'FL',
    zipCode: '32801',
    lat: 28.5383,
    lng: -81.3792,
  },
];

export default function LocationModal({
  isOpen,
  currentLocation,
  currentRadius,
  onClose,
  onSave,
  onDetectGPS,
  isGpsLocating,
}: LocationModalProps) {
  const [query, setQuery] = useState('');
  const [selectedRadius, setSelectedRadius] = useState<RadiusOption>(currentRadius);
  const [isResolving, setIsResolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleResolveSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsResolving(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/location/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!response.ok) {
        throw new Error('Could not find location coordinates.');
      }

      const data = await response.json();
      const resolvedLocation: UserLocation = {
        latitude: data.latitude,
        longitude: data.longitude,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        formattedAddress: data.formattedAddress,
        isGps: false,
        radiusMiles: selectedRadius,
      };

      onSave(resolvedLocation, selectedRadius);
    } catch (err: any) {
      setErrorMessage(err.message || 'Location search failed. Please try a valid ZIP code.');
    } finally {
      setIsResolving(false);
    }
  };

  const handleSelectPreset = (preset: (typeof PRESET_LOCATIONS)[0]) => {
    const presetLocation: UserLocation = {
      latitude: preset.lat,
      longitude: preset.lng,
      city: preset.city,
      state: preset.state,
      zipCode: preset.zipCode,
      formattedAddress: `${preset.city}, ${preset.state} ${preset.zipCode}`,
      isGps: false,
      radiusMiles: selectedRadius,
    };
    onSave(presetLocation, selectedRadius);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 leading-tight">
                Set Search Location & Radius
              </h2>
              <p className="text-xs text-slate-500">
                Current: {currentLocation.city}, {currentLocation.state} ({currentRadius} mi)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Maximum Distance Radius
            </label>
            <div className="grid grid-cols-4 gap-2">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRadius(r)}
                  className={`py-2 rounded-xl text-xs font-bold border transition ${
                    selectedRadius === r
                      ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {r} {r === 1 ? 'Mile' : 'Miles'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Device Coordinates
            </label>
            <button
              type="button"
              onClick={onDetectGPS}
              disabled={isGpsLocating}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-emerald-800 text-xs font-bold transition shadow-2xs"
            >
              {isGpsLocating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  <span>Requesting Browser Geolocation...</span>
                </>
              ) : (
                <>
                  <Crosshair className="w-4 h-4 text-emerald-600" />
                  <span>Use My Current Live GPS Location</span>
                </>
              )}
            </button>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Search by ZIP Code or City, State
            </label>
            <form onSubmit={handleResolveSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. 17050, Mechanicsburg PA, Austin TX"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                />
              </div>
              <button
                type="submit"
                disabled={isResolving || !query.trim()}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center shrink-0"
              >
                {isResolving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set'}
              </button>
            </form>
            {errorMessage && (
              <p className="text-xs font-medium text-rose-600 mt-1.5">{errorMessage}</p>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Quick Preset Markets
            </label>
            <div className="space-y-1.5">
              {PRESET_LOCATIONS.map((preset) => {
                const isActive = currentLocation.zipCode === preset.zipCode;

                return (
                  <button
                    key={preset.query}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs text-left transition ${
                      isActive
                        ? 'border-emerald-300 bg-emerald-50/50 text-emerald-900 font-bold'
                        : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{preset.name}</span>
                    </div>
                    {isActive && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
