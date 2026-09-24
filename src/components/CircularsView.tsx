import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Store as StoreIcon,
  Clock,
  MapPin,
  Calendar,
  Sparkles,
  Percent,
  SlidersHorizontal,
  DollarSign,
  Tag,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  Store,
  DealItem,
  UserLocation,
  RadiusOption,
  ShoppingListItem,
  DealCategory,
  SortOption,
} from '../types';
import DealCard from './DealCard';

interface CircularsViewProps {
  stores: Store[];
  deals: DealItem[];
  location: UserLocation;
  radiusMiles: RadiusOption;
  shoppingList: ShoppingListItem[];
  onToggleList: (deal: DealItem) => void;
  onOpenComparison: (genericProductGroup: string) => void;
}

type PromoFilter = 'all' | 'bogo' | 'digital_coupon' | 'high_discount' | 'organic';

const CATEGORIES: Array<{ id: 'all' | DealCategory; label: string }> = [
  { id: 'all', label: 'All Items' },
  { id: 'produce', label: 'Produce' },
  { id: 'meat_seafood', label: 'Meat & Seafood' },
  { id: 'dairy_eggs', label: 'Dairy & Eggs' },
  { id: 'bakery_deli', label: 'Bakery & Deli' },
  { id: 'pantry_snacks', label: 'Pantry & Snacks' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'beverages', label: 'Beverages' },
  { id: 'household', label: 'Household' },
];

