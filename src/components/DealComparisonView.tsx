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
} from 'lucide-react';
import { ComparisonGroup, Store, ShoppingListItem, DealItem, DealCategory } from '../types';

interface DealComparisonViewProps {
  groups: ComparisonGroup[];
  stores: Store[];
  shoppingList: ShoppingListItem[];
  onToggleList: (deal: DealItem) => void;
  onOpenDetailModal: (group: ComparisonGroup) => void;
}

export default function DealComparisonView({
  groups,
  stores,
  shoppingList,
  onToggleList,
  onOpenDetailModal,
}: DealComparisonViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | DealCategory>('all');
  const [onlyMultiStore, setOnlyMultiStore] = useState(true);

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
            placeholder="Filter commodities (e.g. ground beef, eggs, milk, bread)..."
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
          />
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

      {filteredGroups.length === 0 ? (
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
          {filteredGroups.map((group) => {
            const best = group.bestDeal;
            const runnersUp = group.deals.slice(1);
            const isBestInList = listDealIds.has(best.id);

            return (
              <div
                key={group.genericProductGroup}
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

                  <div className="bg-gradient-to-br from-emerald-50/70 to-teal-50/30 rounded-xl p-4 border border-emerald-200/80 mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wider">
                        <Award className="w-4 h-4 text-emerald-600" />
                        <span>Best Local Deal</span>
                      </div>
                      {group.maxSavingsPercent > 0 && (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[11px] font-bold">
                          <TrendingDown className="w-3 h-3" />
                          <span>Save {group.maxSavingsPercent}%</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-black uppercase"
                            style={{ backgroundColor: best.storeLogoBg, color: best.storeLogoText }}
                          >
                            {best.storeLogoText}
                          </span>
                          <span className="text-xs font-bold text-slate-900 truncate max-w-[160px]">
                            {best.storeName}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 font-medium line-clamp-1">{best.title}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-lg font-black text-emerald-800 font-mono leading-none">
                          {best.unitPrice}
                        </div>
                        <span className="text-[11px] text-slate-500 font-medium">
                          ${best.salePrice.toFixed(2)} pkg
                        </span>
                      </div>
                    </div>
                  </div>

                  {runnersUp.length > 0 && (
                    <div className="space-y-2 mb-4">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                        Other Store Offers:
                      </span>
                      {runnersUp.map((deal) => {
                        const unitDelta = deal.normalizedUnitCost - best.normalizedUnitCost;
                        const pctHigher = best.normalizedUnitCost > 0
                          ? Math.round((unitDelta / best.normalizedUnitCost) * 100)
                          : 0;

                        return (
                          <div
                            key={deal.id}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                          >
                            <div className="flex items-center space-x-2 truncate mr-2">
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

                            <div className="flex items-center space-x-3 shrink-0">
                              <span className="font-mono font-bold text-slate-800">
                                {deal.unitPrice}
                              </span>
                              <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                                +{pctHigher}%
                              </span>
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
                    onClick={() => onToggleList(best)}
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
    </div>
  );
}
