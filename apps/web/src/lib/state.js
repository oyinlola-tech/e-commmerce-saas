const fs = require('fs');
const path = require('path');
const env = require('./load-env');
const emptyState = require('../data/empty-state');
const seed = require('../data/seed');
const {
  getStoreConfiguration,
  isValidHexColor
} = require('./store-themes');

const clone = (value) => JSON.parse(JSON.stringify(value));

const runtimeStatePath = path.join(__dirname, '..', 'data', 'runtime-state.json');

const loadState = () => {
  if (fs.existsSync(runtimeStatePath)) {
    return JSON.parse(fs.readFileSync(runtimeStatePath, 'utf8'));
  }

  const initialState = clone(env.stateSeedOnBoot ? seed : emptyState);
  fs.writeFileSync(runtimeStatePath, JSON.stringify(initialState, null, 2));
  return initialState;
};

const state = loadState();
state.stores = Array.isArray(state.stores) ? state.stores : [];
state.customers = Array.isArray(state.customers) ? state.customers : [];
state.products = Array.isArray(state.products) ? state.products : [];
state.orders = Array.isArray(state.orders) ? state.orders : [];
state.supportConversations = Array.isArray(state.supportConversations) ? state.supportConversations : [];
state.incidents = Array.isArray(state.incidents) ? state.incidents : [];
state.carts = state.carts && typeof state.carts === 'object' ? state.carts : {};

const persistState = () => {
  fs.writeFileSync(runtimeStatePath, JSON.stringify(state, null, 2));
};

const mergeSeedCollection = (collectionName) => {
  const seedCollection = Array.isArray(seed[collectionName]) ? seed[collectionName] : [];
  const targetCollection = Array.isArray(state[collectionName]) ? state[collectionName] : [];
  let mutated = false;

  seedCollection.forEach((entry) => {
    const alreadyExists = targetCollection.some((current) => String(current.id) === String(entry.id));
    if (!alreadyExists) {
      targetCollection.push(clone(entry));
      mutated = true;
    }
  });

  state[collectionName] = targetCollection;
  return mutated;
};

const buildFacetEntries = (values = []) => {
  const facets = new Map();

  values
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .forEach((entry) => {
      const facetKey = slugify(entry);
      if (facetKey && !facets.has(facetKey)) {
        facets.set(facetKey, {
          name: entry,
          slug: facetKey
        });
      }
    });

  return Array.from(facets.values());
};

const applyStoreDefaults = (store) => {
  if (!store) {
    return false;
  }

  const configuration = getStoreConfiguration(store, store);
  let mutated = false;

  if (store.store_type !== configuration.store_type) {
    store.store_type = configuration.store_type;
    mutated = true;
  }

  if (store.template_key !== configuration.template_key) {
    store.template_key = configuration.template_key;
    mutated = true;
  }

  if (store.font_preset !== configuration.font_preset) {
    store.font_preset = configuration.font_preset;
    mutated = true;
  }

  if (!isValidHexColor(store.theme_color) || store.theme_color !== configuration.theme_color) {
    store.theme_color = configuration.theme_color;
    mutated = true;
  }

  if (!String(store.tagline || '').trim()) {
    store.tagline = configuration.tagline;
    mutated = true;
  }

  if (!String(store.description || '').trim()) {
    store.description = configuration.description;
    mutated = true;
  }

  return mutated;
};

const applyProductDefaults = (product) => {
  if (!product) {
    return false;
  }

  let mutated = false;

  if (!Array.isArray(product.tags)) {
    product.tags = [];
    mutated = true;
  }

  if (!Array.isArray(product.images)) {
    product.images = product.image ? [product.image] : [];
    mutated = true;
  }

  if (product.badge === undefined) {
    product.badge = '';
    mutated = true;
  }

  if (product.audience === undefined) {
    product.audience = '';
    mutated = true;
  }

  if (product.rating === undefined) {
    product.rating = null;
    mutated = true;
  }

  if (product.review_count === undefined) {
    product.review_count = null;
    mutated = true;
  }

  return mutated;
};

