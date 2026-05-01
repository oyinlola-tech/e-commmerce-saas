const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { doubleCsrf } = require('csrf-csrf');
const { body, param, query } = require('express-validator');
const env = require('./src/lib/load-env');
const {
  storeTypes,
  storeTemplates,
  fontPresets,
  getStoreTheme
} = require('./src/lib/store-themes');
const {
  buildCurrencyContext,
  normalizeCurrencyCode
} = require('./src/lib/currency');
const {
  brand,
  platformUser,
  systemAdminUser,
  getStoreById,
  getStoreByHost,
  getOwnerStores,
  getAllStores,
  getStoreProducts,
  getPublishedProducts,
  getStoreDiscoveryFacets,
  getProductById,
  getProductBySlug,
  getStoreOrders,
  getOrderById,
  getStoreStats,
  getPlatformMetrics,
  getPlatformHighlights,
  getSupportConversations,
  getIncidents,
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
  replyToSupportConversation,
  updateSupportConversation,
  updateIncident,
  findCustomerByEmail,
  getStoreCustomers,
  getCustomerById
} = require('./src/lib/state');
const {
  createLogger,
  normalizeHostname,
  isSecureRequest,
  sanitizePlainText,
  sanitizeEmail,
  sanitizeSlug,
  sanitizeUrl,
  validate,
  allowBodyFields,
  allowQueryFields,
  commonRules,
  createHttpError
} = require('../../packages/shared');
const { logoUpload, ensureLogoUploadDir, saveLogoFile } = require('./src/lib/uploads');
const { handleFormValidation } = require('./src/lib/validation');
const {
  setSignedCookie,
  clearSignedCookie,
  readSignedCookie,
  ensureVisitorId,
  safeRedirect,
  isPlatformRequestHost
} = require('./src/lib/security');

const logger = createLogger('web-app');
const app = express();

const PORT = env.port;
const ROOT_DOMAIN = env.rootDomain;
const publicDir = path.join(__dirname, 'public');
const logoDir = env.logoUploadDir;
const themeStylesPath = path.join(publicDir, 'styles', 'theme.css');
const themeAssetVersion = fs.existsSync(themeStylesPath)
  ? String(fs.statSync(themeStylesPath).mtimeMs)
  : '1';
const isLocalRoot = ROOT_DOMAIN === 'localhost' || ROOT_DOMAIN === '127.0.0.1';

ensureLogoUploadDir().catch((error) => {
  logger.error('logo_directory_init_failed', { error });
});

const customerCookieName = (storeId) => `customer_${storeId}`;
const orderCookieName = (storeId) => `last_order_${storeId}`;
const wishlistCookieName = (storeId) => `wishlist_${storeId}`;
const recentlyViewedCookieName = (storeId) => `recently_viewed_${storeId}`;
const catalogSortOptions = ['featured', 'newest', 'price-low', 'price-high', 'name'];

const { generateToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => env.csrfSecret,
  cookieName: 'aisle.x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/'
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getSessionIdentifier: (req) => {
    return readSignedCookie(req, 'aisle_visitor_id') || req.ip || 'anonymous';
  },
  getTokenFromRequest: (req) => {
    return req.body?._csrf || req.headers['x-csrf-token'] || req.headers['csrf-token'];
  }
});

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const authPageRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const htmlMinifier = (req, res, next) => {
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (typeof body === 'string' && contentType.includes('text/html')) {
      return originalSend(body.replace(/>\s+</g, '><').trim());
    }

    return originalSend(body);
  };

  next();
};

const handleMultipartLogo = (renderer) => {
  return (req, res, next) => {
    return logoUpload.single('logo')(req, res, (error) => {
      if (!error) {
        return next();
      }

      return renderer(req, res, {
        logo: [error.message]
      }, 422);
    });
  };
};

const buildFormData = (req, keys = []) => {
  return keys.reduce((accumulator, key) => {
    if (req.body?.[key] !== undefined) {
      accumulator[key] = req.body[key];
    }
    return accumulator;
  }, {});
};

const safeDecodeURIComponent = (value = '') => {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
};

const parseCheckbox = (value) => {
  return ['1', 'true', 'on', 'yes', 'published'].includes(String(value || '').trim().toLowerCase());
};

const isStorefrontHost = (req) => {
  return !isPlatformRequestHost(normalizeHostname(req.hostname || req.headers.host || ''));
};

const isStoreScopedPath = (pathname = '') => {
  return pathname === '/register'
    || pathname === '/products'
    || pathname === '/wishlist'
    || pathname.startsWith('/products/')
    || pathname === '/cart'
    || pathname === '/account'
    || pathname === '/orders'
    || pathname === '/checkout'
    || pathname === '/order-confirmation'
    || pathname.startsWith('/cart/')
    || pathname.startsWith('/wishlist/');
};

const getDefaultStore = () => {
  return getOwnerStores(platformUser.id)[0] || getAllStores()[0] || null;
};

const resolveStore = (req) => {
  if (isStorefrontHost(req)) {
    return getStoreByHost(normalizeHostname(req.hostname)) || getDefaultStore();
  }

  const requestedStoreId = sanitizePlainText(req.query.store || readSignedCookie(req, 'activeStoreId') || '', {
    maxLength: 120
  });
  return getStoreById(requestedStoreId) || getDefaultStore();
};

const buildStorefrontUrl = (store) => {
  if (!store) {
    return '/';
  }

  const customDomain = normalizeHostname(store.custom_domain);
  if (customDomain) {
    return `https://${customDomain}`;
  }

  const subdomain = sanitizeSlug(store.subdomain || '');
  if (!subdomain) {
    return '/';
  }

  if (isLocalRoot) {
    return `http://${subdomain}.localhost:${PORT}`;
  }

  return `https://${subdomain}.${ROOT_DOMAIN}`;
};

const buildStoreAdminUrl = (store) => {
  if (!store) {
    return '/dashboard';
  }

  if (isLocalRoot) {
    return `http://localhost:${PORT}/admin?store=${encodeURIComponent(store.id)}`;
  }

  return `${buildStorefrontUrl(store)}/admin`;
};

const getCurrentCustomer = (req, storeId) => {
  if (!storeId || req.query.guest === '1') {
    return null;
  }

  const customerId = readSignedCookie(req, customerCookieName(storeId));
  return customerId ? getCustomerById(storeId, customerId) : null;
};

const getCustomerOrders = (storeId, customer) => {
  if (!customer) {
    return [];
  }

  return getStoreOrders(storeId).filter((order) => {
    return String(order.customer?.email || '').toLowerCase() === String(customer.email || '').toLowerCase();
  });
};

const getWishlistProductIds = (req, storeId) => {
  const raw = readSignedCookie(req, wishlistCookieName(storeId));
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => String(entry)).slice(0, 50);
  } catch {
    return [];
  }
};

const persistWishlist = (req, res, storeId, productIds) => {
  setSignedCookie(req, res, wishlistCookieName(storeId), JSON.stringify(productIds.slice(0, 50)), {
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
};

const getRecentlyViewedProductIds = (req, storeId) => {
  const raw = readSignedCookie(req, recentlyViewedCookieName(storeId));
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => String(entry)).slice(0, 12);
  } catch {
    return [];
  }
};

