export type DealCategory =
  | 'produce'
  | 'meat_seafood'
  | 'dairy_eggs'
  | 'bakery_deli'
  | 'pantry_snacks'
  | 'frozen'
  | 'beverages'
  | 'household';

export type DealType =
  | 'sale'
  | 'bogo'
  | 'digital_coupon'
  | 'multi_buy'
  | 'clearance';

export type NormalizedUnitType =
  | 'lb'
  | 'oz'
  | 'unit'
  | 'gallon'
  | 'count'
  | 'dozen';

export type QualityTier =
  | 'budget'
  | 'standard'
  | 'premium'
  | 'organic';

export type RadiusOption = 1 | 5 | 10 | 25;

export type ActiveTab = 'circulars' | 'compare' | 'list';

export type SortOption = 'discount' | 'price' | 'unit_cost';

export interface Store {
  id: string;
  name: string;
  chain: string;
  logoColor: string;
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
  imageUrl?: string;
  ocrTranscript?: string;
  category: DealCategory;
  originalPrice: number;
  salePrice: number;
  discountPercent: number;
  unitPrice: string;
  normalizedUnitCost: number;
  normalizedUnitType: NormalizedUnitType;
  unitDescription: string;
  dealType: DealType;
  dealBadge?: string;
  validUntil: string;
  inStock: boolean;
  genericProductGroup: string;
  tags: string[];
  brand?: string;
  qualityTier?: QualityTier;
  bundleQuantity?: number;
  bundleTotalPrice?: number | null;
  isUnpricedPromo?: boolean;
  hasExplicitOriginalPrice?: boolean;
  promoBadgeText?: string;
  hasExplicitDollarPrice?: boolean;
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

export interface AIComparisonResult {
  bestDealId: string;
  verdict: string;
  keyDifference: string;
  unitPriceAdvantage: string;
  caveats: string;
}

export interface ComparisonGroup {
  genericProductGroup: string;
  productName: string;
  category: DealCategory;
  deals: DealItem[];
  bestDeal: DealItem;
  totalStores: number;
  unitType: NormalizedUnitType;
  unitPriceDiff: number;
  maxSavingsPercent: number;
  aiAnalysis?: AIComparisonResult;
}

export interface BetterAlternative {
  cheaperDeal: DealItem;
  savingsPerUnit: number;
  totalPotentialSavings: number;
  savingsPercent: number;
  summary: string;
}

export interface ShoppingListItem {
  id: string;
  title: string;
  quantity: number;
  checked: boolean;
  deal?: DealItem;
  betterAlternative?: BetterAlternative | null;
  customPrice?: number;
  notes?: string;
  createdAt: string;
}
