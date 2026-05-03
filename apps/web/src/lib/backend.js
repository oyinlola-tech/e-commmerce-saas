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
  isSecureRequest,
  PLATFORM_ROLES
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
    shipping_origin_country: store.shipping_origin_country || '',
    shipping_flat_rate: Number(store.shipping_flat_rate || 0),
    domestic_shipping_rate: Number(store.domestic_shipping_rate || 0),
    international_shipping_rate: Number(store.international_shipping_rate || 0),
    free_shipping_threshold: Number(store.free_shipping_threshold || 0),
    tax_rate: Number(store.tax_rate || 0),
    tax_label: store.tax_label || '',
    tax_apply_to_shipping: Boolean(store.tax_apply_to_shipping),
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
    base_price: product.base_price === null || product.base_price === undefined
      ? Number(product.price || 0)
      : Number(product.base_price),
    compare_at_price: product.compare_at_price === null || product.compare_at_price === undefined
      ? null
      : Number(product.compare_at_price),
    has_discount: Boolean(product.has_discount),
    discount_amount: Number(product.discount_amount || 0),
    discount_percentage: Number(product.discount_percentage || 0),
    discount_type: product.discount_type || 'none',
    discount_value: product.discount_value === null || product.discount_value === undefined
      ? null
      : Number(product.discount_value),
    promotion_type: product.promotion_type || 'none',
    is_flash_sale: Boolean(product.is_flash_sale),
    discount_label: product.discount_label || '',
    discount_starts_at: product.discount_starts_at || null,
    discount_ends_at: product.discount_ends_at || null,
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
    payment_reference: order.payment_reference || null,
    payment_method: order.payment_method || 'Card',
    currency: order.currency || 'USD',
    subtotal: Number(order.subtotal || 0),
    discount_total: Number(order.discount_total || 0),
    shipping_total: Number(order.shipping_total || 0),
    tax_total: Number(order.tax_total || 0),
    total: Number(order.total || 0),
    tax_label: order.tax_label || null,
    coupon_code: order.coupon_code || null,
    coupon: order.coupon || null,
    pricing_snapshot: order.pricing_snapshot || null,
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

const normalizeCoupon = (coupon) => {
  if (!coupon) {
    return null;
  }

  return {
    id: String(coupon.id),
    store_id: coupon.store_id ? String(coupon.store_id) : null,
    code: coupon.code || '',
    description: coupon.description || '',
    discount_type: coupon.discount_type || 'percentage',
    discount_value: Number(coupon.discount_value || 0),
    minimum_order_amount: Number(coupon.minimum_order_amount || 0),
    starts_at: coupon.starts_at || null,
    ends_at: coupon.ends_at || null,
    usage_limit: coupon.usage_limit === null || coupon.usage_limit === undefined
      ? null
      : Number(coupon.usage_limit),
    usage_count: Number(coupon.usage_count || 0),
    is_active: Boolean(coupon.is_active),
    created_at: coupon.created_at || null,
    updated_at: coupon.updated_at || null
  };
};

