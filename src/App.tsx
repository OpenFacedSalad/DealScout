import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Header } from './components/Header';
import { LocationModal } from './components/LocationModal';
import { CircularsView } from './components/CircularsView';
import { DealComparisonView } from './components/DealComparisonView';
import { DealComparisonModal } from './components/DealComparisonModal';
import { ShoppingListView } from './components/ShoppingListView';
import { groupSimilarDeals, findBetterAlternative } from './utils/dealMatcher';
import { Store, DealItem, UserLocation, ShoppingListItem, ComparisonGroup } from './types';
import { Loader2, AlertCircle } from 'lucide-react';

const SHOPPING_LIST_STORAGE_KEY = 'grocery_circulars_shopping_list_v2';
const LOCATION_STORAGE_KEY = 'grocery_circulars_location_v2';
const RADIUS_STORAGE_KEY = 'grocery_circulars_radius_v2';

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'circulars' | 'compare' | 'list'>('circulars');
  
  // Radius State (1, 5, 10, 25 miles)
  const [radiusMiles, setRadiusMiles] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(RADIUS_STORAGE_KEY);
      if (saved) {
        const val = parseInt(saved, 10);
        if ([1, 5, 10, 25].includes(val)) return val;
      }
    } catch (e) {}
    return 10;
  });

  // Location State
  const [location, setLocation] = useState<UserLocation>(() => {
    try {
      const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      latitude: 40.2234,
      longitude: -77.0016,
      city: 'Mechanicsburg',
      state: 'PA',
      zipCode: '17050',
      formattedAddress: 'Mechanicsburg, PA 17050',
      isGps: false,
      radiusMiles: 10,
    };
  });
  
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Circulars & Deals State
  const [stores, setStores] = useState<Store[]>([]);
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const [isLoadingCirculars, setIsLoadingCirculars] = useState(false);

  // Comparison State
  const [activeCompareGroup, setActiveCompareGroup] = useState<ComparisonGroup | null>(null);

  // Shopping List State
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>(() => {
    try {
      const saved = localStorage.getItem(SHOPPING_LIST_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  // Save shopping list to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SHOPPING_LIST_STORAGE_KEY, JSON.stringify(shoppingList));
    } catch (e) {}
  }, [shoppingList]);

  // Save location to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(location));
    } catch (e) {}
  }, [location]);

  // Save radius to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(RADIUS_STORAGE_KEY, radiusMiles.toString());
    } catch (e) {}
  }, [radiusMiles]);

  // Fetch circulars for location & radius
  const fetchCircularsForLocation = useCallback(async (loc: UserLocation, radius: number) => {
    setIsLoadingCirculars(true);
    try {
      const res = await fetch('/api/circulars/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: loc.latitude,
          lng: loc.longitude,
          city: loc.city,
          state: loc.state,
          zipCode: loc.zipCode,
          radiusMiles: radius,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.stores && Array.isArray(data.stores) && data.deals && Array.isArray(data.deals)) {
          setStores(data.stores);
          setDeals(data.deals);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch circulars:', err);
    } finally {
      setIsLoadingCirculars(false);
    }
  }, []);

  // GPS Geolocation Handler
  const handleDetectGps = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    setIsLoadingLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          // Resolve location coordinates to city/state/zip via server
          const res = await fetch('/api/location/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: latitude, lng: longitude }),
          });

          let city = 'Local Area';
          let state = 'US';
          let zipCode: string | undefined = undefined;
          let formattedAddress = 'Your Current GPS Location';

          if (res.ok) {
            const data = await res.json();
            if (data.city) city = data.city;
            if (data.state) state = data.state;
            if (data.zipCode) zipCode = data.zipCode;
            if (data.formattedAddress) formattedAddress = data.formattedAddress;
          }

          const newLoc: UserLocation = {
            latitude,
            longitude,
            city,
            state,
            zipCode,
            formattedAddress,
            isGps: true,
            radiusMiles,
          };

          setLocation(newLoc);
          fetchCircularsForLocation(newLoc, radiusMiles);
        } catch (e) {
          console.error('Geocode error:', e);
          const fallbackLoc: UserLocation = {
            latitude,
            longitude,
            city: 'Nearby Area',
            state: 'US',
            formattedAddress: 'Live GPS Location',
            isGps: true,
            radiusMiles,
          };
          setLocation(fallbackLoc);
          fetchCircularsForLocation(fallbackLoc, radiusMiles);
        } finally {
          setIsLoadingLocation(false);
        }
      },
      (error) => {
        setIsLoadingLocation(false);
        let msg = 'Unable to auto-detect GPS location. Please choose a city or ZIP code.';
        if (error.code === error.PERMISSION_DENIED) {
          msg = 'Location permission was denied. You can select your city or ZIP code manually.';
        }
        setLocationError(msg);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [fetchCircularsForLocation, radiusMiles]);

  // Initial load: Attempt automatic GPS detection or load saved location
  useEffect(() => {
    // Check if user previously had GPS or saved location
    const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!saved && navigator.geolocation) {
      // First visit: automatically try detecting user's physical GPS location
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          fetch('/api/location/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: latitude, lng: longitude }),
          })
            .then((r) => r.json())
            .then((data) => {
              const detectedLoc: UserLocation = {
                latitude,
                longitude,
                city: data.city || 'Local Area',
                state: data.state || 'US',
                zipCode: data.zipCode,
                formattedAddress: data.formattedAddress || 'Live GPS Location',
                isGps: true,
                radiusMiles,
              };
              setLocation(detectedLoc);
              fetchCircularsForLocation(detectedLoc, radiusMiles);
            })
            .catch(() => {
              fetchCircularsForLocation(location, radiusMiles);
            });
        },
        () => {
          // If denied or timed out, load current location
          fetchCircularsForLocation(location, radiusMiles);
        },
        { timeout: 4000 }
      );
    } else {
      fetchCircularsForLocation(location, radiusMiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle radius change
  const handleChangeRadius = (newRadius: number) => {
    setRadiusMiles(newRadius);
    const updatedLoc = { ...location, radiusMiles: newRadius };
    setLocation(updatedLoc);
    fetchCircularsForLocation(updatedLoc, newRadius);
  };

  // Handle location change
  const handleSelectLocation = (newLoc: UserLocation) => {
    const updatedLoc = { ...newLoc, radiusMiles };
    setLocation(updatedLoc);
    setLocationError(null);
    setSelectedStoreId('all');
    fetchCircularsForLocation(updatedLoc, radiusMiles);
  };

  // Filter stores within radius
  const storesWithinRadius = useMemo(() => {
    return stores.filter((s) => s.distanceMiles <= radiusMiles);
  }, [stores, radiusMiles]);

  const activeStoreIds = useMemo(() => {
    return new Set(storesWithinRadius.map((s) => s.id));
  }, [storesWithinRadius]);

  // Filter deals within active stores in radius
  const dealsWithinRadius = useMemo(() => {
    return deals.filter((d) => activeStoreIds.has(d.storeId));
  }, [deals, activeStoreIds]);

  // Group similar deals for comparison engine
  const comparisonGroups = useMemo(() => {
    return groupSimilarDeals(dealsWithinRadius);
  }, [dealsWithinRadius]);

  // Quick lookup maps
  const similarDealsCounts = useMemo(() => {
    const map = new Map<string, number>();
    comparisonGroups.forEach((g) => {
      map.set(g.productGroup, g.dealCount);
    });
    return map;
  }, [comparisonGroups]);

  const bestDealIds = useMemo(() => {
    const set = new Set<string>();
    comparisonGroups.forEach((g) => {
      if (g.dealCount > 1) {
        set.add(g.bestDealId);
      }
    });
    return set;
  }, [comparisonGroups]);

  // Update shopping list items with better alternative alerts
  const enrichedShoppingList = useMemo(() => {
    return shoppingList.map((item) => {
      const better = findBetterAlternative(item, dealsWithinRadius);
      return {
        ...item,
        betterAlternative: better,
      };
    });
  }, [shoppingList, dealsWithinRadius]);

  // Shopping List Handlers
  const isDealInList = (dealId: string) => {
    return shoppingList.some((item) => item.dealId === dealId);
  };

  const handleToggleShoppingList = (deal: DealItem) => {
    setShoppingList((prev) => {
      const existing = prev.find((i) => i.dealId === deal.id);
      if (existing) {
        return prev.filter((i) => i.dealId !== deal.id);
      } else {
        const newItem: ShoppingListItem = {
          id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          dealId: deal.id,
          dealItem: deal,
          storeId: deal.storeId,
          storeName: deal.storeName,
          storeLogoBg: deal.storeLogoBg,
          storeLogoText: deal.storeLogoText,
          price: deal.salePrice,
          originalPrice: deal.originalPrice,
          quantity: 1,
          unitPrice: deal.unitPrice,
          category: deal.category,
          checked: false,
          addedAt: Date.now(),
        };
        return [newItem, ...prev];
      }
    });
  };

  const handleAddDealToList = (deal: DealItem) => {
    if (!isDealInList(deal.id)) {
      handleToggleShoppingList(deal);
    }
  };

  const handleAddCustomItem = (title: string, storeName = 'Local Store') => {
    const newItem: ShoppingListItem = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      customTitle: title,
      storeId: 'store-custom',
      storeName: storeName,
      storeLogoBg: 'bg-stone-200',
      storeLogoText: 'ITEM',
      price: 0,
      originalPrice: 0,
      quantity: 1,
      category: 'other',
      checked: false,
      addedAt: Date.now(),
    };
    setShoppingList((prev) => [newItem, ...prev]);
  };

  const handleToggleItem = (id: string) => {
    setShoppingList((prev) =>
      prev.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i))
    );
  };

  const handleRemoveItem = (id: string) => {
    setShoppingList((prev) => prev.filter((i) => i.id !== id));
  };

  const handleUpdateQuantity = (id: string, delta: number) => {
    setShoppingList((prev) =>
      prev
        .map((i) => {
          if (i.id === id) {
            const nextQty = Math.max(1, i.quantity + delta);
            return { ...i, quantity: nextQty };
          }
          return i;
        })
        .filter((i) => i.quantity > 0)
    );
  };

  const handleSwapBetterDeal = (itemId: string, newDealId: string) => {
    const newDeal = deals.find((d) => d.id === newDealId);
    if (!newDeal) return;

    setShoppingList((prev) =>
      prev.map((i) => {
        if (i.id === itemId) {
          return {
            ...i,
            dealId: newDeal.id,
            dealItem: newDeal,
            storeId: newDeal.storeId,
            storeName: newDeal.storeName,
            storeLogoBg: newDeal.storeLogoBg,
            storeLogoText: newDeal.storeLogoText,
            price: newDeal.salePrice,
            originalPrice: newDeal.originalPrice,
            unitPrice: newDeal.unitPrice,
            category: newDeal.category,
          };
        }
        return i;
      })
    );
  };

  const handleClearCompleted = () => {
    setShoppingList((prev) => prev.filter((i) => !i.checked));
  };

  // Compare item trigger
  const handleCompareSimilar = (deal: DealItem) => {
    const group = comparisonGroups.find((g) => g.productGroup === deal.genericProductGroup);
    if (group) {
      setActiveCompareGroup(group);
    } else {
      // Fallback single comparison group
      setActiveCompareGroup({
        productGroup: deal.genericProductGroup || deal.id,
        displayName: deal.title,
        category: deal.category,
        dealCount: 1,
        lowestPrice: deal.salePrice,
        lowestUnitPrice: deal.unitPrice,
        bestDealId: deal.id,
        bestStoreName: deal.storeName,
        deals: [deal],
      });
    }
  };

  // Metrics
  const totalCartSavings = shoppingList.reduce(
    (sum, item) => sum + (item.checked ? 0 : Math.max(0, (item.originalPrice || item.price) - item.price) * item.quantity),
    0
  );

  return (
    <div className="min-h-screen bg-stone-100/70 text-stone-900 font-sans antialiased selection:bg-emerald-200 selection:text-emerald-950 pb-16">
      
      {/* Top Header */}
      <Header
        location={location}
        isLoadingLocation={isLoadingLocation}
        onOpenLocationModal={() => setIsLocationModalOpen(true)}
        onDetectGps={handleDetectGps}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        shoppingListCount={shoppingList.length}
        totalSavings={totalCartSavings}
        comparisonCount={comparisonGroups.filter((g) => g.dealCount > 1).length}
        radiusMiles={radiusMiles}
        onChangeRadius={handleChangeRadius}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        
        {/* Loading Indicator */}
        {isLoadingCirculars && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-emerald-900 animate-pulse">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span className="text-sm font-bold">
                Scanning active weekly grocery flyers for {location.city}, {location.state} within {radiusMiles} miles...
              </span>
            </div>
          </div>
        )}

        {/* Location Error Notice */}
        {locationError && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between text-amber-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <span className="text-sm">{locationError}</span>
            </div>
            <button
              onClick={() => setIsLocationModalOpen(true)}
              className="text-xs font-bold text-amber-800 underline hover:no-underline ml-3 cursor-pointer"
            >
              Choose City / ZIP
            </button>
          </div>
        )}

        {/* View Routing */}
        {activeTab === 'circulars' && (
          <CircularsView
            stores={storesWithinRadius}
            deals={dealsWithinRadius}
            selectedStoreId={selectedStoreId}
            onSelectStore={setSelectedStoreId}
            onToggleShoppingList={handleToggleShoppingList}
            isDealInList={isDealInList}
            onCompareSimilar={handleCompareSimilar}
            similarDealsCounts={similarDealsCounts}
            bestDealIds={bestDealIds}
            radiusMiles={radiusMiles}
            onChangeRadius={handleChangeRadius}
            location={location}
            isLoadingCirculars={isLoadingCirculars}
          />
        )}

        {activeTab === 'compare' && (
          <DealComparisonView
            comparisonGroups={comparisonGroups}
            onOpenCompareModal={(group) => setActiveCompareGroup(group)}
            onAddDealToList={handleAddDealToList}
            isDealInList={isDealInList}
          />
        )}

        {activeTab === 'list' && (
          <ShoppingListView
            items={enrichedShoppingList}
            onToggleItem={handleToggleItem}
            onRemoveItem={handleRemoveItem}
            onUpdateQuantity={handleUpdateQuantity}
            onAddCustomItem={handleAddCustomItem}
            onSwapBetterDeal={handleSwapBetterDeal}
            allDeals={dealsWithinRadius}
            onClearCompleted={handleClearCompleted}
          />
        )}

      </main>

      {/* Location Modal */}
      <LocationModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        currentLocation={location}
        onSelectLocation={handleSelectLocation}
        onDetectGps={handleDetectGps}
        isLoadingLocation={isLoadingLocation}
        radiusMiles={radiusMiles}
        onChangeRadius={handleChangeRadius}
      />

      {/* Deal Comparison Modal */}
      <DealComparisonModal
        group={activeCompareGroup}
        onClose={() => setActiveCompareGroup(null)}
        onAddDealToList={handleAddDealToList}
        isDealInList={isDealInList}
      />

      {/* Vercel Web Analytics */}
      <Analytics />
    </div>
  );
}
