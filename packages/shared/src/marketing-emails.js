const {
  encryptText
} = require('./crypto');
const {
  sanitizeEmail,
  sanitizePlainText
} = require('./sanitization');

const MARKETING_UNSUBSCRIBE_TOKEN_PURPOSE = 'customer_marketing_unsubscribe';
const DEFAULT_MARKETING_UNSUBSCRIBE_TOKEN_TTL_MS = Math.max(
  24 * 60 * 60 * 1000,
  Number(process.env.MARKETING_UNSUBSCRIBE_TOKEN_TTL_MS || 365 * 24 * 60 * 60 * 1000)
);

const createMarketingUnsubscribeToken = ({
  customerId,
  storeId,
  email,
  secret,
  now = Date.now(),
  ttlMs = DEFAULT_MARKETING_UNSUBSCRIBE_TOKEN_TTL_MS
}) => {
  const safeCustomerId = Number(customerId || 0);
  const safeStoreId = Number(storeId || 0);
  const safeEmail = sanitizeEmail(email || '');

  if (!safeCustomerId || !safeStoreId || !safeEmail || !String(secret || '').trim()) {
    return '';
  }

  return encryptText(JSON.stringify({
    purpose: MARKETING_UNSUBSCRIBE_TOKEN_PURPOSE,
    customer_id: safeCustomerId,
    store_id: safeStoreId,
    email: safeEmail,
    expires_at: new Date(Number(now) + Math.max(1, Number(ttlMs) || DEFAULT_MARKETING_UNSUBSCRIBE_TOKEN_TTL_MS)).toISOString(),
    issued_at: new Date(Number(now)).toISOString(),
    audience: sanitizePlainText('customer', { maxLength: 20 })
  }), secret);
};

module.exports = {
  MARKETING_UNSUBSCRIBE_TOKEN_PURPOSE,
  DEFAULT_MARKETING_UNSUBSCRIBE_TOKEN_TTL_MS,
  createMarketingUnsubscribeToken
};
