import { useState, useEffect } from 'react';

export function useAutocomplete(query: string) {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&addressdetails=1`
        );
        const data = await res.json();
        // Filter out non-city/town results if needed, keep top 5
        setSuggestions(Array.isArray(data) ? data.slice(0, 5) : []);
      } catch (err) {
        console.error('Autocomplete API failed', err);
      } finally {
        setIsSearching(false);
      }
    }, 400); // 400ms debounce prevents API spam

    return () => clearTimeout(timer);
  }, [query]);

  return { suggestions, isSearching };
}