const normalizeEntitlements = (entitlements = null) => {
  if (!entitlements || typeof entitlements !== 'object') {
    return {
      limits: {
        stores: null,
        products: null
      },
      capabilities: {}
    };
  }

  return {
    limits: {
      stores: entitlements?.limits?.stores ?? null,
      products: entitlements?.limits?.products ?? null
    },
    capabilities: {
      ...(entitlements.capabilities || {})
    }
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

const getCurrentPlatformUser = async (req) => {
  const auth = getPlatformAuth(req);
  if (!auth) {
    return {
      user: null,
      auth: null,
      shouldClearToken: false
    };
  }

  try {
    const response = await requestServiceJson(req, env.serviceUrls.user, '/auth/me', {
      auth
    });

    return {
      user: response?.user || null,
      auth,
      shouldClearToken: false
    };
  } catch (error) {
    if ([401, 404].includes(Number(error.status))) {
      return {
        user: null,
        auth: null,
        shouldClearToken: true
      };
    }

    throw error;
  }
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
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.max(1, Number(options.limit || 100));
  const query = new globalThis.URLSearchParams({
    page: String(page),
    limit: String(limit)
  });

  if (options.category && options.category !== 'All') {
    query.set('category', String(options.category));
  }

  if (String(options.search || '').trim()) {
    query.set('search', String(options.search).trim());
  }

  if (String(options.status || '').trim()) {
    query.set('status', String(options.status).trim().toLowerCase());
  }

  const response = await requestServiceJson(req, env.serviceUrls.product, `/products?${query.toString()}`, {
    auth: {
      storeId: store.id,
      userId: options.auth?.userId || '',
      actorRole: options.auth?.actorRole || '',
      actorType: options.auth?.actorType || ''
    }
  });

  const products = Array.isArray(response?.products)
    ? response.products.map(normalizeProduct)
    : [];

  if (!options.category || options.category === 'All') {
    return {
      total: Number(response?.total || products.length || 0),
      page,
      limit,
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
    total: Number(response?.total || products.length || 0),
    page,
    limit,
    products: products.filter((product) => normalizeStoreCategory(product.category) === normalizedCategory),
    categories: Array.from(new Map(products
      .filter((entry) => entry.category)
      .map((entry) => [normalizeStoreCategory(entry.category), {
        name: entry.category,
        slug: normalizeStoreCategory(entry.category)
      }])).values())
  };
};

const getAdminStoreProductById = async (req, store, auth, productId) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.product,
    `/products/id/${encodeURIComponent(productId)}`,
    {
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      }
    }
  );

  return normalizeProduct(response?.product || null);
};

const createAdminStoreProduct = async (req, store, auth, payload = {}) => {
  const response = await requestServiceJson(req, env.serviceUrls.product, '/products', {
    method: 'POST',
    auth: {
      storeId: store.id,
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    },
    body: {
      store_id: Number(store.id),
      title: String(payload.title || '').trim(),
      slug: String(payload.slug || '').trim(),
      category: payload.category || null,
      description: payload.description || '',
      price: Number(payload.price || 0),
      base_price: payload.base_price === undefined ? undefined : Number(payload.base_price),
      compare_at_price: payload.compare_at_price === '' || payload.compare_at_price === null || payload.compare_at_price === undefined
        ? null
        : Number(payload.compare_at_price),
      discount_type: payload.discount_type || 'none',
      discount_value: payload.discount_value === '' || payload.discount_value === null || payload.discount_value === undefined
        ? null
        : Number(payload.discount_value),
      promotion_type: payload.promotion_type || 'none',
      discount_label: payload.discount_label || '',
      discount_starts_at: payload.discount_starts_at || null,
      discount_ends_at: payload.discount_ends_at || null,
      sku: payload.sku || '',
      inventory_count: Number(payload.inventory_count || 0),
      images: Array.isArray(payload.images) ? payload.images : [],
      status: String(payload.status || 'draft').trim().toLowerCase()
    }
  });

  return normalizeProduct(response?.product || null);
};

const updateAdminStoreProduct = async (req, store, auth, productId, payload = {}) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.product,
    `/products/${encodeURIComponent(productId)}`,
    {
      method: 'PUT',
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      },
      body: {
        store_id: Number(store.id),
        title: payload.title,
        slug: payload.slug,
        category: payload.category,
        description: payload.description,
        price: payload.price === undefined ? undefined : Number(payload.price),
        base_price: payload.base_price === undefined ? undefined : Number(payload.base_price),
        compare_at_price: payload.compare_at_price === '' || payload.compare_at_price === null
          ? null
          : payload.compare_at_price === undefined
            ? undefined
            : Number(payload.compare_at_price),
        discount_type: payload.discount_type,
        discount_value: payload.discount_value === '' || payload.discount_value === null
          ? null
          : payload.discount_value === undefined
            ? undefined
            : Number(payload.discount_value),
        promotion_type: payload.promotion_type,
        discount_label: payload.discount_label,
        discount_starts_at: payload.discount_starts_at,
        discount_ends_at: payload.discount_ends_at,
        sku: payload.sku,
        inventory_count: payload.inventory_count === undefined ? undefined : Number(payload.inventory_count),
        images: Array.isArray(payload.images) ? payload.images : undefined,
        status: payload.status ? String(payload.status).trim().toLowerCase() : undefined
      }
    }
  );

  return normalizeProduct(response?.product || null);
};

