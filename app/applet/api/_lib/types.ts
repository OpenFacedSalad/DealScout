export interface Store {
  id: string;
  name: string;
  chain: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  distanceMiles: number;
  logoBg: string;
  logoText: string;
  totalDealsCount: number;
}

export interface DealItem {
  id: string;
  storeId: string;
  storeName: string;
  storeLogoBg: string;
  storeLogoText: string;
  title: string;
  subtitle?: string;
  category:
    | 'produce'
    | 'meat_seafood'
    | 'dairy_eggs'
    | 'bakery_deli'
    | 'pantry_snacks'
    | 'frozen'
    | 'beverages'
    | 'household';
  originalPrice: number;
  salePrice: number;
  discountPercent: number;
  unitPrice: string;
  normalizedUnitCost: number;
  normalizedUnitType: 'lb' | 'oz' | 'unit' | 'gallon' | 'count' | 'dozen';
  unitDescription: string;
  dealType: 'sale' | 'bogo' | 'digital_coupon' | 'multi_buy' | 'clearance';
  dealBadge?: string;
  validUntil: string;
  inStock: boolean;
  genericProductGroup: string;
  tags: string[];
  brand?: string;
  qualityTier?: 'budget' | 'standard' | 'premium' | 'organic';
}

export interface UserLocation {
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  zipCode: string;
  formattedAddress: string;
  isGps: boolean;
  radiusMiles: number;
}

export type RadiusOption = 1 | 5 | 10 | 25;

export interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  zipCode?: string;
  createdAt: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url: string;
  };
  actions?: Array<{ action: string; title: string }>;
  tag?: string;
}
