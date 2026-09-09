import React, { useState } from 'react';
import { ShoppingBag, Check, Trash2, Plus, Minus, Store, Sparkles, ArrowRight, Share2, Printer, AlertTriangle, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { ShoppingListItem, DealItem } from '../types';

interface ShoppingListViewProps {
  items: ShoppingListItem[];
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onAddCustomItem: (title: string, storeName?: string) => void;
  onSwapBetterDeal: (itemId: string, newDealId: string) => void;
  allDeals: DealItem[];
  onClearCompleted: () => void;
}

export const ShoppingListView: React.FC<ShoppingListViewProps> = ({
  items,
  onToggleItem,
  onRemoveItem,
  onUpdateQuantity,
  onAddCustomItem,
  onSwapBetterDeal,
  allDeals,
  onClearCompleted,
}) => {
  const [groupBy, setGroupBy] = useState<'store' | 'category'>('store');
  const [customItemText, setCustomItemText] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  // Financial calculations
  const totalCost = items.reduce((sum, item) => sum + (item.checked ? 0 : item.price * item.quantity), 0);
  const totalOriginal = items.reduce(
    (sum, item) => sum + (item.checked ? 0 : (item.originalPrice || item.price) * item.quantity),
    0
  );
  const totalSavings = Math.max(0, totalOriginal - totalCost);
  const completedCount = items.filter((i) => i.checked).length;

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customItemText.trim()) {
      onAddCustomItem(customItemText.trim());
      setCustomItemText('');
    }
  };

  const handleCopyList = () => {
    const listText = items
      .map(
        (i) =>
          `[${i.checked ? 'X' : ' '}] ${i.quantity}x ${i.dealItem?.title || i.customTitle} ($${(
            i.price * i.quantity
          ).toFixed(2)}) - ${i.storeName}`
      )
      .join('\n');
    const header = `My Grocery Shopping List (Est Total: $${totalCost.toFixed(2)}, Saved: $${totalSavings.toFixed(
      2
    )})\n-------------------------------------\n`;
    navigator.clipboard.writeText(header + listText);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  // Group items by store or category
  const groups: { [key: string]: ShoppingListItem[] } = {};
  items.forEach((item) => {
    const key = groupBy === 'store' ? item.storeName : item.category;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Summary Card */}
      <div className="bg-stone-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-stone-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2 border border-emerald-500/30">
              <ShoppingBag className="w-3.5 h-3.5" />
              Digital Shopping Cart & Planner
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Your Grocery Deals Shopping List
            </h2>
            <p className="text-stone-400 text-sm mt-1">
              Organized by store circulars with active unit-price discounts
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-4 bg-stone-800/80 p-4 rounded-2xl border border-stone-700/60 flex-wrap">
            <div>
              <span className="text-xs text-stone-400 block font-medium">Estimated Total</span>
              <span className="text-2xl sm:text-3xl font-black text-white">
                ${totalCost.toFixed(2)}
              </span>
            </div>
            <div className="h-10 w-px bg-stone-700 mx-1" />
            <div>
              <span className="text-xs text-stone-400 block font-medium">Circular Savings</span>
              <span className="text-2xl sm:text-3xl font-black text-emerald-400">
                +${totalSavings.toFixed(2)}
              </span>
            </div>
            <div className="h-10 w-px bg-stone-700 mx-1 hidden sm:block" />
            <div className="hidden sm:block">
              <span className="text-xs text-stone-400 block font-medium">Progress</span>
              <span className="text-sm font-bold text-stone-200">
                {completedCount} of {items.length} done
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Control Bar: Custom Add, Grouping, Print/Share */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        
        {/* Custom Item Form */}
        <form onSubmit={handleAddCustom} className="flex gap-2 w-full sm:w-96">
          <input
            id="add-custom-item-input"
            type="text"
            value={customItemText}
            onChange={(e) => setCustomItemText(e.target.value)}
            placeholder="Add custom item (e.g. Cinnamon, Napkins)..."
            className="flex-1 px-3.5 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs"
          />
          <button
            id="add-custom-item-btn"
            type="submit"
            disabled={!customItemText.trim()}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add</span>
          </button>
        </form>

        {/* Grouping & Actions */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs font-semibold">
            <button
              id="group-by-store-btn"
              onClick={() => setGroupBy('store')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                groupBy === 'store' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              By Store
            </button>
            <button
              id="group-by-category-btn"
              onClick={() => setGroupBy('category')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                groupBy === 'category' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              By Category
            </button>
          </div>

          <button
            id="copy-shopping-list-btn"
            onClick={handleCopyList}
            className="px-3 py-2 bg-white hover:bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-700 flex items-center gap-1.5 transition shadow-xs cursor-pointer"
            title="Copy list to clipboard"
          >
            {copySuccess ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
          </button>

          {completedCount > 0 && (
            <button
              id="clear-completed-list-btn"
              onClick={onClearCompleted}
              className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-red-700 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Done</span>
            </button>
          )}
        </div>

      </div>

      {/* Empty State */}
      {items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-stone-300 p-8">
          <div className="w-14 h-14 rounded-2xl bg-stone-100 text-stone-400 flex items-center justify-center mx-auto mb-4">
            <ShoppingBag className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-stone-800">Your Shopping List is Empty</h3>
          <p className="text-sm text-stone-500 max-w-md mx-auto mt-1 mb-5">
            Browse current local grocery flyers or compare similar deals to save items directly to your digital list.
          </p>
        </div>
      ) : (
        /* Grouped Items List */
        <div className="space-y-6">
          {Object.entries(groups).map(([groupName, groupItems]) => {
            const groupSubtotal = groupItems.reduce(
              (sum, item) => sum + (item.checked ? 0 : item.price * item.quantity),
              0
            );

            return (
              <div key={groupName} className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs">
                
                {/* Group Header */}
                <div className="px-5 py-3.5 bg-stone-50 border-b border-stone-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-emerald-700" />
                    <h3 className="font-extrabold text-stone-900 text-sm sm:text-base capitalize">
                      {groupName}
                    </h3>
                    <span className="text-xs text-stone-500 font-medium">
                      ({groupItems.length} {groupItems.length === 1 ? 'item' : 'items'})
                    </span>
                  </div>
                  <span className="text-xs font-bold text-stone-700">
                    Subtotal: ${groupSubtotal.toFixed(2)}
                  </span>
                </div>

                {/* Items in Group */}
                <div className="divide-y divide-stone-100">
                  {groupItems.map((item) => {
                    const title = item.dealItem?.title || item.customTitle;
                    const itemTotal = item.price * item.quantity;

                    return (
                      <div
                        key={item.id}
                        className={`p-4 sm:px-5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          item.checked ? 'bg-stone-50/70 opacity-60' : 'hover:bg-stone-50/40'
                        }`}
                      >
                        {/* Checkbox & Details */}
                        <div className="flex items-start sm:items-center gap-3.5 flex-1">
                          <button
                            id={`check-item-${item.id}`}
                            onClick={() => onToggleItem(item.id)}
                            className={`w-5 h-5 rounded-md border flex items-center justify-center mt-0.5 sm:mt-0 transition flex-shrink-0 cursor-pointer ${
                              item.checked
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'border-stone-300 hover:border-emerald-500 bg-white'
                            }`}
                          >
                            {item.checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </button>

                          <div className="flex-1">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span
                                className={`text-sm font-bold leading-snug ${
                                  item.checked ? 'line-through text-stone-400' : 'text-stone-900'
                                }`}
                              >
                                {title}
                              </span>
                              {item.unitPrice && (
                                <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.2 rounded">
                                  {item.unitPrice}
                                </span>
                              )}
                            </div>

                            {/* Store tag if grouped by category */}
                            {groupBy === 'category' && (
                              <span className="text-[11px] text-stone-500 mt-0.5 block">
                                Store: {item.storeName}
                              </span>
                            )}

                            {/* Better Deal Notification Badge */}
                            {item.betterAlternative && !item.checked && (
                              <div className="mt-2 p-2 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 max-w-lg">
                                <div className="flex items-center gap-1.5 text-xs text-amber-900">
                                  <Sparkles className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                                  <span>
                                    <strong>Cheaper at {item.betterAlternative.storeName}</strong> ({item.betterAlternative.unitPrice}) — Save ${item.betterAlternative.savingsAmount.toFixed(2)}
                                  </span>
                                </div>
                                <button
                                  id={`swap-better-deal-${item.id}`}
                                  onClick={() => onSwapBetterDeal(item.id, item.betterAlternative!.dealId)}
                                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg transition whitespace-nowrap cursor-pointer"
                                >
                                  Swap Deal
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Quantity & Actions */}
                        <div className="flex items-center justify-between sm:justify-end gap-4 pl-8 sm:pl-0">
                          {/* Quantity Controls */}
                          <div className="flex items-center border border-stone-200 rounded-lg bg-white overflow-hidden shadow-2xs">
                            <button
                              id={`qty-minus-${item.id}`}
                              onClick={() => onUpdateQuantity(item.id, -1)}
                              className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2.5 text-xs font-bold text-stone-800">
                              {item.quantity}
                            </span>
                            <button
                              id={`qty-plus-${item.id}`}
                              onClick={() => onUpdateQuantity(item.id, 1)}
                              className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Price */}
                          <div className="text-right min-w-[65px]">
                            <div className="text-sm font-black text-stone-900">
                              ${itemTotal.toFixed(2)}
                            </div>
                            {item.originalPrice > item.price && (
                              <div className="text-[10px] text-stone-400 line-through">
                                ${(item.originalPrice * item.quantity).toFixed(2)}
                              </div>
                            )}
                          </div>

                          {/* Delete Item */}
                          <button
                            id={`remove-item-${item.id}`}
                            onClick={() => onRemoveItem(item.id)}
                            className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                            title="Remove from list"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                      </div>
                    );
                  })}
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