const deleteAdminStoreProduct = async (req, store, auth, productId) => {
  await requestServiceJson(
    req,
    env.serviceUrls.product,
    `/products/${encodeURIComponent(productId)}`,
    {
      method: 'DELETE',
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      },
      body: {
        store_id: Number(store.id)
      }
    }
  );

  return true;
};

const listAdminStoreOrders = async (req, store, auth, options = {}) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.order,
    `/orders?page=1&limit=${Number(options.limit || 100)}`,
    {
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      }
    }
  );

  return Array.isArray(response?.orders)
    ? response.orders.map(normalizeOrder)
    : [];
};

const listStoreCoupons = async (req, store, auth) => {
  const response = await requestServiceJson(req, env.serviceUrls.order, '/coupons', {
    auth: {
      storeId: store.id,
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    }
  });

  return Array.isArray(response?.coupons)
    ? response.coupons.map(normalizeCoupon)
    : [];
};

const createStoreCoupon = async (req, store, auth, payload = {}) => {
  const response = await requestServiceJson(req, env.serviceUrls.order, '/coupons', {
    method: 'POST',
    auth: {
      storeId: store.id,
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    },
    body: {
      code: payload.code,
      description: payload.description || '',
      discount_type: payload.discount_type,
      discount_value: Number(payload.discount_value || 0),
      minimum_order_amount: Number(payload.minimum_order_amount || 0),
      starts_at: payload.starts_at || null,
      ends_at: payload.ends_at || null,
      usage_limit: payload.usage_limit === '' || payload.usage_limit === null || payload.usage_limit === undefined
        ? null
        : Number(payload.usage_limit),
      is_active: payload.is_active === undefined ? true : Boolean(payload.is_active)
    }
  });

  return normalizeCoupon(response?.coupon || null);
};

const updateStoreCoupon = async (req, store, auth, couponId, payload = {}) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.order,
    `/coupons/${encodeURIComponent(couponId)}`,
    {
      method: 'PUT',
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      },
      body: {
        code: payload.code,
        description: payload.description,
        discount_type: payload.discount_type,
        discount_value: payload.discount_value === undefined ? undefined : Number(payload.discount_value),
        minimum_order_amount: payload.minimum_order_amount === undefined ? undefined : Number(payload.minimum_order_amount),
        starts_at: payload.starts_at,
        ends_at: payload.ends_at,
        usage_limit: payload.usage_limit === '' || payload.usage_limit === null
          ? null
          : payload.usage_limit === undefined
            ? undefined
            : Number(payload.usage_limit),
        is_active: payload.is_active
      }
    }
  );

  return normalizeCoupon(response?.coupon || null);
};

const previewStoreCoupon = async (req, store, payload = {}, auth = null) => {
  const response = await requestServiceJson(req, env.serviceUrls.order, '/coupons/preview', {
    method: 'POST',
    auth: {
      storeId: store.id,
      customerId: auth?.customerId || '',
      actorType: auth?.actorType || ''
    },
    body: {
      code: payload.code,
      subtotal: Number(payload.subtotal || 0)
    }
  });

  return {
    ...response,
    coupon: normalizeCoupon(response?.coupon || null),
    subtotal: Number(response?.subtotal || 0),
    discount_total: Number(response?.discount_total || 0),
    total: Number(response?.total || 0)
  };
};

