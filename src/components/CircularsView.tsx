import React, { useState } from 'react';
import { Search, Filter, Store as StoreIcon, Calendar, MapPin, Tag, Sparkles, Percent, ArrowUpDown, Clock, Compass, AlertCircle, Loader2 } from 'lucide-react';
import { Store, DealItem, DealCategory, DealType, UserLocation } from '../types';
import { DealCard } from './DealCard';

interface CircularsViewProps {
  stores: Store[];
  deals: DealItem[];
  selectedStoreId: string;
  onSelectStore: (storeId: string) => void;
  onToggleShoppingList: (deal: DealItem) => void;
  isDealInList: (dealId: string) => boolean;
  onCompareSimilar: (deal: DealItem) => void;
  similarDealsCounts: Map<string, number>;
  bestDealIds: Set<string>;
  radiusMiles: number;
  onChangeRadius: (radius: number) => void;
  location: UserLocation;
  isLoadingCirculars: boolean;
}

export const CircularsView: React.FC<CircularsViewProps> = ({
  stores,
  deals,
  selectedStoreId,
  onSelectStore,
  onToggleShoppingList,
  isDealInList,
  onCompareSimilar,
  similarDealsCounts,
  bestDealIds,
  radiusMiles,
  onChangeRadius,
  location,
  isLoadingCirculars,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDealType, setSelectedDealType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'discount' | 'price_asc' | 'unit_cost'>('discount');

  // Filter stores within the active radius
  const storesWithinRadius = stores.filter((s) => s.distanceMiles <= radiusMiles);

  // Selected store metadata
  const currentStore = storesWithinRadius.find((s) => s.id === selectedStoreId) || null;

  // Filter deals by active stores, search, category, and promo type
  const activeStoreIds = new Set(storesWithinRadius.map((s) => s.id));
  
  const filteredDeals = deals.filter((deal) => {
    const isStoreInRadius = activeStoreIds.has(deal.storeId);
    if (!isStoreInRadius) return false;

    const matchesStore = selectedStoreId === 'all' || deal.storeId === selectedStoreId;
    const matchesCategory = selectedCategory === 'all' || deal.category === selectedCategory;
    const matchesSearch =
      deal.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      deal.storeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (deal.subtitle && deal.subtitle.toLowerCase().includes(searchQuery.toLowerCase())) ||
      deal.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

    let matchesType = true;
    if (selectedDealType === 'bogo') matchesType = deal.dealType === 'bogo';
    else if (selectedDealType === 'digital_coupon') matchesType = deal.dealType === 'digital_coupon';
    else if (selectedDealType === 'high_discount') matchesType = deal.discountPercent >= 35;
    else if (selectedDealType === 'organic') matchesType = deal.qualityTier === 'organic' || deal.tags.includes('USDA Organic');

    return matchesStore && matchesCategory && matchesSearch && matchesType;
  });

  // Sort deals
  const sortedDeals = [...filteredDeals].sort((a, b) => {
    if (sortBy === 'discount') return b.discountPercent - a.discountPercent;
    if (sortBy === 'price_asc') return a.salePrice - b.salePrice;
    if (sortBy === 'unit_cost') return a.normalizedUnitCost - b.normalizedUnitCost;
    return 0;
  });

  const radiusChoices = [1, 5, 10, 25];

  return (
    <div className="space-y-6">
      
      {/* Location, Radius & Store Discovery Banner */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-stone-900">
                  {location.city}, {location.state} {location.zipCode ? `(${location.zipCode})` : ''}
                </span>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {storesWithinRadius.length} {storesWithinRadius.length === 1 ? 'Store' : 'Stores'} within {radiusMiles}mi
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Live circulars for local supermarkets near this geographic location
              </p>
            </div>
          </div>

          {/* Quick Radius Selector Filter Bar */}
          <div className="flex items-center gap-1.5 self-start sm:self-auto bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs">
            <span className="px-2 font-bold text-stone-500 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-stone-400" />
              Radius:
            </span>
            {radiusChoices.map((r) => (
              <button
                key={r}
                id={`radius-pill-${r}`}
                onClick={() => onChangeRadius(r)}
                className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
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

        {/* Store Tabs Strip */}
        <div className="mt-3.5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              id="store-tab-all"
              onClick={() => onSelectStore('all')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                selectedStoreId === 'all'
                  ? 'bg-stone-900 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              <StoreIcon className="w-3.5 h-3.5" />
              <span>All Stores ({filteredDeals.length})</span>
            </button>

            {storesWithinRadius.map((store) => (
              <button
                key={store.id}
                id={`store-tab-${store.id}`}
                onClick={() => onSelectStore(store.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 cursor-pointer ${
                  selectedStoreId === store.id
                    ? 'bg-stone-900 text-white shadow-xs'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200/60'
                }`}
              >
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-black ${store.logoBg}`}>
                  {store.logoText}
                </span>
                <span>{store.name}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  selectedStoreId === store.id ? 'bg-stone-800 text-emerald-400' : 'bg-stone-200/70 text-stone-600'
                }`}>
                  {store.distanceMiles} mi
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* If no stores within very small radius */}
        {storesWithinRadius.length === 0 && (
          <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between text-xs text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>No grocery stores located within {radiusMiles} mile of this location.</span>
            </div>
            <button
              onClick={() => onChangeRadius(10)}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg cursor-pointer"
            >
              Expand to 10 miles
            </button>
          </div>
        )}
      </div>

      {/* Selected Store Flyer Banner */}
      {currentStore && (
        <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-3xl p-5 sm:p-7 shadow-md border border-stone-700">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`px-2.5 py-0.5 rounded text-xs font-black ${currentStore.logoBg}`}>
                  {currentStore.logoText}
                </span>
                <span className="text-xs font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                  {currentStore.distanceMiles} miles from {location.city}, {location.state}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                {currentStore.name} — {currentStore.flyerTitle}
              </h2>
              <div className="flex items-center gap-4 text-xs text-stone-300 mt-2 flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  {currentStore.validDates}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                  {currentStore.address}, {currentStore.city}, {currentStore.state}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  {currentStore.operatingHours}
                </span>
              </div>
            </div>

            <div className="bg-stone-800/90 p-3.5 rounded-2xl border border-stone-700 text-center flex-shrink-0">
              <span className="text-xs text-stone-400 block font-medium">Featured Specials</span>
              <span className="text-sm font-bold text-white block mt-0.5">
                {currentStore.featuredCategory}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Controls */}
      <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs space-y-3">
        
        {/* Search & Sort Row */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="deals-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search circular deals (e.g. Avocado, Steak, Milk, Eggs)..."
              className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
            />
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <span className="text-xs font-bold text-stone-500 flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5" />
              Sort:
            </span>
            <select
              id="deals-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="discount">Highest % Discount</option>
              <option value="price_asc">Lowest Price ($)</option>
              <option value="unit_cost">Lowest Unit Cost ($/lb, $/oz)</option>
            </select>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {[
            { id: 'all', label: 'All Categories' },
            { id: 'produce', label: 'Fresh Produce' },
            { id: 'meat_seafood', label: 'Meat & Seafood' },
            { id: 'dairy_eggs', label: 'Dairy & Eggs' },
            { id: 'bakery_deli', label: 'Bakery & Deli' },
            { id: 'pantry_snacks', label: 'Pantry & Snacks' },
            { id: 'household', label: 'Household' },
          ].map((cat) => (
            <button
              key={cat.id}
              id={`cat-filter-${cat.id}`}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Promo Type Badges */}
        <div className="flex items-center gap-2 overflow-x-auto pt-1 border-t border-stone-100 text-xs">
          <span className="text-stone-400 font-medium text-[11px] whitespace-nowrap">
            Promo Filter:
          </span>
          {[
            { id: 'all', label: 'All Deals' },
            { id: 'bogo', label: 'Buy 1 Get 1 Free (BOGO)' },
            { id: 'digital_coupon', label: 'Digital Coupons' },
            { id: 'high_discount', label: '35%+ Off' },
            { id: 'organic', label: 'Organic' },
          ].map((type) => (
            <button
              key={type.id}
              onClick={() => setSelectedDealType(type.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition whitespace-nowrap cursor-pointer ${
                selectedDealType === type.id
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

      </div>

      {/* Results Count & Match status */}
      <div className="flex items-center justify-between text-xs text-stone-500 px-1">
        <span>
          Showing <strong>{sortedDeals.length}</strong> active flyer deals from <strong>{storesWithinRadius.length}</strong> local stores within {radiusMiles}mi
        </span>
        <span className="flex items-center gap-1 text-emerald-700 font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          Unit prices automatically calibrated
        </span>
      </div>

      {/* Deals Grid */}
      {isLoadingCirculars ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-stone-200 p-8 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-3" />
          <h4 className="text-base font-bold text-stone-800">Fetching Local Store Circulars...</h4>
          <p className="text-xs text-stone-500 mt-1">
            Loading real weekly circular flyers and pricing for {location.city}, {location.state}
          </p>
        </div>
      ) : sortedDeals.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-stone-200 p-8">
          <h4 className="text-base font-bold text-stone-800">No circular deals match your filters</h4>
          <p className="text-xs text-stone-500 mt-1">
            Try resetting your search query, increasing the radius ({radiusMiles}mi), or selecting another category.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedDeals.map((deal) => {
            const inList = isDealInList(deal.id);
            const similarCount = similarDealsCounts.get(deal.genericProductGroup) || 1;
            const isBest = bestDealIds.has(deal.id);

            return (
              <DealCard
                key={deal.id}
                deal={deal}
                isInShoppingList={inList}
                onToggleShoppingList={onToggleShoppingList}
                onCompareSimilar={onCompareSimilar}
                similarDealsCount={similarCount}
                isBestInGroup={isBest}
              />
            );
          })}
        </div>
      )}

    </div>
  );
};
