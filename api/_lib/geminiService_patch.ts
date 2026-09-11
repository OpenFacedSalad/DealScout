import { Store, DealItem } from '../../src/types';

export function generateDeterministicFallbackDeals(stores: Store[]): DealItem[] {
  const allDeals: DealItem[] = [];
  const currentDate = new Date().toISOString().split('T')[0];
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  stores.forEach((store) => {
    const sName = store.name.toLowerCase();
    let items: any[] = [];
    
    if (sName.includes('aldi')) {
      items = [
        { t: 'Fresh Hass Avocados', c: 'produce', o: 1.29, s: 0.69, ut: 'unit', ud: 'each', p: 0.69, k: 'hass_avocados', dt: 'sale' },
        { t: 'Fresh 73/27 Ground Beef', c: 'meat_seafood', o: 3.49, s: 2.99, ut: 'lb', ud: 'per lb', p: 2.99, k: 'ground_beef_80_20', dt: 'sale' },
        { t: 'Large White Eggs', c: 'dairy_eggs', o: 2.99, s: 1.99, ut: 'dozen', ud: 'per dozen', p: 1.99, k: 'large_white_eggs', dt: 'sale' },
        { t: 'Fresh Honeycrisp Apples', c: 'produce', o: 4.99, s: 3.49, ut: 'lb', ud: 'per lb', p: 3.49, k: 'honeycrisp_apples', dt: 'sale' },
        { t: 'Kirkwood Chicken Wings', c: 'meat_seafood', o: 12.99, s: 9.99, ut: 'lb', ud: 'per lb', p: 9.99, k: 'chicken_wings', dt: 'sale' }
      ];
    } else if (sName.includes('giant')) {
      items = [
        { t: 'Fresh 80/20 Ground Beef', c: 'meat_seafood', o: 5.99, s: 3.99, ut: 'lb', ud: 'per lb', p: 3.99, k: 'ground_beef_80_20', dt: 'sale' },
        { t: 'Giant Boneless Skinless Chicken Breast', c: 'meat_seafood', o: 4.99, s: 1.99, ut: 'lb', ud: 'per lb', p: 1.99, k: 'boneless_chicken_breast', dt: 'sale' },
        { t: 'Giant Brand Shredded Cheddar', c: 'dairy_eggs', o: 3.29, s: 2.00, ut: 'unit', ud: '8 oz bag', p: 2.00, k: 'shredded_cheddar_cheese', dt: 'sale' },
        { t: 'Whole Milk Gallon', c: 'dairy_eggs', o: 3.99, s: 3.29, ut: 'gallon', ud: 'per gallon', p: 3.29, k: 'whole_milk_gallon', dt: 'sale' },
        { t: 'Giant Brand Bacon', c: 'meat_seafood', o: 6.99, s: 4.99, ut: 'unit', ud: '16 oz pack', p: 4.99, k: 'bacon_16oz', dt: 'digital_coupon' }
      ];
    } else if (sName.includes('fresh market')) {
      items = [
        { t: 'Little Big Meal: Chicken Stir Fry', c: 'meat_seafood', o: 35.0, s: 25.0, ut: 'unit', ud: 'Meal for 4', p: 25.0, k: 'boneless_chicken_breast', dt: 'sale' },
        { t: 'Premium Extra Virgin Olive Oil', c: 'pantry_snacks', o: 14.99, s: 11.99, ut: 'unit', ud: '16 oz bottle', p: 11.99, k: 'extra_virgin_olive_oil', dt: 'sale' },
        { t: 'Fresh Strawberries', c: 'produce', o: 5.99, s: 3.99, ut: 'unit', ud: '1 lb container', p: 3.99, k: 'strawberries_1lb', dt: 'sale' },
        { t: 'Artisan Sourdough Boule', c: 'bakery_deli', o: 6.99, s: 5.49, ut: 'unit', ud: 'each', p: 5.49, k: 'sourdough_bread', dt: 'sale' },
        { t: 'Gourmet Ground Chuck', c: 'meat_seafood', o: 7.99, s: 5.99, ut: 'lb', ud: 'per lb', p: 5.99, k: 'ground_beef_80_20', dt: 'sale' }
      ];
    } else if (sName.includes('trader joe')) {
      items = [
        { t: 'Organic Large Brown Eggs', c: 'dairy_eggs', o: 4.49, s: 4.49, ut: 'dozen', ud: 'per dozen', p: 4.49, k: 'large_white_eggs', dt: 'sale' },
        { t: 'Teeny Tiny Avocados', c: 'produce', o: 3.99, s: 3.99, ut: 'unit', ud: '6-pack', p: 3.99, k: 'hass_avocados', dt: 'sale' },
        { t: 'Organic Honeycrisp Apples', c: 'produce', o: 5.49, s: 5.49, ut: 'lb', ud: 'per lb', p: 5.49, k: 'honeycrisp_apples', dt: 'sale' },
        { t: 'Trader Joe\'s Extra Virgin Olive Oil', c: 'pantry_snacks', o: 8.99, s: 8.99, ut: 'unit', ud: '16 oz bottle', p: 8.99, k: 'extra_virgin_olive_oil', dt: 'sale' },
        { t: 'Unexpected Cheddar Cheese', c: 'dairy_eggs', o: 4.99, s: 4.99, ut: 'unit', ud: 'per block', p: 4.99, k: 'shredded_cheddar_cheese', dt: 'sale' }
      ];
    } else {
      items = [
        { t: 'Fresh Ground Beef', c: 'meat_seafood', o: 5.49, s: 4.49, ut: 'lb', ud: 'per lb', p: 4.49, k: 'ground_beef_80_20', dt: 'sale' },
        { t: 'Large Eggs', c: 'dairy_eggs', o: 3.49, s: 2.49, ut: 'dozen', ud: 'per dozen', p: 2.49, k: 'large_white_eggs', dt: 'sale' },
        { t: 'Fresh Apples', c: 'produce', o: 2.99, s: 1.99, ut: 'lb', ud: 'per lb', p: 1.99, k: 'honeycrisp_apples', dt: 'sale' },
        { t: 'Whole Milk', c: 'dairy_eggs', o: 3.59, s: 2.99, ut: 'gallon', ud: 'per gallon', p: 2.99, k: 'whole_milk_gallon', dt: 'sale' }
      ];
    }

    items.forEach((item, index) => {
      allDeals.push({
        id: `${store.id}-deal-${index}-${Date.now()}`,
        storeId: store.id,
        storeName: store.name,
        storeLogoBg: store.logoBg,
        storeLogoText: store.logoText,
        title: item.t,
        category: item.c as any,
        originalPrice: item.o,
        salePrice: item.s,
        discountPercent: Math.round(((item.o - item.s) / item.o) * 100),
        unitPrice: `$${item.s.toFixed(2)} ${item.ud.replace('per ', '/ ')}`,
        normalizedUnitCost: item.p,
        normalizedUnitType: item.ut as any,
        unitDescription: item.ud,
        dealType: item.dt as any,
        genericProductGroup: item.k,
        validUntil,
        tags: [store.chain.toLowerCase(), 'weekly_ad'],
      });
    });
  });

  return allDeals;
}
