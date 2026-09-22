import React from 'react';
import { Tag, AlertCircle, Plus, Check } from 'lucide-react';
import { DealItem } from '../types';

interface DealCardProps {
  deal: DealItem;
  onAddToList?: (deal: DealItem) => void;
  isInList?: boolean;
  isLowestInGroup?: boolean;
  competingCount?: number;
  onToggleList?: (deal: DealItem) => void;
  onOpenComparison?: (genericProductGroup: string) => void;
}

export default function DealCard({
  deal,
  onAddToList,
  isInList,
  isLowestInGroup,
  competingCount,
  onToggleList,
  onOpenComparison,
}: DealCardProps) {
  // ---------------------------------------------------------------------------
  // CLIENT-SIDE REAL-TIME PRICING SANITIZATION ENGINE
  // ---------------------------------------------------------------------------
  const rawTitle = deal.title || '';
  const rawSubtitle = deal.subtitle || '';
  const combinedText = `${rawTitle} ${rawSubtitle} ${deal.dealBadge || ''}`.toLowerCase();

  // 1. Detect if this is an unpriced promotion (like "BUY 3 GET 1 FREE" or "BOGO" with no base price)
  const isBogoPromo =
    combinedText.includes('buy three, get one') ||
    combinedText.includes('buy 3 get 1') ||
    combinedText.includes('buy one, get one') ||
    combinedText.includes('buy 1 get 1') ||
    combinedText.includes('bogo') ||
    deal.dealType === 'bogo';

  // Check if price was hallucinated as $3.99 on a BOGO tile with no stated price, or missing/zero price
  const isHallucinatedBogoPrice =
    isBogoPromo && (deal.salePrice === 3.99 || !deal.salePrice || deal.salePrice === 0 || deal.isUnpricedPromo);

  // 2. Multi-Buy Detection & Arithmetic (e.g. "2 for $7", "2/$7", "3 for $5")
  let displayPrice = deal.salePrice;
  let multiBuyBadge: string | null = null;
  let isMultiBuy = false;

  const multiMatch = combinedText.match(/(\d+)\s*(?:for|\/)\s*\$?(\d+(?:\.\d{2})?)/i);
  if (multiMatch) {
    const qty = parseInt(multiMatch[1], 10);
    const total = parseFloat(multiMatch[2]);
    if (qty > 1 && total > 0) {
      isMultiBuy = true;
      displayPrice = Number((total / qty).toFixed(2));
      multiBuyBadge = `${qty} for $${total.toFixed(2)} ($${displayPrice.toFixed(2)} ea)`;
    }
  } else if (deal.bundleQuantity && deal.bundleQuantity > 1 && deal.bundleTotalPrice) {
    isMultiBuy = true;
    displayPrice = Number((deal.bundleTotalPrice / deal.bundleQuantity).toFixed(2));
    multiBuyBadge = `${deal.bundleQuantity} for $${deal.bundleTotalPrice.toFixed(2)} ($${displayPrice.toFixed(2)} ea)`;
  } else if (deal.dealType === 'multi_buy' && deal.unitDescription?.includes('for $')) {
    isMultiBuy = true;
    multiBuyBadge = deal.unitDescription;
  }

  // 3. Strikethrough MSRP & Fake Discount Purge
  const isSuspiciousDiscount =
    deal.discountPercent === 22 ||
    deal.discountPercent === 20 ||
    !deal.originalPrice ||
    deal.originalPrice <= displayPrice;

  const showDiscountBadge = !isSuspiciousDiscount && !isHallucinatedBogoPrice && deal.discountPercent > 0;

  const handleAction = () => {
    if (onAddToList) {
      onAddToList(deal);
    } else if (onToggleList) {
      onToggleList(deal);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition flex flex-col justify-between p-4 overflow-hidden relative">
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
          className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded text-white tracking-wider"
          style={{ backgroundColor: deal.storeLogoBg || '#1E293B' }}
        >
          {deal.storeName || 'GROCERY'}
        </span>
        {deal.validUntil && (
          <span className="text-[11px] text-slate-400">Ends {deal.validUntil.slice(5)}</span>
        )}
      </div>

      {(deal as any).imageUrl ? (
        <div className="w-full h-40 rounded-xl overflow-hidden mb-3 bg-slate-50 flex items-center justify-center border border-slate-100">
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
      ) : null}

      <div className="mb-2">
        <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">
          {deal.title}
        </h3>
        {deal.subtitle && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{deal.subtitle}</p>
        )}
      </div>

      <div className="mt-auto pt-2 border-t border-slate-100">
        {isHallucinatedBogoPrice ? (
          <div className="my-1">
            <span className="inline-block bg-amber-500 text-slate-950 font-black text-xs px-2 py-1 rounded-md uppercase tracking-wider shadow-sm">
              {combinedText.includes('buy three') || combinedText.includes('buy 3') ? 'BUY 3, GET 1 FREE' : 'BUY 1, GET 1 FREE'}
            </span>
            <p className="text-[11px] font-semibold text-slate-500 mt-1">
              Base price varies in-store • Discount at register
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-black text-slate-900">
                ${displayPrice.toFixed(2)}
              </span>

              {showDiscountBadge && (
                <>
                  <span className="text-xs text-slate-400 line-through">
                    ${deal.originalPrice.toFixed(2)}
                  </span>
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                    -{deal.discountPercent}%
                  </span>
                </>
              )}
            </div>

            {multiBuyBadge ? (
              <p className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md inline-block mt-1">
                {multiBuyBadge}
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">
                Normalized Unit Cost: <span className="font-semibold text-slate-700">{deal.unitPrice || `$${displayPrice.toFixed(2)} each`}</span>
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
                ? 'bg-emerald-600 text-white shadow-sm'
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
