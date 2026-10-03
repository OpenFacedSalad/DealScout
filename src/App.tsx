import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Store,
  DealItem,
  UserLocation,
  RadiusOption,
  ActiveTab,
  ShoppingListItem,
  ComparisonGroup,
} from './types';
import { groupSimilarDeals, findBetterAlternative } from './utils/dealMatcher';
import { queueCartAction } from './utils/syncQueue';
import { safeStorage } from './utils/safeStorage';
import { sanitizeDealList } from './utils/dealPricing';
import Header from './components/Header';
import LocationModal from './components/LocationModal';
import CircularsView from './components/CircularsView';
import DealComparisonView from './components/DealComparisonView';
import DealComparisonModal from './components/DealComparisonModal';
import ShoppingListView from './components/ShoppingListView';
import DocViewerModal from './components/DocViewerModal';
import InstallBanner from './components/InstallBanner';
import FlyerUploadModal from './components/FlyerUploadModal';
import NotificationOptInBanner from './components/NotificationOptInBanner';
import CircularLoadingProgress from './components/CircularLoadingProgress';

const STORAGE_KEY_LOCATION = 'grocery_circulars_location_v3';
const STORAGE_KEY_RADIUS = 'grocery_circulars_radius_v3';
const STORAGE_KEY_LIST = 'grocery_circulars_shopping_list_v3';

const DEFAULT_LOCATION: UserLocation = {
  latitude: 40.2137,
  longitude: -77.0075,
  city: 'Mechanicsburg',
  state: 'PA',
  zipCode: '17050',
  formattedAddress: 'Mechanicsburg, PA 17050, USA',
  isGps: false,
  radiusMiles: 10,
};

