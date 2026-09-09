import React from 'react';
import { Plus, Check, ArrowLeftRight, Tag, Sparkles, ShieldCheck } from 'lucide-react';
import { DealItem } from '../types';

interface DealCardProps {
  deal: DealItem;
  isInShoppingList: boolean;
  onToggleShoppingList: (deal: DealItem) => void;
  onCompareSimilar?: (deal: DealItem) => void;
  similarDealsCount?: number;
  isBestInGroup?: boolean;
}

export const DealCard: React.FC<DealCardProps> = ({
  deal,
  isInShoppingList,
  onToggleShoppingList,
  onCompareSimilar,
  similarDealsCount = 0,
  isBestInGroup = false,
}) => {
  return (
    <div className={`group relative bg-white rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden ${
      isBestInGroup 
        ? 'border-emerald-500/80 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500/20' 
        : 'border-stone-200 hover:border-stone-300 hover:shadow-md'
    }`}>
      
      {/* Top Banner / Store Header */}
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          {/* Store Logo & Name */}
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold tracking-wider ${deal.storeLogoBg} text-stone-800 border border-stone-200/60`}>
              {deal.storeLogoText}
            </span>
            <span className="text-xs font-semibold text-stone-600 truncate max-w-[130px]">
              {deal.storeName}
            </span>
          </div>

          {/* Deal Promo Badge */}
          {deal.dealBadge && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
              deal.dealType === 'bogo'
                ? 'bg-purple-50 text-purple-700 border-purple-200'
                : deal.dealType === 'digital_coupon'
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              {deal.dealBadge}
            </span>
          )}
        </div>

        {/* Best Deal Winner Indicator */}
        {isBestInGroup && (
          <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
            <span>Lowest Unit Price across circulars</span>
          </div>
        )}

        {/* Product Title & Subtitle */}
        <h4 className="text-sm sm:text-base font-bold text-stone-900 leading-snug group-hover:text-emerald-700 transition line-clamp-2">
          {deal.title}
        </h4>
        {deal.subtitle && (
          <p className="text-xs text-stone-500 mt-0.5 line-clamp-1">
            {deal.subtitle}
          </p>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mt-2">
          {deal.qualityTier === 'organic' && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100/70 text-emerald-800 border border-emerald-200">
              Organic
            </span>
          )}
          {deal.tags?.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[10px] text-stone-600 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200/60">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Pricing & Actions */}
      <div className="p-4 pt-3 mt-3 border-t border-stone-100 bg-stone-50/50 rounded-b-2xl">
        <div className="flex items-baseline justify-between gap-2">
          {/* Price Block */}
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-black text-stone-950 tracking-tight">
                ${deal.salePrice.toFixed(2)}
              </span>
              {deal.originalPrice > deal.salePrice && (
                <span className="text-xs text-stone-400 line-through">
                  ${deal.originalPrice.toFixed(2)}
                </span>
              )}
            </div>
            
            {/* Unit Price Meter */}
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-xs font-bold text-emerald-700 bg-emerald-100/60 px-1.5 py-0.5 rounded">
                {deal.unitPrice}
              </span>
              <span className="text-[11px] text-stone-400">
                ({deal.unitDescription})
              </span>
            </div>
          </div>

          {/* Discount Percentage Pill */}
          {deal.discountPercent > 0 && (
            <span className="text-xs font-extrabold px-2 py-1 rounded-lg bg-emerald-600 text-white shadow-xs">
              Save {deal.discountPercent}%
            </span>
          )}
        </div>

        {/* Bottom Button Toolbar */}
        <div className="grid grid-cols-2 gap-2 mt-3.5">
          {/* Compare Similar Deals Button */}
          {onCompareSimilar && (
            <button
              id={`compare-deal-btn-${deal.id}`}
              onClick={() => onCompareSimilar(deal)}
              className="px-2 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 bg-white hover:bg-amber-50 text-stone-700 hover:text-amber-800 border border-stone-200 hover:border-amber-300 transition cursor-pointer"
              title="Compare price with other local grocery stores"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-amber-600" />
              <span>
                Compare {similarDealsCount > 1 ? `(${similarDealsCount})` : ''}
              </span>
            </button>
          )}

          {/* Add to Shopping List Button */}
          <button
            id={`toggle-cart-deal-btn-${deal.id}`}
            onClick={() => onToggleShoppingList(deal)}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              isInShoppingList
                ? 'bg-emerald-700 text-white shadow-xs hover:bg-emerald-800'
                : 'bg-stone-900 hover:bg-stone-800 text-white shadow-xs'
            } ${!onCompareSimilar ? 'col-span-2' : ''}`}
          >
            {isInShoppingList ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-200" />
                <span>On List</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Add to List</span>
              </>
            )}
          </button>
        </div>

      </div>

    </div>
  );
};