const persistRecentlyViewed = (req, res, storeId, productId) => {
  const nextIds = [
    String(productId),
    ...getRecentlyViewedProductIds(req, storeId).filter((entry) => entry !== String(productId))
  ].slice(0, 12);

  setSignedCookie(req, res, recentlyViewedCookieName(storeId), JSON.stringify(nextIds), {
    maxAge: 14 * 24 * 60 * 60 * 1000
  });
};

const getRecentlyViewedProducts = (req, storeId, options = {}) => {
  const excludeId = options.excludeId ? String(options.excludeId) : null;
  const limit = Math.max(1, Number(options.limit || 4));

  return getRecentlyViewedProductIds(req, storeId)
    .filter((entry) => !excludeId || entry !== excludeId)
    .map((entry) => getProductById(storeId, entry))
    .filter((product) => product && String(product.status || '').toLowerCase() === 'published')
    .slice(0, limit);
};

const renderPlatform = (res, view, payload = {}) => {
  return res.render(view, {
    layout: 'layouts/main',
    ...payload
  });
};

const renderStorefront = (req, res, view, payload = {}) => {
  const store = resolveStore(req);
  const customer = getCurrentCustomer(req, store?.id);
  const cart = getCart(store?.id);
  const storeTheme = getStoreTheme(store);
  const wishlistIds = store?.id ? getWishlistProductIds(req, store.id) : [];
  const wishlistProducts = store?.id
    ? getPublishedProducts(store.id).filter((product) => wishlistIds.includes(String(product.id)))
    : [];
  const recentlyViewedProducts = store?.id ? getRecentlyViewedProducts(req, store.id, { limit: 6 }) : [];

  return res.render(view, {
    layout: 'layouts/store',
    store,
    storeTheme,
    customer,
    cart,
    wishlistIds,
    wishlistProducts,
    wishlistCount: wishlistIds.length,
    recentlyViewedProducts,
    ...payload
  });
};

const renderStoreAdmin = (req, res, view, payload = {}) => {
  const store = resolveStore(req);
  return res.render(view, {
    layout: 'layouts/admin',
    store,
    storeTheme: getStoreTheme(store),
    ...payload
  });
};

const renderPlatformAdmin = (res, view, payload = {}) => {
  return res.render(view, {
    layout: 'layouts/platform-admin',
    ...payload
  });
};

const renderCustomerSignup = (req, res, errors = {}, status = 200) => {
  res.status(status);
  return renderStorefront(req, res, 'storefront/register', {
    pageTitle: 'Create account',
    errors,
    formData: buildFormData(req, ['name', 'email'])
  });
};

const renderCustomerLogin = (req, res, errors = {}, status = 200) => {
  res.status(status);
  return renderStorefront(req, res, 'storefront/login', {
    pageTitle: 'Sign in',
    errors,
    formData: buildFormData(req, ['email'])
  });
};

const renderOwnerSignup = (req, res, errors = {}, status = 200) => {
  res.status(status);
  return renderPlatform(res, 'platform/signup', {
    pageTitle: 'Create owner account',
    errors,
    formData: buildFormData(req, [
      'name',
      'email',
      'store_name',
      'store_subdomain',
      'store_type',
      'template_key',
      'theme_color',
      'font_preset'
    ])
  });
};

const renderOwnerLogin = (req, res, errors = {}, status = 200) => {
  res.status(status);
  return renderPlatform(res, 'platform/login', {
    pageTitle: 'Sign in',
    errors,
    formData: buildFormData(req, ['email'])
  });
};

const renderProductForm = (req, res, product = null, errors = {}, status = 200) => {
  res.status(status);
  return renderStoreAdmin(req, res, 'admin/product-form', {
    pageTitle: product ? 'Edit product' : 'Add product',
    product,
    errors
  });
};

const renderSettingsPage = (req, res, errors = {}, status = 200) => {
  res.status(status);
  return renderStoreAdmin(req, res, 'admin/settings', {
    pageTitle: 'Store settings',
    errors
  });
};

const renderDomainPage = (req, res, errors = {}, status = 200) => {
  res.status(status);
  return renderStoreAdmin(req, res, 'admin/domain', {
    pageTitle: 'Domain setup',
    errors
  });
};

const renderCheckoutPage = (req, res, errors = {}, status = 200) => {
  res.status(status);
  return renderStorefront(req, res, 'storefront/checkout', {
    pageTitle: 'Checkout',
    errors
  });
};

