import React, { useState } from 'react';
import { useAutocomplete } from '../hooks/useAutocomplete';
import { MapPin, Loader2 } from 'lucide-react';

interface LocationSearchProps {
  onSelectLocation: (lat: number, lon: number, name: string, raw?: any) => void;
  placeholder?: string;
}

export default function LocationSearch({
  onSelectLocation,
  placeholder = 'e.g., Mechanicsburg, PA',
}: LocationSearchProps) {
  const [query, setQuery] = useState('');
  const { suggestions, isSearching } = useAutocomplete(query);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-sm text-slate-800"
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  onSelectLocation(parseFloat(s.lat), parseFloat(s.lon), s.display_name, s.address);
                }}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-start space-x-3 border-b border-slate-100 last:border-0 transition"
              >
                <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <span className="text-sm text-slate-700 leading-snug">{s.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
