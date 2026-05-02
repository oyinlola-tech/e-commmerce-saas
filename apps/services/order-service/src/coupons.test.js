const {
  normalizeCouponCode,
  calculateCouponDiscount,
  buildCouponPreview
} = require('./coupons');

describe('coupon helpers', () => {
  test('normalizes coupon codes for storage and lookup', () => {
    expect(normalizeCouponCode(' spring-sale 2026! ')).toBe('SPRING-SALE2026');
  });

  test('builds a valid percentage coupon preview with totals', () => {
    const preview = buildCouponPreview({
      coupon: {
        id: 7,
        store_id: 3,
        code: 'FLASH20',
        description: '20% off flash coupon',
        discount_type: 'percentage',
        discount_value: 20,
        minimum_order_amount: 100,
        starts_at: '2026-05-01T00:00:00.000Z',
        ends_at: '2026-05-10T00:00:00.000Z',
        usage_limit: 50,
        is_active: true
      },
      subtotal: 150,
      usageCount: 12,
      now: '2026-05-02T10:00:00.000Z'
    });

    expect(preview.valid).toBe(true);
    expect(preview.discount_total).toBe(30);
    expect(preview.total).toBe(120);
    expect(preview.coupon.code).toBe('FLASH20');
    expect(preview.coupon.usage_count).toBe(12);
  });

  test('caps amount discounts at the subtotal', () => {
    expect(calculateCouponDiscount({
      coupon: {
        discount_type: 'amount',
        discount_value: 500
      },
      subtotal: 120
    })).toBe(120);
  });

  test('rejects expired coupons with a shopper-friendly message', () => {
    const preview = buildCouponPreview({
      coupon: {
        code: 'OLD10',
        discount_type: 'percentage',
        discount_value: 10,
        minimum_order_amount: 0,
        starts_at: '2026-04-01T00:00:00.000Z',
        ends_at: '2026-04-15T00:00:00.000Z',
        usage_limit: null,
        is_active: true
      },
      subtotal: 100,
      now: '2026-05-02T10:00:00.000Z'
    });

    expect(preview.valid).toBe(false);
    expect(preview.status).toBe(422);
    expect(preview.reason).toBe('This coupon has expired.');
  });
});
