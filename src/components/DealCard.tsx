import React from 'react';
import { ShoppingBag, Tag, Sparkles, Check, Plus } from 'lucide-react';
import { DealItem } from '../types';

interface DealCardProps {
  deal: DealItem;
  onAddToList?: (deal: DealItem) => void;
  onToggleList?: (deal: DealItem) => void;
  isInList?: boolean;
  isLowestInGroup?: boolean;
  competingCount?: number;
  onOpenComparison?: (genericProductGroup: string) => void;
}

export default function DealCard({
  deal,
  onAddToList,
  onToggleList,
  isInList,
  isLowestInGroup,
  competingCount,
  onOpenComparison,
}: DealCardProps) {
  const handleAction = () => {
    if (onAddToList) {
      onAddToList(deal);
    } else if (onToggleList) {
      onToggleList(deal);
    }
  };

  const displayPriceText =
    deal.displayPrice || (deal.salePrice > 0 ? `$${deal.salePrice.toFixed(2)}` : null);

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs hover:shadow-md transition relative justify-between">
      {/* Lowest Price Banner */}
      {isLowestInGroup && competingCount && competingCount > 1 && (
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1 text-white text-[11px] font-bold tracking-wide flex items-center justify-between">
          <span>LOWEST LOCAL PRICE</span>
          <span className="text-[10px] font-medium text-emerald-100">
            vs {competingCount - 1} competitor{competingCount > 2 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Store Header & Expiration */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <span
            className="text-[10px] font-black tracking-wider px-1.5 py-0.5 rounded text-white uppercase"
            style={{ backgroundColor: deal.storeLogoBg || '#059669' }}
          >
            {deal.storeLogoText || 'DEAL'}
          </span>
          <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]">
            {deal.storeName}
          </span>
        </div>

        {deal.validUntil && (
          <span className="text-[11px] text-slate-400">
            {deal.validUntil.startsWith('202') ? `Ends ${deal.validUntil.slice(5)}` : deal.validUntil}
          </span>
        )}
      </div>

      {/* Circular Snippet Image */}
      {deal.imageUrl && (
        <div className="relative w-full h-44 bg-slate-50 flex items-center justify-center overflow-hidden border-b border-slate-100">
          <img
            src={deal.imageUrl}
            alt={deal.title}
            className="object-contain h-full w-full p-2"
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.parentElement) {
                target.parentElement.style.display = 'none';
              }
            }}
          />
          {deal.dealBadge && (
            <span className="absolute bottom-2 right-2 bg-amber-400 text-slate-900 text-[11px] font-black px-2 py-0.5 rounded shadow-xs uppercase">
              {deal.dealBadge}
            </span>
          )}
        </div>
      )}

      {/* Card Content */}
      <div className="p-3 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900 leading-snug line-clamp-2">
            {deal.title}
          </h3>
          {deal.subtitle && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
              {deal.subtitle}
            </p>
          )}
        </div>

        {/* Pricing Area */}
        <div className="mt-3 pt-2 border-t border-slate-100">
          {deal.isUnpricedPromo || !displayPriceText ? (
            /* Unpriced Promotion Display (e.g. BOGO 50% Off) */
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 text-xs font-black px-2 py-1 rounded">
                <Tag className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>{deal.dealBadge || deal.promoBadgeText || 'SPECIAL PROMOTION'}</span>
              </div>
              <p className="text-xs font-semibold text-slate-700">
                Price varies in-store
              </p>
              <p className="text-[11px] text-slate-500">
                Discount applied at register
              </p>
            </div>
          ) : (
            /* Standard or Multi-Buy Display (e.g. 2 for $7 -> $3.50 ea) */
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 font-mono">
                  {displayPriceText}
                </span>

                {deal.discountPercent > 0 && deal.originalPrice > deal.salePrice && (
                  <>
                    <span className="text-xs text-slate-400 line-through font-mono">
                      ${deal.originalPrice.toFixed(2)}
                    </span>
                    <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-1 rounded">
                      -{deal.discountPercent}%
                    </span>
                  </>
                )}
              </div>

              {/* Multi-Buy Sub-Banner */}
              {deal.bundleQuantity && deal.bundleQuantity > 1 && deal.bundleTotalPrice ? (
                <div className="mt-1 flex items-center space-x-1 text-xs text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded w-fit">
                  <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span>
                    Must buy {deal.bundleQuantity} for ${deal.bundleTotalPrice.toFixed(2)}
                  </span>
                </div>
              ) : deal.unitDescription ? (
                <p className="text-[11px] text-slate-500 mt-1 font-medium">
                  Normalized: {deal.unitDescription}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Action Buttons: Compare & Add to List */}
        <div className="mt-3 pt-2 flex items-center justify-between gap-2">
          {competingCount && competingCount > 1 && onOpenComparison ? (
            <button
              onClick={() => onOpenComparison(deal.genericProductGroup)}
              className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2 py-1.5 rounded-lg transition"
              title="View cross-store unit price comparison"
            >
              Compare ({competingCount})
            </button>
          ) : (
            <div />
          )}

          {(onAddToList || onToggleList) && (
            <button
              onClick={handleAction}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 ${
                isInList
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {isInList ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Added</span>
                </>
              ) : (
                <>
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>Add to List</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
