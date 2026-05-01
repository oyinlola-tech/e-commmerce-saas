const fs = require('fs');
const path = require('path');

const clone = (value) => JSON.parse(JSON.stringify(value));

const statePath = path.join(__dirname, '..', 'data', 'presentation-state.json');

const defaultBrand = {
  name: 'Aisle',
  platformName: 'Aisle',
  shortDescription: 'A serious commerce workspace for design-led brands and retail operators.',
  supportEmail: 'support@aisle.so',
  website: 'aisle.so',
  headquarters: '',
  marketsServed: [],
  color: '#0F766E'
};

const defaultState = {
  brand: defaultBrand,
  storeContent: {},
  productContent: {}
};

const defaultStoreContent = (store = {}) => {
  const storeName = String(store.name || 'Your store').trim();
  const category = String(store.store_type || 'general').trim().replace(/[-_]+/g, ' ');

  return {
    tagline: '',
    description: `${storeName} is built to present ${category} products with a calm storefront, clear merchandising, and reliable checkout.`,
    fulfillment_sla: 'Orders are processed quickly and delivery updates follow as the order progresses.',
    return_window_days: 30,
    markets: ['Global'],
    currencies: ['USD'],
    default_currency: 'USD',
    seo_title: '',
    seo_description: '',
    seo_keywords: '',
    announcement_text: '',
    hero_eyebrow: '',
    hero_title: '',
    hero_description: '',
    hero_support: '',
    primary_cta_text: '',
    secondary_cta_text: '',
    featured_collection_title: '',
    featured_collection_description: '',
    footer_blurb: ''
  };
};

const defaultProductContent = () => {
  return {
    highlights: [],
    featured: false,
    badge: '',
    audience: '',
    rating: null,
    review_count: null,
    tags: []
  };
};

const ensureStateFile = () => {
  if (fs.existsSync(statePath)) {
    return;
  }

  fs.writeFileSync(statePath, JSON.stringify(defaultState, null, 2));
};

const loadState = () => {
  ensureStateFile();
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return {
    brand: {
      ...defaultBrand,
      ...(parsed.brand || {})
    },
    storeContent: parsed.storeContent && typeof parsed.storeContent === 'object'
      ? parsed.storeContent
      : {},
    productContent: parsed.productContent && typeof parsed.productContent === 'object'
      ? parsed.productContent
      : {}
  };
};

const state = loadState();

const persistState = () => {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
};

const normalizeStringArray = (value = [], maxItems = 12) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

const getStoreContent = (store = null) => {
  if (!store?.id) {
    return defaultStoreContent(store || {});
  }

  return {
    ...defaultStoreContent(store),
    ...(state.storeContent[String(store.id)] || {})
  };
};

const upsertStoreContent = (storeId, payload = {}) => {
  if (!storeId) {
    return null;
  }

  const key = String(storeId);
  const current = state.storeContent[key] || {};
  state.storeContent[key] = {
    ...current,
    ...payload,
    markets: payload.markets === undefined
      ? (current.markets || ['Global'])
      : normalizeStringArray(payload.markets, 24),
    currencies: payload.currencies === undefined
      ? (current.currencies || ['USD'])
      : normalizeStringArray(payload.currencies, 12)
  };
  persistState();
  return clone(state.storeContent[key]);
};

const getProductContent = (product = null) => {
  if (!product?.id) {
    return defaultProductContent();
  }

  return {
    ...defaultProductContent(),
    ...(state.productContent[String(product.id)] || {})
  };
};

const upsertProductContent = (productId, payload = {}) => {
  if (!productId) {
    return null;
  }

  const key = String(productId);
  const current = state.productContent[key] || {};
  state.productContent[key] = {
    ...current,
    ...payload,
    highlights: payload.highlights === undefined
      ? (current.highlights || [])
      : normalizeStringArray(payload.highlights, 12),
    tags: payload.tags === undefined
      ? (current.tags || [])
      : normalizeStringArray(payload.tags, 12)
  };
  persistState();
  return clone(state.productContent[key]);
};

const removeProductContent = (productId) => {
  if (!productId) {
    return false;
  }

  const key = String(productId);
  if (!state.productContent[key]) {
    return false;
  }

  delete state.productContent[key];
  persistState();
  return true;
};

const mergeStorePresentation = (store = null) => {
  if (!store) {
    return null;
  }

  return {
    ...store,
    ...getStoreContent(store)
  };
};

const mergeProductPresentation = (product = null) => {
  if (!product) {
    return null;
  }

  return {
    ...product,
    ...getProductContent(product)
  };
};

module.exports = {
  brand: state.brand,
  getStoreContent,
  getProductContent,
  mergeStorePresentation,
  mergeProductPresentation,
  removeProductContent,
  upsertProductContent,
  upsertStoreContent
};
