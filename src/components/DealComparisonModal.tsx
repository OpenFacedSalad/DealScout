import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Scale,
  Award,
  AlertTriangle,
  Tag,
  Check,
  Plus,
  Loader2,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { ComparisonGroup, DealItem, ShoppingListItem, AIComparisonResult } from '../types';

interface DealComparisonModalProps {
  group: ComparisonGroup;
  isOpen: boolean;
  onClose: () => void;
  shoppingList: ShoppingListItem[];
  onToggleList: (deal: DealItem) => void;
}

export default function DealComparisonModal({
  group,
  isOpen,
  onClose,
  shoppingList,
  onToggleList,
}: DealComparisonModalProps) {
  const [analysis, setAnalysis] = useState<AIComparisonResult | null>(group.aiAnalysis || null);
  const [isLoading, setIsLoading] = useState<boolean>(!group.aiAnalysis);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const listDealIds = new Set(
    shoppingList
      .filter((item) => Boolean(item.deal?.id))
      .map((item) => item.deal!.id)
  );

  useEffect(() => {
    if (group.aiAnalysis) {
      setAnalysis(group.aiAnalysis);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setFetchError(null);

    async function fetchAIAnalysis() {
      try {
        const res = await fetch('/api/compare/deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productGroupName: group.genericProductGroup,
            deals: group.deals,
          }),
        });

        if (!res.ok) {
          throw new Error(`AI comparison failed with status: ${res.status}`);
        }

        const data = await res.json();
        if (isMounted) {
          setAnalysis(data);
          group.aiAnalysis = data;
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('[DealComparisonModal] AI Analysis Error:', err);
          setFetchError(err.message || 'Could not load AI analysis');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchAIAnalysis();

    return () => {
      isMounted = false;
    };
  }, [group]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 leading-tight">
                {group.productName}
              </h2>
              <p className="text-xs text-slate-500">
                Comparing {group.deals.length} active weekly circular offers across local supermarkets
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/50 via-slate-50 to-teal-50/30 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-black uppercase tracking-wider text-emerald-900">
                  Gemini 3.7 Flash Deal Intelligence
                </span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                Live Analysis
              </span>
            </div>

            {isLoading ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-2 text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                <p className="text-xs font-medium">Analyzing unit price differences, BOGOs & fine print...</p>
              </div>
            ) : fetchError ? (
              <div className="text-xs text-rose-600 font-medium">
                Unable to load AI verdict: {fetchError}
              </div>
            ) : analysis ? (
              <div className="space-y-3">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Shopper Verdict
                  </span>
                  <p className="text-sm font-bold text-slate-900 bg-white/80 p-3 rounded-xl border border-emerald-100 shadow-2xs">
                    {analysis.verdict}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-white/80 p-3 rounded-xl border border-slate-200/80">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                      Key Difference
                    </span>
                    <p className="text-xs font-semibold text-slate-800">
                      {analysis.keyDifference}
                    </p>
                  </div>

                  <div className="bg-white/80 p-3 rounded-xl border border-slate-200/80">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                      Unit Price Spread
                    </span>
                    <p className="text-xs font-black text-emerald-700 font-mono">
                      {analysis.unitPriceAdvantage}
                    </p>
                  </div>
                </div>

                {analysis.caveats && analysis.caveats !== 'None' && (
                  <div className="flex items-start space-x-2 bg-amber-50/80 border border-amber-200/80 p-3 rounded-xl text-xs text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Purchase Requirements / Fine Print: </span>
                      <span className="font-medium">{analysis.caveats}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">
              All Competing Store Offers (Ranked by Unit Cost)
            </h3>

            <div className="space-y-3">
              {group.deals.map((deal, idx) => {
                const isBest = idx === 0;
                const isInList = listDealIds.has(deal.id);

                return (
                  <div
                    key={deal.id ? `modal-deal-${deal.id}` : `modal-deal-${deal.storeId || 'item'}-${idx}`}
                    className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition ${
                      isBest
                        ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-300/40 shadow-xs'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center space-x-2">
                        {isBest ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-600 text-white uppercase tracking-wider flex items-center space-x-1">
                            <Award className="w-3 h-3" />
                            <span>#1 Lowest Cost</span>
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-slate-400">
                            #{idx + 1}
                          </span>
                        )}

                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider"
                          style={{ backgroundColor: deal.storeLogoBg, color: deal.storeLogoText }}
                        >
                          {deal.storeLogoText}
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          {deal.storeName}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 leading-snug">
                        {deal.title}
                      </h4>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {deal.brand && deal.brand !== 'Store Brand' && (
                          <span className="text-slate-500">Brand: {deal.brand}</span>
                        )}
                        {deal.dealType === 'digital_coupon' && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold text-[10px]">
                            Digital Coupon
                          </span>
                        )}
                        {deal.dealType === 'bogo' && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold text-[10px]">
                            BOGO Free
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-baseline sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 shrink-0">
                      <div className="text-right">
                        <span className="text-base sm:text-lg font-black text-slate-900 font-mono">
                          {deal.unitPrice}
                        </span>
                        <div className="text-xs text-slate-500 font-medium">
                          ${deal.salePrice.toFixed(2)} package
                          {deal.originalPrice > deal.salePrice && (
                            <span className="line-through text-slate-400 ml-1">
                              ${deal.originalPrice.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => onToggleList(deal)}
                        className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                          isInList
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                      >
                        {isInList ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>In List</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            <span>Add Deal</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-medium">
            Best deal: <strong className="text-emerald-700">{group.bestDeal.storeName}</strong> ({group.bestDeal.unitPrice})
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
          >
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
}
