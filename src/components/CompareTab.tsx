import React, { useEffect } from 'react';
import DealComparisonView from './DealComparisonView';
import { ComparisonGroup, Store, ShoppingListItem, DealItem } from '../types';

interface CompareTabProps {
  groups: ComparisonGroup[];
  stores: Store[];
  shoppingList: ShoppingListItem[];
  onToggleList: (deal: DealItem) => void;
  onAddToList?: (deal: DealItem) => void;
  onOpenDetailModal: (group: ComparisonGroup) => void;
  activeFilter?: string | null;
  activeStore?: string | null;
  activeTab?: string;
}

export default function CompareTab(props: CompareTabProps) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const mainContainer = document.getElementById('main-scroll-container');
    if (mainContainer) {
      mainContainer.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [props.activeTab, props.activeStore, props.activeFilter]);

  return <DealComparisonView {...props} />;
}

export { CompareTab };
