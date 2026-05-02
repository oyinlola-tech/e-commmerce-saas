const {
  createHttpError
} = require('../../../../packages/shared/src/errors');
const {
  sanitizeEmail,
  sanitizePlainText
} = require('../../../../packages/shared/src/sanitization');
const {
  decryptText
} = require('../../../../packages/shared/src/crypto');

const MARKETING_UNSUBSCRIBE_TOKEN_PURPOSE = 'customer_marketing_unsubscribe';

const parseMarketingUnsubscribeToken = (token, secret) => {
  if (!String(token || '').trim()) {
    throw createHttpError(400, 'A marketing unsubscribe token is required.', null, { expose: true });
  }

  let payload = null;
  try {
    payload = JSON.parse(decryptText(String(token || '').trim(), secret));
  } catch {
    throw createHttpError(400, 'This unsubscribe link is invalid.', null, { expose: true });
  }

  const purpose = sanitizePlainText(payload?.purpose || '', { maxLength: 80 });
  const customerId = Number(payload?.customer_id || 0);
  const storeId = Number(payload?.store_id || 0);
  const email = sanitizeEmail(payload?.email || '');
  const expiresAt = payload?.expires_at ? new Date(payload.expires_at) : null;

  if (
    purpose !== MARKETING_UNSUBSCRIBE_TOKEN_PURPOSE
    || !customerId
    || !storeId
    || !email
    || !expiresAt
    || Number.isNaN(expiresAt.getTime())
    || expiresAt.getTime() < Date.now()
  ) {
    throw createHttpError(400, 'This unsubscribe link is no longer valid.', null, { expose: true });
  }

  return {
    customerId,
    storeId,
    email
  };
};

const sanitizeMarketingSubscriber = (customer) => {
  if (!customer) {
    return null;
  }

  return {
    id: customer.id,
    store_id: customer.store_id,
    name: customer.name,
    email: customer.email,
    marketing_email_subscribed: Boolean(customer.marketing_email_subscribed),
    marketing_email_subscribed_at: customer.marketing_email_subscribed_at || null,
    marketing_email_unsubscribed_at: customer.marketing_email_unsubscribed_at || null
  };
};

module.exports = {
  MARKETING_UNSUBSCRIBE_TOKEN_PURPOSE,
  parseMarketingUnsubscribeToken,
  sanitizeMarketingSubscriber
};
