const crypto = require('crypto');
const env = require('./load-env');
const {
  buildSignedInternalHeaders,
  buildCookieOptions,
  requestJson,
  setCustomerTokenCookie,
  setPlatformTokenCookie,
  clearAuthCookies,
  verifyToken,
  isSecureRequest
} = require('../../../../packages/shared');

const DEFAULT_PRODUCT_IMAGE = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=300&q=80';
const SESSION_COOKIE_NAME = 'aisle_session_id';
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

class BackendRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'BackendRequestError';
    this.status = Number(options.status || 500);
    this.payload = options.payload || null;
    this.cause = options.cause || null;
  }
}

const buildSessionCookieOptions = () => {
  return buildCookieOptions(env, {
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_MS
  });
};

const shouldWriteSensitiveCookie = (req) => {
  return !env.isProduction || isSecureRequest(req);
};

const createEmptyCart = ({ storeId = null, customerId = null, sessionId = null } = {}) => {
  return {
    id: null,
    store_id: storeId ? String(storeId) : null,
    customer_id: customerId ? String(customerId) : null,
    session_id: sessionId || null,
    status: 'active',
    items: [],
    total: 0
  };
};

const getRequestId = (req) => {
  return req.requestId || req.headers['x-request-id'] || crypto.randomUUID();
};

const getRequestHost = (req) => {
  return String(req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '')
    .split(',')[0]
    .trim();
};

const getRequestHostname = (req) => {
  return getRequestHost(req).split(':')[0].toLowerCase();
};

const buildServiceHeaders = (req, auth = {}) => {
  return buildSignedInternalHeaders({
    requestId: getRequestId(req),
    forwardedHost: getRequestHost(req),
    storeId: auth.storeId || '',
    userId: auth.userId || '',
    actorRole: auth.actorRole || '',
    customerId: auth.customerId || '',
    actorType: auth.actorType || '',
    secret: env.internalSharedSecret
  });
};

const coerceBackendError = (error, fallbackMessage = 'Unable to complete the backend request.') => {
  if (error instanceof BackendRequestError) {
    return error;
  }

  const status = Number(error?.status || (error?.name === 'AbortError' ? 504 : 0)) || 503;
  const payload = error?.payload || null;
  const message = payload?.error || payload?.message || error?.message || fallbackMessage;

  return new BackendRequestError(message, {
    status,
    payload,
    cause: error
  });
};

const requestServiceJson = async (req, serviceUrl, pathname, options = {}) => {
  try {
    return await requestJson(`${serviceUrl}${pathname}`, {
      method: options.method || 'GET',
      body: options.body,
      headers: {
        ...buildServiceHeaders(req, options.auth || {}),
        ...(options.headers || {})
      },
      timeoutMs: options.timeoutMs || env.backendRequestTimeoutMs
    });
  } catch (error) {
    throw coerceBackendError(error);
  }
};

const requestPublicJson = async (req, serviceUrl, pathname, options = {}) => {
  try {
    return await requestJson(`${serviceUrl}${pathname}`, {
      method: options.method || 'GET',
      body: options.body,
      headers: {
        'x-request-id': getRequestId(req),
        ...(options.headers || {})
      },
      timeoutMs: options.timeoutMs || env.backendRequestTimeoutMs
    });
  } catch (error) {
    throw coerceBackendError(error);
  }
};

const decodeToken = (token) => {
  if (!token) {
    return null;
  }

  try {
    return verifyToken(token, env.jwtSecret);
  } catch {
    return null;
  }
};

const normalizeStore = (store) => {
  if (!store) {
    return null;
  }

  return {
    id: String(store.id),
    owner_id: store.owner_id ? String(store.owner_id) : null,
    name: store.name,
    subdomain: store.subdomain,
    custom_domain: store.custom_domain || '',
    logo: store.logo_url || '',
    logo_url: store.logo_url || '',
    theme_color: store.theme_color || '#0F766E',
    store_type: store.store_type || 'general',
    template_key: store.template_key || 'fashion',
    font_preset: store.font_preset || 'jakarta',
    support_email: store.support_email || '',
    contact_phone: store.contact_phone || '',
    is_active: Boolean(store.is_active),
    ssl_status: store.ssl_status || 'pending',
    tagline: '',
    description: '',
    fulfillment_sla: 'Orders ship quickly with dependable support follow-up.',
    return_window_days: 30,
    markets: ['Global'],
    currencies: ['USD'],
    default_currency: 'USD',
    launch_status: Boolean(store.is_active) ? 'live' : 'setup',
    operational_status: Boolean(store.is_active) ? 'healthy' : 'paused',
    created_at: store.created_at,
    updated_at: store.updated_at
  };
};

