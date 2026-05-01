const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DOMAIN = process.env.APP_ROOT_DOMAIN || 'localhost';

const samplePlatformUser = {
  id: 'owner_1',
  name: 'Ada Lovelace',
  email: 'ada@multistore.test'
};

const sampleStore = {
  id: 'store_1',
  name: 'Northline Studio',
  subdomain: 'northline',
  custom_domain: 'shop.northlinestudio.com',
  logo: 'https://placehold.co/120x120?text=NS',
  theme_color: '#0F766E',
  ssl_status: 'issued',
  tagline: 'Utility-first essentials for modern daily routines.'
};

const sampleCustomer = {
  id: 'customer_1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  address: '17 Marina Road, Victoria Island'
};

const sampleProducts = [
  {
    id: 'prod_1',
    name: 'Luna Tote',
    slug: 'luna-tote',
    price: 89,
    compare_at_price: 110,
    image: 'https://placehold.co/800x800?text=Luna+Tote',
    images: [
      'https://placehold.co/1000x1000?text=Luna+Tote',
      'https://placehold.co/1000x1000?text=Interior',
      'https://placehold.co/1000x1000?text=Strap+Detail'
    ],
    description: 'A lightweight tote built for everyday carry, with durable straps and a clean silhouette.',
    inventory: 36,
    sku: 'LUNA-001',
    status: 'Published'
  },
  {
    id: 'prod_2',
    name: 'Harbor Bottle',
    slug: 'harbor-bottle',
    price: 34,
    compare_at_price: null,
    image: 'https://placehold.co/800x800?text=Harbor+Bottle',
    description: 'Double-walled stainless steel bottle with a minimal matte finish.',
    inventory: 92,
    sku: 'HB-034',
    status: 'Published'
  },
  {
    id: 'prod_3',
    name: 'Transit Pouch',
    slug: 'transit-pouch',
    price: 28,
    compare_at_price: 36,
    image: 'https://placehold.co/800x800?text=Transit+Pouch',
    description: 'Compact organizer pouch for cables, tech, and travel essentials.',
    inventory: 58,
    sku: 'TP-028',
    status: 'Draft'
  },
  {
    id: 'prod_4',
    name: 'Daybreak Journal',
    slug: 'daybreak-journal',
    price: 22,
    compare_at_price: null,
    image: 'https://placehold.co/800x800?text=Daybreak+Journal',
    description: 'Thread-bound journal with premium paper for notes, planning, and sketching.',
    inventory: 104,
    sku: 'DJ-022',
    status: 'Published'
  }
];

const sampleOrders = [
  {
    id: '1001',
    status: 'Pending',
    total: 123,
    created_at: new Date().toISOString(),
    customer_name: 'Jane Doe',
    customer: sampleCustomer,
    items: [
      { product_id: 'prod_1', name: 'Luna Tote', price: 89, quantity: 1, image: sampleProducts[0].image },
      { product_id: 'prod_4', name: 'Daybreak Journal', price: 22, quantity: 1, image: sampleProducts[3].image }
    ]
  },
  {
    id: '1000',
    status: 'Shipped',
    total: 68,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    customer_name: 'Michael B.',
    customer: { name: 'Michael B.', email: 'michael@example.com', address: '12 Palm Street' },
    items: [
      { product_id: 'prod_2', name: 'Harbor Bottle', price: 34, quantity: 2, image: sampleProducts[1].image }
    ]
  }
];