export default function CircularsView({
  stores,
  deals,
  location,
  radiusMiles,
  shoppingList,
  onToggleList,
  onOpenComparison,
}: CircularsViewProps) {
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | DealCategory>('all');
  const [promoFilter, setPromoFilter] = useState<PromoFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('discount');

  // Ensure switching store tabs always snaps the view back to the top
  useEffect(() => {
    // Scroll window to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // If deals are contained in an internal scroll container, reset it as well:
    const dealsContainer = document.getElementById('deals-container');
    if (dealsContainer) {
      dealsContainer.scrollTop = 0;
    }
  }, [selectedStoreId]);

  const activeStore = useMemo(() => {
    if (selectedStoreId === 'all') return null;
    return stores.find((s) => s.id === selectedStoreId) || null;
  }, [selectedStoreId, stores]);

  const groupStats = useMemo(() => {
    const stats: Record<string, { minUnitCost: number; count: number }> = {};
    for (const deal of deals) {
      const group = deal.genericProductGroup;
      if (!stats[group]) {
        stats[group] = { minUnitCost: deal.normalizedUnitCost, count: 0 };
      }
      stats[group].count += 1;
      if (deal.normalizedUnitCost < stats[group].minUnitCost) {
        stats[group].minUnitCost = deal.normalizedUnitCost;
      }
    }
    return stats;
  }, [deals]);

  const listDealIds = useMemo(() => {
    return new Set(
      shoppingList
        .filter((item) => Boolean(item.deal?.id))
        .map((item) => item.deal!.id)
    );
  }, [shoppingList]);

  const displayedDeals = useMemo(() => {
    let result = deals.filter((deal) => {
      // 1. STRICT TEXT SEARCH (Titles & Subtitles ONLY, NEVER Categories)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const titleMatch = deal.title.toLowerCase().includes(query);
        const subMatch = deal.subtitle ? deal.subtitle.toLowerCase().includes(query) : false;
        
        if (!titleMatch && !subMatch) return false;
      }

      // 2. STORE TAB FILTER
      if (selectedStoreId && selectedStoreId !== 'all' && deal.storeId !== selectedStoreId) {
        return false;
      }

      // 3. PRE-BUILT UI FILTERS (BOGO, 35% Off, Digital Coupons, Organic)
      if (promoFilter === 'bogo') {
        if (!deal.isUnpricedPromo && deal.dealType !== 'bogo') return false;
      }
      if (promoFilter === 'high_discount' || (promoFilter as string) === '35_off') {
        if (deal.discountPercent < 35) return false;
      }
      if (promoFilter === 'digital_coupon' && deal.dealType !== 'digital_coupon') {
        return false;
      }
      if (promoFilter === 'organic' && deal.qualityTier !== 'organic' && !deal.tags.includes('organic')) {
        return false;
      }

      // 4. CATEGORY FILTER
      if (selectedCategory !== 'all' && deal.category !== selectedCategory) {
        return false;
      }

      return true;
    });

    return result.sort((a, b) => {
      if (sortBy === 'discount') {
        return b.discountPercent - a.discountPercent;
      }
      if (sortBy === 'price') {
        return a.salePrice - b.salePrice;
      }
      if (sortBy === 'unit_cost') {
        return a.normalizedUnitCost - b.normalizedUnitCost;
      }
      return 0;
    });
  }, [deals, selectedStoreId, selectedCategory, promoFilter, searchQuery, sortBy]);

  return (
    <div className="w-full h-full space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Active Weekly Circulars</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tracking-tight">
            {stores.length} Supermarkets near {location.city}, {location.state}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Aggregated within a <span className="font-semibold text-slate-700">{radiusMiles}-mile</span> radius. All prices normalized per unit.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-100 text-right">
            <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Total Deals
            </span>
            <span className="text-lg font-black text-slate-900 font-mono">
              {deals.length}
            </span>
          </div>
          <div className="bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-100 text-right">
            <span className="block text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
              Stores In Radius
            </span>
            <span className="text-lg font-black text-emerald-800 font-mono">
              {stores.length}
            </span>
          </div>
        </div>
      </div>

      {/* STICKY STORE FILTER */}
      <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-md py-3 border-b border-slate-200 shadow-sm w-full">
        <div className="flex items-center space-x-2 overflow-x-auto scrollbar-none w-full px-1">
          <button
            onClick={() => {
              setSelectedStoreId('all');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition shadow-2xs shrink-0 ${
              selectedStoreId === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <StoreIcon className="w-3.5 h-3.5" />
            <span>All Stores</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                selectedStoreId === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {deals.length}
            </span>
          </button>

          {stores.map((store, sIdx) => (
            <button
              key={store.id ? `store-${store.id}` : `store-idx-${sIdx}`}
              onClick={() => {
                setSelectedStoreId(store.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition shadow-2xs border shrink-0 ${
                selectedStoreId === store.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider"
                style={{
                  backgroundColor: store.logoBg,
                  color: store.logoText,
                }}
              >
                {store.logoText}
              </span>
              <span>{store.name}</span>
              <span className="text-[11px] font-normal text-slate-400">
                {store.distanceMiles}mi
              </span>
              {store.totalDealsCount > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    selectedStoreId === store.id
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {store.totalDealsCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeStore && (
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center space-x-2">
                <span
                  className="px-2 py-0.5 rounded text-xs font-black uppercase tracking-wider"
                  style={{ backgroundColor: activeStore.logoBg, color: activeStore.logoText }}
                >
                  {activeStore.logoText}
                </span>
                <h2 className="text-lg font-bold">{activeStore.flyerTitle}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                <span className="flex items-center space-x-1">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{activeStore.address}, {activeStore.city} ({activeStore.distanceMiles} miles away)</span>
                </span>
                <span className="flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{activeStore.operatingHours}</span>
                </span>
                <span className="flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Valid: {activeStore.validDates}</span>
                </span>
              </div>
            </div>

            <div className="sm:text-right border-t sm:border-t-0 sm:border-l border-slate-700 pt-3 sm:pt-0 sm:pl-5">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
                Store Speciality
              </span>
              <p className="text-xs font-medium text-slate-200 mt-0.5">
                {activeStore.featuredCategory}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                // Snap viewport back (zoom out) on Enter
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                }
              }}
              placeholder="Search deals (e.g. eggs, milk)..."
              className="w-full pl-10 pr-10 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-auto">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 hidden sm:inline" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Sort Deals By"
              className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="discount">Highest % Discount</option>
              <option value="unit_cost">Lowest Unit Cost</option>
              <option value="price">Lowest Package Price</option>
            </select>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto overflow-y-hidden max-w-full pb-1 scrollbar-none text-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider pr-1">
            Deals:
          </span>
          <button
            onClick={() => setPromoFilter('all')}
            className={`px-2.5 py-1 rounded-lg font-bold text-xs transition ${
              promoFilter === 'all'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setPromoFilter('bogo')}
            className={`px-2.5 py-1 rounded-lg font-bold text-xs transition ${
              promoFilter === 'bogo'
                ? 'bg-amber-100 text-amber-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            BOGO Deals
          </button>
          <button
            onClick={() => setPromoFilter('digital_coupon')}
            className={`px-2.5 py-1 rounded-lg font-bold text-xs transition ${
              promoFilter === 'digital_coupon'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Digital Coupons
          </button>
          <button
            onClick={() => setPromoFilter('high_discount')}
            className={`px-2.5 py-1 rounded-lg font-bold text-xs transition ${
              promoFilter === 'high_discount'
                ? 'bg-rose-100 text-rose-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            35%+ Off
          </button>
          <button
            onClick={() => setPromoFilter('organic')}
            className={`px-2.5 py-1 rounded-lg font-bold text-xs transition ${
              promoFilter === 'organic'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Organic
          </button>
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto overflow-y-hidden max-w-full pb-1 scrollbar-none text-xs border-t border-slate-100 pt-2.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl font-semibold text-xs whitespace-nowrap transition ${
                selectedCategory === cat.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {displayedDeals.length === 0 ? (
        <div id="deals-container" className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400 mb-3">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">No matching circular deals found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Try adjusting your search query, switching stores, or resetting category and promotion filters.
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              setPromoFilter('all');
              setSelectedStoreId('all');
            }}
            className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        <div id="deals-container" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 pb-20">
          {displayedDeals.map((deal, dIdx) => {
            const stats = groupStats[deal.genericProductGroup];
            const isLowestInGroup = stats ? deal.normalizedUnitCost <= stats.minUnitCost : false;
            const competingCount = stats ? stats.count : 1;
            const isInList = listDealIds.has(deal.id);

            return (
              <DealCard
                key={deal.id ? `deal-${deal.id}` : `deal-${deal.storeId || 'item'}-${dIdx}`}
                deal={deal}
                isLowestInGroup={isLowestInGroup}
                competingCount={competingCount}
                isInList={isInList}
                onToggleList={onToggleList}
                onOpenComparison={onOpenComparison}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
