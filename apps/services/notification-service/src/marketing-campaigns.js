const { URL } = require('url');
const {
  sanitizePlainText,
  sanitizeUrl,
  createMarketingUnsubscribeToken
} = require('../../../../packages/shared');

const MARKETING_CAMPAIGN_SCHEDULER_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.MARKETING_CAMPAIGN_SCHEDULER_INTERVAL_MS || 60 * 60 * 1000)
);
const MONTHLY_MARKETING_TEMPLATE_KEY = 'store.monthly_product_marketing';
const MAX_MARKETING_PRODUCTS = 15;

const joinUrl = (baseUrl, relativePath) => {
  try {
    return new URL(relativePath, baseUrl).toString();
  } catch {
    return '';
  }
};

const buildNextMonthlySendAt = (referenceDate = new Date()) => {
  const baseDate = referenceDate instanceof Date
    ? new Date(referenceDate.getTime())
    : new Date(referenceDate);
  const safeDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const nextDate = new Date(safeDate.getTime());
  nextDate.setMonth(nextDate.getMonth() + 1);
  return nextDate;
};

const ensureStoreMarketingCampaign = async (db, { storeId, nextSendAt }) => {
  const safeStoreId = Number(storeId || 0);
  if (!safeStoreId) {
    return;
  }

  await db.execute(
    `
      INSERT INTO marketing_campaigns (store_id, frequency, status, next_send_at)
      VALUES (?, 'monthly', 'active', ?)
      ON DUPLICATE KEY UPDATE store_id = store_id
    `,
    [safeStoreId, nextSendAt instanceof Date ? nextSendAt : buildNextMonthlySendAt(nextSendAt)]
  );
};

const listDueMarketingCampaigns = async (db, limit = 20) => {
  return db.query(
    `
      SELECT *
      FROM marketing_campaigns
      WHERE status = 'active'
        AND frequency = 'monthly'
        AND next_send_at <= CURRENT_TIMESTAMP
      ORDER BY next_send_at ASC, id ASC
      LIMIT ?
    `,
    [Math.max(1, Number(limit || 20))]
  );
};

const markMarketingCampaignSent = async (db, campaignId, sentAt = new Date()) => {
  const safeSentAt = sentAt instanceof Date ? sentAt : new Date(sentAt);
  const nextSendAt = buildNextMonthlySendAt(safeSentAt);

  await db.execute(
    `
      UPDATE marketing_campaigns
      SET last_sent_at = ?, next_send_at = ?, status = 'active'
      WHERE id = ?
    `,
    [safeSentAt, nextSendAt, campaignId]
  );
};

const snoozeMarketingCampaign = async (db, campaignId, referenceDate = new Date()) => {
  const nextSendAt = buildNextMonthlySendAt(referenceDate);
  await db.execute(
    `
      UPDATE marketing_campaigns
      SET next_send_at = ?, status = 'active'
      WHERE id = ?
    `,
    [nextSendAt, campaignId]
  );
};

const normalizeProductImageUrl = (storefrontUrl, product = {}) => {
  const image = Array.isArray(product.images) && product.images.length
    ? product.images[0]
    : product.image || '';
  const safeImage = sanitizePlainText(image || '', { maxLength: 500 });

  if (/^https?:\/\//i.test(safeImage)) {
    return sanitizeUrl(safeImage);
  }

  if (safeImage.startsWith('/')) {
    return joinUrl(storefrontUrl, safeImage);
  }

  return '';
};

const normalizeProductUrl = (storefrontUrl, product = {}) => {
  const safeUrl = sanitizeUrl(product.url || product.product_url || '');
  if (safeUrl) {
    return safeUrl;
  }

  const slug = sanitizePlainText(product.slug || '', { maxLength: 180 });
  if (!slug) {
    return storefrontUrl;
  }

  return joinUrl(storefrontUrl, `/products/${encodeURIComponent(slug)}`);
};

const buildMarketingUnsubscribeUrl = ({ webAppUrl, token }) => {
  if (!String(token || '').trim()) {
    return '';
  }

  return joinUrl(webAppUrl, `/email/unsubscribe?token=${encodeURIComponent(String(token).trim())}`);
};

const buildMonthlyMarketingTemplateData = ({
  config,
  store,
  customer,
  products = [],
  currency = 'USD'
}) => {
  const storefrontUrl = sanitizeUrl(store?.storefront_url || '') || sanitizeUrl(store?.website_url || '');
  const unsubscribeToken = createMarketingUnsubscribeToken({
    customerId: customer?.id,
    storeId: store?.id,
    email: customer?.email,
    secret: config.internalSharedSecret
  });
  const unsubscribeUrl = buildMarketingUnsubscribeUrl({
    webAppUrl: config.webAppUrl,
    token: unsubscribeToken
  });
  const mappedProducts = products
    .slice(0, MAX_MARKETING_PRODUCTS)
    .map((product) => ({
      id: product.id,
      title: sanitizePlainText(product.title || product.name || 'Product', { maxLength: 180 }) || 'Product',
      slug: sanitizePlainText(product.slug || '', { maxLength: 180 }),
      category: sanitizePlainText(product.category || '', { maxLength: 120 }),
      description: sanitizePlainText(product.description || '', { maxLength: 220 }),
      price: Number(product.price || 0),
      compare_at_price: product.compare_at_price === null || product.compare_at_price === undefined
        ? null
        : Number(product.compare_at_price),
      discount_label: sanitizePlainText(product.discount_label || '', { maxLength: 120 }),
      image_url: normalizeProductImageUrl(storefrontUrl, product),
      product_url: normalizeProductUrl(storefrontUrl, product),
      currency: sanitizePlainText(product.currency || currency || 'USD', { maxLength: 10 }) || 'USD'
    }));
  const distinctCategories = new Set(mappedProducts.map((product) => product.category).filter(Boolean));
  const discountedProductsCount = mappedProducts.filter((product) => {
    return Boolean(product.discount_label)
      || (Number.isFinite(product.compare_at_price) && product.compare_at_price > product.price);
  }).length;

  return {
    name: sanitizePlainText(customer?.name || 'there', { maxLength: 120 }) || 'there',
    store_name: sanitizePlainText(store?.name || '', { maxLength: 150 }),
    products: mappedProducts,
    products_count: mappedProducts.length,
    discounted_products_count: discountedProductsCount,
    category_count: distinctCategories.size,
    currency: sanitizePlainText(currency || 'USD', { maxLength: 10 }) || 'USD',
    store_url: storefrontUrl,
    catalog_url: joinUrl(storefrontUrl, '/products'),
    unsubscribe_url: unsubscribeUrl,
    month_label: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date())
  };
};

module.exports = {
  MARKETING_CAMPAIGN_SCHEDULER_INTERVAL_MS,
  MONTHLY_MARKETING_TEMPLATE_KEY,
  MAX_MARKETING_PRODUCTS,
  buildNextMonthlySendAt,
  ensureStoreMarketingCampaign,
  listDueMarketingCampaigns,
  markMarketingCampaignSent,
  snoozeMarketingCampaign,
  buildMonthlyMarketingTemplateData
};
