import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

const STORAGE_KEY_LOCATION = 'grocery_circulars_location_v2';
const STORAGE_KEY_RADIUS = 'grocery_circulars_radius_v2';
const STORAGE_KEY_LIST = 'grocery_circulars_shopping_list_v2';

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

  const STORAGE_KEY_STORES = 'dealscout_cached_stores_v2';
  const STORAGE_KEY_DEALS = 'dealscout_cached_deals_v2';

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

  const fetchCirculars = useCallback(
    async (targetLocation: UserLocation, targetRadius: number) => {
      setIsLoading(true);
      setError(null);

      // 1. Create an AbortController to force a timeout on the frontend
      const controller = new AbortController();
      // INCREASED TO 60 SECONDS to allow Gemini Vision OCR sufficient time to process
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const payload = {
        lat: targetLocation?.latitude ?? 40.2137,
        lng: targetLocation?.longitude ?? -77.0075,
        city: targetLocation?.city || 'Mechanicsburg',
        state: targetLocation?.state || 'PA',
        zipCode: targetLocation?.zipCode || '17050',
        radiusMiles: targetRadius || 10,
      };

      const doFetch = async () => {
        const response = await fetch('/api/circulars/nearby', {
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
        console.error("Fetch error:", err);
        if (err.name === 'AbortError' || err.message?.includes('AbortError') || err.message?.includes('Timeout')) {
          setError("Request timed out. The AI processing took longer than 60 seconds.");
        } else {
          setError(err?.message || "Failed to load live circulars. The AI endpoint may be timing out.");
        }
      } finally {
        clearTimeout(timeoutId);
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchCirculars(location, radiusMiles);
  }, [location, radiusMiles, fetchCirculars]);

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
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative w-full pb-20">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {error && !isLoading && (
            <div className="mx-4 my-8 p-6 bg-rose-50 border border-rose-200 rounded-xl text-center shadow-sm">
              <h3 className="text-rose-800 font-bold mb-2">Live Search Failed</h3>
              <p className="text-sm text-rose-600 mb-4">{error}</p>
              <button
                onClick={() => window.location.reload()} 
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