const setCustomerAuthCookie = (req, res, storeId, customerId) => {
  setSignedCookie(req, res, customerCookieName(storeId), String(customerId), {
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
};

const setOrderTrackingCookie = (req, res, storeId, orderId) => {
  setSignedCookie(req, res, orderCookieName(storeId), String(orderId), {
    maxAge: 14 * 24 * 60 * 60 * 1000
  });
};

const setCurrencyPreferenceCookie = (req, res, name, value) => {
  setSignedCookie(req, res, name, value, {
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
};

const wantsJson = (req) => {
  return req.xhr
    || String(req.headers.accept || '').includes('application/json')
    || req.path.startsWith('/cart/')
    || req.path.startsWith('/wishlist/');
};

const supportedErrorPageStatuses = new Set([400, 401, 403, 404, 422, 429, 500, 502, 503]);

const resolveErrorView = (status) => {
  const normalizedStatus = supportedErrorPageStatuses.has(Number(status)) ? Number(status) : 500;
  const targetPath = path.join(__dirname, 'views', 'errors', `${normalizedStatus}.ejs`);
  return fs.existsSync(targetPath) ? `errors/${normalizedStatus}` : 'errors/500';
};

const resolveErrorLayout = (req) => {
  if (req.path.startsWith('/platform-admin')) {
    return 'layouts/platform-admin';
  }

  if (req.path.startsWith('/admin')) {
    return 'layouts/admin';
  }

  return isStorefrontHost(req) ? 'layouts/store' : 'layouts/main';
};

const resolveErrorHomeHref = (req) => {
  if (req.path.startsWith('/platform-admin')) {
    return '/platform-admin';
  }

  if (req.path.startsWith('/admin')) {
    return '/admin';
  }

  if (!isStorefrontHost(req)) {
    return '/';
  }

  return '/';
};

const buildErrorDetailItems = (error) => {
  if (!error?.details) {
    return [];
  }

  if (Array.isArray(error.details?.fields)) {
    return error.details.fields
      .slice(0, 5)
      .map((entry) => {
        const field = sanitizePlainText(entry.field || '', { maxLength: 80 });
        const message = sanitizePlainText(entry.message || '', { maxLength: 180 });
        return field ? `${field}: ${message}` : message;
      })
      .filter(Boolean);
  }

  if (Array.isArray(error.details)) {
    return error.details
      .slice(0, 5)
      .map((entry) => sanitizePlainText(String(entry || ''), { maxLength: 180 }))
      .filter(Boolean);
  }

  return [];
};

const buildErrorPageState = (req, status, error = null, overrides = {}) => {
  const normalizedStatus = supportedErrorPageStatuses.has(Number(status)) ? Number(status) : 500;
  const fallbackHref = resolveErrorHomeHref(req);
  const retryHref = safeRedirect(req, req.headers.referer || req.originalUrl || fallbackHref, fallbackHref);
  const presets = {
    400: {
      title: 'Bad request',
      message: 'The request could not be understood. Check the address or retry from a stable page.',
      primaryAction: { href: fallbackHref, label: 'Go home' },
      secondaryAction: { href: retryHref, label: 'Try again' },
      recoverySteps: [
        'Check the link, form inputs, or query parameters.',
        'Refresh the page and submit again.',
        'Start over from a working section if the problem keeps repeating.'
      ]
    },
    401: {
      title: 'Sign in required',
      message: 'This page needs a valid session before it can continue.',
      primaryAction: { href: '/login', label: 'Sign in' },
      secondaryAction: { href: fallbackHref, label: 'Back to safety' },
      recoverySteps: [
        'Sign in again if your session expired.',
        'Return to checkout, orders, or account after login.',
        'Use a store-specific account when browsing a storefront.'
      ]
    },
    403: {
      title: 'Access denied',
      message: 'You do not have permission to continue with this action.',
      primaryAction: { href: retryHref, label: 'Go back' },
      secondaryAction: { href: fallbackHref, label: 'Return home' },
      recoverySteps: [
        'Make sure you are signed in with the correct account.',
        'Refresh the page if your session token expired.',
        'Return to a page you can access and try a different route.'
      ]
    },
    404: {
      title: 'Page not found',
      message: 'The page or resource you requested could not be found.',
      primaryAction: { href: fallbackHref, label: 'Go home' },
      secondaryAction: { href: retryHref, label: 'Go back' },
      recoverySteps: [
        'Double-check the route or product link.',
        'Return to the catalog, dashboard, or homepage.',
        'Refresh the page if the URL should still exist.'
      ]
    },
    422: {
      title: 'Request could not be processed',
      message: 'We understood the request, but some of the submitted data still needs attention.',
      primaryAction: { href: retryHref, label: 'Review and retry' },
      secondaryAction: { href: fallbackHref, label: 'Go home' },
      recoverySteps: [
        'Review highlighted fields or required inputs.',
        'Correct the values and submit again.',
        'Refresh the page if the form state looks out of sync.'
      ]
    },
    429: {
      title: 'Too many requests',
      message: 'The app is temporarily rate-limiting requests from this session.',
      primaryAction: { href: retryHref, label: 'Try again shortly' },
      secondaryAction: { href: fallbackHref, label: 'Return home' },
      recoverySteps: [
        'Wait a moment before retrying.',
        'Avoid repeated rapid clicks or refreshes.',
        'Try again from a single tab if you have several open.'
      ]
    },
    500: {
      title: 'Something went wrong',
      message: 'The server ran into an unexpected issue while rendering this page.',
      primaryAction: { href: retryHref, label: 'Try again' },
      secondaryAction: { href: fallbackHref, label: 'Return home' },
      recoverySteps: [
        'Refresh the page after a moment.',
        'Return to another section if this route is unstable.',
        'Use the request ID below if you need to trace the issue.'
      ]
    },
    502: {
      title: 'Upstream response failed',
      message: 'A connected backend service returned an invalid or incomplete response.',
      primaryAction: { href: retryHref, label: 'Retry request' },
      secondaryAction: { href: fallbackHref, label: 'Go home' },
      recoverySteps: [
        'Retry after a short pause.',
        'Return to a different page while the service recovers.',
        'Use the request ID below if the problem persists.'
      ]
    },
    503: {
      title: 'Service unavailable',
      message: 'A required service is temporarily unavailable right now.',
      primaryAction: { href: retryHref, label: 'Retry soon' },
      secondaryAction: { href: fallbackHref, label: 'Return home' },
      recoverySteps: [
        'Wait a moment and try again.',
        'Avoid resubmitting rapidly while recovery is in progress.',
        'Use another stable page until the service comes back.'
      ]
    }
  };

  const preset = presets[normalizedStatus] || presets[500];
  const isExposed = !env.isProduction || normalizedStatus < 500 || error?.expose;
  const detailItems = buildErrorDetailItems(error);
  const message = overrides.message
    || (isExposed && error?.message ? error.message : preset.message);

  return {
    statusCode: normalizedStatus,
    title: overrides.title || preset.title,
    message,
    primaryAction: overrides.primaryAction || preset.primaryAction,
    secondaryAction: Object.prototype.hasOwnProperty.call(overrides, 'secondaryAction')
      ? overrides.secondaryAction
      : preset.secondaryAction,
    recoverySteps: overrides.recoverySteps || preset.recoverySteps,
    detailItems: overrides.detailItems || detailItems,
    requestId: req.requestId || null
  };
};

const renderErrorPage = (req, res, status, error = null, overrides = {}) => {
  const store = resolveStore(req);
  const errorState = buildErrorPageState(req, status, error, overrides);
  const layout = overrides.layout || resolveErrorLayout(req);
  const customer = store ? getCurrentCustomer(req, store.id) : null;
  const cart = store ? getCart(store.id) : { items: [], total: 0 };

  return res.status(Number(status || errorState.statusCode || 500)).render(resolveErrorView(errorState.statusCode), {
    layout,
    pageTitle: overrides.pageTitle || errorState.title,
    metaDescription: errorState.message,
    store,
    storeTheme: getStoreTheme(store),
    customer,
    cart,
    errorState
  });
};

const csrfProtectedMiddleware = (req, res, next) => {
  return doubleCsrfProtection(req, res, next);
};

app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  req.log = logger.child({
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl
  });
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  crossOriginResourcePolicy: false,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
        'https://cdn.tailwindcss.com',
        'https://cdn.jsdelivr.net'
      ],
      styleSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
        'https://fonts.googleapis.com'
      ],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(compression());
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser(env.cookieSecret));
app.use(htmlMinifier);
app.use((req, res, next) => {
  ensureVisitorId(req, res);
  return next();
});

app.use((req, res, next) => {
  if (!env.isProduction) {
    return next();
  }

  if (isSecureRequest(req)) {
    return next();
  }

  const requestHost = normalizeHostname(req.headers.host);
  if (!requestHost) {
    if (wantsJson(req)) {
      return res.status(400).json({ error: 'Invalid host header.' });
    }

    return renderErrorPage(req, res, 400, createHttpError(400, 'Invalid host header.', null, { expose: true }));
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(308, `https://${requestHost}${req.originalUrl}`);
  }

  if (wantsJson(req)) {
    return res.status(400).json({ error: 'HTTPS is required.' });
  }

  return renderErrorPage(req, res, 400, createHttpError(400, 'HTTPS is required.', null, { expose: true }), {
    message: 'This action requires a secure HTTPS connection before it can continue.'
  });
});

app.use('/logos', express.static(logoDir, {
  immutable: true,
  maxAge: '1y',
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'theme.css') {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
      return;
    }

    if (/\.[a-f0-9]{8,}\./i.test(path.basename(filePath))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }

    res.setHeader('Cache-Control', `public, max-age=${env.staticAssetCacheSeconds}`);
  }
}));

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  return csrfProtectedMiddleware(req, res, next);
});

