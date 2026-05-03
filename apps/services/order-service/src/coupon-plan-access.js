const hasPlanCapability = (access = {}, capability = '') => {
  return Boolean(access?.entitlements?.capabilities?.[capability]);
};

const toComparableValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  return String(value);
};

const toComparableNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  return Number(value || 0);
};

const toComparableUsageLimit = (value) => {
  return value === null || value === undefined || value === ''
    ? null
    : Number(value);
};

const isCouponPauseOnlyUpdate = (existingCoupon = null, couponDraft = null) => {
  if (!existingCoupon || !couponDraft || couponDraft.is_active !== false) {
    return false;
  }

  return toComparableValue(couponDraft.code) === toComparableValue(existingCoupon.code)
    && toComparableValue(couponDraft.description) === toComparableValue(existingCoupon.description)
    && toComparableValue(couponDraft.discount_type) === toComparableValue(existingCoupon.discount_type)
    && toComparableNumber(couponDraft.discount_value) === toComparableNumber(existingCoupon.discount_value)
    && toComparableNumber(couponDraft.minimum_order_amount) === toComparableNumber(existingCoupon.minimum_order_amount)
    && toComparableValue(couponDraft.starts_at) === toComparableValue(existingCoupon.starts_at)
    && toComparableValue(couponDraft.ends_at) === toComparableValue(existingCoupon.ends_at)
    && toComparableUsageLimit(couponDraft.usage_limit) === toComparableUsageLimit(existingCoupon.usage_limit);
};

module.exports = {
  hasPlanCapability,
  isCouponPauseOnlyUpdate
};