const normalizeProduct = (product) => {
  if (!product) {
    return null;
  }

  const images = Array.isArray(product.images) && product.images.length
    ? product.images
    : [DEFAULT_PRODUCT_IMAGE];
  const inventory = Number(
    product.available_inventory === undefined
      ? product.inventory_count
      : product.available_inventory
  );

  return {
    id: String(product.id),
    store_id: product.store_id ? String(product.store_id) : null,
    name: product.title,
    title: product.title,
    slug: product.slug,
    category: product.category || 'General',
    description: product.description || '',
    price: Number(product.price || 0),
    compare_at_price: product.compare_at_price === null || product.compare_at_price === undefined
      ? null
      : Number(product.compare_at_price),
    sku: product.sku || '',
    inventory,
    inventory_count: Number(product.inventory_count || 0),
    reserved_count: Number(product.reserved_count || 0),
    image: images[0] || DEFAULT_PRODUCT_IMAGE,
    images,
    highlights: [],
    status: product.status || 'published',
    created_at: product.created_at,
    updated_at: product.updated_at
  };
};

const normalizeCustomer = (customer) => {
  if (!customer) {
    return null;
  }

  const primaryAddress = Array.isArray(customer.addresses) && customer.addresses.length
    ? customer.addresses[0]
    : {};

  return {
    id: String(customer.id),
    store_id: customer.store_id ? String(customer.store_id) : null,
    name: customer.name || '',
    email: customer.email || '',
    phone: customer.phone || '',
    addresses: Array.isArray(customer.addresses) ? customer.addresses : [],
    address: primaryAddress.address || primaryAddress.line1 || '',
    city: primaryAddress.city || '',
    country: primaryAddress.country || '',
    postal_code: primaryAddress.postal_code || primaryAddress.postalCode || '',
    metadata: customer.metadata || {},
    created_at: customer.created_at,
    updated_at: customer.updated_at
  };
};

const normalizeOrder = (order) => {
  if (!order) {
    return null;
  }

  const shippingAddress = order.shipping_address || {};
  const customerSnapshot = order.customer_snapshot || {};

  return {
    id: String(order.id),
    store_id: order.store_id ? String(order.store_id) : null,
    customer_id: order.customer_id ? String(order.customer_id) : null,
    status: order.status || 'pending',
    payment_status: order.payment_status || 'pending',
    payment_method: order.payment_method || 'Card',
    currency: order.currency || 'USD',
    subtotal: Number(order.subtotal || 0),
    total: Number(order.total || 0),
    shipping_address: shippingAddress,
    customer: {
      name: customerSnapshot.name || '',
      email: customerSnapshot.email || '',
      phone: customerSnapshot.phone || '',
      address: shippingAddress.address || '',
      city: shippingAddress.city || '',
      country: shippingAddress.country || '',
      postal_code: shippingAddress.postal_code || ''
    },
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({
          id: item.id ? String(item.id) : null,
          product_id: item.product_id ? String(item.product_id) : null,
          name: item.name || 'Product',
          price: Number(item.price || 0),
          quantity: Number(item.quantity || 0),
          image: DEFAULT_PRODUCT_IMAGE
        }))
      : [],
    created_at: order.created_at,
    updated_at: order.updated_at
  };
};

const normalizeCart = (cart, identity = {}) => {
  const safeCart = cart || createEmptyCart(identity);

  return {
    id: safeCart.id ? String(safeCart.id) : null,
    store_id: safeCart.store_id ? String(safeCart.store_id) : (identity.storeId ? String(identity.storeId) : null),
    customer_id: safeCart.customer_id ? String(safeCart.customer_id) : (identity.customerId ? String(identity.customerId) : null),
    session_id: safeCart.session_id || identity.sessionId || null,
    status: safeCart.status || 'active',
    items: Array.isArray(safeCart.items)
      ? safeCart.items.map((item) => ({
          id: item.id ? String(item.id) : null,
          product_id: item.product_id ? String(item.product_id) : null,
          name: item.name || item.title_snapshot || 'Product',
          image: item.image || item.image_snapshot || DEFAULT_PRODUCT_IMAGE,
          price: Number(item.price || item.price_at_time || 0),
          quantity: Number(item.quantity || 0)
        }))
      : [],
    total: Number(safeCart.total || 0)
  };
};