export default function App() {
  const [location, setLocation] = useState<UserLocation>(() => {
    try {
      const saved = safeStorage.getItem(STORAGE_KEY_LOCATION);
      return saved ? JSON.parse(saved) : DEFAULT_LOCATION;
    } catch {
      return DEFAULT_LOCATION;
    }
  });

  const [radiusMiles, setRadiusMiles] = useState<RadiusOption>(() => {
    try {
      const saved = safeStorage.getItem(STORAGE_KEY_RADIUS);
      return saved ? (Number(saved) as RadiusOption) : 10;
    } catch {
      return 10;
    }
  });

  const [rawShoppingList, setRawShoppingList] = useState<ShoppingListItem[]>(() => {
    try {
      const saved = safeStorage.getItem(STORAGE_KEY_LIST);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const STORAGE_KEY_STORES = 'dealscout_cached_stores_v3';
  const STORAGE_KEY_DEALS = 'dealscout_cached_deals_v3';

  const [activeTab, setActiveTab] = useState<ActiveTab>('circulars');
  const [stores, setStores] = useState<Store[]>(() => {
    try {
      const saved = safeStorage.getItem(STORAGE_KEY_STORES);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [deals, setDeals] = useState<DealItem[]>(() => {
    try {
      const saved = safeStorage.getItem(STORAGE_KEY_DEALS);
      return saved ? sanitizeDealList(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isGpsLocating, setIsGpsLocating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isDocModalOpen, setIsDocModalOpen] = useState<boolean>(false);
  const [activeDocType, setActiveDocType] = useState<'design' | 'code' | 'devtools'>('design');
  const [selectedComparisonGroup, setSelectedComparisonGroup] = useState<ComparisonGroup | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<'sequential' | 'parallel'>('parallel');

  useEffect(() => {
    safeStorage.setItem(STORAGE_KEY_LOCATION, JSON.stringify(location));
  }, [location]);

  useEffect(() => {
    safeStorage.setItem(STORAGE_KEY_RADIUS, radiusMiles.toString());
  }, [radiusMiles]);

  useEffect(() => {
    safeStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(rawShoppingList));
  }, [rawShoppingList]);

  // Purge legacy and stale deals cache on mount to prevent stale JSON from prior sessions
  useEffect(() => {
    try {
      localStorage.removeItem('dealscout_deals');
      localStorage.removeItem('deals_cache');
      localStorage.removeItem('dealscout_circulars');
      localStorage.removeItem('grocery_circulars_deals_cache');
      localStorage.removeItem('dealscout_cached_deals_v2');
    } catch {
      // Safe storage fallback
    }
  }, []);

  const inFlightAbortRef = useRef<AbortController | null>(null);

  const fetchCirculars = useCallback(
    async (targetLocation: UserLocation, targetRadius: number, mode: 'sequential' | 'parallel' = 'parallel') => {
      // Cleanly abort any previous in-flight request
      if (inFlightAbortRef.current) {
        inFlightAbortRef.current.abort();
      }

      const controller = new AbortController();
      inFlightAbortRef.current = controller;

      setIsLoading(true);
      setError(null);

      // Strict 25-second timeout. If the backend hasn't returned local math by now, it's dead.
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 25000);

      const payload = {
        lat: targetLocation?.latitude ?? 40.2137,
        lng: targetLocation?.longitude ?? -77.0075,
        city: targetLocation?.city || 'Mechanicsburg',
        state: targetLocation?.state || 'PA',
        zipCode: targetLocation?.zipCode || '17050',
        radiusMiles: targetRadius || 10,
        executionMode: mode,
      };

      const doFetch = async () => {
        const response = await fetch(`/api/circulars/nearby?executionMode=${mode}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errMsg = `Server returned HTTP ${response.status}`;
          try {
            const errData = await response.json();
            if (errData?.error) errMsg = errData.error;
          } catch {}
          throw new Error(errMsg);
        }
        return await response.json();
      };

      try {
        let data;
        try {
          data = await doFetch();
        } catch (firstErr: any) {
          if (controller.signal.aborted || firstErr?.name === 'AbortError') {
            throw firstErr;
          }
          console.warn('[App] First circular fetch attempt failed, retrying once...', firstErr);
          await new Promise((r) => setTimeout(r, 600));
          data = await doFetch();
        }

        // If this request was superseded while running, discard result
        if (inFlightAbortRef.current !== controller) {
          return;
        }

        const newStores = Array.isArray(data?.stores) ? data.stores : [];
        const newDeals = Array.isArray(data?.deals) ? data.deals : [];

        if (newStores.length > 0) {
          setStores(newStores);
          try {
            safeStorage.setItem(STORAGE_KEY_STORES, JSON.stringify(newStores));
          } catch {}
        }
        if (newDeals.length > 0) {
          const sanitized = sanitizeDealList(newDeals);
          setDeals(sanitized);
          try {
            safeStorage.setItem(STORAGE_KEY_DEALS, JSON.stringify(sanitized));
          } catch {}
        }
      } catch (err: any) {
        // If this controller was superseded by a newer fetch or unmount, ignore quietly
        if (inFlightAbortRef.current !== controller) {
          return;
        }

        const isAbort =
          err?.name === 'AbortError' ||
          err?.message?.toLowerCase().includes('abort') ||
          err?.message?.toLowerCase().includes('timeout') ||
          controller.signal.aborted;

        if (isAbort) {
          if (timedOut) {
            console.warn('[App] Circular fetch timed out after 90s');
            setError('Live circular request timed out. Please try refreshing or reducing your search radius.');
          }
          // Aborted by user action or superseded cleanly
          return;
        }

        console.error('Fetch error:', err);
        setError(err?.message || 'Failed to load live circulars. Please try again.');
      } finally {
        clearTimeout(timeoutId);
        if (inFlightAbortRef.current === controller) {
          inFlightAbortRef.current = null;
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    fetchCirculars(location, radiusMiles, executionMode);
    return () => {
      if (inFlightAbortRef.current) {
        inFlightAbortRef.current.abort();
      }
    };
  }, [location, radiusMiles, executionMode, fetchCirculars]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const mainContainer = document.getElementById('main-scroll-container');
    if (mainContainer) {
      mainContainer.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [activeTab]);

  const handleDetectGPS = useCallback(async () => {
    try {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }

      setIsGpsLocating(true);

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            const res = await fetch('/api/location/resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lat, lng }),
            });

            if (!res.ok) throw new Error('Failed to resolve coordinates');

            const data = await res.json();
            const newLoc: UserLocation = {
              latitude: data.latitude,
              longitude: data.longitude,
              city: data.city,
              state: data.state,
              zipCode: data.zipCode,
              formattedAddress: data.formattedAddress,
              isGps: true,
              radiusMiles,
            };

            setLocation(newLoc);
          } catch (err) {
            console.error('[App] GPS resolve error:', err);
            alert('Could not resolve physical address from GPS coordinates.');
          } finally {
            setIsGpsLocating(false);
          }
        },
        (error) => {
          setIsGpsLocating(false);
          console.warn('[App] GPS Permission error:', error.message);
          alert('Location access was denied or timed out. Please enter your ZIP code manually.');
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    } catch (err) {
      setIsGpsLocating(false);
      console.warn('[App] GPS Geolocation restricted in this environment:', err);
    }
  }, [radiusMiles]);

  const comparisonGroups = useMemo(() => {
    return groupSimilarDeals(deals);
  }, [deals]);

  const shoppingList = useMemo(() => {
    return rawShoppingList.map((item) => {
      const betterAlternative = findBetterAlternative(item, deals);
      return {
        ...item,
        betterAlternative,
      };
    });
  }, [rawShoppingList, deals]);

  const totalListSavings = useMemo(() => {
    return shoppingList.reduce((acc, item) => {
      if (item.betterAlternative) {
        return acc + item.betterAlternative.totalPotentialSavings;
      }
      return acc;
    }, 0);
  }, [shoppingList]);

  const handleDealsImported = useCallback((importedDeals: DealItem[], storeId: string) => {
    setDeals((prev) => {
      const remaining = prev.filter((d) => d.storeId !== storeId);
      const sanitized = sanitizeDealList([...importedDeals, ...remaining]);
      safeStorage.setItem(STORAGE_KEY_DEALS, JSON.stringify(sanitized));
      return sanitized;
    });

    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, totalDealsCount: importedDeals.length } : s))
    );
  }, []);

  const handleToggleDealInList = useCallback((deal: DealItem) => {
    setRawShoppingList((prev) => {
      const existing = prev.find((item) => item.deal?.id === deal.id);
      if (existing) {
        queueCartAction('REMOVE', { id: existing.id });
        return prev.filter((item) => item.id !== existing.id);
      }
      const newItem: ShoppingListItem = {
        id: `cart-${deal.id}-${Date.now()}`,
        title: deal.title,
        quantity: 1,
        checked: false,
        deal,
        createdAt: new Date().toISOString(),
      };
      queueCartAction('UPDATE_QTY', { id: newItem.id, item: newItem });
      return [newItem, ...prev];
    });
  }, []);

  const handleAddCustomItem = useCallback((title: string) => {
    if (!title.trim()) return;
    const newItem: ShoppingListItem = {
      id: `custom-${Date.now()}`,
      title: title.trim(),
      quantity: 1,
      checked: false,
      createdAt: new Date().toISOString(),
    };
    queueCartAction('UPDATE_QTY', { id: newItem.id, item: newItem });
    setRawShoppingList((prev) => [newItem, ...prev]);
  }, []);

  const handleRemoveListItem = useCallback((id: string) => {
    queueCartAction('REMOVE', { id });
    setRawShoppingList((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleToggleListItemChecked = useCallback((id: string) => {
    queueCartAction('TOGGLE', { id });
    setRawShoppingList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item))
    );
  }, []);

  const handleUpdateListItemQuantity = useCallback((id: string, delta: number) => {
    queueCartAction('UPDATE_QTY', { id, delta });
    setRawShoppingList((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as ShoppingListItem[]
    );
  }, []);

  const handleSwapItemWithAlternative = useCallback(
    (itemId: string, cheaperDeal: DealItem) => {
      queueCartAction('UPDATE_QTY', { id: itemId, dealId: cheaperDeal.id });
      setRawShoppingList((prev) =>
        prev.map((item) => {
          if (item.id === itemId) {
            return {
              ...item,
              title: cheaperDeal.title,
              deal: cheaperDeal,
              betterAlternative: null,
            };
          }
          return item;
        })
      );
    },
    []
  );

  const handleOpenDocModal = (type: 'design' | 'code' | 'devtools') => {
    setActiveDocType(type);
    setIsDocModalOpen(true);
  };

  const handleDownloadJson = () => {
    try {
      const jsonString = JSON.stringify(deals, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dealscout_payload_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportFeedback('Downloaded JSON file!');
      setTimeout(() => setExportFeedback(null), 3500);
    } catch (err) {
      console.error('Failed to download JSON:', err);
      setExportFeedback('Download failed. Use Copy to Clipboard instead.');
      try {
        alert('Download failed. Use Copy to Clipboard instead.');
      } catch {}
    }
  };

  const handleCopyToClipboard = async () => {
    try {
      const jsonString = JSON.stringify(deals, null, 2);
      await navigator.clipboard.writeText(jsonString);
      setExportFeedback('Payload copied to clipboard!');
      setTimeout(() => setExportFeedback(null), 3500);
      try {
        alert('Payload copied to clipboard!');
      } catch {}
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      setExportFeedback('Clipboard access denied. Use Download JSON instead.');
      try {
        alert('Clipboard access denied. Use Download JSON instead.');
      } catch {}
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 overflow-hidden antialiased">
      {/* 2. STATIC HEADER (Takes up its natural height, does not scroll) */}
      <div className="shrink-0 bg-white border-b border-slate-200 z-40">
        <NotificationOptInBanner />
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          location={location}
          radiusMiles={radiusMiles}
          setRadiusMiles={setRadiusMiles}
          onOpenLocationModal={() => setIsLocationModalOpen(true)}
          onOpenUploadModal={() => setIsUploadModalOpen(true)}
          onDetectGPS={handleDetectGPS}
          isGpsLocating={isGpsLocating}
          comparisonCount={comparisonGroups.filter((g) => g.totalStores > 1).length}
          shoppingListCount={shoppingList.length}
          totalSavings={totalListSavings}
          onOpenDocViewer={handleOpenDocModal}
        />
      </div>

      {/* 3. SCROLLABLE CONTENT AREA */}
      <main id="main-scroll-container" className="flex-1 overflow-y-auto overflow-x-hidden relative w-full pb-20">
        {/* --- TEMPORARY EXPORT BAR (DELETE AFTER TESTING) --- */}
        <div className="m-4 p-4 bg-slate-900 rounded-xl shadow-lg border border-slate-700 flex flex-col gap-3">
          <div className="flex items-center justify-between text-white text-xs font-bold uppercase tracking-wider">
            <span>Debug Data Exporter <span className="text-emerald-400 font-mono text-[10px] ml-1 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">v4.9.0</span> ({Array.isArray(deals) ? deals.length : 0} items)</span>
            {exportFeedback && (
              <span className="text-emerald-400 font-medium normal-case text-[11px] animate-pulse">
                {exportFeedback}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDownloadJson}
              className="flex-1 bg-emerald-600 active:bg-emerald-700 text-white font-semibold py-2.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5"
            >
              📥 Download .json
            </button>
            <button
              onClick={handleCopyToClipboard}
              className="flex-1 bg-slate-700 active:bg-slate-600 text-white font-semibold py-2.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5"
            >
              📋 Copy All
            </button>
          </div>
        </div>
        {/* --------------------------------------------------- */}

        {/* TEMPORARY API TOGGLE (Remove before public rollout) */}
        <div className="w-full max-w-lg mx-auto bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 shadow-sm">
          <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-2 text-center">
            API Execution Mode (Testing Only)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setExecutionMode('sequential')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition border ${
                executionMode === 'sequential' 
                ? 'bg-amber-500 text-white border-amber-600 shadow-inner' 
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              🐢 Sequential (Free API)
            </button>
            <button
              onClick={() => setExecutionMode('parallel')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition border ${
                executionMode === 'parallel' 
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-inner' 
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              ⚡ Simultaneous (Paid API)
            </button>
          </div>
        </div>

        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {error && !isLoading && (
            <div className="mx-4 my-8 p-6 bg-rose-50 border border-rose-200 rounded-xl text-center shadow-sm">
              <h3 className="text-rose-800 font-bold mb-2">Live Search Failed</h3>
              <p className="text-sm text-rose-600 mb-4">{error}</p>
              <button
                onClick={() => fetchCirculars(location, radiusMiles, executionMode)} 
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-lg transition"
              >
                Retry Search
              </button>
            </div>
          )}

          {isLoading ? (
            <CircularLoadingProgress isLoading={isLoading} />
          ) : (
            <>
              {activeTab === 'circulars' && (
                <CircularsView
                  stores={stores}
                  deals={deals}
                  location={location}
                  radiusMiles={radiusMiles}
                  shoppingList={rawShoppingList}
                  onToggleList={handleToggleDealInList}
                  onOpenComparison={(groupKey) => {
                    const grp = comparisonGroups.find((g) => g.genericProductGroup === groupKey);
                    if (grp) setSelectedComparisonGroup(grp);
                  }}
                />
              )}

              {activeTab === 'compare' && (
                <DealComparisonView
                  groups={comparisonGroups}
                  stores={stores}
                  shoppingList={rawShoppingList}
                  onToggleList={handleToggleDealInList}
                  onOpenDetailModal={(group) => setSelectedComparisonGroup(group)}
                />
              )}

              {activeTab === 'list' && (
                <ShoppingListView
                  items={shoppingList}
                  onRemoveItem={handleRemoveListItem}
                  onToggleChecked={handleToggleListItemChecked}
                  onUpdateQuantity={handleUpdateListItemQuantity}
                  onAddCustomItem={handleAddCustomItem}
                  onSwapDeal={handleSwapItemWithAlternative}
                />
              )}
            </>
          )}
        </div>
      </main>

      <InstallBanner />

      {isLocationModalOpen && (
        <LocationModal
          isOpen={isLocationModalOpen}
          currentLocation={location}
          currentRadius={radiusMiles}
          onClose={() => setIsLocationModalOpen(false)}
          onSave={(newLoc, newRadius) => {
            setLocation(newLoc);
            setRadiusMiles(newRadius);
            setIsLocationModalOpen(false);
          }}
          onDetectGPS={() => {
            setIsLocationModalOpen(false);
            handleDetectGPS();
          }}
          isGpsLocating={isGpsLocating}
        />
      )}

      {isUploadModalOpen && (
        <FlyerUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          stores={stores}
          onDealsImported={handleDealsImported}
        />
      )}

      {selectedComparisonGroup && (
        <DealComparisonModal
          group={selectedComparisonGroup}
          isOpen={Boolean(selectedComparisonGroup)}
          onClose={() => setSelectedComparisonGroup(null)}
          shoppingList={rawShoppingList}
          onToggleList={handleToggleDealInList}
        />
      )}

      {isDocModalOpen && (
        <DocViewerModal
          isOpen={isDocModalOpen}
          initialDoc={activeDocType}
          onClose={() => setIsDocModalOpen(false)}
        />
      )}
    </div>
  );
}
