import React, { useEffect, useState } from 'react';
import { X, Sparkles, Trophy, Check, ArrowRight, Store, AlertCircle, TrendingDown, Plus, Loader2 } from 'lucide-react';
import { DealItem, ComparisonGroup } from '../types';

interface DealComparisonModalProps {
  group: ComparisonGroup | null;
  onClose: () => void;
  onAddDealToList: (deal: DealItem) => void;
  isDealInList: (dealId: string) => boolean;
}

export const DealComparisonModal: React.FC<DealComparisonModalProps> = ({
  group,
  onClose,
  onAddDealToList,
  isDealInList,
}) => {
  const [aiAnalysis, setAiAnalysis] = useState<ComparisonGroup['aiAnalysis'] | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  useEffect(() => {
    if (!group || group.deals.length < 2) return;

    let isMounted = true;
    setIsLoadingAi(true);

    fetch('/api/compare/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productGroupName: group.displayName,
        deals: group.deals,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.bestDealId) {
          setAiAnalysis(data);
        }
      })
      .catch((err) => {
        console.error('Error fetching AI comparison:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingAi(false);
      });

    return () => {
      isMounted = false;
    };
  }, [group]);

  if (!group) return null;

  // Identify winning deal (from AI or default lowest normalized cost)
  const winningDealId = aiAnalysis?.bestDealId || group.bestDealId;
  const bestDeal = group.deals.find((d) => d.id === winningDealId) || group.deals[0];
  const sortedDeals = [...group.deals].sort((a, b) => {
    if (a.id === winningDealId) return -1;
    if (b.id === winningDealId) return 1;
    return a.normalizedUnitCost - b.normalizedUnitCost;
  });

  const maxUnitCost = Math.max(...group.deals.map((d) => d.normalizedUnitCost || 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl border border-stone-200 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-stone-100 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 uppercase tracking-wider">
                Cross-Store Deal Comparison
              </span>
              <span className="text-xs text-stone-500 font-medium">
                {group.deals.length} local grocery stores competing
              </span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-stone-900 mt-1">
              Comparing Deals for: {group.displayName}
            </h3>
          </div>
          <button
            id="close-compare-modal-btn"
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* AI Deal Verdict Box */}
        <div className="mt-6 p-5 rounded-2xl bg-emerald-950 text-white shadow-lg border border-emerald-800/40 relative overflow-hidden">
          <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-emerald-950 flex-shrink-0 shadow-md">
              <Trophy className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Recommended Best Value Deal
                </span>
                {isLoadingAi && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Analyzing flyer fine print...
                  </span>
                )}
              </div>

              <h4 className="text-lg font-bold text-white mt-1">
                {bestDeal.storeName} — {bestDeal.title}
              </h4>

              <p className="text-sm text-emerald-100/90 mt-1 leading-relaxed">
                {aiAnalysis?.verdict ||
                  `${bestDeal.storeName} offers the lowest unit cost at ${bestDeal.unitPrice}, making it the highest value option among nearby grocery circulars.`}
              </p>

              {aiAnalysis?.keyDifference && (
                <div className="mt-3 pt-3 border-t border-emerald-800/60 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-emerald-300">
                  <span className="font-semibold">Key Difference:</span>
                  <span className="text-emerald-100">{aiAnalysis.keyDifference}</span>
                </div>
              )}

              {aiAnalysis?.caveats && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-800/40">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{aiAnalysis.caveats}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Side-by-Side Breakdown & Unit Price Meter */}
        <div className="mt-6">
          <h4 className="text-sm font-bold text-stone-900 uppercase tracking-wider mb-3">
            Unit Price Comparison Meter
          </h4>

          <div className="space-y-3">
            {sortedDeals.map((deal) => {
              const isWinner = deal.id === winningDealId;
              const inList = isDealInList(deal.id);
              const percentageOfMax = Math.round((deal.normalizedUnitCost / maxUnitCost) * 100);

              return (
                <div
                  key={deal.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    isWinner
                      ? 'border-emerald-500 bg-emerald-50/40 shadow-xs'
                      : 'border-stone-200 bg-stone-50/30'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    
                    {/* Store & Title */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${deal.storeLogoBg} text-stone-800 border border-stone-200`}>
                          {deal.storeLogoText}
                        </span>
                        <span className="text-xs font-bold text-stone-900">
                          {deal.storeName}
                        </span>
                        {isWinner && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white uppercase tracking-wider">
                            Best Value
                          </span>
                        )}
                        {deal.dealBadge && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                            {deal.dealBadge}
                          </span>
                        )}
                      </div>

                      <div className="text-sm font-bold text-stone-900">
                        {deal.title}
                      </div>
                      <div className="text-xs text-stone-500">
                        {deal.unitDescription} • Valid until {deal.validUntil}
                      </div>

                      {/* Bar comparison */}
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex-1 h-2.5 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isWinner ? 'bg-emerald-600' : 'bg-stone-400'
                            }`}
                            style={{ width: `${Math.max(15, percentageOfMax)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-black min-w-[70px] text-right ${isWinner ? 'text-emerald-700 font-extrabold' : 'text-stone-700'}`}>
                          {deal.unitPrice}
                        </span>
                      </div>
                    </div>

                    {/* Price & Add to List Action */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-stone-100 gap-2">
                      <div className="text-right">
                        <div className="text-xl font-black text-stone-900">
                          ${deal.salePrice.toFixed(2)}
                        </div>
                        {deal.originalPrice > deal.salePrice && (
                          <div className="text-xs text-stone-400 line-through">
                            orig ${deal.originalPrice.toFixed(2)}
                          </div>
                        )}
                      </div>

                      <button
                        id={`add-compared-deal-${deal.id}`}
                        onClick={() => onAddDealToList(deal)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                          inList
                            ? 'bg-emerald-700 text-white'
                            : isWinner
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                            : 'bg-stone-900 hover:bg-stone-800 text-white'
                        }`}
                      >
                        {inList ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Saved</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>{isWinner ? 'Save Best Deal' : 'Save This'}</span>
                          </>
                        )}
                      </button>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between">
          <span className="text-xs text-stone-500">
            Prices verified from active weekly circular advertisements.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs rounded-xl transition cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
