import React, { useState } from 'react';
import { Sparkles, Trophy, ArrowRight, Search, Filter, ArrowLeftRight, Check, Plus } from 'lucide-react';
import { ComparisonGroup, DealItem, DealCategory } from '../types';

interface DealComparisonViewProps {
  comparisonGroups: ComparisonGroup[];
  onOpenCompareModal: (group: ComparisonGroup) => void;
  onAddDealToList: (deal: DealItem) => void;
  isDealInList: (dealId: string) => boolean;
}

export const DealComparisonView: React.FC<DealComparisonViewProps> = ({
  comparisonGroups,
  onOpenCompareModal,
  onAddDealToList,
  isDealInList,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Filter groups
  const filteredGroups = comparisonGroups.filter((g) => {
    const matchesSearch =
      g.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.deals.some((d) => d.storeName.toLowerCase().includes(searchQuery.toLowerCase()) || d.title.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || g.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      
      {/* Intro Banner */}
      <div className="bg-gradient-to-r from-amber-900 to-stone-900 text-white rounded-3xl p-6 sm:p-8 shadow-lg relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold uppercase tracking-wider mb-2 border border-amber-500/30">
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Live Circular Price Matcher
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Compare Similar Deals Across Local Grocery Stores
          </h2>
          <p className="text-stone-300 text-sm mt-2 leading-relaxed">
            We automatically scan nearby weekly store circulars, normalize prices by unit ($/lb, $/oz, $/unit), and highlight the best value so you never overpay for staple groceries.
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="compare-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items (e.g. Eggs, Chicken, Apples)..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
          />
        </div>

        {/* Categories */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All Compared' },
            { id: 'produce', label: 'Produce' },
            { id: 'meat_seafood', label: 'Meat & Seafood' },
            { id: 'dairy_eggs', label: 'Dairy & Eggs' },
            { id: 'bakery_deli', label: 'Bakery' },
            { id: 'pantry_snacks', label: 'Pantry' },
            { id: 'household', label: 'Household' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Comparison Match Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {filteredGroups.map((group) => {
          const sorted = [...group.deals].sort((a, b) => a.normalizedUnitCost - b.normalizedUnitCost);
          const best = sorted[0];
          const runnerUp = sorted[1];
          const priceSpread = runnerUp
            ? Math.round(((runnerUp.normalizedUnitCost - best.normalizedUnitCost) / runnerUp.normalizedUnitCost) * 100)
            : 0;

          return (
            <div
              key={group.productGroup}
              className="bg-white rounded-2xl border border-stone-200 hover:border-amber-400/80 shadow-xs hover:shadow-md transition-all p-5 flex flex-col justify-between"
            >
              {/* Header */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                    {group.dealCount} Local Circulars Competing
                  </span>
                  {priceSpread > 0 && (
                    <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      Save up to {priceSpread}%
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-black text-stone-900 leading-tight">
                  {group.displayName}
                </h3>
              </div>

              {/* Best Deal Winner Spotlight */}
              <div className="mt-4 p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                      Winner: {best.storeName}
                    </span>
                  </div>
                  <span className="text-xs font-extrabold text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-200 shadow-2xs">
                    {best.unitPrice}
                  </span>
                </div>
                <div className="text-xs text-stone-700 font-medium truncate">
                  {best.title}
                </div>
              </div>

              {/* Store Pricing Grid */}
              <div className="mt-3 divide-y divide-stone-100">
                {sorted.slice(0, 4).map((deal, idx) => {
                  const isTop = idx === 0;
                  const inList = isDealInList(deal.id);
                  return (
                    <div key={deal.id} className="py-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${deal.storeLogoBg} text-stone-800`}>
                          {deal.storeLogoText}
                        </span>
                        <span className={`font-semibold ${isTop ? 'text-stone-900 font-bold' : 'text-stone-600'}`}>
                          {deal.storeName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${isTop ? 'text-emerald-700' : 'text-stone-700'}`}>
                          {deal.unitPrice} (${deal.salePrice.toFixed(2)})
                        </span>
                        <button
                          id={`quick-save-${deal.id}`}
                          onClick={() => onAddDealToList(deal)}
                          className={`p-1 rounded-md transition cursor-pointer ${
                            inList ? 'text-emerald-600 bg-emerald-100' : 'text-stone-400 hover:text-stone-900 hover:bg-stone-100'
                          }`}
                          title={inList ? 'Saved in shopping list' : 'Add to shopping list'}
                        >
                          {inList ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Button */}
              <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between">
                <button
                  id={`open-comparison-btn-${group.productGroup}`}
                  onClick={() => onOpenCompareModal(group)}
                  className="w-full py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Deep Compare ({group.dealCount} Stores)</span>
                </button>
              </div>

            </div>
          );
        })}
      </div>

    </div>
  );
};
