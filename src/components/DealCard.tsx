import React from 'react';
import { Plus, Check } from 'lucide-react';
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
  const badgeText = (deal as any).promoBadgeText || deal.dealBadge || '';
  const title = deal.title || '';
  const combined = `${title} ${badgeText}`.toUpperCase();

  let effectivePrice = deal.salePrice;
  let multiBuySubtitle: string | null = null;

  const multiMatch = combined.match(/(\d+)\s*(?:FOR|\/)\s*\$?(\d+(?:\.\d{2})?)/);
  if (multiMatch) {
    const qty = parseInt(multiMatch[1], 10);
    const total = parseFloat(multiMatch[2]);
    if (qty > 1 && total > 0) {
      effectivePrice = Number((total / qty).toFixed(2));
      multiBuySubtitle = `${qty} for $${total.toFixed(2)} ($${effectivePrice.toFixed(2)} ea)`;
    }
  } else if (deal.bundleQuantity && deal.bundleQuantity > 1 && (deal as any).bundleTotalPrice) {
    effectivePrice = Number(((deal as any).bundleTotalPrice / deal.bundleQuantity).toFixed(2));
    multiBuySubtitle = `${deal.bundleQuantity} for $${(deal as any).bundleTotalPrice.toFixed(2)} ($${effectivePrice.toFixed(2)} ea)`;
  }

  const isBogo =
    (deal as any).isUnpricedPromo ||
    effectivePrice === 0 ||
    combined.includes('BUY 1 GET 2') ||
    combined.includes('BUY 1 GET 1') ||
    combined.includes('BUY ONE, GET ONE') ||
    combined.includes('BUY THREE, GET ONE') ||
    combined.includes('50% OFF') ||
    deal.dealType === 'bogo';

  const isUnpricedBogoDisplay = isBogo && (effectivePrice === 0 || effectivePrice === 3.99);

  const handleAction = () => {
    if (onAddToList) {
      onAddToList(deal);
    } else if (onToggleList) {
      onToggleList(deal);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition flex flex-col justify-between p-4 overflow-hidden relative">
      {isLowestInGroup && competingCount && competingCount > 1 && (
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1 text-white text-[11px] font-bold tracking-wide flex items-center justify-between -mx-4 -mt-4 mb-3 rounded-t-xl">
          <span>LOWEST LOCAL PRICE</span>
          <span className="text-[10px] font-medium text-emerald-100">
            vs {competingCount - 1} competitor{competingCount > 2 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-black uppercase px-2.5 py-1 rounded-md text-white tracking-wider"
          style={{ backgroundColor: deal.storeLogoBg || '#1E293B' }}
        >
          {deal.storeName || 'GROCERY'}
        </span>
        {deal.validUntil && (
          <span className="text-[11px] font-medium text-slate-400">Ends {deal.validUntil.slice(5)}</span>
        )}
      </div>

      {(deal as any).imageUrl && (
        <div className="w-full h-44 rounded-xl overflow-hidden mb-3 bg-slate-50 flex items-center justify-center border border-slate-100 relative">
          <img
            src={(deal as any).imageUrl}
            alt={deal.title}
            className="w-full h-full object-contain p-2"
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.parentElement) {
                target.parentElement.style.display = 'none';
              }
            }}
          />
        </div>
      )}

      <div className="mb-3">
        {badgeText && (
          <span className="inline-block bg-amber-500 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded uppercase tracking-wider mb-1.5 shadow-2xs">
            {badgeText}
          </span>
        )}
        <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">
          {deal.title}
        </h3>
        {deal.subtitle && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{deal.subtitle}</p>
        )}
      </div>

      <div className="mt-auto pt-2 border-t border-slate-100">
        {isUnpricedBogoDisplay ? (
          <div className="my-1">
            <span className="inline-block bg-amber-100 text-amber-900 font-extrabold text-xs px-2 py-1 rounded-md uppercase tracking-wider border border-amber-200">
              {badgeText || 'SPECIAL PROMOTION'}
            </span>
            <p className="text-xs font-semibold text-slate-500 mt-1">
              Price varies in-store • Discount at register
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-slate-900 font-mono">
                ${effectivePrice.toFixed(2)}
              </span>

              {deal.discountPercent > 0 && deal.discountPercent !== 22 && deal.discountPercent !== 20 && deal.originalPrice > effectivePrice && (
                <>
                  <span className="text-xs text-slate-400 line-through font-mono">
                    ${deal.originalPrice.toFixed(2)}
                  </span>
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                    -{deal.discountPercent}%
                  </span>
                </>
              )}
            </div>

            {multiBuySubtitle ? (
              <p className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md inline-block mt-1">
                {multiBuySubtitle}
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">
                Normalized Unit Cost: <span className="font-semibold text-slate-700">{deal.unitPrice || `$${effectivePrice.toFixed(2)} each`}</span>
              </p>
            )}
          </div>
        )}

        <div className="mt-3 pt-2 flex items-center justify-between">
          {competingCount && competingCount > 1 && onOpenComparison ? (
            <button
              onClick={() => onOpenComparison(deal.genericProductGroup)}
              className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg transition"
              title="View cross-store unit price comparison"
            >
              Compare ({competingCount})
            </button>
          ) : (
            <div />
          )}

          <button
            onClick={handleAction}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
              isInList
                ? 'bg-emerald-600 text-white shadow-2xs'
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
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