let demoCart = {
  items: [
    {
      product_id: 'prod_1',
      name: 'Luna Tote',
      price: 89,
      quantity: 1,
      image: sampleProducts[0].image
    }
  ],
  total: 89
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const isPlatformHost = (hostname) => {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === ROOT_DOMAIN;
};

const isStorefrontHost = (req) => {
  return !isPlatformHost(req.hostname);
};

const withTotals = (cart) => {
  cart.total = cart.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  return cart;
};

const getCurrentCustomer = (req) => {
  return req.query.guest === '1' ? null : sampleCustomer;
};

const getProductById = (id) => {
  return sampleProducts.find((product) => String(product.id) === String(id));
};

const getProductBySlug = (slug) => {
  return sampleProducts.find((product) => product.slug === slug);
};

app.use((req, res, next) => {
  res.locals.pageTitle = '';
  res.locals.metaDescription = '';
  res.locals.currentPath = req.path;
  res.locals.platformUser = samplePlatformUser;
  res.locals.success = req.query.success || null;
  res.locals.error = req.query.error || null;
  next();
});

app.get('/', (req, res) => {
  if (isStorefrontHost(req)) {
    return res.render('storefront/home', {
      layout: 'layouts/store',
      pageTitle: sampleStore.name,
      metaDescription: 'Storefront homepage',
      store: sampleStore,
      customer: getCurrentCustomer(req),
      products: sampleProducts,
      featuredProducts: sampleProducts.slice(0, 4),
      cart: withTotals({ ...demoCart, items: demoCart.items.map((item) => ({ ...item })) })
    });
  }

  return res.render('platform/index', {
    layout: 'layouts/main',
    pageTitle: 'Launch your online store',
    metaDescription: 'Landing page for the multi-tenant ecommerce SaaS'
  });
});

app.get('/signup', (req, res) => {
  if (isStorefrontHost(req)) {
    return res.render('storefront/register', {
      layout: 'layouts/store',
      pageTitle: 'Register',
      store: sampleStore,
      customer: null,
      cart: demoCart,
      errors: {}
    });
  }

  return res.render('platform/signup', {
    layout: 'layouts/main',
    pageTitle: 'Create account',
    errors: {},
    formData: {}
  });
});

app.post('/signup', (req, res) => {
  res.redirect('/dashboard?success=Account created');
});

app.get('/login', (req, res) => {
  if (isStorefrontHost(req)) {
    return res.render('storefront/login', {
      layout: 'layouts/store',
      pageTitle: 'Login',
      store: sampleStore,
      customer: null,
      cart: demoCart,
      errors: {},
      formData: {}
    });
  }

  return res.render('platform/login', {
    layout: 'layouts/main',
    pageTitle: 'Sign in',
    errors: {},
    formData: {}
  });
});

app.post('/login', (req, res) => {
  if (isStorefrontHost(req)) {
    return res.redirect(req.query.returnTo || '/?success=Signed in');
  }

  return res.redirect('/dashboard?success=Welcome back');
});

app.get('/dashboard', (req, res) => {
  res.render('platform/dashboard', {
    layout: 'layouts/main',
    pageTitle: 'Dashboard',
    stores: [
      sampleStore,
      {
        id: 'store_2',
        name: 'Fieldhouse',
        subdomain: 'fieldhouse',
        logo: '',
        theme_color: '#4F46E5'
      }
    ]
  });
});

app.post('/stores', (req, res) => {
  res.redirect('/dashboard?success=Store created');
});

app.get('/stores/:id/manage', (req, res) => {
  const store = req.params.id === sampleStore.id ? sampleStore : sampleStore;
  const adminUrl = ROOT_DOMAIN === 'localhost'
    ? `http://${store.subdomain}.localhost:${PORT}/admin`
    : `https://${store.subdomain}.${ROOT_DOMAIN}/admin`;

  res.redirect(adminUrl);
});

app.get('/admin', (req, res) => {
  res.render('admin/dashboard', {
    layout: 'layouts/admin',
    pageTitle: 'Admin dashboard',
    store: sampleStore,
    products: sampleProducts,
    orders: sampleOrders,
    recentOrders: sampleOrders,
    stats: {
      totalProducts: sampleProducts.length,
      totalOrders: sampleOrders.length,
      revenue30d: 8420,
      customersCount: 182
    }
  });
});

app.get('/admin/products', (req, res) => {
  res.render('admin/products', {
    layout: 'layouts/admin',
    pageTitle: 'Products',
    store: sampleStore,
    products: sampleProducts
  });
});

app.get('/admin/products/new', (req, res) => {
  res.render('admin/product-form', {
    layout: 'layouts/admin',
    pageTitle: 'Add product',
    store: sampleStore,
    product: null,
    errors: {}
  });
});

app.get('/admin/products/:id/edit', (req, res) => {
  const product = getProductById(req.params.id) || sampleProducts[0];

  res.render('admin/product-form', {
    layout: 'layouts/admin',
    pageTitle: 'Edit product',
    store: sampleStore,
    product,
    errors: {}
  });
});

app.post('/admin/products', (req, res) => {
  res.redirect('/admin/products?success=Product saved');
});

app.post('/admin/products/:id', (req, res) => {
  res.redirect('/admin/products?success=Product updated');
});

app.post('/admin/products/:id/delete', (req, res) => {
  res.redirect('/admin/products?success=Product deleted');
});

app.get('/admin/orders', (req, res) => {
  res.render('admin/orders', {
    layout: 'layouts/admin',
    pageTitle: 'Orders',
    store: sampleStore,
    orders: sampleOrders
  });
});

app.get('/admin/orders/:id', (req, res) => {
  const order = sampleOrders.find((entry) => entry.id === req.params.id) || sampleOrders[0];

  res.render('admin/order-detail', {
    layout: 'layouts/admin',
    pageTitle: `Order #${order.id}`,
    store: sampleStore,
    order
  });
});

app.post('/admin/orders/:id/status', (req, res) => {
  res.redirect(`/admin/orders/${req.params.id}?success=Order status updated`);
});

app.get('/admin/settings', (req, res) => {
  res.render('admin/settings', {
    layout: 'layouts/admin',
    pageTitle: 'Store settings',
    store: sampleStore,
    errors: {}
  });
});

app.post('/admin/settings', (req, res) => {
  res.redirect('/admin/settings?success=Store settings updated');
});

app.get('/admin/domain', (req, res) => {
  res.render('admin/domain', {
    layout: 'layouts/admin',
    pageTitle: 'Domain setup',
    store: sampleStore,
    errors: {}
  });
});

app.post('/admin/domain', (req, res) => {
  res.redirect('/admin/domain?success=Domain saved for verification');
});

app.get('/products', (req, res) => {
  res.render('storefront/products', {
    layout: 'layouts/store',
    pageTitle: 'Products',
    store: sampleStore,
    customer: getCurrentCustomer(req),
    products: sampleProducts,
    categories: [{ name: 'Accessories', slug: 'accessories' }, { name: 'Journals', slug: 'journals' }],
    activeCategory: req.query.category ? decodeURIComponent(req.query.category) : 'All',
    cart: demoCart
  });
});

app.get('/products/:slug', (req, res) => {
  const product = getProductBySlug(req.params.slug) || sampleProducts[0];

  res.render('storefront/product', {
    layout: 'layouts/store',
    pageTitle: product.name,
    store: sampleStore,
    customer: getCurrentCustomer(req),
    product,
    cart: demoCart
  });
});

app.get('/cart', (req, res) => {
  res.render('storefront/cart', {
    layout: 'layouts/store',
    pageTitle: 'Cart',
    store: sampleStore,
    customer: getCurrentCustomer(req),
    cart: demoCart
  });
});

app.get('/register', (req, res) => {
  res.render('storefront/register', {
    layout: 'layouts/store',
    pageTitle: 'Register',
    store: sampleStore,
    customer: null,
    cart: demoCart,
    errors: {},
    formData: {}
  });
});

app.post('/register', (req, res) => {
  res.redirect(req.query.returnTo || '/?success=Account created');
});

app.get('/checkout', (req, res) => {
  const customer = getCurrentCustomer(req);
  if (!customer) {
    return res.redirect('/login?returnTo=/checkout');
  }

  return res.render('storefront/checkout', {
    layout: 'layouts/store',
    pageTitle: 'Checkout',
    store: sampleStore,
    customer,
    cart: demoCart,
    errors: {}
  });
});

app.post('/checkout', (req, res) => {
  res.redirect('/order-confirmation?success=Order placed');
});

app.get('/order-confirmation', (req, res) => {
  res.render('storefront/order-confirmation', {
    layout: 'layouts/store',
    pageTitle: 'Order confirmation',
    store: sampleStore,
    customer: sampleCustomer,
    order: {
      id: '1002',
      status: 'Pending',
      total: demoCart.total,
      estimated_shipping: '3-5 business days',
      items: demoCart.items
    },
    cart: demoCart
  });
});

app.post('/cart/add', (req, res) => {
  const product = getProductById(req.body.productId);
  const quantity = Math.max(1, Number(req.body.quantity || 1));

  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const existingItem = demoCart.items.find((item) => String(item.product_id) === String(product.id));
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    demoCart.items.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      quantity,
      image: product.image
    });
  }

  return res.json({ cart: withTotals(demoCart) });
});