const normalizeStoreCategory = (value = '') => {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const ensureStorefrontSession = (req, res) => {
  const existing = String(req.cookies[SESSION_COOKIE_NAME] || '').trim();
  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();
  if (shouldWriteSensitiveCookie(req)) {
    res.cookie(SESSION_COOKIE_NAME, generated, buildSessionCookieOptions());
  }
  req.cookies[SESSION_COOKIE_NAME] = generated;
  return generated;
};

const clearWebAuthCookies = (req, res, options = {}) => {
  clearAuthCookies(req, res, env);
  delete req.cookies.customer_token;
  delete req.cookies.platform_token;

  if (options.includeSession) {
    res.clearCookie(SESSION_COOKIE_NAME, buildSessionCookieOptions());
    delete req.cookies[SESSION_COOKIE_NAME];
  }
};

const getStoreByHost = async (req) => {
  const response = await requestPublicJson(
    req,
    env.serviceUrls.store,
    `/resolve?host=${encodeURIComponent(getRequestHostname(req))}`
  );

  const store = normalizeStore(response?.store || null);
  if (!store) {
    throw new BackendRequestError('Store not found.', { status: 404 });
  }

  if (!store.is_active) {
    throw new BackendRequestError('Store not found or inactive.', { status: 404 });
  }

  return store;
};

const getCustomerAuthForStore = (req, storeId) => {
  const customerAuth = decodeToken(req.cookies.customer_token);
  if (!customerAuth || customerAuth.actor_type !== 'customer') {
    return {
      auth: null,
      shouldClearToken: Boolean(req.cookies.customer_token && !customerAuth)
    };
  }

  if (storeId && String(customerAuth.store_id) !== String(storeId)) {
    return {
      auth: null,
      shouldClearToken: false
    };
  }

  return {
    auth: {
      storeId: String(customerAuth.store_id),
      customerId: String(customerAuth.customer_id),
      actorType: 'customer'
    },
    shouldClearToken: false
  };
};

const getPlatformAuth = (req) => {
  const platformAuth = decodeToken(req.cookies.platform_token);
  if (!platformAuth || platformAuth.actor_type !== 'platform_user') {
    return null;
  }

  return {
    userId: String(platformAuth.user_id),
    actorRole: platformAuth.role,
    actorType: 'platform_user'
  };
};

const getCurrentCustomer = async (req, store) => {
  if (!store?.id) {
    return {
      customer: null,
      auth: null,
      shouldClearToken: false
    };
  }

  const authState = getCustomerAuthForStore(req, store.id);
  if (!authState.auth) {
    return {
      customer: null,
      auth: null,
      shouldClearToken: authState.shouldClearToken
    };
  }

  try {
    const response = await requestServiceJson(req, env.serviceUrls.customer, '/customers/me', {
      auth: authState.auth
    });

    return {
      customer: normalizeCustomer(response?.customer || null),
      auth: authState.auth,
      shouldClearToken: false
    };
  } catch (error) {
    if ([401, 404].includes(Number(error.status))) {
      return {
        customer: null,
        auth: null,
        shouldClearToken: true
      };
    }

    throw error;
  }
};

const getCartForStore = async (req, store, auth, sessionId) => {
  if (!store?.id) {
    return createEmptyCart({ sessionId });
  }

  const response = await requestServiceJson(req, env.serviceUrls.cart, '/cart', {
    auth: {
      storeId: store.id,
      customerId: auth?.customerId || '',
      actorType: auth?.actorType || ''
    },
    headers: {
      'x-session-id': sessionId
    }
  });

  return normalizeCart(response?.cart || null, {
    storeId: store.id,
    customerId: auth?.customerId || null,
    sessionId
  });
};

const mergeCartIntoCustomer = async (req, store, customerId, sessionId) => {
  if (!store?.id || !customerId || !sessionId) {
    return createEmptyCart({
      storeId: store?.id || null,
      customerId,
      sessionId
    });
  }

  const response = await requestServiceJson(req, env.serviceUrls.cart, '/cart/merge', {
    method: 'POST',
    auth: {
      storeId: store.id,
      customerId,
      actorType: 'customer'
    },
    body: {
      session_id: sessionId
    },
    headers: {
      'x-session-id': sessionId
    }
  });

  return normalizeCart(response?.cart || null, {
    storeId: store.id,
    customerId,
    sessionId
  });
};

const listStoreProducts = async (req, store, options = {}) => {
  const response = await requestServiceJson(req, env.serviceUrls.product, `/products?page=1&limit=${Number(options.limit || 100)}`, {
    auth: {
      storeId: store.id,
      actorType: ''
    }
  });

  const products = Array.isArray(response?.products)
    ? response.products.map(normalizeProduct)
    : [];

  if (!options.category || options.category === 'All') {
    return {
      products,
      categories: Array.from(new Map(products
        .filter((entry) => entry.category)
        .map((entry) => [normalizeStoreCategory(entry.category), {
          name: entry.category,
          slug: normalizeStoreCategory(entry.category)
        }])).values())
    };
  }

  const normalizedCategory = normalizeStoreCategory(options.category);
  return {
    products: products.filter((product) => normalizeStoreCategory(product.category) === normalizedCategory),
    categories: Array.from(new Map(products
      .filter((entry) => entry.category)
      .map((entry) => [normalizeStoreCategory(entry.category), {
        name: entry.category,
        slug: normalizeStoreCategory(entry.category)
      }])).values())
  };
};

const getStoreProductBySlug = async (req, store, slug) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.product,
    `/products/${encodeURIComponent(slug)}`,
    {
      auth: {
        storeId: store.id,
        actorType: ''
      }
    }
  );

  return normalizeProduct(response?.product || null);
};

