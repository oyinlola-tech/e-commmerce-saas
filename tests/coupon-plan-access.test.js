const {
  hasPlanCapability,
  isCouponPauseOnlyUpdate
} = require('../apps/services/order-service/src/coupon-plan-access');

describe('coupon marketing plan access helpers', () => {
  test('detects enabled automated marketing capability', () => {
    expect(hasPlanCapability({
      entitlements: {
        capabilities: {
          automated_marketing: true
        }
      }
    }, 'automated_marketing')).toBe(true);
  });

  test('allows pause-only coupon updates after downgrade', () => {
    const existingCoupon = {
      code: 'WELCOME10',
      description: 'Welcome offer',
      discount_type: 'percentage',
      discount_value: 10,
      minimum_order_amount: 0,
      starts_at: null,
      ends_at: null,
      usage_limit: null,
      is_active: 1
    };
    const couponDraft = {
      ...existingCoupon,
      is_active: false
    };

    expect(isCouponPauseOnlyUpdate(existingCoupon, couponDraft)).toBe(true);
  });

  test('blocks coupon edits that change offer details after downgrade', () => {
    const existingCoupon = {
      code: 'WELCOME10',
      description: 'Welcome offer',
      discount_type: 'percentage',
      discount_value: 10,
      minimum_order_amount: 0,
      starts_at: null,
      ends_at: null,
      usage_limit: null,
      is_active: 1
    };
    const couponDraft = {
      ...existingCoupon,
      discount_value: 15,
      is_active: false
    };

    expect(isCouponPauseOnlyUpdate(existingCoupon, couponDraft)).toBe(false);
  });
});
