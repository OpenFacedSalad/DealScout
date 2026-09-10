import React from 'react';
import {
  Plus,
  Check,
  Scale,
  Sparkles,
  Tag,
  Clock,
  Award,
} from 'lucide-react';
import { DealItem } from '../types';

interface DealCardProps {
  key?: React.Key;
  deal: DealItem;
  isLowestInGroup: boolean;
  competingCount: number;
  isInList: boolean;
  onToggleList: (deal: DealItem) => void;
  onOpenComparison: (genericProductGroup: string) => void;
}

export default function DealCard({
  deal,
  isLowestInGroup,
  competingCount,
  isInList,
  onToggleList,
  onOpenComparison,
}: DealCardProps) {
  const isOrganic = deal.qualityTier === 'organic' || deal.tags.includes('organic');
  const isBogo = deal.dealType === 'bogo';
  const isDigitalCoupon = deal.dealType === 'digital_coupon';
  const isMultiBuy = deal.dealType === 'multi_buy';

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-2xl bg-white border transition-all duration-200 hover:shadow-lg ${
        isLowestInGroup && competingCount > 1
          ? 'border-emerald-300 ring-1 ring-emerald-400/50 shadow-sm'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {isLowestInGroup && competingCount > 1 && (
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1 text-white text-[11px] font-bold tracking-wide flex items-center justify-between rounded-t-2xl">
          <span className="flex items-center space-x-1">
            <Award className="w-3.5 h-3.5" />
            <span>LOWEST LOCAL PRICE</span>
          </span>
          <span className="text-[10px] font-medium text-emerald-100">
            vs {competingCount - 1} competitor{competingCount > 2 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="p-4 sm:p-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center space-x-2">
            <span
              className="px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-wider shadow-2xs"
              style={{
                backgroundColor: deal.storeLogoBg || '#334155',
                color: deal.storeLogoText || '#FFFFFF',
              }}
            >
              {deal.storeLogoText || deal.storeName.substring(0, 5).toUpperCase()}
            </span>
            <span className="text-xs font-semibold text-slate-700 truncate max-w-[130px]">
              {deal.storeName}
            </span>
          </div>

          {deal.validUntil && (
            <span className="flex items-center space-x-1 text-[11px] text-slate-400 font-medium">
              <Clock className="w-3 h-3" />
              <span>Ends {new Date(deal.validUntil).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
          {deal.dealBadge && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
              {deal.dealBadge}
            </span>
          )}
          {isBogo && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
              BOGO FREE
            </span>
          )}
          {isDigitalCoupon && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 flex items-center space-x-1">
              <Tag className="w-2.5 h-2.5" />
              <span>Digital Clip</span>
            </span>
          )}
          {isMultiBuy && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200">
              Multi-Buy
            </span>
          )}
          {isOrganic && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
              Organic
            </span>
          )}
        </div>

        <div className="mb-3">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base leading-snug line-clamp-2">
            {deal.title}
          </h3>
          {deal.subtitle && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{deal.subtitle}</p>
          )}
          {deal.brand && deal.brand !== 'Store Brand' && (
            <span className="inline-block text-[11px] font-medium text-slate-400 mt-0.5">
              Brand: {deal.brand}
            </span>
          )}
        </div>

        <div className="mt-auto pt-2">
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-black text-slate-900 tracking-tight">
              ${deal.salePrice.toFixed(2)}
            </span>
            {deal.originalPrice > deal.salePrice && (
              <span className="text-xs text-slate-400 line-through font-medium">
                ${deal.originalPrice.toFixed(2)}
              </span>
            )}
            {deal.discountPercent > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700">
                -{deal.discountPercent}%
              </span>
            )}
          </div>

          <div className="mt-2 py-1.5 px-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium text-[11px]">Normalized Unit Cost:</span>
            <span className="font-black text-emerald-700 font-mono text-xs">
              {deal.unitPrice}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 bg-slate-50/70 border-t border-slate-100 rounded-b-2xl flex items-center gap-2">
        {competingCount > 1 ? (
          <button
            onClick={() => onOpenComparison(deal.genericProductGroup)}
            className="flex-1 inline-flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition shadow-2xs"
            title="View cross-store unit price comparison"
          >
            <Scale className="w-3.5 h-3.5 text-emerald-600" />
            <span>Compare ({competingCount})</span>
          </button>
        ) : (
          <div className="flex-1 text-[11px] text-slate-400 italic px-2">
            No local matches
          </div>
        )}

        <button
          onClick={() => onToggleList(deal)}
          className={`flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-xs ${
            isInList
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-slate-900 hover:bg-slate-800 text-white'
          }`}
          title={isInList ? 'Remove from shopping list' : 'Add to shopping list'}
        >
          {isInList ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>In List</span>
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
  );
}
