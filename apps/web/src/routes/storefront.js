const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');

const registerStorefrontRoutes = (app, deps) => {
  const { context, helpers, validations, renderers } = deps;
  const {
    authRateLimiter,
    env,
    handleFormValidation,
    addToCart,
    checkoutStorefrontCart,
    clearStorefrontCart,
    clearWebAuthCookies,
    ensureStorefrontSession,
    getCustomerOrderById,
    getStoreProductById,
    getStoreProductBySlug,
    listCustomerOrders,
    listStoreProducts,
    mergeProductPresentation,
    registerStorefrontCustomer,
    removeCartItem,
    updateCartItem,
    clearSignedCookie,
    readSignedCookie,
    customerCookieName,
    orderCookieName,
    sanitizePlainText,
    sanitizeSlug,
    createHttpError,
    validate,
    allowBodyFields,
    isPlatformRequestHost
  } = context;
  const {
    resolveStore,
    buildStoreSeoDescription,
    buildStoreSeoKeywords,
    buildStorefrontAssetUrl,
    decorateProducts,
    buildProductDiscovery,
    filterCatalogProducts,
    getWishlistProductIds,
    loadProductsByIds,
    persistRecentlyViewed,
    getRecentlyViewedProducts,
    resolveSafeLocalRedirect,
    persistWishlist,
    setOrderTrackingCookie
  } = helpers;
  const {
    catalogQueryValidation,
    customerRegisterValidation,
    checkoutValidation,
    cartMutationValidation,
    productIdentifierValidation
  } = validations;
  const {
    renderStorefront,
    renderCustomerSignup,
    renderCheckoutPage,
    renderErrorPage
  } = renderers;

  app.get('/products', catalogQueryValidation, async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      const category = req.query.category || 'All';
      const search = req.query.search || '';
      const sort = req.query.sort || 'featured';
      const tag = req.query.tag || '';
      const productResult = await listStoreProducts(req, store, {
        limit: 300,
        category,
        search
      });
      const catalogProducts = decorateProducts(productResult.products || []);
      const discovery = buildProductDiscovery(catalogProducts);
      const products = filterCatalogProducts(catalogProducts, {
        category,
        search,
        sort,
        tag
      });

      return renderStorefront(req, res, 'storefront/products', {
        pageTitle: 'Products',
        metaTitle: `Shop ${store.name}`,
        metaDescription: buildStoreSeoDescription(store),
        metaKeywords: buildStoreSeoKeywords(store, [
          category !== 'All' ? category : '',
          tag,
          search
        ]),
        canonicalPath: '/products',
        products,
        categories: productResult.categories || discovery.categories,
        discoveryTags: discovery.tags.slice(0, 10),
        activeCategory: category,
        activeTag: tag,
        searchQuery: search,
        activeSort: sort
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/products/:slug', async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      const product = mergeProductPresentation(await getStoreProductBySlug(req, store, sanitizeSlug(req.params.slug)));
      if (!product) {
        return res.redirect('/products?error=Product not found');
      }

      const relatedResult = await listStoreProducts(req, store, {
        limit: 24,
        category: product.category
      });
      const relatedProducts = decorateProducts(relatedResult.products || [])
        .filter((entry) => entry.id !== product.id)
        .slice(0, 4);

      persistRecentlyViewed(req, res, store.id, product.id);
      const recentlyViewedProducts = await getRecentlyViewedProducts(req, store, {
        excludeId: product.id,
        limit: 4
      });

      return renderStorefront(req, res, 'storefront/product', {
        pageTitle: product.name,
        metaTitle: `${product.name} | ${store.name}`,
        metaDescription: sanitizePlainText(product.description || buildStoreSeoDescription(store), { maxLength: 320 }),
        metaKeywords: buildStoreSeoKeywords(store, [
          product.category,
          ...(Array.isArray(product.tags) ? product.tags.slice(0, 6) : [])
        ]),
        canonicalPath: `/products/${product.slug}`,
        socialImage: buildStorefrontAssetUrl(store, product.image || store.logo || ''),
        metaType: 'product',
        product,
        relatedProducts,
        recentlyViewedProducts
      });
    } catch (error) {
      if (Number(error.status) === 404) {
        return res.redirect('/products?error=Product not found');
      }

      return next(error);
    }
  });

  app.get('/wishlist', async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      const wishlistIds = getWishlistProductIds(req, store.id);
      const wishlistProducts = await loadProductsByIds(req, store, wishlistIds);

      return renderStorefront(req, res, 'storefront/wishlist', {
        pageTitle: 'Wishlist',
        wishlistProducts
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/cart', (req, res) => {
    const store = resolveStore(req);
    if (!store) {
      return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
    }

    return renderStorefront(req, res, 'storefront/cart', {
      pageTitle: 'Cart'
    });
  });

  app.get('/register', (req, res) => {
    const store = resolveStore(req);
    if (!store) {
      return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
    }

    return renderCustomerSignup(req, res);
  });

  app.post(
    '/register',
    authRateLimiter,
    customerRegisterValidation,
    handleFormValidation((req, res, errors) => renderCustomerSignup(req, res, errors, 422)),
    async (req, res, next) => {
      try {
        const store = resolveStore(req);
        if (!store) {
          return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
        }

        await registerStorefrontCustomer(req, res, store, {
          name: req.body.name,
          email: req.body.email,
          password: req.body.password
        });

        const redirectTarget = resolveSafeLocalRedirect(req, req.body.returnTo || req.query.returnTo, '/account?success=Account created', store);
        return res.redirect(redirectTarget);
      } catch (error) {
        if ([400, 401, 403, 409, 422].includes(Number(error.status))) {
          return res.redirect(`/register?error=${encodeURIComponent(error.message || 'Unable to create the account right now.')}`);
        }

        return next(error);
      }
    }
  );

  app.get('/account', async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect('/login?returnTo=/account');
      }

      const [customerOrders, wishlistProducts, recentlyViewedProducts] = await Promise.all([
        listCustomerOrders(req, store, req.customerAuth, { limit: 50 }),
        loadProductsByIds(req, store, getWishlistProductIds(req, store.id)),
        getRecentlyViewedProducts(req, store, { limit: 4 })
      ]);
      req.currentCustomerOrders = customerOrders;

      return renderStorefront(req, res, 'storefront/account', {
        pageTitle: 'My account',
        customerOrders,
        wishlistProducts,
        recentlyViewedProducts
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/orders', async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect('/login?returnTo=/orders');
      }

      const customerOrders = await listCustomerOrders(req, store, req.customerAuth, { limit: 100 });
      req.currentCustomerOrders = customerOrders;

      return renderStorefront(req, res, 'storefront/orders', {
        pageTitle: 'My orders',
        customerOrders
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/orders/:id/reorder', validate([
    allowBodyFields(['_csrf']),
    param('id')
      .trim()
      .notEmpty()
      .isLength({ max: 40 })
      .withMessage('order id is required.')
      .customSanitizer((value) => sanitizePlainText(value, { maxLength: 40 }))
  ]), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect('/login?returnTo=/orders');
      }

      const order = await getCustomerOrderById(req, store, req.customerAuth, req.params.id);
      if (!order) {
        return res.redirect('/orders?error=Order not found');
      }

      const sessionId = req.storefrontSessionId || ensureStorefrontSession(req, res);
      let restoredCount = 0;

      for (const item of order.items || []) {
        if (!item.product_id || Number(item.quantity || 0) <= 0) {
          continue;
        }

        try {
          await addToCart(req, store, {
            productId: item.product_id,
            quantity: item.quantity,
            sessionId,
            auth: req.customerAuth
          });
          restoredCount += 1;
        } catch (error) {
          if (![403, 404].includes(Number(error.status))) {
            throw error;
          }
        }
      }

      if (!restoredCount) {
        return res.redirect('/orders?error=Unable to add those items back to your cart');
      }

      return res.redirect('/cart?success=Items added back to your cart');
    } catch (error) {
      if ([403, 404].includes(Number(error.status))) {
        return res.redirect('/orders?error=Order not found');
      }

      return next(error);
    }
  });

  app.get('/checkout', (req, res) => {
    const store = resolveStore(req);
    if (!store) {
      return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
    }

    if (!req.currentCustomer || !req.customerAuth) {
      return res.redirect('/login?returnTo=/checkout');
    }

    if (!req.currentCart?.items?.length) {
      return res.redirect('/cart?error=Your cart is empty');
    }

    return renderCheckoutPage(req, res);
  });

  app.post('/checkout', checkoutValidation, handleFormValidation((req, res, errors) => {
    return renderCheckoutPage(req, res, errors, 422);
  }), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect('/login?returnTo=/checkout');
      }

      if (!req.currentCart?.items?.length) {
        return res.redirect('/cart?error=Your cart is empty');
      }

      const checkout = await checkoutStorefrontCart(req, store, req.customerAuth, {
        ...req.body,
        email: req.currentCustomer.email,
        phone: req.currentCustomer.phone,
        currency: res.locals.selectedCurrency || store.default_currency || 'USD',
        sessionId: req.storefrontSessionId || ensureStorefrontSession(req, res)
      });

      if (!checkout?.order?.id) {
        return res.redirect('/cart?error=Your cart is empty');
      }

      setOrderTrackingCookie(req, res, store.id, checkout.order.id);
      return res.redirect(`/order-confirmation?order=${encodeURIComponent(checkout.order.id)}&success=Order placed`);
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/checkout?error=${encodeURIComponent(error.message || 'Unable to place the order right now.')}`);
      }

      return next(error);
    }
  });

  app.get('/order-confirmation', async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect('/login?returnTo=/order-confirmation');
      }

      const orderId = sanitizePlainText(req.query.order || readSignedCookie(req, orderCookieName(store.id)) || '', {
        maxLength: 120
      });

      if (!orderId) {
        return res.redirect('/products');
      }

      const order = await getCustomerOrderById(req, store, req.customerAuth, orderId);
      if (!order) {
        return res.redirect('/products');
      }

      return renderStorefront(req, res, 'storefront/order-confirmation', {
        pageTitle: 'Order confirmation',
        order
      });
    } catch (error) {
      if ([403, 404].includes(Number(error.status))) {
        return res.redirect('/products');
      }

      return next(error);
    }
  });

  app.post('/cart/add', cartMutationValidation(false), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        throw createHttpError(404, 'Store not found.', null, { expose: true });
      }

      const cart = await addToCart(req, store, {
        productId: req.body.productId,
        quantity: req.body.quantity || 1,
        sessionId: req.storefrontSessionId || ensureStorefrontSession(req, res),
        auth: req.customerAuth
      });

      return res.json({ cart });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/cart/update', cartMutationValidation(true), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        throw createHttpError(404, 'Store not found.', null, { expose: true });
      }

      const sessionId = req.storefrontSessionId || ensureStorefrontSession(req, res);
      const cart = Number(req.body.quantity || 0) <= 0
        ? await removeCartItem(req, store, {
          productId: req.body.productId,
          sessionId,
          auth: req.customerAuth
        })
        : await updateCartItem(req, store, {
          productId: req.body.productId,
          quantity: req.body.quantity,
          sessionId,
          auth: req.customerAuth
        });

      return res.json({ cart });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/cart/remove', validate([
    allowBodyFields(['productId']),
    body('productId').isString().notEmpty().withMessage('productId is required.')
  ]), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        throw createHttpError(404, 'Store not found.', null, { expose: true });
      }

      const cart = await removeCartItem(req, store, {
        productId: req.body.productId,
        sessionId: req.storefrontSessionId || ensureStorefrontSession(req, res),
        auth: req.customerAuth
      });

      return res.json({ cart });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/cart/clear', validate([
    allowBodyFields(['_csrf'])
  ]), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        throw createHttpError(404, 'Store not found.', null, { expose: true });
      }

      const cart = await clearStorefrontCart(
        req,
        store,
        req.customerAuth,
        req.storefrontSessionId || ensureStorefrontSession(req, res)
      );

      return res.json({ cart });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/wishlist/items', async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        throw createHttpError(404, 'Store not found.', null, { expose: true });
      }

      const wishlist = getWishlistProductIds(req, store.id);
      const items = await loadProductsByIds(req, store, wishlist);
      return res.json({
        items,
        wishlist,
        count: items.length
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wishlist/items', validate([
    allowBodyFields(['productId']),
    body('productId').isString().notEmpty().withMessage('productId is required.')
  ]), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        throw createHttpError(404, 'Store not found.', null, { expose: true });
      }

      const product = await getStoreProductById(req, store, req.body.productId);
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
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/wishlist/items/:productId', validate([
    productIdentifierValidation
  ]), (req, res) => {
    const store = resolveStore(req);
    if (!store) {
      throw createHttpError(404, 'Store not found.', null, { expose: true });
    }

    const nextIds = getWishlistProductIds(req, store.id).filter((entry) => entry !== String(req.params.productId));
    persistWishlist(req, res, store.id, nextIds);
    return res.json({
      wishlist: nextIds,
      count: nextIds.length
    });
  });

  app.post('/logout', rateLimit({
    windowMs: env.mutationRateLimitWindowMs,
    limit: env.mutationRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  }), validate([
    allowBodyFields(['_csrf'])
  ]), (req, res) => {
    const store = resolveStore(req);

    clearWebAuthCookies(req, res);

    if (store) {
      clearSignedCookie(req, res, customerCookieName(store.id));
      clearSignedCookie(req, res, orderCookieName(store.id));
    }

    if (isPlatformRequestHost(req.hostname)) {
      clearSignedCookie(req, res, 'activeStoreId');
    }

    return res.redirect('/?success=Signed out');
  });
};

module.exports = {
  registerStorefrontRoutes
};
