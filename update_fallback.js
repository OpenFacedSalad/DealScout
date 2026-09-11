const fs = require('fs');

let content = fs.readFileSync('api/_lib/geminiService.ts', 'utf8');

const regex = /function generateDeterministicFallbackDeals[\s\S]*?function generateDeterministicComparison/m;

const newCode = `function generateDeterministicFallbackDeals(stores: Store[]): DealItem[] {
  const deals: DealItem[] = [];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5);
  const validUntilStr = futureDate.toISOString().split('T')[0];

  const commodities = [
    { key: 'ground_beef_80_20', title: '80/20 Ground Beef', category: 'meat_seafood', basePrice: 4.99, type: 'lb' },
    { key: 'boneless_chicken_breast', title: 'Boneless Skinless Chicken Breast', category: 'meat_seafood', basePrice: 3.49, type: 'lb' },
    { key: 'atlantic_salmon', title: 'Fresh Atlantic Salmon Portions', category: 'meat_seafood', basePrice: 9.99, type: 'lb' },
    { key: 'bacon_16oz', title: 'Thick Cut Bacon, 16 oz', category: 'meat_seafood', basePrice: 5.49, type: 'unit' },
    { key: 'pork_chops', title: 'Bone-In Pork Chops', category: 'meat_seafood', basePrice: 3.99, type: 'lb' },
    { key: 'large_white_eggs', title: 'Grade A Large White Eggs, 1 Dozen', category: 'dairy_eggs', basePrice: 2.79, type: 'dozen' },
    { key: 'whole_milk_gallon', title: 'Whole Milk, 1 Gallon', category: 'dairy_eggs', basePrice: 3.49, type: 'gallon' },
    { key: 'butter_salted_1lb', title: 'Salted Butter Quarters, 16 oz', category: 'dairy_eggs', basePrice: 4.49, type: 'unit' },
    { key: 'shredded_cheddar_cheese', title: 'Shredded Sharp Cheddar, 8 oz', category: 'dairy_eggs', basePrice: 2.99, type: 'unit' },
    { key: 'honeycrisp_apples', title: 'Fresh Honeycrisp Apples', category: 'produce', basePrice: 2.49, type: 'lb' },
    { key: 'strawberries_1lb', title: 'Fresh Strawberries, 1 lb pkg', category: 'produce', basePrice: 3.99, type: 'unit' },
    { key: 'hass_avocados', title: 'Hass Avocados', category: 'produce', basePrice: 1.25, type: 'unit' },
    { key: 'russet_potatoes_5lb', title: 'Russet Potatoes, 5 lb bag', category: 'produce', basePrice: 3.99, type: 'unit' },
    { key: 'sourdough_bread', title: 'Artisan Sourdough Loaf', category: 'bakery_deli', basePrice: 4.49, type: 'unit' },
    { key: 'extra_virgin_olive_oil', title: 'Extra Virgin Olive Oil, 16.9 oz', category: 'pantry_snacks', basePrice: 7.99, type: 'unit' }
  ];

  stores.forEach((store) => {
    const chainOrName = (store.chain || store.name || '').toLowerCase();
    
    let logoBg = store.logoBg || '#334155';
    let logoText = store.logoText || 'STORE';
    let brand = 'Store Brand';
    let qualityTier: "budget" | "standard" | "premium" | "organic" = 'standard';
    let priceMultiplier = 1.0;

    if (chainOrName.includes('aldi')) {
      logoBg = '#002B49';
      logoText = 'ALDI';
      brand = 'Simply Nature / Friendly Farms';
      qualityTier = 'budget';
      priceMultiplier = 0.85;
    } else if (chainOrName.includes('giant')) {
      logoBg = '#DA291C';
      logoText = 'GIANT';
      brand = "Nature's Promise / Store Brand";
      qualityTier = 'standard';
      priceMultiplier = 1.0;
    } else if (chainOrName.includes('fresh market')) {
      logoBg = '#00543D';
      logoText = 'FRESH MKT';
      brand = 'The Fresh Market';
      qualityTier = 'premium';
      priceMultiplier = 1.3;
    } else if (chainOrName.includes('trader joe')) {
      logoBg = '#C8102E';
      logoText = "TJ'S";
      brand = "Trader Joe's";
      qualityTier = 'standard';
      priceMultiplier = 0.95;
    } else if (chainOrName.includes('karns')) {
      logoBg = '#B91C1C';
      logoText = 'KARNS';
      brand = 'Karns Butcher Cut';
      qualityTier = 'premium';
      priceMultiplier = 1.1;
    }

    store.logoBg = logoBg;
    store.logoText = logoText;

    commodities.forEach((comm, idx) => {
      // Create some variance so prices aren't purely uniform multipliers
      const variance = 1 + ((store.id.length + idx) % 11 - 5) * 0.02; // +/- 10%
      let salePrice = parseFloat((comm.basePrice * priceMultiplier * variance).toFixed(2));
      let origPrice = parseFloat((salePrice * 1.25).toFixed(2));
      
      let unitPriceStr = \`$\${salePrice.toFixed(2)} / \${comm.type}\`;
      let normType: any = comm.type;
      
      if (comm.type === 'dozen') {
        unitPriceStr = \`$\${(salePrice / 12).toFixed(2)} / egg\`;
        normType = 'unit';
      }

      deals.push({
        id: \`\${store.id}-\${comm.key}\`,
        storeId: store.id,
        storeName: store.name,
        storeLogoBg: logoBg,
        storeLogoText: logoText,
        title: comm.title,
        category: comm.category as any,
        originalPrice: origPrice,
        salePrice: salePrice,
        discountPercent: Math.round(((origPrice - salePrice) / origPrice) * 100),
        unitPrice: unitPriceStr,
        normalizedUnitCost: comm.type === 'dozen' ? parseFloat((salePrice / 12).toFixed(3)) : salePrice,
        normalizedUnitType: normType,
        unitDescription: comm.type === 'dozen' ? 'per egg' : \`per \${comm.type}\`,
        dealType: 'sale',
        validUntil: validUntilStr,
        inStock: true,
        genericProductGroup: comm.key,
        tags: [comm.category, 'grocery'],
        brand: brand,
        qualityTier: qualityTier,
      });
    });
  });

  return deals;
}

function generateDeterministicComparison`;

content = content.replace(regex, newCode);
fs.writeFileSync('api/_lib/geminiService.ts', content);