app.patch('/cart/update', (req, res) => {
  const productId = String(req.body.productId || '');
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const targetItem = demoCart.items.find((item) => String(item.product_id) === productId);

  if (!targetItem) {
    return res.status(404).json({ error: 'Cart item not found.' });
  }

  if (quantity <= 0) {
    demoCart.items = demoCart.items.filter((item) => String(item.product_id) !== productId);
  } else {
    targetItem.quantity = quantity;
  }

  return res.json({ cart: withTotals(demoCart) });
});

app.delete('/cart/remove', (req, res) => {
  const productId = String(req.body.productId || '');
  demoCart.items = demoCart.items.filter((item) => String(item.product_id) !== productId);
  return res.json({ cart: withTotals(demoCart) });
});

app.get('/logout', (req, res) => {
  res.redirect('/?success=Signed out');
});

app.get('/error', (req, res) => {
  res.status(500).render('errors/500', {
    layout: 'layouts/main',
    pageTitle: 'Server error'
  });
});

app.use((req, res) => {
  res.status(404).render('errors/404', {
    layout: isStorefrontHost(req) ? 'layouts/store' : 'layouts/main',
    pageTitle: 'Not found',
    store: sampleStore,
    customer: getCurrentCustomer(req),
    cart: demoCart
  });
});

app.listen(PORT, () => {
  console.log(`MultiStore frontend preview running on http://localhost:${PORT}`);
});
