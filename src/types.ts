export type DealCategory = 
  | 'produce'
  | 'meat_seafood'
  | 'dairy_eggs'
  | 'bakery_deli'
  | 'pantry_snacks'
  | 'frozen'
  | 'beverages'
  | 'household';

export type DealType = 'sale' | 'bogo' | 'digital_coupon' | 'multi_buy' | 'clearance';

export interface Store {
  id: string;
  name: string;
  chain: string;
  logoColor: string; // Tailwind background / text color
  logoBg: string;
  logoText: string;
  distanceMiles: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  flyerTitle: string;
  validDates: string;
  totalDealsCount: number;
  featuredCategory: string;
  operatingHours: string;
}

export interface DealItem {
  id: string;
  storeId: string;
  storeName: string;
  storeLogoBg: string;
  storeLogoText: string;
  title: string;
  subtitle?: string;
  category: DealCategory;
  originalPrice: number;
  salePrice: number;
  discountPercent: number;
  unitPrice: string; // e.g. "$1.49 / lb"
  normalizedUnitCost: number; // numeric cost for 1 base unit
  normalizedUnitType: 'lb' | 'oz' | 'unit' | 'gallon' | 'count' | 'dozen';
  unitDescription: string; // e.g. "1 lb bag", "12 oz pack", "1 gallon"
  dealType: DealType;
  dealBadge?: string; // e.g. "BOGO FREE", "SAVE 40%", "DIGITAL ONLY"
  validUntil: string;
  inStock: boolean;
  genericProductGroup: string; // e.g. "apples", "eggs", "milk", "chicken_breast", "ground_beef", "avocados", "strawberries", "bread", "olive_oil", "cheddar_cheese", "salmon", "paper_towels", "coffee", "pasta"
  tags: string[];
  imageUrl?: string;
  brand?: string;
  qualityTier?: 'budget' | 'standard' | 'premium' | 'organic';
}

export interface ComparisonGroup {
  productGroup: string;
  displayName: string;
  category: DealCategory;
  dealCount: number;
  lowestPrice: number;
  lowestUnitPrice: string;
  bestDealId: string;
  bestStoreName: string;
  deals: DealItem[];
  aiAnalysis?: {
    bestDealId: string;
    verdict: string;
    keyDifference: string;
    unitPriceAdvantage: string;
    caveats?: string;
  };
}

export interface ShoppingListItem {
  id: string;
  dealId?: string;
  dealItem?: DealItem;
  customTitle?: string;
  storeId: string;
  storeName: string;
  storeLogoBg: string;
  storeLogoText: string;
  price: number;
  originalPrice: number;
  quantity: number;
  unitPrice?: string;
  category: DealCategory | 'other';
  checked: boolean;
  addedAt: number;
  notes?: string;
  betterAlternative?: {
    storeName: string;
    salePrice: number;
    unitPrice: string;
    savingsAmount: number;
    dealId: string;
  };
}

export interface UserLocation {
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  zipCode?: string;
  formattedAddress: string;
  isGps: boolean;
  radiusMiles?: number;
}