const addToCart = async (req, store, options = {}) => {
  const sessionId = options.sessionId;
  const response = await requestServiceJson(req, env.serviceUrls.cart, '/cart/items', {
    method: 'POST',
    auth: {
      storeId: store.id,
      customerId: options.auth?.customerId || '',
      actorType: options.auth?.actorType || ''
    },
    body: {
      store_id: Number(store.id),
      product_id: Number(options.productId),
      quantity: Number(options.quantity || 1)
    },
    headers: {
      'x-session-id': sessionId
    }
  });

  return normalizeCart(response?.cart || null, {
    storeId: store.id,
    customerId: options.auth?.customerId || null,
    sessionId
  });
};

const updateCartItem = async (req, store, options = {}) => {
  const sessionId = options.sessionId;
  const response = await requestServiceJson(
    req,
    env.serviceUrls.cart,
    `/cart/items/${encodeURIComponent(options.productId)}`,
    {
      method: 'PATCH',
      auth: {
        storeId: store.id,
        customerId: options.auth?.customerId || '',
        actorType: options.auth?.actorType || ''
      },
      body: {
        store_id: Number(store.id),
        quantity: Number(options.quantity || 0)
      },
      headers: {
        'x-session-id': sessionId
      }
    }
  );

  return normalizeCart(response?.cart || null, {
    storeId: store.id,
    customerId: options.auth?.customerId || null,
    sessionId
  });
};

const removeCartItem = async (req, store, options = {}) => {
  const sessionId = options.sessionId;
  const response = await requestServiceJson(
    req,
    env.serviceUrls.cart,
    `/cart/items/${encodeURIComponent(options.productId)}`,
    {
      method: 'DELETE',
      auth: {
        storeId: store.id,
        customerId: options.auth?.customerId || '',
        actorType: options.auth?.actorType || ''
      },
      body: {
        store_id: Number(store.id)
      },
      headers: {
        'x-session-id': sessionId
      }
    }
  );

  return normalizeCart(response?.cart || null, {
    storeId: store.id,
    customerId: options.auth?.customerId || null,
    sessionId
  });
};

