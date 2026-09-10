import React, { useState, useMemo } from 'react';
import {
  ShoppingCart,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  ArrowRightLeft,
  Sparkles,
  CloudOff,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { ShoppingListItem, DealItem } from '../types';
import { useSyncQueue } from '../hooks/useSyncQueue';

interface ShoppingListViewProps {
  items: ShoppingListItem[];
  onRemoveItem: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onAddCustomItem: (title: string) => void;
  onSwapDeal: (itemId: string, cheaperDeal: DealItem) => void;
}

export default function ShoppingListView({
  items,
  onRemoveItem,
  onToggleChecked,
  onUpdateQuantity,
  onAddCustomItem,
  onSwapDeal,
}: ShoppingListViewProps) {
  const [newItemTitle, setNewItemTitle] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'by_store'>('by_store');
  const { pendingCount, pendingItemIds, isOnline, hasUnsyncedChanges } = useSyncQueue();

  const handleAddItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newItemTitle.trim()) {
      onAddCustomItem(newItemTitle.trim());
      setNewItemTitle('');
    }
  };

  const totalEstimatedCost = useMemo(() => {
    return items.reduce((sum, item) => {
      const price = item.deal ? item.deal.salePrice : item.customPrice || 0;
      return sum + price * (item.quantity || 1);
    }, 0);
  }, [items]);

  const potentialWeeklySavings = useMemo(() => {
    return items.reduce((sum, item) => {
      if (!item.checked && item.betterAlternative) {
        return sum + item.betterAlternative.totalPotentialSavings;
      }
      return sum + (item.deal ? (item.deal.originalPrice - item.deal.salePrice) * (item.quantity || 1) : 0);
    }, 0);
  }, [items]);

  const checkedCount = useMemo(() => items.filter((i) => i.checked).length, [items]);

  const groupedByStore = useMemo(() => {
    const map = new Map<string, { storeName: string; logoBg: string; logoText: string; items: ShoppingListItem[] }>();

    items.forEach((item) => {
      const storeId = item.deal ? item.deal.storeId : 'custom';
      const storeName = item.deal ? item.deal.storeName : 'Other / Custom Items';
      const logoBg = item.deal ? item.deal.storeLogoBg : '#475569';
      const logoText = item.deal ? item.deal.storeLogoText : 'LIST';

      if (!map.has(storeId)) {
        map.set(storeId, { storeName, logoBg, logoText, items: [] });
      }
      map.get(storeId)!.items.push(item);
    });

    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="space-y-6">
      {/* 1. Header & Basket Summary */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <ShoppingCart className="w-4 h-4 text-emerald-600" />
            <span>Smart Shopping Cart & Deal Monitor</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tracking-tight">
            Weekly Grocery Trip Planner
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {items.length} item{items.length === 1 ? '' : 's'} total &bull; {checkedCount} checked off
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-100 text-right">
            <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Est. Basket Total
            </span>
            <span className="text-lg font-black text-slate-900 font-mono">
              ${totalEstimatedCost.toFixed(2)}
            </span>
          </div>

          <div className="bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-100 text-right">
            <span className="block text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
              Total Weekly Savings
            </span>
            <span className="text-lg font-black text-emerald-800 font-mono">
              ${potentialWeeklySavings.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Unsynced Offline Changes Alert */}
      {hasUnsyncedChanges && (
        <div className="bg-amber-50 border border-amber-200/90 rounded-2xl p-3.5 flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center space-x-2.5 min-w-0">
            {isOnline ? (
              <RefreshCw className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
            ) : (
              <CloudOff className="w-4 h-4 text-amber-700 shrink-0" />
            )}
            <div>
              <span className="font-bold text-amber-900">
                {isOnline ? 'Syncing edits...' : 'Offline Changes Queued'}
              </span>
              <p className="text-amber-800 text-[11px] mt-0.5">
                {pendingCount} item modification{pendingCount > 1 ? 's' : ''} saved locally.
                {!isOnline && ' Will sync automatically when reconnected.'}
              </p>
            </div>
          </div>

          <span className="px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900 font-mono font-bold text-[10px] shrink-0 ml-2">
            {pendingCount} Pending
          </span>
        </div>
      )}

      {/* 3. Add Custom Item Form & Grouping Controls */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <form onSubmit={handleAddItemSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            placeholder="Add custom item (e.g., Paper towels, Garlic, Bagels)..."
            className="flex-1 px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center space-x-1.5 shrink-0 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add to List</span>
          </button>
        </form>

        <div className="flex items-center space-x-1.5 self-end sm:self-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider pr-1">
            View:
          </span>
          <button
            onClick={() => setViewMode('by_store')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              viewMode === 'by_store'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Group by Store
          </button>
          <button
            onClick={() => setViewMode('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              viewMode === 'all'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Flat List
          </button>
        </div>
      </div>

      {/* 4. Cart List */}
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400 mb-3">
            <ShoppingCart className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">Your shopping list is empty</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Add items from the Weekly Circulars feed, or type custom items in the bar above.
          </p>
        </div>
      ) : viewMode === 'by_store' ? (
        <div className="space-y-6">
          {groupedByStore.map(([storeKey, group]) => {
            const storeSubtotal = group.items.reduce((sum, item) => {
              const price = item.deal ? item.deal.salePrice : item.customPrice || 0;
              return sum + price * (item.quantity || 1);
            }, 0);

            return (
              <div
                key={storeKey}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
              >
                <div className="bg-slate-50/80 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider"
                      style={{ backgroundColor: group.logoBg, color: '#FFFFFF' }}
                    >
                      {group.logoText}
                    </span>
                    <h2 className="text-sm font-black text-slate-900">{group.storeName}</h2>
                    <span className="text-xs text-slate-400 font-medium">
                      ({group.items.length} item{group.items.length === 1 ? '' : 's'})
                    </span>
                  </div>

                  <div className="text-xs font-bold text-slate-700">
                    Subtotal: <span className="font-mono">${storeSubtotal.toFixed(2)}</span>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {group.items.map((item, idx) => (
                    <ShoppingListItemRow
                      key={item.id ? `item-${item.id}` : `item-${idx}`}
                      item={item}
                      isPendingSync={pendingItemIds.has(item.id)}
                      onToggleChecked={onToggleChecked}
                      onUpdateQuantity={onUpdateQuantity}
                      onRemoveItem={onRemoveItem}
                      onSwapDeal={onSwapDeal}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs divide-y divide-slate-100">
          {items.map((item, idx) => (
            <ShoppingListItemRow
              key={item.id ? `item-${item.id}` : `item-${idx}`}
              item={item}
              isPendingSync={pendingItemIds.has(item.id)}
              onToggleChecked={onToggleChecked}
              onUpdateQuantity={onUpdateQuantity}
              onRemoveItem={onRemoveItem}
              onSwapDeal={onSwapDeal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ItemRowProps {
  key?: string;
  item: ShoppingListItem;
  isPendingSync?: boolean;
  onToggleChecked: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onRemoveItem: (id: string) => void;
  onSwapDeal: (itemId: string, cheaperDeal: DealItem) => void;
}

function ShoppingListItemRow({
  item,
  isPendingSync = false,
  onToggleChecked,
  onUpdateQuantity,
  onRemoveItem,
  onSwapDeal,
}: ItemRowProps) {
  const deal = item.deal;
  const itemPrice = deal ? deal.salePrice : item.customPrice || 0;
  const lineTotal = itemPrice * item.quantity;
  const hasAlternative = !item.checked && Boolean(item.betterAlternative);

  return (
    <div
      className={`p-4 transition-all duration-300 ${
        isPendingSync
          ? 'bg-amber-50/60 ring-1 ring-amber-300/80 animate-pulse'
          : item.checked
          ? 'bg-slate-50/70'
          : 'bg-white hover:bg-slate-50/40'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          <button
            onClick={() => onToggleChecked(item.id)}
            className="text-slate-400 hover:text-emerald-600 transition shrink-0"
            title={item.checked ? 'Mark active' : 'Mark completed'}
          >
            {item.checked ? (
              <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-50" />
            ) : (
              <Square className="w-5 h-5" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-2">
              <span
                className={`text-sm font-bold truncate ${
                  item.checked ? 'line-through text-slate-400' : 'text-slate-900'
                }`}
              >
                {item.title}
              </span>

              {isPendingSync && (
                <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-amber-200/70 text-amber-900 text-[10px] font-bold tracking-tight shrink-0 animate-pulse">
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-700" />
                  <span>Syncing...</span>
                </span>
              )}

              {deal?.dealBadge && !item.checked && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                  {deal.dealBadge}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 text-xs text-slate-500 mt-0.5">
              {deal ? (
                <>
                  <span className="font-semibold text-slate-700">{deal.storeName}</span>
                  <span>&bull;</span>
                  <span className="font-mono text-emerald-700 font-bold">{deal.unitPrice}</span>
                  <span>&bull;</span>
                  <span>${deal.salePrice.toFixed(2)} pkg</span>
                </>
              ) : (
                <span className="italic text-slate-400">Custom user item</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4 shrink-0">
          <div className="flex items-center space-x-1.5 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => onUpdateQuantity(item.id, -1)}
              className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-white hover:text-slate-900 font-bold text-xs transition"
              title="Decrease quantity"
            >
              -
            </button>
            <span className="w-6 text-center font-bold text-xs font-mono text-slate-900">
              {item.quantity}
            </span>
            <button
              onClick={() => onUpdateQuantity(item.id, 1)}
              className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-white hover:text-slate-900 font-bold text-xs transition"
              title="Increase quantity"
            >
              +
            </button>
          </div>

          <div className="text-right w-16">
            <span
              className={`font-mono font-black text-sm ${
                item.checked ? 'line-through text-slate-400' : 'text-slate-900'
              }`}
            >
              ${lineTotal.toFixed(2)}
            </span>
          </div>

          <button
            onClick={() => onRemoveItem(item.id)}
            className="text-slate-300 hover:text-rose-600 transition p-1"
            title="Remove item"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {hasAlternative && item.betterAlternative && (
        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start space-x-2.5">
            <div className="w-6 h-6 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">
                  Cheaper Alternative Nearby!
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-amber-200/70 text-amber-900">
                  Save {item.betterAlternative.savingsPercent}%
                </span>
              </div>
              <p className="text-xs text-amber-950 font-medium mt-0.5">
                Switch to <strong>{item.betterAlternative.cheaperDeal.storeName}</strong> ({item.betterAlternative.cheaperDeal.unitPrice}) and save{' '}
                <strong className="text-emerald-800 font-bold">
                  ${item.betterAlternative.totalPotentialSavings.toFixed(2)}
                </strong>{' '}
                on this purchase.
              </p>
            </div>
          </div>

          <button
            onClick={() => onSwapDeal(item.id, item.betterAlternative!.cheaperDeal)}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shrink-0 shadow-2xs"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Swap Deal</span>
          </button>
        </div>
      )}
    </div>
  );
}