app.use((req, res, next) => {
  if (req.query.store && getStoreById(req.query.store)) {
    setSignedCookie(req, res, 'activeStoreId', req.query.store, {
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    req.signedCookies.activeStoreId = req.query.store;
  }

  return next();
});

app.use(async (req, res, next) => {
  try {
    const activeStore = resolveStore(req);
    const pricingStore = isStorefrontHost(req) || req.path.startsWith('/admin') || isStoreScopedPath(req.path)
      ? activeStore
      : null;
    const currencyContext = await buildCurrencyContext(req, pricingStore);

    if (currencyContext.shouldPersistSelection) {
      setCurrencyPreferenceCookie(req, res, currencyContext.cookieName, currencyContext.selectedCurrency);
      req.signedCookies[currencyContext.cookieName] = currencyContext.selectedCurrency;
    }

    res.locals.pageTitle = '';
    res.locals.metaDescription = '';
    res.locals.currentPath = req.path;
    res.locals.currentUrl = req.originalUrl;
    res.locals.platformBrand = brand;
    res.locals.platformUser = platformUser;
    res.locals.systemAdminUser = systemAdminUser;
    res.locals.success = req.query.success || null;
    res.locals.error = req.query.error || null;
    res.locals.currentStore = activeStore;
    res.locals.currentStoreTheme = getStoreTheme(activeStore);
    res.locals.storeTypes = storeTypes;
    res.locals.storeTemplates = storeTemplates;
    res.locals.fontPresets = fontPresets;
    res.locals.currencyContext = currencyContext;
    res.locals.selectedCurrency = currencyContext.selectedCurrency;
    res.locals.currencyOptions = currencyContext.options;
    res.locals.currencyPreferenceSource = currencyContext.source;
    res.locals.visitorLocation = currencyContext.geoData;
    res.locals.baseCurrency = currencyContext.baseCurrency;
    res.locals.formatMoney = (amount) => currencyContext.formatAmount(amount);
    res.locals.convertMoney = (amount) => currencyContext.convertAmount(amount);
    res.locals.storefrontUrl = buildStorefrontUrl(activeStore);
    res.locals.storeAdminUrl = buildStoreAdminUrl(activeStore);
    res.locals.csrfToken = generateToken(req, res);
    res.locals.themeAssetVersion = themeAssetVersion;
    next();
  } catch (error) {
    next(error);
  }
});

const currencyValidation = [
  allowBodyFields(['code', 'returnTo', 'scope', '_csrf']),
  body('code').custom((value) => Boolean(normalizeCurrencyCode(value))).withMessage('Select a valid currency code.'),
  body('returnTo').optional().isString(),
  body('scope').optional().isIn(['store', 'platform'])
];

const customerRegisterValidation = [
  allowBodyFields(['name', 'email', 'password', 'confirmPassword', '_csrf']),
  commonRules.name('name', 120),
  commonRules.email(),
  commonRules.password(),
  body('confirmPassword')
    .isString()
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.')
];

const ownerSignupValidation = [
  allowBodyFields([
    'name',
    'email',
    'password',
    'confirmPassword',
    'store_name',
    'store_subdomain',
    'store_type',
    'template_key',
    'theme_color',
    'font_preset',
    '_csrf'
  ]),
  commonRules.name('name', 120),
  commonRules.email(),
  commonRules.password(),
  body('confirmPassword')
    .isString()
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.'),
  body('store_name').optional().trim().isLength({ max: 150 }),
  body('store_subdomain').optional().customSanitizer((value) => sanitizeSlug(value).slice(0, 120)),
  body('store_type').optional().trim().isLength({ max: 50 }),
  body('template_key').optional().trim().isLength({ max: 50 }),
  body('theme_color').optional().matches(/^#[0-9a-f]{6}$/i).withMessage('Use a valid hex colour.'),
  body('font_preset').optional().trim().isLength({ max: 50 })
];

const ownerLoginValidation = [
  allowBodyFields(['email', 'password', '_csrf']),
  commonRules.email(),
  body('password').isString().notEmpty().withMessage('Password is required.')
];

const storeCreationValidation = [
  allowBodyFields(['name', 'subdomain', 'store_type', 'template_key', 'theme_color', 'font_preset', '_csrf']),
  commonRules.name('name', 150),
  body('subdomain').customSanitizer((value) => sanitizeSlug(value).slice(0, 120)).notEmpty().withMessage('Subdomain is required.'),
  body('store_type').optional().trim().isLength({ max: 50 }),
  body('template_key').optional().trim().isLength({ max: 50 }),
  body('theme_color').optional().matches(/^#[0-9a-f]{6}$/i).withMessage('Use a valid hex colour.'),
  body('font_preset').optional().trim().isLength({ max: 50 })
];

const storeSettingsValidation = [
  allowBodyFields([
    'name',
    'tagline',
    'description',
    'store_type',
    'template_key',
    'template_picker',
    'font_preset',
    'theme_color',
    'support_email',
    'contact_phone',
    'fulfillment_sla',
    'return_window_days',
    '_csrf'
  ]),
  commonRules.name('name', 150),
  body('tagline').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 180 })),
  body('description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 1500 })),
  body('store_type').optional().trim().isLength({ max: 50 }),
  body('template_key').optional().trim().isLength({ max: 50 }),
  body('font_preset').optional().trim().isLength({ max: 50 }),
  body('theme_color').optional().matches(/^#[0-9a-f]{6}$/i).withMessage('Use a valid hex colour.'),
  body('support_email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid support email.'),
  body('contact_phone').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 50 })),
  body('fulfillment_sla').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
  body('return_window_days').optional().isInt({ min: 1, max: 365 }).withMessage('Return window must be between 1 and 365 days.').toInt()
];

const domainValidation = [
  allowBodyFields(['custom_domain', '_csrf']),
  body('custom_domain').optional().custom((value) => {
    return !value || Boolean(normalizeHostname(value));
  }).withMessage('Enter a valid hostname such as store.example.com.')
];

const productValidation = [
  allowBodyFields([
    'name',
    'category',
    'sku',
    'description',
    'highlights',
    'price',
    'compare_at_price',
    'inventory',
    'featured',
    'image',
    'gallery',
    'status',
    '_csrf'
  ]),
  commonRules.name('name', 180),
  body('category').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
  body('sku').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
  body('description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 3000 })),
  body('highlights').optional().isString(),
  body('price').isFloat({ min: 0 }).withMessage('Price must be zero or greater.').toFloat(),
  body('compare_at_price').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Compare-at price must be zero or greater.').toFloat(),
  body('inventory').isInt({ min: 0, max: 1000000 }).withMessage('Inventory must be zero or greater.').toInt(),
  body('image').optional({ values: 'falsy' }).customSanitizer((value) => sanitizeUrl(value)),
  body('gallery').optional().isString()
];

const orderStatusValidation = [
  allowBodyFields(['status', '_csrf']),
  body('status').trim().notEmpty().isLength({ max: 40 }).withMessage('Choose a valid order status.')
];

const checkoutValidation = [
  allowBodyFields([
    'name',
    'address',
    'city',
    'country',
    'postal_code',
    'payment_method',
    'cardholder',
    'reference',
    '_csrf'
  ]),
  commonRules.name('name', 120),
  body('address').customSanitizer((value) => sanitizePlainText(value, { maxLength: 190 })).notEmpty().withMessage('Address is required.'),
  body('city').customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })).notEmpty().withMessage('City is required.'),
  body('country').customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })).notEmpty().withMessage('Country is required.'),
  body('postal_code').customSanitizer((value) => sanitizePlainText(value, { maxLength: 30 })).notEmpty().withMessage('Postal code is required.'),
  body('payment_method').trim().notEmpty().isLength({ max: 40 }).withMessage('Choose a payment method.'),
  body('cardholder').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
  body('reference').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 }))
];