const getAdminStoreOrderById = async (req, store, auth, orderId) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.order,
    `/orders/${encodeURIComponent(orderId)}`,
    {
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      }
    }
  );

  return normalizeOrder(response?.order || null);
};

const updateAdminStoreOrderStatus = async (req, store, auth, orderId, status) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.order,
    `/orders/${encodeURIComponent(orderId)}/status`,
    {
      method: 'PATCH',
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      },
      body: {
        status
      }
    }
  );

  return normalizeOrder(response?.order || null);
};

const refundAdminStoreOrder = async (req, store, auth, paymentReference, payload = {}) => {
  if (!paymentReference) {
    throw new BackendRequestError('Payment reference is required to refund an order.', {
      status: 400
    });
  }

  const response = await requestServiceJson(
    req,
    env.serviceUrls.payment,
    `/payments/${encodeURIComponent(paymentReference)}/refund`,
    {
      method: 'POST',
      auth: {
        storeId: store.id,
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      },
      body: {
        reason: payload.reason || ''
      }
    }
  );

  return {
    payment: response?.payment || null,
    refund: response?.refund || null
  };
};

const listAdminStoreCustomers = async (req, store, auth) => {
  const response = await requestServiceJson(req, env.serviceUrls.customer, '/customers', {
    auth: {
      storeId: store.id,
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    }
  });

  return Array.isArray(response?.customers)
    ? response.customers.map(normalizeCustomer)
    : [];
};

const listPlatformStores = async (req, auth) => {
  const response = await requestServiceJson(req, env.serviceUrls.store, '/stores', {
    auth: {
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    }
  });

  return Array.isArray(response?.stores)
    ? response.stores.map(normalizeStore)
    : [];
};

const getPlatformStoreById = async (req, auth, storeId) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.store,
    `/stores/${encodeURIComponent(storeId)}`,
    {
      auth: {
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      }
    }
  );

  return normalizeStore(response?.store || null);
};

const getPlatformStoreOnboarding = async (req, auth, storeId) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.store,
    `/stores/${encodeURIComponent(storeId)}/onboarding`,
    {
      auth: {
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      }
    }
  );

  return {
    state: response?.state || null,
    tasks: Array.isArray(response?.tasks) ? response.tasks : []
  };
};

const syncPlatformStoreOnboarding = async (req, auth, storeId, tasks = []) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.store,
    `/stores/${encodeURIComponent(storeId)}/onboarding/sync`,
    {
      method: 'POST',
      auth: {
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      },
      body: {
        tasks: Array.isArray(tasks)
          ? tasks.map((task) => ({
              key: task?.key,
              title: task?.title,
              description: task?.description,
              step: task?.step,
              complete: Boolean(task?.complete),
              required: task?.required !== false,
              action: task?.action,
              href: task?.href,
              estimate_minutes: Number(task?.estimate_minutes || 0)
            }))
          : []
      }
    }
  );

  return {
    state: response?.state || null,
    tasks: Array.isArray(response?.tasks) ? response.tasks : []
  };
};

const createPlatformStore = async (req, auth, payload = {}) => {
  const response = await requestServiceJson(req, env.serviceUrls.store, '/stores', {
    method: 'POST',
    auth: {
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    },
    body: {
      name: String(payload.name || '').trim(),
      subdomain: String(payload.subdomain || '').trim(),
      custom_domain: payload.custom_domain || null,
      logo_url: payload.logo_url || null,
      theme_color: payload.theme_color || '#0F766E',
      store_type: payload.store_type || 'general',
      template_key: payload.template_key || 'fashion',
      font_preset: payload.font_preset || 'jakarta',
      support_email: payload.support_email || null,
      contact_phone: payload.contact_phone || null,
      is_active: payload.is_active === undefined ? true : Boolean(payload.is_active),
      ssl_status: payload.ssl_status || 'pending'
    }
  });

  return normalizeStore(response?.store || null);
};

