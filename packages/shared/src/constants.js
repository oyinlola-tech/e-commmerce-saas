const EVENT_NAMES = {
  USER_REGISTERED: 'USER_REGISTERED',
  STORE_CREATED: 'STORE_CREATED',
  STORE_UPDATED: 'STORE_UPDATED',
  CUSTOMER_REGISTERED: 'CUSTOMER_REGISTERED',
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
  CART_UPDATED: 'CART_UPDATED',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  SUBSCRIPTION_CHANGED: 'SUBSCRIPTION_CHANGED',
  KYC_SUBMITTED: 'KYC_SUBMITTED',
  KYB_SUBMITTED: 'KYB_SUBMITTED',
  COMPLIANCE_STATUS_CHANGED: 'COMPLIANCE_STATUS_CHANGED',
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_UPDATED: 'TICKET_UPDATED',
  TICKET_MESSAGE_CREATED: 'TICKET_MESSAGE_CREATED',
  CHAT_THREAD_CREATED: 'CHAT_THREAD_CREATED',
  CHAT_MESSAGE_CREATED: 'CHAT_MESSAGE_CREATED',
  EMAIL_ENQUEUED: 'EMAIL_ENQUEUED'
};

const PLATFORM_ROLES = {
  STORE_OWNER: 'store_owner',
  PLATFORM_OWNER: 'platform_owner',
  SUPPORT_AGENT: 'support_agent'
};

const STORE_TYPES = [
  'fashion',
  'electronics',
  'home-decor',
  'beauty',
  'skincare',
  'haircare',
  'womens-fashion',
  'unisex-lifestyle',
  'gourmet',
  'outdoors',
  'kids',
  'jewelry'
];

const TEMPLATE_KEYS = [
  'fashion',
  'electronics',
  'home-decor',
  'beauty',
  'skincare',
  'haircare',
  'womens-fashion',
  'unisex-lifestyle',
  'gourmet',
  'outdoors',
  'kids',
  'jewelry'
];

const FONT_PRESETS = [
  'jakarta',
  'editorial',
  'signal',
  'gallery',
  'studio'
];

const SUPPORTED_PLATFORM_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'TRY',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'OMR',
  'BHD',
  'JOD',
  'ILS',
  'INR',
  'PKR',
  'BDT',
  'NPR',
  'LKR',
  'JPY',
  'CNY',
  'HKD',
  'SGD',
  'MYR',
  'THB',
  'IDR',
  'PHP',
  'VND',
  'KRW',
  'MXN',
  'BRL',
  'ARS',
  'CLP',
  'COP',
  'PEN',
  'NGN',
  'GHS',
  'KES',
  'UGX',
  'TZS',
  'RWF',
  'BIF',
  'CDF',
  'DJF',
  'GMD',
  'GNF',
  'KMF',
  'LSL',
  'LYD',
  'MGA',
  'MRU',
  'MZN',
  'AOA',
  'CVE',
  'ERN',
  'ZAR',
  'BWP',
  'NAD',
  'ZMW',
  'MWK',
  'MUR',
  'SCR',
  'SOS',
  'SZL',
  'STN',
  'MAD',
  'TND',
  'DZD',
  'EGP',
  'ETB',
  'LRD',
  'XOF',
  'XAF',
  'SLL'
];

const PAYMENT_PROVIDERS = ['paystack', 'flutterwave'];
const SUPPORT_STATUSES = ['open', 'pending', 'resolved', 'closed'];
const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const isAllowedThemeValue = (value, allowedValues) => {
  return allowedValues.includes(String(value || '').trim().toLowerCase());
};

const normalizeThemeContract = (payload = {}) => {
  const storeType = String(payload.store_type || '').trim().toLowerCase();
  const templateKey = String(payload.template_key || '').trim().toLowerCase();
  const fontPreset = String(payload.font_preset || '').trim().toLowerCase();

  return {
    store_type: isAllowedThemeValue(storeType, STORE_TYPES) ? storeType : STORE_TYPES[0],
    template_key: isAllowedThemeValue(templateKey, TEMPLATE_KEYS) ? templateKey : TEMPLATE_KEYS[0],
    font_preset: isAllowedThemeValue(fontPreset, FONT_PRESETS) ? fontPreset : FONT_PRESETS[0]
  };
};

module.exports = {
  EVENT_NAMES,
  PLATFORM_ROLES,
  STORE_TYPES,
  TEMPLATE_KEYS,
  FONT_PRESETS,
  SUPPORTED_PLATFORM_CURRENCIES,
  PAYMENT_PROVIDERS,
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  normalizeThemeContract
};
