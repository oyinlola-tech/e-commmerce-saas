const DISCOUNT_TYPES = ['none', 'amount', 'percentage'];
const PROMOTION_TYPES = ['none', 'discount', 'flash_sale'];

const roundMoney = (value = 0) => {
  return Math.round(Number(value || 0) * 100) / 100;
};

const normalizeDiscountType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return DISCOUNT_TYPES.includes(normalized)
    ? normalized
    : 'none';
};

const normalizePromotionType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return PROMOTION_TYPES.includes(normalized)
    ? normalized
    : 'none';
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

const isPromotionWindowActive = ({ startsAt = null, endsAt = null, now = new Date() } = {}) => {
  const start = parseDateValue(startsAt);
  const end = parseDateValue(endsAt);
  const currentTime = parseDateValue(now) || new Date();

  if (start && start.getTime() > currentTime.getTime()) {
    return false;
  }

  if (end && end.getTime() < currentTime.getTime()) {
    return false;
  }

  return true;
};

const calculateDiscountedPrice = ({ basePrice = 0, discountType = 'none', discountValue = 0 } = {}) => {
  const safeBasePrice = Math.max(0, roundMoney(basePrice));
  const safeDiscountValue = Math.max(0, Number(discountValue || 0));
  const normalizedDiscountType = normalizeDiscountType(discountType);

  if (normalizedDiscountType === 'amount') {
    return roundMoney(Math.max(0, safeBasePrice - safeDiscountValue));
  }

  if (normalizedDiscountType === 'percentage') {
    const boundedPercentage = Math.min(95, safeDiscountValue);
    return roundMoney(safeBasePrice * (1 - (boundedPercentage / 100)));
  }

  return safeBasePrice;
};

const calculateDiscountPercentage = ({ originalPrice = 0, salePrice = 0 } = {}) => {
  const safeOriginalPrice = Math.max(0, Number(originalPrice || 0));
  const safeSalePrice = Math.max(0, Number(salePrice || 0));
  if (!safeOriginalPrice || safeSalePrice >= safeOriginalPrice) {
    return 0;
  }

  return Math.round(((safeOriginalPrice - safeSalePrice) / safeOriginalPrice) * 100);
};

const resolveProductPricing = (product = {}, options = {}) => {
  const now = options.now || new Date();
  const configuredBasePrice = product.base_price === null || product.base_price === undefined
    ? null
    : roundMoney(product.base_price);
  const storedPrice = roundMoney(product.price || 0);
  const storedCompareAtPrice = product.compare_at_price === null || product.compare_at_price === undefined
    ? null
    : roundMoney(product.compare_at_price);
  const normalizedDiscountType = normalizeDiscountType(product.discount_type);
  const normalizedPromotionType = normalizePromotionType(product.promotion_type);
  const discountValue = Math.max(0, Number(product.discount_value || 0));
  const hasStructuredDiscount = configuredBasePrice !== null
    && normalizedDiscountType !== 'none'
    && discountValue > 0;

  if (hasStructuredDiscount) {
    const active = isPromotionWindowActive({
      startsAt: product.discount_starts_at,
      endsAt: product.discount_ends_at,
      now
    });
    const salePrice = calculateDiscountedPrice({
      basePrice: configuredBasePrice,
      discountType: normalizedDiscountType,
      discountValue
    });
    const hasDiscount = active && salePrice < configuredBasePrice;
    const livePrice = hasDiscount
      ? salePrice
      : configuredBasePrice;
    const compareAtPrice = hasDiscount
      ? configuredBasePrice
      : null;
    const discountPercentage = hasDiscount
      ? calculateDiscountPercentage({
        originalPrice: configuredBasePrice,
        salePrice
      })
      : 0;

    return {
      basePrice: configuredBasePrice,
      price: livePrice,
      compareAtPrice,
      hasDiscount,
      discountAmount: hasDiscount
        ? roundMoney(configuredBasePrice - salePrice)
        : 0,
      discountPercentage,
      discountType: normalizedDiscountType,
      discountValue,
      promotionType: hasDiscount
        ? normalizedPromotionType
        : (configuredBasePrice === livePrice ? 'none' : normalizedPromotionType),
      isFlashSale: hasDiscount && normalizedPromotionType === 'flash_sale',
      discountStartsAt: product.discount_starts_at || null,
      discountEndsAt: product.discount_ends_at || null,
      discountLabel: String(product.discount_label || '').trim()
    };
  }

  const legacyCompareAtPrice = storedCompareAtPrice !== null && storedCompareAtPrice > storedPrice
    ? storedCompareAtPrice
    : null;
  const legacyDiscountPercentage = legacyCompareAtPrice
    ? calculateDiscountPercentage({
      originalPrice: legacyCompareAtPrice,
      salePrice: storedPrice
    })
    : 0;

  return {
    basePrice: legacyCompareAtPrice || storedPrice,
    price: storedPrice,
    compareAtPrice: legacyCompareAtPrice,
    hasDiscount: Boolean(legacyCompareAtPrice),
    discountAmount: legacyCompareAtPrice
      ? roundMoney(legacyCompareAtPrice - storedPrice)
      : 0,
    discountPercentage: legacyDiscountPercentage,
    discountType: 'none',
    discountValue: 0,
    promotionType: legacyCompareAtPrice ? 'discount' : 'none',
    isFlashSale: false,
    discountStartsAt: null,
    discountEndsAt: null,
    discountLabel: ''
  };
};

module.exports = {
  DISCOUNT_TYPES,
  PROMOTION_TYPES,
  roundMoney,
  normalizeDiscountType,
  normalizePromotionType,
  parseDateValue,
  toDatabaseDateTime,
  isPromotionWindowActive,
  calculateDiscountedPrice,
  calculateDiscountPercentage,
  resolveProductPricing
};