const updatePlatformStore = async (req, auth, storeId, payload = {}) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.store,
    `/stores/${encodeURIComponent(storeId)}`,
    {
      method: 'PUT',
      auth: {
        userId: auth.userId,
        actorRole: auth.actorRole,
        actorType: 'platform_user'
      },
      body: payload
    }
  );

  return normalizeStore(response?.store || null);
};

const getOwnerSubscription = async (req, auth) => {
  return getOwnerSubscriptionAccess(req, auth, auth?.userId || '');
};

const getOwnerSubscriptionAccess = async (req, auth, ownerId) => {
  const normalizedOwnerId = String(ownerId || auth?.userId || '').trim();
  const isSelf = normalizedOwnerId && String(auth?.userId || '').trim() === normalizedOwnerId;
  const pathname = isSelf
    ? '/subscriptions/me'
    : `/subscriptions/${encodeURIComponent(normalizedOwnerId)}`;
  const response = await requestServiceJson(req, env.serviceUrls.billing, pathname, {
    auth: {
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    }
  });

  return {
    subscription: response?.subscription || null,
    latestInvoice: response?.latest_invoice || null,
    entitlements: normalizeEntitlements(response?.entitlements || null)
  };
};

const shouldFallbackPublicBillingPlans = (error) => {
  const status = Number(error?.status || 0);
  return status >= 500;
};

const getPublicBillingPlans = async (req, options = {}) => {
  const targetCurrency = String(options.currency || '').trim().toUpperCase();
  const query = targetCurrency
    ? `?currency=${encodeURIComponent(targetCurrency)}`
    : '';

  try {
    const response = await requestPublicJson(req, env.serviceUrls.billing, `/plans${query}`);
    return Array.isArray(response?.plans) ? response.plans : [];
  } catch (error) {
    if (!shouldFallbackPublicBillingPlans(error)) {
      throw error;
    }

    req.log?.warn('public_billing_plans_unavailable', {
      serviceUrl: env.serviceUrls.billing,
      status: error.status,
      error
    });
    return [];
  }
};

const getAdminBillingPlans = async (req, auth) => {
  const response = await requestServiceJson(req, env.serviceUrls.billing, '/admin/plans', {
    auth: {
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    }
  });

  return {
    plans: Array.isArray(response?.plans) ? response.plans : [],
    supported_currencies: Array.isArray(response?.supported_currencies) ? response.supported_currencies : [],
    trial_days: Number(response?.trial_days || 0),
    trial_authorization_amount: Number(response?.trial_authorization_amount || 0),
    trial_authorization_currency: response?.trial_authorization_currency || 'USD'
  };
};

const updateAdminBillingPlan = async (req, auth, payload = {}) => {
  return requestServiceJson(req, env.serviceUrls.billing, '/admin/plans', {
    method: 'POST',
    auth: {
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    },
    body: {
      plan: String(payload.plan || '').trim().toLowerCase(),
      currency: String(payload.currency || '').trim().toUpperCase() || undefined,
      monthly_amount: Number(payload.monthly_amount || 0),
      yearly_discount_percentage: Number(payload.yearly_discount_percentage || 0)
    }
  });
};

const createOwnerSubscriptionCheckout = async (req, auth, payload = {}) => {
  return requestServiceJson(req, env.serviceUrls.billing, '/subscriptions/checkout-session', {
    method: 'POST',
    auth: {
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    },
    body: {
      plan: payload.plan,
      billing_cycle: payload.billing_cycle || 'monthly',
      provider: payload.provider || 'paystack',
      currency: payload.currency || 'USD',
      email: payload.email || null,
      callback_url: payload.callback_url || null
    }
  });
};