const platformStoreStatusValidation = [
  allowBodyFields(['launch_status', 'operational_status', '_csrf']),
  body('launch_status').optional().trim().isLength({ max: 40 }),
  body('operational_status').optional().trim().isLength({ max: 40 })
];

const supportUpdateValidation = [
  allowBodyFields(['status', 'priority', 'owner', '_csrf']),
  body('status').optional().trim().isLength({ max: 40 }),
  body('priority').optional().trim().isLength({ max: 40 }),
  body('owner').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 }))
];

const supportReplyValidation = [
  allowBodyFields(['body', 'status', 'priority', '_csrf']),
  body('body').trim().notEmpty().withMessage('Reply message is required.').customSanitizer((value) => sanitizePlainText(value, { maxLength: 2000 })),
  body('status').optional().trim().isLength({ max: 40 }),
  body('priority').optional().trim().isLength({ max: 40 })
];

const incidentValidation = [
  allowBodyFields(['status', 'owner', 'note', '_csrf']),
  body('status').optional().trim().isLength({ max: 40 }),
  body('owner').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
  body('note').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 2000 }))
];

const cartMutationValidation = (requiresQuantity = false) => validate([
  allowBodyFields(['productId', 'quantity']),
  body('productId').isString().notEmpty().withMessage('productId is required.'),
  ...(requiresQuantity
    ? [body('quantity').isInt({ min: 0, max: 999 }).withMessage('quantity must be between 0 and 999.').toInt()]
    : [body('quantity').optional().isInt({ min: 1, max: 999 }).withMessage('quantity must be between 1 and 999.').toInt()])
]);

const productIdentifierValidation = param('productId')
  .trim()
  .notEmpty()
  .isLength({ max: 120 })
  .withMessage('productId is required.')
  .customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 }));

const catalogQueryValidation = validate([
  allowQueryFields(['category', 'search', 'sort', 'tag']),
  query('category').optional().customSanitizer((value) => sanitizePlainText(safeDecodeURIComponent(value), { maxLength: 120 })),
  commonRules.querySearch('search'),
  commonRules.queryEnum('sort', catalogSortOptions),
  query('tag').optional().customSanitizer((value) => sanitizePlainText(safeDecodeURIComponent(value), { maxLength: 120 }))
]);

app.post('/preferences/currency', currencyValidation, handleFormValidation((req, res) => {
  return res.redirect('/?error=Update the currency selection and try again.');
}), async (req, res) => {
  const activeStore = resolveStore(req);
  const pricingStore = isStorefrontHost(req) || String(req.body.scope || '').toLowerCase() === 'store'
    ? activeStore
    : null;
  const currencyContext = await buildCurrencyContext(req, pricingStore);
  const requestedCurrency = normalizeCurrencyCode(req.body.code);
  const allowedCurrencies = currencyContext.options.map((entry) => entry.code);
  const safeReturnTo = safeRedirect(req, req.body.returnTo || req.headers.referer || '/', '/', pricingStore);

  if (!requestedCurrency || !allowedCurrencies.includes(requestedCurrency)) {
    let redirectWithError = '/?error=Currency%20is%20not%20available%20for%20this%20storefront';
    try {
      const parsedReturnTo = new URL(safeReturnTo, 'https://local.invalid');
      parsedReturnTo.searchParams.set('error', 'Currency is not available for this storefront');
      redirectWithError = `${parsedReturnTo.pathname}${parsedReturnTo.search}${parsedReturnTo.hash}`;
    } catch {
      // keep fallback redirectWithError
    }

    return res.redirect(redirectWithError);
  }

  setCurrencyPreferenceCookie(req, res, currencyContext.cookieName, requestedCurrency);
  return res.redirect(safeReturnTo);
});

app.get('/', (req, res) => {
  if (isStorefrontHost(req)) {
    const store = resolveStore(req);
    const products = getPublishedProducts(store.id);
    const discovery = getStoreDiscoveryFacets(store.id);

    return renderStorefront(req, res, 'storefront/home', {
      pageTitle: store.name,
      metaDescription: `${store.name} delivers premium essentials with international fulfillment, fast checkout, and service-led support.`,
      products,
      featuredProducts: products.filter((product) => product.featured).slice(0, 4),
      categories: discovery.categories,
      discoveryTags: discovery.tags.slice(0, 8),
      stats: getStoreStats(store.id)
    });
  }

  return renderPlatform(res, 'platform/index', {
    pageTitle: 'Enterprise Commerce For Global Brands',
    metaDescription: 'Aisle Commerce Cloud helps modern retail teams launch, operate, and scale international storefronts from one operating system.',
    metrics: getPlatformMetrics(),
    stores: getPlatformHighlights().slice(0, 3)
  });
});

app.get('/signup', (req, res) => {
  if (isStorefrontHost(req)) {
    return renderCustomerSignup(req, res);
  }

  return renderOwnerSignup(req, res);
});

app.post(
  '/signup',
  authRateLimiter,
  handleMultipartLogo((req, res, errors, status) => renderOwnerSignup(req, res, errors, status)),
  ownerSignupValidation,
  handleFormValidation((req, res, errors) => renderOwnerSignup(req, res, errors, 422)),
  async (req, res, next) => {
    try {
      if (isStorefrontHost(req)) {
        return next();
      }

      const hasStoreSetup = req.body.store_name || req.body.store_subdomain || req.body.store_type;
      let logoUrl = '';

      if (req.file) {
        logoUrl = await saveLogoFile(req.file, 'owner-signup');
      }

      if (hasStoreSetup) {
        const store = createStore({
          name: req.body.store_name || `${String(req.body.name || 'New').trim() || 'New'} Store`,
          subdomain: req.body.store_subdomain,
          ownerId: platformUser.id,
          store_type: req.body.store_type,
          template_key: req.body.template_key,
          theme_color: req.body.theme_color,
          font_preset: req.body.font_preset,
          logo: logoUrl
        });

        return res.redirect(`/dashboard?success=${encodeURIComponent(`${store.name} created successfully`)}`);
      }

      return res.redirect('/dashboard?success=Welcome to Aisle');
    } catch (error) {
      return next(error);
    }
  },
  customerRegisterValidation,
  handleFormValidation((req, res, errors) => renderCustomerSignup(req, res, errors, 422)),
  (req, res) => {
    const store = resolveStore(req);
    const customer = createCustomer(store.id, {
      name: sanitizePlainText(req.body.name, { maxLength: 120 }),
      email: sanitizeEmail(req.body.email)
    });
    setCustomerAuthCookie(req, res, store.id, customer.id);
    const redirectTarget = safeRedirect(req, req.query.returnTo || req.body.returnTo, '/account?success=Account created', store);
    return res.redirect(redirectTarget);
  }
);

