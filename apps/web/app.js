const path = require('path');
const env = require('./src/lib/load-env');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
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
  getStoreCustomers,
  getCustomerById,
  findCustomerByEmail,
  getStoreProducts,
  getPublishedProducts,
  getStoreCategories,
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
  createStore,
  updateStoreSettings,
  updateStoreDomain,
  createProduct,
  updateProduct,
  deleteProduct,
  createCustomer,
  createOrder,
  updateOrderStatus,
  replyToSupportConversation,
  updateSupportConversation,
  updateIncident
} = require('./src/lib/state');

const app = express();
const PORT = env.port;
const ROOT_DOMAIN = env.rootDomain;

app.set('trust proxy', true);

const parseCookies = (header = '') => {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, pair) => {
      const [key, ...valueParts] = pair.split('=');
      if (!key) {
        return accumulator;
      }

      accumulator[key] = decodeURIComponent(valueParts.join('=') || '');
      return accumulator;
    }, {});
};

const isLocalRoot = ROOT_DOMAIN === 'localhost' || ROOT_DOMAIN === '127.0.0.1';

const isPlatformHost = (hostname) => {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === ROOT_DOMAIN
    || hostname === `www.${ROOT_DOMAIN}`;
};

const isStorefrontHost = (req) => {
  return !isPlatformHost(req.hostname);
};

const isStoreScopedPath = (pathname = '') => {
  return pathname === '/register'
    || pathname === '/products'
    || pathname.startsWith('/products/')
    || pathname === '/cart'
    || pathname === '/account'
    || pathname === '/orders'
    || pathname === '/checkout'
    || pathname === '/order-confirmation'
    || pathname.startsWith('/cart/');
};

const getDefaultStore = () => {
  return getOwnerStores(platformUser.id)[0] || getAllStores()[0] || null;
};

const resolveStore = (req) => {
  if (isStorefrontHost(req)) {
    return getStoreByHost(req.hostname) || getDefaultStore();
  }

  return getStoreById(req.query.store || req.cookies.activeStoreId) || getDefaultStore();
};

const buildStorefrontUrl = (store) => {
  if (!store) {
    return '#';
  }

  if (isLocalRoot) {
    return `http://${store.subdomain}.localhost:${PORT}`;
  }

  if (store.custom_domain) {
    return `https://${store.custom_domain}`;
  }

  return `https://${store.subdomain}.${ROOT_DOMAIN}`;
};

const buildStoreAdminUrl = (store) => {
  if (!store) {
    return '#';
  }

  if (isLocalRoot) {
    return `http://localhost:${PORT}/admin?store=${encodeURIComponent(store.id)}`;
  }

  return `${buildStorefrontUrl(store)}/admin`;
};

const customerCookieName = (storeId) => `customer_${storeId}`;
const orderCookieName = (storeId) => `last_order_${storeId}`;

const getCurrentCustomer = (req, storeId) => {
  if (!storeId || req.query.guest === '1') {
    return null;
  }

  const customerId = req.cookies[customerCookieName(storeId)];
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

  return res.render(view, {
    layout: 'layouts/store',
    store,
    storeTheme,
    customer,
    cart,
    ...payload
  });
};

const renderStoreAdmin = (req, res, view, payload = {}) => {
  const store = resolveStore(req);
  const storeTheme = getStoreTheme(store);

  return res.render(view, {
    layout: 'layouts/admin',
    store,
    storeTheme,
    ...payload
  });
};

const renderPlatformAdmin = (res, view, payload = {}) => {
  return res.render(view, {
    layout: 'layouts/platform-admin',
    ...payload
  });
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});

app.use((req, res, next) => {
  if (req.query.store && getStoreById(req.query.store)) {
    res.cookie('activeStoreId', req.query.store, { sameSite: 'lax' });
    req.cookies.activeStoreId = req.query.store;
  }

  next();
});