const ensureSeedBaseline = () => {
  let mutated = false;

  ['stores', 'customers', 'products', 'orders', 'supportConversations', 'incidents'].forEach((collectionName) => {
    if (mergeSeedCollection(collectionName)) {
      mutated = true;
    }
  });

  Object.entries(seed.carts || {}).forEach(([storeId, cart]) => {
    if (!state.carts[storeId]) {
      state.carts[storeId] = clone(cart);
      mutated = true;
    }
  });

  state.stores.forEach((store) => {
    if (applyStoreDefaults(store)) {
      mutated = true;
    }
  });

  state.products.forEach((product) => {
    if (applyProductDefaults(product)) {
      mutated = true;
    }
  });

  if (mutated) {
    persistState();
  }
};

ensureSeedBaseline();

const themePalette = ['#0F766E', '#1D4ED8', '#B45309', '#BE123C', '#0B7285', '#4C1D95'];

const slugify = (value = '') => {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();

  let output = '';
  let previousWasSeparator = false;

  for (const character of normalized) {
    const isAlphaNumeric = (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9');
    if (isAlphaNumeric) {
      output += character;
      previousWasSeparator = false;
      continue;
    }

    const isSeparator = character === ' ' || character === '_' || character === '-';
    if (isSeparator && output && !previousWasSeparator) {
      output += '-';
      previousWasSeparator = true;
    }
  }

  return output.endsWith('-')
    ? output.slice(0, -1)
    : output;
};

const toTitleCase = (value = '') => {
  return String(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const getStoreById = (storeId) => {
  return state.stores.find((store) => store.id === storeId) || null;
};

const getStoreBySubdomain = (subdomain) => {
  const normalized = String(subdomain || '').toLowerCase();
  return state.stores.find((store) => String(store.subdomain || '').toLowerCase() === normalized) || null;
};

const getStoreByDomain = (hostname) => {
  const normalized = String(hostname || '').toLowerCase();
  return state.stores.find((store) => String(store.custom_domain || '').toLowerCase() === normalized) || null;
};

const getStoreByHost = (hostname) => {
  const customDomainStore = getStoreByDomain(hostname);
  if (customDomainStore) {
    return customDomainStore;
  }

  const normalized = String(hostname || '').toLowerCase();
  const [subdomain] = normalized.split('.');
  return getStoreBySubdomain(subdomain);
};

const getOwnerStores = (ownerId) => {
  return state.stores.filter((store) => store.owner_id === ownerId);
};

const getAllStores = () => {
  return [...state.stores];
};

const getStoreCustomers = (storeId) => {
  return state.customers
    .filter((customer) => customer.store_id === storeId)
    .sort((a, b) => Number(b.lifetime_value || 0) - Number(a.lifetime_value || 0));
};

const getCustomerById = (storeId, customerId) => {
  return state.customers.find((customer) => customer.store_id === storeId && customer.id === customerId) || null;
};

const findCustomerByEmail = (storeId, email) => {
  const normalized = String(email || '').trim().toLowerCase();
  return state.customers.find((customer) => customer.store_id === storeId && String(customer.email || '').toLowerCase() === normalized) || null;
};

const normalizeDiscoveryToken = (value = '') => slugify(value);

const toProductSearchValue = (product) => {
  return [
    product.name,
    product.category,
    product.description,
    product.sku,
    product.badge,
    product.audience,
    ...(Array.isArray(product.highlights) ? product.highlights : []),
    ...(Array.isArray(product.tags) ? product.tags : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const compareProducts = (left, right, sort = 'featured') => {
  switch (sort) {
    case 'price-low':
      return Number(left.price || 0) - Number(right.price || 0);
    case 'price-high':
      return Number(right.price || 0) - Number(left.price || 0);
    case 'name':
      return String(left.name || '').localeCompare(String(right.name || ''));
    case 'newest':
      return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
    default:
      if (Boolean(right.featured) !== Boolean(left.featured)) {
        return Number(Boolean(right.featured)) - Number(Boolean(left.featured));
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
  }
};

const getStoreProducts = (storeId, options = {}) => {
  const {
    publishedOnly = false,
    category = null,
    search = '',
    sort = 'featured',
    tag = null
  } = options;

  const normalizedCategory = normalizeDiscoveryToken(category);
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedTag = normalizeDiscoveryToken(tag);

  return state.products
    .filter((product) => product.store_id === storeId)
    .filter((product) => !publishedOnly || String(product.status || '').toLowerCase() === 'published')
    .filter((product) => {
      if (!normalizedCategory || normalizedCategory === 'all') {
        return true;
      }
      return normalizeDiscoveryToken(product.category) === normalizedCategory;
    })
    .filter((product) => {
      if (!normalizedSearch) {
        return true;
      }

      return toProductSearchValue(product).includes(normalizedSearch);
    })
    .filter((product) => {
      if (!normalizedTag) {
        return true;
      }

      const productTags = [
        product.category,
        product.badge,
        product.audience,
        ...(Array.isArray(product.tags) ? product.tags : [])
      ]
        .map((entry) => normalizeDiscoveryToken(entry))
        .filter(Boolean);

      return productTags.includes(normalizedTag);
    })
    .sort((a, b) => compareProducts(a, b, sort));
};

const getPublishedProducts = (storeId) => {
  return getStoreProducts(storeId, { publishedOnly: true });
};

const getStoreCategories = (storeId) => {
  const unique = new Map();
  getPublishedProducts(storeId).forEach((product) => {
    if (!product.category) {
      return;
    }
    unique.set(slugify(product.category), {
      name: product.category,
      slug: slugify(product.category)
    });
  });
  return Array.from(unique.values());
};

const getStoreDiscoveryFacets = (storeId) => {
  const products = getPublishedProducts(storeId);

  return {
    categories: getStoreCategories(storeId),
    tags: buildFacetEntries(products.flatMap((product) => [
      product.badge,
      product.audience,
      ...(Array.isArray(product.tags) ? product.tags : [])
    ]))
  };
};

const getProductById = (storeId, productId) => {
  return state.products.find((product) => product.store_id === storeId && String(product.id) === String(productId)) || null;
};

const getProductBySlug = (storeId, slug) => {
  return state.products.find((product) => product.store_id === storeId && product.slug === slug) || null;
};

const getStoreOrders = (storeId) => {
  return state.orders
    .filter((order) => order.store_id === storeId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

const getOrderById = (storeId, orderId) => {
  return state.orders.find((order) => order.store_id === storeId && String(order.id) === String(orderId)) || null;
};

const getLatestOrder = (storeId) => {
  return getStoreOrders(storeId)[0] || null;
};

const getSupportConversations = (options = {}) => {
  const { storeId = null, status = null } = options;
  return state.supportConversations
    .filter((conversation) => !storeId || conversation.store_id === storeId)
    .filter((conversation) => !status || String(conversation.status).toLowerCase() === String(status).toLowerCase())
    .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
};

const getConversationById = (conversationId) => {
  return state.supportConversations.find((conversation) => conversation.id === conversationId) || null;
};

const getIncidents = () => {
  return [...state.incidents].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
};

const getIncidentById = (incidentId) => {
  return state.incidents.find((incident) => incident.id === incidentId) || null;
};

const getStoreStats = (storeId) => {
  const products = getStoreProducts(storeId);
  const orders = getStoreOrders(storeId);
  const customers = getStoreCustomers(storeId);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const revenue30d = orders
    .filter((order) => new Date(order.created_at).getTime() >= thirtyDaysAgo)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  return {
    totalProducts: products.length,
    publishedProducts: products.filter((product) => String(product.status || '').toLowerCase() === 'published').length,
    draftProducts: products.filter((product) => String(product.status || '').toLowerCase() !== 'published').length,
    totalOrders: orders.length,
    revenue30d,
    customersCount: customers.length,
    lowStockProducts: products.filter((product) => Number(product.inventory || 0) <= 10).length,
    openSupportTickets: getSupportConversations({ storeId, status: 'open' }).length
  };
};

const getPlatformMetrics = () => {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const gmv30d = state.orders
    .filter((order) => new Date(order.created_at).getTime() >= thirtyDaysAgo)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const openTickets = state.supportConversations.filter((conversation) => String(conversation.status || '').toLowerCase() !== 'resolved').length;
  const unresolvedIncidents = state.incidents.filter((incident) => String(incident.status || '').toLowerCase() !== 'resolved').length;
  const activeMarkets = new Set(state.stores.flatMap((store) => store.markets || []));

  return {
    storesCount: state.stores.length,
    liveStores: state.stores.filter((store) => String(store.launch_status || '').toLowerCase() === 'live').length,
    gmv30d,
    openTickets,
    unresolvedIncidents,
    customersCount: state.customers.length,
    activeMarkets: activeMarkets.size
  };
};

const getPlatformHighlights = () => {
  return state.stores
    .map((store) => ({
      ...store,
      stats: getStoreStats(store.id)
    }))
    .sort((a, b) => Number(b.monthly_revenue || 0) - Number(a.monthly_revenue || 0));
};

const nextId = (prefix) => {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
};

const nextOrderNumber = () => {
  const highest = state.orders.reduce((max, order) => {
    return Math.max(max, Number(order.id) || 0);
  }, 4108);

  return String(highest + 1);
};

const ensureCartTotals = (cart) => {
  const safeCart = cart || { items: [], total: 0 };
  safeCart.items = Array.isArray(safeCart.items) ? safeCart.items : [];
  safeCart.total = safeCart.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  return safeCart;
};

const ensureStoreCart = (storeId) => {
  if (!state.carts[storeId]) {
    state.carts[storeId] = { items: [], total: 0 };
  }

  return ensureCartTotals(state.carts[storeId]);
};

const getCart = (storeId) => {
  return clone(ensureStoreCart(storeId));
};

const addCartItem = (storeId, productId, quantity = 1) => {
  const product = getProductById(storeId, productId);
  if (!product) {
    return null;
  }

  const cart = ensureStoreCart(storeId);
  const target = cart.items.find((item) => String(item.product_id) === String(productId));
  const qty = Math.max(1, Number(quantity || 1));

  if (target) {
    target.quantity += qty;
  } else {
    cart.items.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      quantity: qty,
      image: product.image
    });
  }

  persistState();
  return clone(ensureCartTotals(cart));
};

const updateCartItemQuantity = (storeId, productId, quantity) => {
  const cart = ensureStoreCart(storeId);
  const target = cart.items.find((item) => String(item.product_id) === String(productId));
  if (!target) {
    return null;
  }

  const qty = Math.max(0, Number(quantity || 0));
  if (qty <= 0) {
    cart.items = cart.items.filter((item) => String(item.product_id) !== String(productId));
  } else {
    target.quantity = qty;
  }

  persistState();
  return clone(ensureCartTotals(cart));
};

const removeCartItem = (storeId, productId) => {
  const cart = ensureStoreCart(storeId);
  cart.items = cart.items.filter((item) => String(item.product_id) !== String(productId));
  persistState();
  return clone(ensureCartTotals(cart));
};

const clearCart = (storeId) => {
  state.carts[storeId] = { items: [], total: 0 };
  persistState();
  return getCart(storeId);
};

const makeColorFromName = (name = '') => {
  const checksum = Array.from(String(name)).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return themePalette[checksum % themePalette.length];
};

const uniqueSubdomain = (preferredValue) => {
  const base = slugify(preferredValue) || 'store';
  let candidate = base;
  let suffix = 2;

  while (state.stores.some((store) => store.subdomain === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const createStore = (payload = {}) => {
  const { name, subdomain, ownerId } = payload;
  const cleanName = String(name || '').trim() || 'New Store';
  const normalizedSubdomain = uniqueSubdomain(subdomain || cleanName);
  const configuration = getStoreConfiguration({
    name: cleanName,
    subdomain: normalizedSubdomain,
    ...payload
  });
  const store = {
    id: nextId('store'),
    owner_id: ownerId || state.platformUser.id,
    name: cleanName,
    subdomain: normalizedSubdomain,
    custom_domain: '',
    logo: String(payload.logo || payload.logo_url || '').trim(),
    store_type: configuration.store_type,
    template_key: configuration.template_key,
    font_preset: configuration.font_preset,
    theme_color: configuration.theme_color || makeColorFromName(cleanName),
    ssl_status: 'issued',
    tagline: configuration.tagline,
    description: configuration.description,
    support_email: `support@${normalizedSubdomain}.store`,
    contact_phone: '+1 000 000 0000',
    fulfillment_sla: 'Orders ship within 24 hours on business days.',
    return_window_days: 30,
    timezone: 'UTC',
    markets: ['United States'],
    currencies: ['USD'],
    launch_status: 'setup',
    operational_status: 'healthy',
    health_score: 90,
    conversion_rate: 0,
    monthly_revenue: 0,
    monthly_orders: 0,
    average_order_value: 0,
    support_backlog: 0
  };

  state.stores.unshift(store);
  state.carts[store.id] = { items: [], total: 0 };
  persistState();
  return store;
};

const updateStoreSettings = (storeId, payload = {}) => {
  const store = getStoreById(storeId);
  if (!store) {
    return null;
  }

  const configuration = getStoreConfiguration(payload, store);
  const color = isValidHexColor(payload.theme_color)
    ? String(payload.theme_color)
    : configuration.theme_color;

  store.name = String(payload.name || store.name).trim() || store.name;
  store.logo = String(payload.logo || payload.logo_url || store.logo || '').trim();
  store.store_type = configuration.store_type;
  store.template_key = configuration.template_key;
  store.font_preset = configuration.font_preset;
  store.theme_color = color;
  store.tagline = configuration.tagline;
  store.description = configuration.description;
  store.support_email = String(payload.support_email || store.support_email).trim() || store.support_email;
  store.contact_phone = String(payload.contact_phone || store.contact_phone).trim() || store.contact_phone;
  store.fulfillment_sla = String(payload.fulfillment_sla || store.fulfillment_sla).trim() || store.fulfillment_sla;

  const parsedReturnWindow = Number(payload.return_window_days);
  if (Number.isFinite(parsedReturnWindow) && parsedReturnWindow > 0) {
    store.return_window_days = parsedReturnWindow;
  }

  persistState();
  return store;
};

const updateStoreDomain = (storeId, customDomain) => {
  const store = getStoreById(storeId);
  if (!store) {
    return null;
  }

  store.custom_domain = String(customDomain || '').trim();
  store.ssl_status = store.custom_domain ? 'pending' : 'issued';
  persistState();
  return store;
};

const parseHighlights = (value = '') => {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const parseImageList = (value = '') => {
  return String(value)
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeProductPayload = (payload = {}, existingProduct = null) => {
  const gallery = parseImageList(payload.gallery || payload.images || '');
  const primaryImage = String(payload.image || '').trim() || gallery[0] || (existingProduct ? existingProduct.image : '');
  const mergedImages = primaryImage ? [primaryImage, ...gallery.filter((image) => image !== primaryImage)] : gallery;

  return {
    name: String(payload.name || existingProduct?.name || '').trim(),
    slug: slugify(payload.slug || payload.name || existingProduct?.slug || ''),
    category: String(payload.category || existingProduct?.category || 'General').trim(),
    price: Number(payload.price || existingProduct?.price || 0),
    compare_at_price: payload.compare_at_price ? Number(payload.compare_at_price) : null,
    image: primaryImage,
    images: mergedImages,
    description: String(payload.description || existingProduct?.description || '').trim(),
    highlights: parseHighlights(payload.highlights || ''),
    inventory: Math.max(0, Number(payload.inventory || existingProduct?.inventory || 0)),
    sku: String(payload.sku || existingProduct?.sku || '').trim(),
    status: payload.status ? 'Published' : 'Draft',
    featured: Boolean(payload.featured)
  };
};

const createProduct = (storeId, payload = {}) => {
  const product = {
    id: nextId('prod'),
    store_id: storeId,
    ...normalizeProductPayload(payload)
  };

  if (!product.slug) {
    product.slug = slugify(product.name || product.id);
  }

  state.products.unshift(product);
  persistState();
  return product;
};

const updateProduct = (storeId, productId, payload = {}) => {
  const product = getProductById(storeId, productId);
  if (!product) {
    return null;
  }

  Object.assign(product, normalizeProductPayload(payload, product));
  if (!product.slug) {
    product.slug = slugify(product.name || product.id);
  }

  persistState();
  return product;
};

const deleteProduct = (storeId, productId) => {
  const existingProduct = getProductById(storeId, productId);
  if (!existingProduct) {
    return false;
  }

  state.products = state.products.filter((product) => !(product.store_id === storeId && String(product.id) === String(productId)));
  if (state.carts[storeId]) {
    state.carts[storeId].items = state.carts[storeId].items.filter((item) => String(item.product_id) !== String(productId));
    ensureCartTotals(state.carts[storeId]);
  }

  persistState();
  return true;
};

const createCustomer = (storeId, payload = {}) => {
  const existingCustomer = findCustomerByEmail(storeId, payload.email);
  if (existingCustomer) {
    existingCustomer.name = String(payload.name || existingCustomer.name).trim() || existingCustomer.name;
    existingCustomer.address = String(payload.address || existingCustomer.address || '').trim();
    existingCustomer.city = String(payload.city || existingCustomer.city || '').trim();
    existingCustomer.country = String(payload.country || existingCustomer.country || '').trim();
    existingCustomer.postal_code = String(payload.postal_code || existingCustomer.postal_code || '').trim();
    persistState();
    return existingCustomer;
  }

  const customer = {
    id: nextId('customer'),
    store_id: storeId,
    name: String(payload.name || '').trim() || 'Customer',
    email: String(payload.email || '').trim(),
    address: String(payload.address || '').trim(),
    city: String(payload.city || '').trim(),
    country: String(payload.country || '').trim(),
    postal_code: String(payload.postal_code || '').trim(),
    segment: 'New',
    lifetime_value: 0,
    orders_count: 0
  };

  state.customers.unshift(customer);
  persistState();
  return customer;
};

const createOrder = (storeId, customer, payload = {}) => {
  const cart = ensureStoreCart(storeId);
  if (!cart.items.length) {
    return null;
  }

  const activeCustomer = createCustomer(storeId, {
    ...customer,
    ...payload
  });

  const addressParts = [
    payload.address || activeCustomer.address,
    payload.city || activeCustomer.city,
    payload.country || activeCustomer.country,
    payload.postal_code || activeCustomer.postal_code
  ].filter(Boolean);

  cart.items.forEach((item) => {
    const product = getProductById(storeId, item.product_id);
    if (product) {
      product.inventory = Math.max(0, Number(product.inventory || 0) - Number(item.quantity || 0));
    }
  });

  const order = {
    id: nextOrderNumber(),
    store_id: storeId,
    status: 'Pending',
    payment_status: 'Authorized',
    payment_method: toTitleCase(payload.payment_method || 'Card'),
    created_at: new Date().toISOString(),
    total: cart.total,
    customer_name: activeCustomer.name,
    customer: {
      name: activeCustomer.name,
      email: activeCustomer.email,
      address: addressParts.join(', ')
    },
    items: cart.items.map((item) => ({ ...item }))
  };

  state.orders.unshift(order);
  activeCustomer.orders_count = Number(activeCustomer.orders_count || 0) + 1;
  activeCustomer.lifetime_value = Number(activeCustomer.lifetime_value || 0) + Number(order.total || 0);
  clearCart(storeId);

  persistState();
  return order;
};

const addOrderToCart = (storeId, orderId) => {
  const order = getOrderById(storeId, orderId);
  if (!order || !Array.isArray(order.items) || !order.items.length) {
    return null;
  }

  const cart = ensureStoreCart(storeId);

  order.items.forEach((item) => {
    const product = getProductById(storeId, item.product_id);
    if (!product) {
      return;
    }

    const existingItem = cart.items.find((entry) => String(entry.product_id) === String(item.product_id));
    if (existingItem) {
      existingItem.quantity += Math.max(1, Number(item.quantity || 1));
      return;
    }

    cart.items.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      quantity: Math.max(1, Number(item.quantity || 1)),
      image: product.image
    });
  });

  persistState();
  return clone(ensureCartTotals(cart));
};

const updateOrderStatus = (storeId, orderId, status) => {
  const order = getOrderById(storeId, orderId);
  if (!order) {
    return null;
  }

  order.status = toTitleCase(status || order.status);
  persistState();
  return order;
};

const updateSupportConversation = (conversationId, payload = {}) => {
  const conversation = getConversationById(conversationId);
  if (!conversation) {
    return null;
  }

  if (payload.status) {
    conversation.status = String(payload.status).toLowerCase();
  }

  if (payload.priority) {
    conversation.priority = String(payload.priority).toLowerCase();
  }

  if (payload.owner) {
    conversation.owner = String(payload.owner).trim();
  }

  conversation.last_message_at = new Date().toISOString();
  persistState();
  return conversation;
};

const replyToSupportConversation = (conversationId, payload = {}) => {
  const conversation = getConversationById(conversationId);
  if (!conversation) {
    return null;
  }

  const body = String(payload.body || '').trim();
  if (body) {
    conversation.messages.push({
      author: String(payload.author || state.systemAdminUser.name).trim(),
      role: payload.role || 'support',
      sent_at: new Date().toISOString(),
      body
    });
  }

  if (payload.status) {
    conversation.status = String(payload.status).toLowerCase();
  } else if (body) {
    conversation.status = 'pending';
  }

  if (payload.priority) {
    conversation.priority = String(payload.priority).toLowerCase();
  }

  conversation.last_message_at = new Date().toISOString();
  persistState();
  return conversation;
};

const updateIncident = (incidentId, payload = {}) => {
  const incident = getIncidentById(incidentId);
  if (!incident) {
    return null;
  }

  if (payload.status) {
    incident.status = String(payload.status).toLowerCase();
  }

  if (payload.owner) {
    incident.owner = String(payload.owner).trim();
  }

  const note = String(payload.note || '').trim();
  if (note) {
    incident.notes.unshift({
      author: String(payload.author || state.systemAdminUser.name).trim(),
      created_at: new Date().toISOString(),
      body: note
    });
  }

  incident.updated_at = new Date().toISOString();
  persistState();
  return incident;
};

module.exports = {
  state,
  brand: state.brand,
  platformUser: state.platformUser,
  systemAdminUser: state.systemAdminUser,
  slugify,
  getStoreById,
  getStoreBySubdomain,
  getStoreByDomain,
  getStoreByHost,
  getOwnerStores,
  getAllStores,
  getStoreCustomers,
  getCustomerById,
  findCustomerByEmail,
  getStoreProducts,
  getPublishedProducts,
  getStoreCategories,
  getStoreDiscoveryFacets,
  getProductById,
  getProductBySlug,
  getStoreOrders,
  getOrderById,
  getLatestOrder,
  getStoreStats,
  getPlatformMetrics,
  getPlatformHighlights,
  getSupportConversations,
  getConversationById,
  getIncidents,
  getIncidentById,
  getCart,
  addCartItem,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
  createStore,
  updateStoreSettings,
  updateStoreDomain,
  createProduct,
  updateProduct,
  deleteProduct,
  createCustomer,
  createOrder,
  addOrderToCart,
  updateOrderStatus,
  updateSupportConversation,
  replyToSupportConversation,
  updateIncident
};