app.get('/login', authPageRateLimiter, (req, res) => {
  if (isStorefrontHost(req)) {
    return renderCustomerLogin(req, res);
  }

  return renderOwnerLogin(req, res);
});

app.post('/login', authRateLimiter, ownerLoginValidation, handleFormValidation((req, res, errors) => {
  if (isStorefrontHost(req)) {
    return renderCustomerLogin(req, res, errors, 422);
  }

  return renderOwnerLogin(req, res, errors, 422);
}), (req, res) => {
  if (isStorefrontHost(req)) {
    const store = resolveStore(req);
    const customer = findCustomerByEmail(store.id, req.body.email);

    if (!customer) {
      return res.redirect('/login?error=No customer account was found for this storefront.');
    }

    setCustomerAuthCookie(req, res, store.id, customer.id);
    const redirectTarget = safeRedirect(req, req.query.returnTo || req.body.returnTo, '/account?success=Signed in', store);
    return res.redirect(redirectTarget);
  }

  return res.redirect('/dashboard?success=Welcome back');
});

app.get('/dashboard', (req, res) => {
  return renderPlatform(res, 'platform/dashboard', {
    pageTitle: 'Owner dashboard',
    stores: getOwnerStores(platformUser.id),
    metrics: getPlatformMetrics()
  });
});

app.post(
  '/stores',
  authRateLimiter,
  handleMultipartLogo((req, res, errors, status) => {
    res.status(status);
    return renderPlatform(res, 'platform/dashboard', {
      pageTitle: 'Owner dashboard',
      stores: getOwnerStores(platformUser.id),
      metrics: getPlatformMetrics(),
      errors
    });
  }),
  storeCreationValidation,
  handleFormValidation((req, res, errors) => {
    res.status(422);
    return renderPlatform(res, 'platform/dashboard', {
      pageTitle: 'Owner dashboard',
      stores: getOwnerStores(platformUser.id),
      metrics: getPlatformMetrics(),
      errors
    });
  }),
  async (req, res, next) => {
    try {
      const logoUrl = req.file ? await saveLogoFile(req.file, req.body.subdomain || 'store') : '';
      const store = createStore({
        name: req.body.name,
        subdomain: req.body.subdomain,
        ownerId: platformUser.id,
        store_type: req.body.store_type,
        template_key: req.body.template_key,
        theme_color: req.body.theme_color,
        font_preset: req.body.font_preset,
        logo: logoUrl
      });

      return res.redirect(`/dashboard?success=${encodeURIComponent(`${store.name} created successfully`)}`);
    } catch (error) {
      return next(error);
    }
  }
);

app.get('/stores/:id/manage', (req, res) => {
  const store = getStoreById(req.params.id);
  if (!store) {
    return res.redirect('/dashboard?error=Store not found');
  }

  return res.redirect(safeRedirect(req, buildStoreAdminUrl(store), '/dashboard?error=Store not found', store, {
    preferRelative: false
  }));
});

app.get('/stores/:id/preview', (req, res) => {
  const store = getStoreById(req.params.id);
  if (!store) {
    return res.redirect('/dashboard?error=Store not found');
  }

  return res.redirect(safeRedirect(req, buildStorefrontUrl(store), '/dashboard?error=Store not found', store, {
    preferRelative: false
  }));
});

app.get('/platform-admin', (req, res) => {
  return renderPlatformAdmin(res, 'platform/admin-dashboard', {
    pageTitle: 'Platform control center',
    metrics: getPlatformMetrics(),
    stores: getPlatformHighlights(),
    supportQueue: getSupportConversations().slice(0, 4),
    incidents: getIncidents().slice(0, 4)
  });
});

app.get('/platform-admin/stores', (req, res) => {
  return renderPlatformAdmin(res, 'platform/admin-stores', {
    pageTitle: 'Tenant directory',
    stores: getPlatformHighlights()
  });
});

app.post('/platform-admin/stores/:id/status', platformStoreStatusValidation, handleFormValidation((req, res) => {
  return res.redirect('/platform-admin/stores?error=Review the status fields and try again.');
}), (req, res) => {
  const store = getStoreById(req.params.id);
  if (!store) {
    return res.redirect('/platform-admin/stores?error=Store not found');
  }

  if (req.body.launch_status) {
    store.launch_status = sanitizePlainText(req.body.launch_status, { maxLength: 40 }).toLowerCase();
  }

  if (req.body.operational_status) {
    store.operational_status = sanitizePlainText(req.body.operational_status, { maxLength: 40 }).toLowerCase();
  }

  return res.redirect('/platform-admin/stores?success=Tenant status updated');
});

app.get('/platform-admin/support', (req, res) => {
  return renderPlatformAdmin(res, 'platform/admin-support', {
    pageTitle: 'Support operations',
    conversations: getSupportConversations()
  });
});

app.post('/platform-admin/support/:id/update', supportUpdateValidation, handleFormValidation((req, res) => {
  return res.redirect('/platform-admin/support?error=Review the support update fields and try again.');
}), (req, res) => {
  const conversation = updateSupportConversation(req.params.id, {
    status: req.body.status,
    priority: req.body.priority,
    owner: req.body.owner
  });

  if (!conversation) {
    return res.redirect('/platform-admin/support?error=Conversation not found');
  }

  return res.redirect('/platform-admin/support?success=Support conversation updated');
});

app.post('/platform-admin/support/:id/reply', supportReplyValidation, handleFormValidation((req, res) => {
  return res.redirect('/platform-admin/support?error=Reply text is required.');
}), (req, res) => {
  const conversation = replyToSupportConversation(req.params.id, {
    body: req.body.body,
    status: req.body.status,
    priority: req.body.priority,
    author: systemAdminUser.name,
    role: 'support'
  });

  if (!conversation) {
    return res.redirect('/platform-admin/support?error=Conversation not found');
  }

  return res.redirect('/platform-admin/support?success=Support reply sent');
});

app.get('/platform-admin/incidents', (req, res) => {
  return renderPlatformAdmin(res, 'platform/admin-incidents', {
    pageTitle: 'Incident center',
    incidents: getIncidents()
  });
});

app.post('/platform-admin/incidents/:id', incidentValidation, handleFormValidation((req, res) => {
  return res.redirect('/platform-admin/incidents?error=Review the incident update and try again.');
}), (req, res) => {
  const incident = updateIncident(req.params.id, {
    status: req.body.status,
    owner: req.body.owner,
    note: req.body.note,
    author: systemAdminUser.name
  });

  if (!incident) {
    return res.redirect('/platform-admin/incidents?error=Incident not found');
  }

  return res.redirect('/platform-admin/incidents?success=Incident updated');
});

app.get('/admin', (req, res) => {
  const store = resolveStore(req);
  const products = getStoreProducts(store.id);
  const orders = getStoreOrders(store.id);

  return renderStoreAdmin(req, res, 'admin/dashboard', {
    pageTitle: 'Store admin',
    products,
    orders,
    recentOrders: orders.slice(0, 5),
    stats: getStoreStats(store.id),
    supportQueue: getSupportConversations({ storeId: store.id }).slice(0, 4),
    customers: getStoreCustomers(store.id).slice(0, 5)
  });
});