app.use(async (req, res, next) => {
  const activeStore = resolveStore(req);
  const pricingStore = isStorefrontHost(req) || req.path.startsWith('/admin') || isStoreScopedPath(req.path)
    ? activeStore
    : null;
  const currencyContext = await buildCurrencyContext(req, pricingStore);

  if (currencyContext.shouldPersistSelection) {
    res.cookie(currencyContext.cookieName, currencyContext.selectedCurrency, {
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30
    });
    req.cookies[currencyContext.cookieName] = currencyContext.selectedCurrency;
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
  next();
});

app.post('/preferences/currency', async (req, res) => {
  const activeStore = resolveStore(req);
  const pricingStore = isStorefrontHost(req) || String(req.body.scope || '').toLowerCase() === 'store'
    ? activeStore
    : null;
  const currencyContext = await buildCurrencyContext(req, pricingStore);
  const requestedCurrency = normalizeCurrencyCode(req.body.code);
  const allowedCurrencies = currencyContext.options.map((entry) => entry.code);
  const returnTo = String(req.body.returnTo || req.headers.referer || '/').trim();
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? returnTo
    : '/';

  if (!requestedCurrency || !allowedCurrencies.includes(requestedCurrency)) {
    return res.redirect(`${safeReturnTo}${safeReturnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('Currency is not available for this storefront')}`);
  }

  res.cookie(currencyContext.cookieName, requestedCurrency, {
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  });

  if (pricingStore) {
    req.cookies[currencyContext.cookieName] = requestedCurrency;
  }

  return res.redirect(safeReturnTo);
});

app.get('/', (req, res) => {
  if (isStorefrontHost(req)) {
    const store = resolveStore(req);
    const products = getPublishedProducts(store.id);

    return renderStorefront(req, res, 'storefront/home', {
      pageTitle: store.name,
      metaDescription: `${store.name} delivers premium essentials with international fulfillment, fast checkout, and service-led support.`,
      products,
      featuredProducts: products.slice(0, 4),
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
    return renderStorefront(req, res, 'storefront/register', {
      pageTitle: 'Create account',
      errors: {},
      formData: {}
    });
  }

  return renderPlatform(res, 'platform/signup', {
    pageTitle: 'Create owner account',
    errors: {},
    formData: {}
  });
});

app.post('/signup', (req, res) => {
  if (isStorefrontHost(req)) {
    const store = resolveStore(req);
    const customer = createCustomer(store.id, req.body);
    res.cookie(customerCookieName(store.id), customer.id, { sameSite: 'lax' });
    return res.redirect(req.query.returnTo || '/account?success=Account created');
  }

  const hasStoreSetup = req.body.store_name || req.body.store_subdomain || req.body.store_type;

  if (hasStoreSetup) {
    const store = createStore({
      name: req.body.store_name || `${String(req.body.name || 'New').trim() || 'New'} Store`,
      subdomain: req.body.store_subdomain,
      ownerId: platformUser.id,
      store_type: req.body.store_type,
      template_key: req.body.template_key,
      theme_color: req.body.theme_color,
      font_preset: req.body.font_preset
    });

    return res.redirect(`/dashboard?success=${encodeURIComponent(`${store.name} created successfully`)}`);
  }

  return res.redirect('/dashboard?success=Welcome to Aisle');
});

app.get('/login', (req, res) => {
  if (isStorefrontHost(req)) {
    return renderStorefront(req, res, 'storefront/login', {
      pageTitle: 'Sign in',
      errors: {},
      formData: {}
    });
  }

  return renderPlatform(res, 'platform/login', {
    pageTitle: 'Sign in',
    errors: {},
    formData: {}
  });
});

app.post('/login', (req, res) => {
  if (isStorefrontHost(req)) {
    const store = resolveStore(req);
    const customer = findCustomerByEmail(store.id, req.body.email);

    if (!customer) {
      return res.redirect('/login?error=No customer account was found for this storefront.');
    }

    res.cookie(customerCookieName(store.id), customer.id, { sameSite: 'lax' });
    return res.redirect(req.query.returnTo || '/account?success=Signed in');
  }

  return res.redirect('/dashboard?success=Welcome back');
});

app.get('/dashboard', (req, res) => {
  const stores = getOwnerStores(platformUser.id);

  return renderPlatform(res, 'platform/dashboard', {
    pageTitle: 'Owner dashboard',
    stores,
    metrics: getPlatformMetrics()
  });
});

app.post('/stores', (req, res) => {
  const store = createStore({
    name: req.body.name,
    subdomain: req.body.subdomain,
    ownerId: platformUser.id,
    store_type: req.body.store_type,
    template_key: req.body.template_key,
    theme_color: req.body.theme_color,
    font_preset: req.body.font_preset
  });

  return res.redirect(`/dashboard?success=${encodeURIComponent(`${store.name} created successfully`)}`);
});

app.get('/stores/:id/manage', (req, res) => {
  const store = getStoreById(req.params.id);
  if (!store) {
    return res.redirect('/dashboard?error=Store not found');
  }

  return res.redirect(buildStoreAdminUrl(store));
});

app.get('/stores/:id/preview', (req, res) => {
  const store = getStoreById(req.params.id);
  if (!store) {
    return res.redirect('/dashboard?error=Store not found');
  }

  return res.redirect(buildStorefrontUrl(store));
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

app.post('/platform-admin/stores/:id/status', (req, res) => {
  const store = getStoreById(req.params.id);
  if (!store) {
    return res.redirect('/platform-admin/stores?error=Store not found');
  }

  if (req.body.launch_status) {
    store.launch_status = String(req.body.launch_status).toLowerCase();
  }

  if (req.body.operational_status) {
    store.operational_status = String(req.body.operational_status).toLowerCase();
  }

  return res.redirect('/platform-admin/stores?success=Tenant status updated');
});

app.get('/platform-admin/support', (req, res) => {
  return renderPlatformAdmin(res, 'platform/admin-support', {
    pageTitle: 'Support operations',
    conversations: getSupportConversations()
  });
});

app.post('/platform-admin/support/:id/update', (req, res) => {
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

app.post('/platform-admin/support/:id/reply', (req, res) => {
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

app.post('/platform-admin/incidents/:id', (req, res) => {
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
    supportQueue: getSupportConversations({ storeId: store.id }).slice(0, 4)
  });
});

app.get('/admin/products', (req, res) => {
  const store = resolveStore(req);

  return renderStoreAdmin(req, res, 'admin/products', {
    pageTitle: 'Products',
    products: getStoreProducts(store.id)
  });
});

app.get('/admin/products/new', (req, res) => {
  return renderStoreAdmin(req, res, 'admin/product-form', {
    pageTitle: 'Add product',
    product: null,
    errors: {}
  });
});

app.get('/admin/products/:id/edit', (req, res) => {
  const store = resolveStore(req);
  const product = getProductById(store.id, req.params.id);

  return renderStoreAdmin(req, res, 'admin/product-form', {
    pageTitle: 'Edit product',
    product: product || null,
    errors: {}
  });
});

app.post('/admin/products', (req, res) => {
  const store = resolveStore(req);
  createProduct(store.id, req.body);
  return res.redirect('/admin/products?success=Product created');
});

app.post('/admin/products/:id', (req, res) => {
  const store = resolveStore(req);
  const product = updateProduct(store.id, req.params.id, req.body);

  if (!product) {
    return res.redirect('/admin/products?error=Product not found');
  }

  return res.redirect('/admin/products?success=Product updated');
});

app.post('/admin/products/:id/delete', (req, res) => {
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

app.post('/admin/orders/:id/status', (req, res) => {
  const store = resolveStore(req);
  const order = updateOrderStatus(store.id, req.params.id, req.body.status);

  if (!order) {
    return res.redirect('/admin/orders?error=Order not found');
  }

  return res.redirect(`/admin/orders/${order.id}?success=Order status updated`);
});

app.get('/admin/settings', (req, res) => {
  return renderStoreAdmin(req, res, 'admin/settings', {
    pageTitle: 'Store settings',
    errors: {}
  });
});

app.post('/admin/settings', (req, res) => {
  const store = resolveStore(req);
  updateStoreSettings(store.id, req.body);
  return res.redirect('/admin/settings?success=Store settings updated');
});

app.get('/admin/domain', (req, res) => {
  return renderStoreAdmin(req, res, 'admin/domain', {
    pageTitle: 'Domain setup',
    errors: {}
  });
});

app.post('/admin/domain', (req, res) => {
  const store = resolveStore(req);
  updateStoreDomain(store.id, req.body.custom_domain);
  return res.redirect('/admin/domain?success=Domain settings saved');
});

app.get('/products', (req, res) => {
  const store = resolveStore(req);
  const category = req.query.category ? decodeURIComponent(req.query.category) : 'All';
  const products = getStoreProducts(store.id, {
    publishedOnly: true,
    category
  });

  return renderStorefront(req, res, 'storefront/products', {
    pageTitle: 'Products',
    products,
    categories: getStoreCategories(store.id),
    activeCategory: category
  });
});

app.get('/products/:slug', (req, res) => {
  const store = resolveStore(req);
  const product = getProductBySlug(store.id, req.params.slug);

  if (!product) {
    return res.redirect('/products?error=Product not found');
  }

  const relatedProducts = getPublishedProducts(store.id)
    .filter((entry) => entry.id !== product.id && entry.category === product.category)
    .slice(0, 3);

  return renderStorefront(req, res, 'storefront/product', {
    pageTitle: product.name,
    product,
    relatedProducts
  });
});

app.get('/cart', (req, res) => {
  return renderStorefront(req, res, 'storefront/cart', {
    pageTitle: 'Cart'
  });
});

app.get('/register', (req, res) => {
  return renderStorefront(req, res, 'storefront/register', {
    pageTitle: 'Create account',
    errors: {},
    formData: {}
  });
});

app.post('/register', (req, res) => {
  const store = resolveStore(req);
  const customer = createCustomer(store.id, req.body);
  res.cookie(customerCookieName(store.id), customer.id, { sameSite: 'lax' });
  return res.redirect(req.query.returnTo || '/account?success=Account created');
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

  return renderStorefront(req, res, 'storefront/checkout', {
    pageTitle: 'Checkout',
    errors: {}
  });
});

app.post('/checkout', (req, res) => {
  const store = resolveStore(req);
  const customer = getCurrentCustomer(req, store.id);

  if (!customer) {
    return res.redirect('/login?returnTo=/checkout');
  }

  const order = createOrder(store.id, customer, req.body);
  if (!order) {
    return res.redirect('/cart?error=Your cart is empty');
  }

  res.cookie(orderCookieName(store.id), order.id, { sameSite: 'lax' });
  return res.redirect(`/order-confirmation?order=${order.id}&success=Order placed`);
});

app.get('/order-confirmation', (req, res) => {
  const store = resolveStore(req);
  const orderId = req.query.order || req.cookies[orderCookieName(store.id)];
  const order = orderId ? getOrderById(store.id, orderId) : null;

  if (!order) {
    return res.redirect('/products');
  }

  return renderStorefront(req, res, 'storefront/order-confirmation', {
    pageTitle: 'Order confirmation',
    order
  });
});

app.post('/cart/add', (req, res) => {
  const store = resolveStore(req);
  const cart = addCartItem(store.id, req.body.productId, req.body.quantity);

  if (!cart) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  return res.json({ cart });
});

app.patch('/cart/update', (req, res) => {
  const store = resolveStore(req);
  const cart = updateCartItemQuantity(store.id, req.body.productId, req.body.quantity);

  if (!cart) {
    return res.status(404).json({ error: 'Cart item not found.' });
  }

  return res.json({ cart });
});

app.delete('/cart/remove', (req, res) => {
  const store = resolveStore(req);
  const cart = removeCartItem(store.id, req.body.productId);
  return res.json({ cart });
});

app.get('/logout', (req, res) => {
  const store = resolveStore(req);

  if (store) {
    res.clearCookie(customerCookieName(store.id));
    res.clearCookie(orderCookieName(store.id));
  }

  if (isPlatformHost(req.hostname)) {
    res.clearCookie('activeStoreId');
  }

  return res.redirect('/?success=Signed out');
});

app.get('/error', (req, res) => {
  res.status(500).render('errors/500', {
    layout: 'layouts/main',
    pageTitle: 'Server error'
  });
});

app.use((req, res) => {
  const store = resolveStore(req);

  res.status(404).render('errors/404', {
    layout: isStorefrontHost(req) ? 'layouts/store' : 'layouts/main',
    pageTitle: 'Not found',
    store,
    customer: getCurrentCustomer(req, store?.id),
    cart: store ? getCart(store.id) : { items: [], total: 0 }
  });
});

app.listen(PORT, () => {
  console.log(`Aisle Commerce Cloud running on http://localhost:${PORT}`);
});