const registerStorefrontCustomer = async (req, res, store, payload = {}) => {
  const response = await requestPublicJson(req, env.serviceUrls.customer, '/customers/register', {
    method: 'POST',
    body: {
      store_id: Number(store.id),
      name: String(payload.name || '').trim(),
      email: String(payload.email || '').trim().toLowerCase(),
      password: String(payload.password || ''),
      phone: payload.phone || null
    }
  });

  if (response?.token) {
    setCustomerTokenCookie(req, res, response.token, env);
  }

  const customer = normalizeCustomer(response?.customer || null);
  const sessionId = ensureStorefrontSession(req, res);
  const cart = await mergeCartIntoCustomer(req, store, customer?.id, sessionId);

  return {
    customer,
    cart
  };
};

const loginStorefrontCustomer = async (req, res, store, payload = {}) => {
  const response = await requestPublicJson(req, env.serviceUrls.customer, '/customers/login', {
    method: 'POST',
    body: {
      store_id: Number(store.id),
      email: String(payload.email || '').trim().toLowerCase(),
      password: String(payload.password || '')
    }
  });

  if (response?.token) {
    setCustomerTokenCookie(req, res, response.token, env);
  }

  const customer = normalizeCustomer(response?.customer || null);
  const sessionId = ensureStorefrontSession(req, res);
  const cart = await mergeCartIntoCustomer(req, store, customer?.id, sessionId);

  return {
    customer,
    cart
  };
};

const listCustomerOrders = async (req, store, auth, options = {}) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.order,
    `/orders?page=1&limit=${Number(options.limit || 50)}`,
    {
      auth: {
        storeId: store.id,
        customerId: auth.customerId,
        actorType: 'customer'
      }
    }
  );

  return Array.isArray(response?.orders)
    ? response.orders.map(normalizeOrder)
    : [];
};

const getCustomerOrderById = async (req, store, auth, orderId) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.order,
    `/orders/${encodeURIComponent(orderId)}`,
    {
      auth: {
        storeId: store.id,
        customerId: auth.customerId,
        actorType: 'customer'
      }
    }
  );

  return normalizeOrder(response?.order || null);
};

const checkoutStorefrontCart = async (req, store, auth, payload = {}) => {
  const response = await requestServiceJson(req, env.serviceUrls.order, '/checkout', {
    method: 'POST',
    auth: {
      storeId: store.id,
      customerId: auth.customerId,
      actorType: 'customer'
    },
    body: {
      currency: payload.currency || 'USD',
      email: payload.email,
      shipping_address: {
        address: payload.address,
        city: payload.city,
        country: payload.country,
        postal_code: payload.postal_code
      },
      customer: {
        name: payload.name,
        email: payload.email,
        phone: payload.phone || null
      }
    },
    headers: {
      'x-session-id': payload.sessionId
    }
  });

  return {
    order: normalizeOrder(response?.order || null),
    payment: response?.payment || null,
    providers: response?.providers || []
  };
};

const registerPlatformUser = async (req, res, payload = {}) => {
  const response = await requestPublicJson(req, env.serviceUrls.user, '/auth/register', {
    method: 'POST',
    body: payload
  });

  if (response?.token) {
    setPlatformTokenCookie(req, res, response.token, env);
  }

  return response;
};

const loginPlatformUser = async (req, res, payload = {}) => {
  const response = await requestPublicJson(req, env.serviceUrls.user, '/auth/login', {
    method: 'POST',
    body: payload
  });

  if (response?.token) {
    setPlatformTokenCookie(req, res, response.token, env);
  }

  return response;
};

module.exports = {
  BackendRequestError,
  DEFAULT_PRODUCT_IMAGE,
  SESSION_COOKIE_NAME,
  buildServiceHeaders,
  clearWebAuthCookies,
  coerceBackendError,
  createEmptyCart,
  ensureStorefrontSession,
  getCartForStore,
  getCurrentCustomer,
  getCustomerAuthForStore,
  getCustomerOrderById,
  getPlatformAuth,
  getRequestHost,
  getRequestHostname,
  getStoreByHost,
  listCustomerOrders,
  listStoreProducts,
  loginPlatformUser,
  loginStorefrontCustomer,
  normalizeCart,
  normalizeOrder,
  normalizeProduct,
  normalizeStore,
  normalizeStoreCategory,
  registerPlatformUser,
  registerStorefrontCustomer,
  requestPublicJson,
  requestServiceJson,
  addToCart,
  updateCartItem,
  removeCartItem,
  getStoreProductBySlug,
  checkoutStorefrontCart
};
