const COUPON_DISCOUNT_TYPES = ['amount', 'percentage'];
const ACTIVE_REDEMPTION_STATUSES = ['pending', 'confirmed'];

const roundMoney = (value = 0) => {
  return Math.round(Number(value || 0) * 100) / 100;
};

const normalizeCouponCode = (value = '') => {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 80);
};

const normalizeCouponDiscountType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return COUPON_DISCOUNT_TYPES.includes(normalized)
    ? normalized
    : 'percentage';
};

const parseDateValue = (value) => {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date
    ? value
    : new Date(value);
  return Number.isNaN(candidate.getTime())
    ? null
    : candidate;
};

const toDatabaseDateTime = (value) => {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return null;
  }

  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const serializeCoupon = (coupon = null, extra = {}) => {
  if (!coupon) {
    return null;
  }

  return {
    id: coupon.id,
    store_id: coupon.store_id,
    code: coupon.code,
    description: coupon.description,
    discount_type: normalizeCouponDiscountType(coupon.discount_type),
    discount_value: roundMoney(coupon.discount_value || 0),
    minimum_order_amount: roundMoney(coupon.minimum_order_amount || 0),
    starts_at: coupon.starts_at || null,
    ends_at: coupon.ends_at || null,
    usage_limit: coupon.usage_limit === null || coupon.usage_limit === undefined
      ? null
      : Number(coupon.usage_limit),
    is_active: Boolean(coupon.is_active),
    usage_count: Number(extra.usage_count || 0),
    created_at: coupon.created_at,
    updated_at: coupon.updated_at
  };
};

const calculateCouponDiscount = ({ coupon = null, subtotal = 0 }) => {
  const safeSubtotal = Math.max(0, roundMoney(subtotal));
  if (!coupon) {
    return 0;
  }

  const discountType = normalizeCouponDiscountType(coupon.discount_type);
  const discountValue = Math.max(0, Number(coupon.discount_value || 0));
  if (!safeSubtotal || !discountValue) {
    return 0;
  }

  if (discountType === 'amount') {
    return roundMoney(Math.min(safeSubtotal, discountValue));
  }

  const boundedPercentage = Math.min(95, discountValue);
  return roundMoney(Math.min(safeSubtotal, safeSubtotal * (boundedPercentage / 100)));
};

const buildCouponPreview = ({ coupon = null, subtotal = 0, usageCount = 0, now = new Date() } = {}) => {
  const safeSubtotal = Math.max(0, roundMoney(subtotal));
  const currentTime = parseDateValue(now) || new Date();
  const normalizedUsageCount = Math.max(0, Number(usageCount || 0));

  if (!coupon) {
    return {
      valid: false,
      status: 404,
      reason: 'Coupon not found.'
    };
  }

  if (!coupon.is_active) {
    return {
      valid: false,
      status: 422,
      reason: 'This coupon is not active right now.'
    };
  }

  const startsAt = parseDateValue(coupon.starts_at);
  if (startsAt && startsAt.getTime() > currentTime.getTime()) {
    return {
      valid: false,
      status: 422,
      reason: 'This coupon has not started yet.'
    };
  }

  const endsAt = parseDateValue(coupon.ends_at);
  if (endsAt && endsAt.getTime() < currentTime.getTime()) {
    return {
      valid: false,
      status: 422,
      reason: 'This coupon has expired.'
    };
  }

  const minimumOrderAmount = Math.max(0, Number(coupon.minimum_order_amount || 0));
  if (safeSubtotal < minimumOrderAmount) {
    return {
      valid: false,
      status: 422,
      reason: `This coupon requires a minimum order of ${minimumOrderAmount.toFixed(2)}.`
    };
  }

  const usageLimit = coupon.usage_limit === null || coupon.usage_limit === undefined
    ? null
    : Number(coupon.usage_limit);
  if (usageLimit !== null && normalizedUsageCount >= usageLimit) {
    return {
      valid: false,
      status: 422,
      reason: 'This coupon has reached its usage limit.'
    };
  }

  const discountTotal = calculateCouponDiscount({
    coupon,
    subtotal: safeSubtotal
  });
  if (discountTotal <= 0) {
    return {
      valid: false,
      status: 422,
      reason: 'This coupon does not apply to the current order.'
    };
  }

  return {
    valid: true,
    subtotal: safeSubtotal,
    discount_total: discountTotal,
    total: roundMoney(safeSubtotal - discountTotal),
    coupon: serializeCoupon(coupon, {
      usage_count: normalizedUsageCount
    })
  };
};

module.exports = {
  COUPON_DISCOUNT_TYPES,
  ACTIVE_REDEMPTION_STATUSES,
  roundMoney,
  normalizeCouponCode,
  normalizeCouponDiscountType,
  parseDateValue,
  toDatabaseDateTime,
  serializeCoupon,
  calculateCouponDiscount,
  buildCouponPreview
};