app.get('/admin/products', (req, res) => {
  const store = resolveStore(req);
  return renderStoreAdmin(req, res, 'admin/products', {
    pageTitle: 'Products',
    products: getStoreProducts(store.id)
  });
});

app.get('/admin/products/new', (req, res) => renderProductForm(req, res, null));

app.get('/admin/products/:id/edit', (req, res) => {
  const store = resolveStore(req);
  return renderProductForm(req, res, getProductById(store.id, req.params.id) || null);
});

app.post('/admin/products', productValidation, handleFormValidation((req, res, errors) => renderProductForm(req, res, null, errors, 422)), (req, res) => {
  const store = resolveStore(req);
  createProduct(store.id, {
    ...req.body,
    featured: parseCheckbox(req.body.featured),
    status: parseCheckbox(req.body.status)
  });
  return res.redirect('/admin/products?success=Product created');
});

app.post('/admin/products/:id', productValidation, handleFormValidation((req, res, errors) => {
  const store = resolveStore(req);
  return renderProductForm(req, res, getProductById(store.id, req.params.id) || null, errors, 422);
}), (req, res) => {
  const store = resolveStore(req);
  const product = updateProduct(store.id, req.params.id, {
    ...req.body,
    featured: parseCheckbox(req.body.featured),
    status: parseCheckbox(req.body.status)
  });

  if (!product) {
    return res.redirect('/admin/products?error=Product not found');
  }

  return res.redirect('/admin/products?success=Product updated');
});

app.post('/admin/products/:id/delete', validate([
  allowBodyFields(['_csrf']),
  param('id')
    .trim()
    .notEmpty()
    .isLength({ max: 120 })
    .withMessage('id is required.')
    .customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 }))
]), (req, res) => {
  const store = resolveStore(req);
  const removed = deleteProduct(store.id, req.params.id);

  if (!removed) {
    return res.redirect('/admin/products?error=Product not found');
  }

  return res.redirect('/admin/products?success=Product deleted');
});

app.get('/admin/orders', (req, res) => {
  const store = resolveStore(req);
  return renderStoreAdmin(req, res, 'admin/orders', {
    pageTitle: 'Orders',
    orders: getStoreOrders(store.id)
  });
});

app.get('/admin/orders/:id', (req, res) => {
  const store = resolveStore(req);
  const order = getOrderById(store.id, req.params.id);

  return renderStoreAdmin(req, res, 'admin/order-detail', {
    pageTitle: order ? `Order #${order.id}` : 'Order detail',
    order: order || null
  });
});

app.post('/admin/orders/:id/status', orderStatusValidation, handleFormValidation((req, res) => {
  return res.redirect('/admin/orders?error=Choose a valid order status.');
}), (req, res) => {
  const store = resolveStore(req);
  const order = updateOrderStatus(store.id, req.params.id, req.body.status);

  if (!order) {
    return res.redirect('/admin/orders?error=Order not found');
  }

  return res.redirect(`/admin/orders/${order.id}?success=Order status updated`);
});

app.get('/admin/settings', (req, res) => renderSettingsPage(req, res));

app.post(
  '/admin/settings',
  handleMultipartLogo((req, res, errors, status) => renderSettingsPage(req, res, errors, status)),
  storeSettingsValidation,
  handleFormValidation((req, res, errors) => renderSettingsPage(req, res, errors, 422)),
  async (req, res, next) => {
    try {
      const store = resolveStore(req);
      const logoUrl = req.file ? await saveLogoFile(req.file, store.id) : undefined;
      updateStoreSettings(store.id, {
        ...req.body,
        template_key: req.body.template_key || req.body.template_picker,
        logo: logoUrl || undefined
      });
      return res.redirect('/admin/settings?success=Store settings updated');
    } catch (error) {
      return next(error);
    }
  }
);

app.get('/admin/domain', (req, res) => renderDomainPage(req, res));

app.post('/admin/domain', domainValidation, handleFormValidation((req, res, errors) => renderDomainPage(req, res, errors, 422)), (req, res) => {
  const store = resolveStore(req);
  updateStoreDomain(store.id, normalizeHostname(req.body.custom_domain || '') || '');
  return res.redirect('/admin/domain?success=Domain settings saved');
});

app.get('/products', catalogQueryValidation, (req, res) => {
  const store = resolveStore(req);
  const category = req.query.category || 'All';
  const search = req.query.search || '';
  const sort = req.query.sort || 'featured';
  const tag = req.query.tag || '';
  const products = getStoreProducts(store.id, {
    publishedOnly: true,
    category,
    search,
    sort,
    tag
  });
  const discovery = getStoreDiscoveryFacets(store.id);

  return renderStorefront(req, res, 'storefront/products', {
    pageTitle: 'Products',
    products,
    categories: discovery.categories,
    discoveryTags: discovery.tags.slice(0, 10),
    activeCategory: category,
    activeTag: tag,
    searchQuery: search,
    activeSort: sort
  });
});

app.get('/products/:slug', (req, res) => {
  const store = resolveStore(req);
  const product = getProductBySlug(store.id, sanitizeSlug(req.params.slug));

  if (!product) {
    return res.redirect('/products?error=Product not found');
  }

  const relatedProducts = getPublishedProducts(store.id)
    .filter((entry) => entry.id !== product.id && entry.category === product.category)
    .slice(0, 3);

  persistRecentlyViewed(req, res, store.id, product.id);

  return renderStorefront(req, res, 'storefront/product', {
    pageTitle: product.name,
    product,
    relatedProducts,
    recentlyViewedProducts: getRecentlyViewedProducts(req, store.id, {
      excludeId: product.id,
      limit: 4
    })
  });
});

app.get('/wishlist', (req, res) => {
  return renderStorefront(req, res, 'storefront/wishlist', {
    pageTitle: 'Wishlist'
  });
});

app.get('/cart', (req, res) => {
  return renderStorefront(req, res, 'storefront/cart', {
    pageTitle: 'Cart'
  });
});

app.get('/register', (req, res) => renderCustomerSignup(req, res));

app.post('/register', authRateLimiter, customerRegisterValidation, handleFormValidation((req, res, errors) => renderCustomerSignup(req, res, errors, 422)), (req, res) => {
  const store = resolveStore(req);
  const customer = createCustomer(store.id, {
    name: sanitizePlainText(req.body.name, { maxLength: 120 }),
    email: sanitizeEmail(req.body.email)
  });
  setCustomerAuthCookie(req, res, store.id, customer.id);
  const redirectTarget = safeRedirect(req, req.query.returnTo || req.body.returnTo, '/account?success=Account created', store);
  return res.redirect(redirectTarget);
});

app.get('/account', (req, res) => {
  const store = resolveStore(req);
  const customer = getCurrentCustomer(req, store.id);

  if (!customer) {
    return res.redirect('/login?returnTo=/account');
  }

  return renderStorefront(req, res, 'storefront/account', {
    pageTitle: 'My account',
    customerOrders: getCustomerOrders(store.id, customer)
  });
});

