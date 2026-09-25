import React, { useState, useMemo } from 'react';
import {
  Scale,
  Sparkles,
  Award,
  ArrowRight,
  TrendingDown,
  Search,
  Layers,
  Plus,
  Check,
  Percent,
  X,
  ExternalLink,
} from 'lucide-react';
import { ComparisonGroup, Store, ShoppingListItem, DealItem, DealCategory } from '../types';
import DealCard from './DealCard';

interface DealComparisonViewProps {
  groups: ComparisonGroup[];
  stores: Store[];
  shoppingList: ShoppingListItem[];
  onToggleList: (deal: DealItem) => void;
  onAddToList?: (deal: DealItem) => void;
  onOpenDetailModal: (group: ComparisonGroup) => void;
}

export default function DealComparisonView({
  groups,
  stores,
  shoppingList,
  onToggleList,
  onAddToList,
  onOpenDetailModal,
}: DealComparisonViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | DealCategory>('all');
  const [onlyMultiStore, setOnlyMultiStore] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [verificationDeal, setVerificationDeal] = useState<DealItem | null>(null);

  const handleAddToList = onAddToList || onToggleList;

  const listDealIds = useMemo(() => {
    return new Set(
      shoppingList
        .filter((item) => Boolean(item.deal?.id))
        .map((item) => item.deal!.id)
    );
  }, [shoppingList]);

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      if (onlyMultiStore && group.totalStores <= 1) {
        return false;
      }
      if (selectedCategory !== 'all' && group.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = group.productName.toLowerCase().includes(q);
        const matchesStores = group.deals.some((d) => d.storeName.toLowerCase().includes(q));
        return matchesName || matchesStores;
      }
      return true;
    });
  }, [groups, onlyMultiStore, selectedCategory, searchQuery]);

  const multiStoreCount = useMemo(() => groups.filter((g) => g.totalStores > 1).length, [groups]);
  const averageSavingsPercent = useMemo(() => {
    const multi = groups.filter((g) => g.totalStores > 1 && g.maxSavingsPercent > 0);
    if (multi.length === 0) return 0;
    const total = multi.reduce((sum, g) => sum + g.maxSavingsPercent, 0);
    return Math.round(total / multi.length);
  }, [groups]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <Scale className="w-4 h-4 text-emerald-600" />
            <span>Cross-Store Commodity Matcher</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tracking-tight">
            Compare Competing Local Supermarkets
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Prices are normalized per unit ($/lb, $/oz, $/egg, $/gal) to eliminate deceptive package sizing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-100 text-right">
            <span className="block text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
              Competing Commodities
            </span>
            <span className="text-lg font-black text-emerald-800 font-mono">
              {multiStoreCount}
            </span>
          </div>
          <div className="bg-amber-50 px-3.5 py-2 rounded-xl border border-amber-100 text-right">
            <span className="block text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
              Avg. Spread
            </span>
            <span className="text-lg font-black text-amber-900 font-mono">
              {averageSavingsPercent}%
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
              }
            }}
            placeholder="Filter commodities (e.g. ground beef, eggs, milk, bread)..."
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

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setOnlyMultiStore(!onlyMultiStore)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition border ${
              onlyMultiStore
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {onlyMultiStore ? 'Competing Deals Only' : 'All Commodities'}
          </button>
        </div>
      </div>

      {/* Sticky Horizontal Filter Bar */}
      <div
        className="sticky top-0 z-20 bg-white border-b border-gray-200 py-3 px-4 flex gap-2 overflow-x-auto whitespace-nowrap shadow-sm rounded-xl"
        style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
      >
        <button 
          onClick={() => setActiveFilter(null)}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${!activeFilter ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          All Deals
        </button>
        {groups.map((group) => (
          <button
            key={group.genericProductGroup}
            onClick={() => setActiveFilter(activeFilter === group.genericProductGroup ? null : group.genericProductGroup)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${activeFilter === group.genericProductGroup ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {group.productName}
          </button>
        ))}
      </div>

      {filteredGroups.filter(group => !activeFilter || group.genericProductGroup === activeFilter).length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400 mb-3">
            <Scale className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">No matching commodity comparisons</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Try expanding your search radius in the header or turning off "Competing Deals Only".
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredGroups
            .filter(group => !activeFilter || group.genericProductGroup === activeFilter)
            .map((group, gIdx) => {
            // 1. Filter out unpriced items for the math check
            const comparableDeals = group.deals.filter(
              (d) => d.salePrice > 0 && d.normalizedUnitCost > 0 && !d.isUnpricedPromo
            );

            // 2. Sort only the valid, priced deals to find the true winner
            const sortedDeals = [...comparableDeals].sort(
              (a, b) => a.normalizedUnitCost - b.normalizedUnitCost
            );

            const bestDeal = sortedDeals[0] || group.bestDeal;

            // 3. If there are no valid priced deals in the group, skip rendering it in the comparison tab
            if (!bestDeal || bestDeal.salePrice <= 0 || bestDeal.isUnpricedPromo) {
              return null;
            }

            // Calculate savings based on the highest price in the comparable group vs the best deal
            const highestPrice = comparableDeals.length > 0
              ? Math.max(...comparableDeals.map((d) => d.normalizedUnitCost))
              : bestDeal.normalizedUnitCost;
            const percentSaved = highestPrice > bestDeal.normalizedUnitCost
              ? Math.round(((highestPrice - bestDeal.normalizedUnitCost) / highestPrice) * 100)
              : 0;

            const runnersUp = group.deals.filter((d) => d.id !== bestDeal.id);
            const isBestInList = listDealIds.has(bestDeal.id);

            return (
              <div
                key={group.genericProductGroup ? `group-${group.genericProductGroup}` : `group-idx-${gIdx}`}
                className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 transition-all p-5 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        {group.category.replace('_', ' & ')}
                      </span>
                      <h2 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
                        {group.productName}
                      </h2>
                    </div>

                    <span
                      className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                        group.totalStores > 1
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>{group.totalStores} store{group.totalStores > 1 ? 's' : ''}</span>
                    </span>
                  </div>

                  <div
                    onClick={() => setVerificationDeal(bestDeal)}
                    className="bg-gradient-to-br from-emerald-50/70 to-teal-50/30 rounded-xl p-4 border border-emerald-200/80 mb-4 cursor-pointer hover:border-emerald-300 hover:shadow-xs transition"
                    title="Click to verify circular source card"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wider">
                        <Award className="w-4 h-4 text-emerald-600" />
                        <span>Best Local Deal</span>
                      </div>
                      {percentSaved > 0 && (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[11px] font-bold">
                          <TrendingDown className="w-3 h-3" />
                          <span>Save {percentSaved}%</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-black uppercase"
                            style={{ backgroundColor: bestDeal.storeLogoBg, color: bestDeal.storeLogoText }}
                          >
                            {bestDeal.storeLogoText}
                          </span>
                          <span className="text-xs font-bold text-slate-900 truncate max-w-[160px]">
                            {bestDeal.storeName}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 font-medium line-clamp-1">{bestDeal.title}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-lg font-black text-emerald-800 font-mono leading-none">
                          ${Number(bestDeal.normalizedUnitCost || bestDeal.salePrice).toFixed(2)}
                          <span className="text-xs text-slate-500 font-normal ml-1">
                            / {bestDeal.normalizedUnitType || 'ea'}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500 font-medium">
                          ${bestDeal.salePrice.toFixed(2)} pkg
                        </span>
                      </div>
                    </div>
                  </div>

                  {runnersUp.length > 0 && (
                    <div className="space-y-2 mb-4">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                        Other Store Offers:
                      </span>
                      {runnersUp.map((deal, rIdx) => {
                        const isUnpriced = deal.isUnpricedPromo || deal.salePrice === 0;
                        const unitDelta = deal.normalizedUnitCost - bestDeal.normalizedUnitCost;
                        const pctHigher = !isUnpriced && bestDeal.normalizedUnitCost > 0 && unitDelta > 0
                          ? Math.round((unitDelta / bestDeal.normalizedUnitCost) * 100)
                          : 0;
                        const isRunnerInList = listDealIds.has(deal.id);

                        return (
                          <div
                            key={deal.id ? `runner-${deal.id}` : `runner-${deal.storeId || 'store'}-${rIdx}`}
                            onClick={() => setVerificationDeal(deal)}
                            className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100/80 hover:border-emerald-200 transition text-left cursor-pointer group text-xs"
                            title="Click to verify circular source card"
                          >
                            <div className="flex items-center space-x-2 truncate mr-2 flex-1 min-w-0">
                              <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0"
                                style={{ backgroundColor: deal.storeLogoBg, color: deal.storeLogoText }}
                              >
                                {deal.storeLogoText}
                              </span>
                              <span className="font-semibold text-slate-700 truncate">
                                {deal.storeName}
                              </span>
                            </div>

                            <div className="flex items-center space-x-2.5 shrink-0 ml-2">
                              <div className="flex flex-col text-right">
                                {isUnpriced ? (
                                  <span className="font-semibold text-slate-700">Varies in-store</span>
                                ) : (
                                  <span className="font-bold text-slate-900 font-mono">
                                    ${Number(deal.normalizedUnitCost || deal.salePrice).toFixed(2)}
                                    <span className="text-xs text-slate-500 font-normal ml-1">
                                      / {deal.normalizedUnitType || 'ea'}
                                    </span>
                                  </span>
                                )}
                              </div>
                              {pctHigher > 0 && (
                                <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                                  +{pctHigher}%
                                </span>
                              )}
                              {isUnpriced && (
                                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                  Promo
                                </span>
                              )}

                              {/* Explicit Add to List Button */}
                              {handleAddToList && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation(); // Prevents the verification modal from opening
                                    handleAddToList(deal);
                                  }}
                                  className={`p-1.5 rounded-lg transition shrink-0 ${
                                    isRunnerInList
                                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800'
                                  }`}
                                  title={isRunnerInList ? 'Saved in shopping list' : `Add ${deal.storeName} deal to list`}
                                  aria-label={`Add ${deal.storeName} deal to list`}
                                >
                                  {isRunnerInList ? (
                                    <Check className="w-3.5 h-3.5" />
                                  ) : (
                                    <Plus className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() => onOpenDetailModal(group)}
                    className="flex-1 inline-flex items-center justify-center space-x-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>AI Deep Comparison</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                  </button>

                  <button
                    onClick={() => onToggleList(bestDeal)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shrink-0 ${
                      isBestInList
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                    title={isBestInList ? 'In Shopping List' : 'Add winning deal to list'}
                  >
                    {isBestInList ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Saved</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Best</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Source Verification Modal Overlay */}
      {verificationDeal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setVerificationDeal(null)}
        >
          <div
            className="relative w-full max-w-sm animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <div className="flex justify-end w-full mb-2">
              <button
                onClick={() => setVerificationDeal(null)}
                className="bg-slate-800/80 hover:bg-slate-800 text-white rounded-full p-2 backdrop-blur-md transition shadow-md"
                aria-label="Close verification modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Render the exact circular item */}
            <div className="shadow-2xl rounded-2xl overflow-hidden bg-white">
              <DealCard
                deal={verificationDeal}
                onToggleList={onToggleList}
                isInList={listDealIds.has(verificationDeal.id)}
              />
            </div>

            <div className="mt-3 text-center">
              <p className="text-xs font-bold text-white/90 uppercase tracking-widest bg-slate-900/40 backdrop-blur-xs py-1 px-3 rounded-full inline-block">
                Source Circular Verification
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