const verifyOwnerSubscriptionCheckout = async (req, auth, reference) => {
  return requestServiceJson(req, env.serviceUrls.billing, '/subscriptions/verify-checkout', {
    method: 'POST',
    auth: {
      userId: auth.userId,
      actorRole: auth.actorRole,
      actorType: 'platform_user'
    },
    body: {
      reference
    }
  });
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

const getStoreProductById = async (req, store, productId, options = {}) => {
  const response = await requestServiceJson(
    req,
    env.serviceUrls.product,
    `/products/id/${encodeURIComponent(productId)}`,
    {
      auth: {
        storeId: store.id,
        userId: options.auth?.userId || '',
        actorRole: options.auth?.actorRole || '',
        actorType: options.auth?.actorType || ''
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

const requestStorefrontPasswordReset = async (req, store, payload = {}) => {
  return requestPublicJson(req, env.serviceUrls.customer, '/customers/password-reset/request', {
    method: 'POST',
    body: {
      store_id: Number(store.id),
      email: String(payload.email || '').trim().toLowerCase()
    }
  });
};

const unsubscribeStorefrontMarketing = async (req, token) => {
  const safeToken = String(token || '').trim();
  const response = await requestPublicJson(
    req,
    env.serviceUrls.customer,
    `/customers/marketing/unsubscribe?token=${encodeURIComponent(safeToken)}`
  );

  let store = null;
  if (response?.customer?.store_id) {
    try {
      const storeResponse = await requestServiceJson(
        req,
        env.serviceUrls.store,
        `/stores/${encodeURIComponent(response.customer.store_id)}`,
        {
          auth: {
            actorRole: PLATFORM_ROLES.PLATFORM_OWNER,
            actorType: 'platform_user'
          }
        }
      );
      store = normalizeStore(storeResponse?.store || null);
    } catch {
      store = null;
    }
  }

  return {
    status: response?.status || 'unsubscribed',
    already_unsubscribed: Boolean(response?.already_unsubscribed),
    customer: normalizeCustomer(response?.customer || null),
    store
  };
};

const confirmStorefrontPasswordReset = async (req, store, payload = {}) => {
  return requestPublicJson(req, env.serviceUrls.customer, '/customers/password-reset/confirm', {
    method: 'POST',
    body: {
      store_id: Number(store.id),
      email: String(payload.email || '').trim().toLowerCase(),
      otp: String(payload.otp || '').trim(),
      password: String(payload.password || '')
    }
  });
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

const getStoreCheckoutProviders = async (req, store, auth = null) => {
  const response = await requestServiceJson(req, env.serviceUrls.payment, '/payments/config', {
    auth: {
      storeId: store.id,
      customerId: auth?.customerId || '',
      actorType: auth?.actorType || ''
    }
  });

  return Array.isArray(response?.configs)
    ? response.configs
      .filter((config) => {
        const provider = String(config?.provider || '').trim().toLowerCase();
        const status = String(config?.status || '').trim().toLowerCase();
        const hasPublicKey = Boolean(String(config?.public_key || '').trim());
        const hasSecretKey = Boolean(config?.has_secret_key);
        const hasWebhookSecretHash = Boolean(config?.has_webhook_secret_hash);

        return status === 'active'
          && hasPublicKey
          && hasSecretKey
          && (provider !== 'flutterwave' || hasWebhookSecretHash);
      })
      .map((config) => ({
        provider: String(config?.provider || '').trim().toLowerCase(),
        public_key: String(config?.public_key || '').trim(),
        has_secret_key: Boolean(config?.has_secret_key)
      }))
    : [];
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
      provider: payload.provider || 'paystack',
      callback_url: payload.callback_url || null,
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
      },
      coupon_code: payload.coupon_code || null
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

const quoteStorefrontCheckout = async (req, store, auth, payload = {}) => {
  const response = await requestServiceJson(req, env.serviceUrls.order, '/checkout/quote', {
    method: 'POST',
    auth: {
      storeId: store.id,
      customerId: auth.customerId,
      actorType: 'customer'
    },
    body: {
      currency: payload.currency || 'USD',
      shipping_address: {
        address: payload.address,
        city: payload.city,
        country: payload.country,
        postal_code: payload.postal_code
      },
      coupon_code: payload.coupon_code || null
    },
    headers: {
      'x-session-id': payload.sessionId
    }
  });

  return {
    coupon: response?.coupon || null,
    quote: response?.quote || null
  };
};

const verifyStorefrontCheckout = async (req, store, auth, reference) => {
  const response = await requestServiceJson(req, env.serviceUrls.order, '/checkout/verify', {
    method: 'POST',
    auth: {
      storeId: store.id,
      customerId: auth.customerId,
      actorType: 'customer'
    },
    body: {
      reference
    }
  });

  return {
    order: normalizeOrder(response?.order || null),
    payment: response?.payment || null
  };
};

const clearStorefrontCart = async (req, store, auth, sessionId) => {
  const response = await requestServiceJson(req, env.serviceUrls.cart, '/cart/clear', {
    method: 'POST',
    auth: {
      storeId: store.id,
      customerId: auth?.customerId || '',
      actorType: auth?.actorType || ''
    },
    body: {
      store_id: Number(store.id)
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

const requestPlatformPasswordReset = async (req, payload = {}) => {
  return requestPublicJson(req, env.serviceUrls.user, '/auth/password-reset/request', {
    method: 'POST',
    body: {
      email: String(payload.email || '').trim().toLowerCase()
    }
  });
};

const confirmPlatformPasswordReset = async (req, payload = {}) => {
  return requestPublicJson(req, env.serviceUrls.user, '/auth/password-reset/confirm', {
    method: 'POST',
    body: {
      email: String(payload.email || '').trim().toLowerCase(),
      otp: String(payload.otp || '').trim(),
      password: String(payload.password || '')
    }
  });
};

module.exports = {
  BackendRequestError,
  DEFAULT_PRODUCT_IMAGE,
  SESSION_COOKIE_NAME,
  buildServiceHeaders,
  clearWebAuthCookies,
  clearStorefrontCart,
  coerceBackendError,
  createAdminStoreProduct,
  createEmptyCart,
  createPlatformStore,
  deleteAdminStoreProduct,
  ensureStorefrontSession,
  getAdminStoreOrderById,
  getAdminStoreProductById,
  getAdminBillingPlans,
  getPublicBillingPlans,
  getCartForStore,
  getCurrentCustomer,
  getCurrentPlatformUser,
  getCustomerAuthForStore,
  getCustomerOrderById,
  getOwnerSubscription,
  getOwnerSubscriptionAccess,
  getPlatformAuth,
  getPlatformStoreById,
  getPlatformStoreOnboarding,
  getRequestHost,
  getRequestHostname,
  getStoreByHost,
  getStoreCheckoutProviders,
  getStoreProductById,
  listCustomerOrders,
  listStoreCoupons,
  listAdminStoreCustomers,
  listAdminStoreOrders,
  listPlatformStores,
  listStoreProducts,
  requestPlatformPasswordReset,
  confirmPlatformPasswordReset,
  requestStorefrontPasswordReset,
  unsubscribeStorefrontMarketing,
  confirmStorefrontPasswordReset,
  createOwnerSubscriptionCheckout,
  verifyOwnerSubscriptionCheckout,
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
  syncPlatformStoreOnboarding,
  createStoreCoupon,
  addToCart,
  previewStoreCoupon,
  updateAdminStoreOrderStatus,
  updateAdminBillingPlan,
  updateAdminStoreProduct,
  refundAdminStoreOrder,
  updateStoreCoupon,
  updatePlatformStore,
  updateCartItem,
  removeCartItem,
  getStoreProductBySlug,
  checkoutStorefrontCart,
  quoteStorefrontCheckout,
  verifyStorefrontCheckout
};