app.get('/orders', (req, res) => {
  const store = resolveStore(req);
  const customer = getCurrentCustomer(req, store.id);

  if (!customer) {
    return res.redirect('/login?returnTo=/orders');
  }

  return renderStorefront(req, res, 'storefront/orders', {
    pageTitle: 'My orders',
    customerOrders: getCustomerOrders(store.id, customer)
  });
});

app.post('/orders/:id/reorder', validate([
  allowBodyFields(['_csrf']),
  param('id')
    .trim()
    .notEmpty()
    .isLength({ max: 40 })
    .withMessage('order id is required.')
    .customSanitizer((value) => sanitizePlainText(value, { maxLength: 40 }))
]), (req, res) => {
  const store = resolveStore(req);
  const customer = getCurrentCustomer(req, store.id);

  if (!customer) {
    return res.redirect('/login?returnTo=/orders');
  }

  const order = getOrderById(store.id, req.params.id);
  if (!order || String(order.customer?.email || '').toLowerCase() !== String(customer.email || '').toLowerCase()) {
    return res.redirect('/orders?error=Order not found');
  }

  const cart = addOrderToCart(store.id, order.id);
  if (!cart) {
    return res.redirect('/orders?error=Unable to add these items back to your cart');
  }

  return res.redirect('/cart?success=Items added back to your cart');
});

app.get('/checkout', (req, res) => {
  const store = resolveStore(req);
  const customer = getCurrentCustomer(req, store.id);
  const cart = getCart(store.id);

  if (!customer) {
    return res.redirect('/login?returnTo=/checkout');
  }

  if (!cart.items.length) {
    return res.redirect('/cart?error=Your cart is empty');
  }

  return renderCheckoutPage(req, res);
});

app.post('/checkout', checkoutValidation, handleFormValidation((req, res, errors) => renderCheckoutPage(req, res, errors, 422)), (req, res) => {
  const store = resolveStore(req);
  const customer = getCurrentCustomer(req, store.id);

  if (!customer) {
    return res.redirect('/login?returnTo=/checkout');
  }

  const order = createOrder(store.id, customer, req.body);
  if (!order) {
    return res.redirect('/cart?error=Your cart is empty');
  }

  setOrderTrackingCookie(req, res, store.id, order.id);
  return res.redirect(`/order-confirmation?order=${order.id}&success=Order placed`);
});

app.get('/order-confirmation', (req, res) => {
  const store = resolveStore(req);
  const orderId = req.query.order || readSignedCookie(req, orderCookieName(store.id));
  const order = orderId ? getOrderById(store.id, orderId) : null;

  if (!order) {
    return res.redirect('/products');
  }

  return renderStorefront(req, res, 'storefront/order-confirmation', {
    pageTitle: 'Order confirmation',
    order
  });
});

app.post('/cart/add', cartMutationValidation(false), (req, res) => {
  const store = resolveStore(req);
  const cart = addCartItem(store.id, req.body.productId, req.body.quantity);

  if (!cart) {
    throw createHttpError(404, 'Product not found.', null, { expose: true });
  }

  return res.json({ cart });
});

app.patch('/cart/update', cartMutationValidation(true), (req, res) => {
  const store = resolveStore(req);
  const cart = updateCartItemQuantity(store.id, req.body.productId, req.body.quantity);

  if (!cart) {
    throw createHttpError(404, 'Cart item not found.', null, { expose: true });
  }

  return res.json({ cart });
});

app.delete('/cart/remove', validate([
  allowBodyFields(['productId']),
  body('productId').isString().notEmpty().withMessage('productId is required.')
]), (req, res) => {
  const store = resolveStore(req);
  return res.json({ cart: removeCartItem(store.id, req.body.productId) });
});

app.post('/cart/clear', validate([
  allowBodyFields(['_csrf'])
]), (req, res) => {
  const store = resolveStore(req);
  return res.json({ cart: clearCart(store.id) });
});

app.get('/wishlist/items', (req, res) => {
  const store = resolveStore(req);
  const ids = getWishlistProductIds(req, store.id);
  const products = getPublishedProducts(store.id).filter((product) => ids.includes(String(product.id)));
  return res.json({ items: products, count: ids.length });
});

app.post('/wishlist/items', validate([
  allowBodyFields(['productId']),
  body('productId').isString().notEmpty().withMessage('productId is required.')
]), (req, res) => {
  const store = resolveStore(req);
  const product = getProductById(store.id, req.body.productId);
  if (!product) {
    throw createHttpError(404, 'Product not found.', null, { expose: true });
  }

  const existingIds = getWishlistProductIds(req, store.id);
  const nextIds = existingIds.includes(String(product.id))
    ? existingIds
    : [...existingIds, String(product.id)];
  persistWishlist(req, res, store.id, nextIds);

  return res.status(201).json({
    wishlist: nextIds,
    count: nextIds.length
  });
});

app.delete('/wishlist/items/:productId', validate([
  productIdentifierValidation
]), (req, res) => {
  const store = resolveStore(req);
  const nextIds = getWishlistProductIds(req, store.id).filter((entry) => entry !== String(req.params.productId));
  persistWishlist(req, res, store.id, nextIds);
  return res.json({
    wishlist: nextIds,
    count: nextIds.length
  });
});

app.post('/logout', validate([
  allowBodyFields(['_csrf'])
]), (req, res) => {
  const store = resolveStore(req);

  if (store) {
    clearSignedCookie(req, res, customerCookieName(store.id));
    clearSignedCookie(req, res, orderCookieName(store.id));
  }

  if (isPlatformRequestHost(req.hostname)) {
    clearSignedCookie(req, res, 'activeStoreId');
  }

  return res.redirect('/?success=Signed out');
});

app.get('/error', (req, res) => {
  const requestedStatus = Number(req.query.status || 500);
  const supportedStatus = supportedErrorPageStatuses.has(requestedStatus) ? requestedStatus : 500;
  return renderErrorPage(req, res, supportedStatus);
});

app.use((req, res) => {
  return renderErrorPage(req, res, 404);
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error === invalidCsrfTokenError || error.code === 'EBADCSRFTOKEN') {
    const message = 'Your session token expired. Please refresh the page and try again.';
    if (wantsJson(req)) {
      return res.status(403).json({ error: message });
    }

    return renderErrorPage(req, res, 403, createHttpError(403, message, null, { expose: true }), {
      primaryAction: {
        href: safeRedirect(req, req.headers.referer || '/', '/'),
        label: 'Refresh and retry'
      },
      secondaryAction: {
        href: resolveErrorHomeHref(req),
        label: 'Return home'
      }
    });
  }

  if (wantsJson(req)) {
    const status = Number(error.status || 500);
    return res.status(status).json({
      error: status >= 500 && env.isProduction
        ? 'An unexpected error occurred.'
        : (error.message || 'Request failed.'),
      details: error.details || undefined
    });
  }

  logger.error('web_request_failed', {
    requestId: req.requestId,
    path: req.originalUrl,
    error
  });

  return renderErrorPage(req, res, Number(error.status || 500), error);
});

app.listen(PORT, () => {
  logger.info('Aisle Commerce Cloud listening', {
    port: PORT,
    rootDomain: ROOT_DOMAIN
  });
});
