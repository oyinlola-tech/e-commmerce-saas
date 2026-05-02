const {
  resolveProductPricing,
  calculateDiscountedPrice,
  calculateDiscountPercentage
} = require('./pricing');

describe('product pricing helpers', () => {
  test('resolves an active percentage flash sale with compare-at pricing', () => {
    const pricing = resolveProductPricing({
      price: 120,
      base_price: 120,
      discount_type: 'percentage',
      discount_value: 25,
      promotion_type: 'flash_sale',
      discount_label: 'Weekend drop',
      discount_starts_at: '2026-05-01T00:00:00.000Z',
      discount_ends_at: '2026-05-03T23:59:59.000Z'
    }, {
      now: '2026-05-02T12:00:00.000Z'
    });

    expect(pricing.price).toBe(90);
    expect(pricing.basePrice).toBe(120);
    expect(pricing.compareAtPrice).toBe(120);
    expect(pricing.hasDiscount).toBe(true);
    expect(pricing.discountAmount).toBe(30);
    expect(pricing.discountPercentage).toBe(25);
    expect(pricing.promotionType).toBe('flash_sale');
    expect(pricing.isFlashSale).toBe(true);
    expect(pricing.discountLabel).toBe('Weekend drop');
  });

  test('does not activate a scheduled discount before the start window', () => {
    const pricing = resolveProductPricing({
      price: 80,
      base_price: 80,
      discount_type: 'amount',
      discount_value: 10,
      promotion_type: 'discount',
      discount_starts_at: '2026-05-10T00:00:00.000Z',
      discount_ends_at: '2026-05-12T23:59:59.000Z'
    }, {
      now: '2026-05-02T12:00:00.000Z'
    });

    expect(pricing.price).toBe(80);
    expect(pricing.compareAtPrice).toBeNull();
    expect(pricing.hasDiscount).toBe(false);
    expect(pricing.discountAmount).toBe(0);
    expect(pricing.discountPercentage).toBe(0);
    expect(pricing.promotionType).toBe('none');
    expect(pricing.isFlashSale).toBe(false);
  });

  test('keeps legacy compare-at pricing behavior when structured discount is absent', () => {
    const pricing = resolveProductPricing({
      price: 75,
      compare_at_price: 100
    });

    expect(pricing.basePrice).toBe(100);
    expect(pricing.price).toBe(75);
    expect(pricing.compareAtPrice).toBe(100);
    expect(pricing.hasDiscount).toBe(true);
    expect(pricing.discountAmount).toBe(25);
    expect(pricing.discountPercentage).toBe(25);
    expect(pricing.promotionType).toBe('discount');
  });

  test('discount calculations bound values safely', () => {
    expect(calculateDiscountedPrice({
      basePrice: 50,
      discountType: 'amount',
      discountValue: 75
    })).toBe(0);

    expect(calculateDiscountedPrice({
      basePrice: 200,
      discountType: 'percentage',
      discountValue: 120
    })).toBe(10);

    expect(calculateDiscountPercentage({
      originalPrice: 200,
      salePrice: 10
    })).toBe(95);
  });
});
