const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const {
  cleanStructuredData,
  buildBreadcrumbStructuredData,
  buildItemListStructuredData
} = require('../lib/seo');

const registerStorefrontRoutes = (app, deps) => {
  const { context, helpers, validations, renderers } = deps;
  const {
    authRateLimiter,
    env,
    handleFormValidation,
    addToCart,
    checkoutStorefrontCart,
    quoteStorefrontCheckout,
    clearStorefrontCart,
    clearWebAuthCookies,
    createStorefrontProductReview,
    ensureStorefrontSession,
    getCustomerOrderById,
    getStoreCheckoutProviders,
    getStoreProductById,
    getStoreProductBySlug,
    getStoreProductReviews,
    listCustomerOrders,
    previewStoreCoupon,
    listStoreProducts,
    mergeProductPresentation,
    registerStorefrontCustomer,
    removeCartItem,
    verifyStorefrontCheckout,
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
    buildStorefrontAbsoluteUrl,
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
    setOrderTrackingCookie,
    getAppliedCouponCode,
    persistAppliedCoupon,
    clearAppliedCoupon
  } = helpers;
  const {
    catalogQueryValidation,
    customerRegisterValidation,
    checkoutValidation,
    cartMutationValidation,
    cartCouponValidation,
    productIdentifierValidation
  } = validations;
  const {
    renderStorefront,
    renderCustomerSignup,
    renderCheckoutPage,
    renderErrorPage
  } = renderers;

  const loadAppliedCouponPreview = async (req, res, store) => {
    if (!store?.id) {
      req.storeCouponPreview = null;
      return null;
    }

    if (!req.currentCart?.items?.length) {
      clearAppliedCoupon(req, res, store.id);
      req.storeCouponPreview = null;
      return null;
    }

    const appliedCouponCode = getAppliedCouponCode(req, store.id);
    if (!appliedCouponCode) {
      req.storeCouponPreview = null;
      return null;
    }

    try {
      const preview = await previewStoreCoupon(req, store, {
        code: appliedCouponCode,
        subtotal: req.currentCart.total
      }, req.customerAuth);
      req.storeCouponPreview = preview;
      return preview;
    } catch (error) {
      if ([404, 422].includes(Number(error.status))) {
        clearAppliedCoupon(req, res, store.id);
        req.storeCouponPreview = null;
        return null;
      }

      throw error;
    }
  };

  const loadCheckoutProviders = async (req, store) => {
    if (!store?.id) {
      req.storeCheckoutProviders = [];
      return [];
    }

    const providers = await getStoreCheckoutProviders(req, store, req.customerAuth);
    req.storeCheckoutProviders = providers;
    return providers;
  };

  const buildCollectionStructuredData = (store, products = [], options = {}) => {
    const storeUrl = buildStorefrontAbsoluteUrl(store, '/');
    const collectionUrl = buildStorefrontAbsoluteUrl(store, '/products');
    const items = products.slice(0, 24).map((product) => ({
      url: buildStorefrontAbsoluteUrl(store, `/products/${product.slug}`),
      name: product.name,
      image: buildStorefrontAssetUrl(store, product.image || store.logo || '')
    }));

    return [
      buildBreadcrumbStructuredData([
        { name: store.name, item: storeUrl },
        { name: options.name || 'Catalog', item: collectionUrl }
      ]),
      buildItemListStructuredData(items, {
        name: options.name || `Catalog for ${store.name}`
      })
    ].filter(Boolean);
  };

  const buildProductStructuredData = (store, product, selectedCurrency = 'USD') => {
    const productUrl = buildStorefrontAbsoluteUrl(store, `/products/${product.slug}`);
    const storeUrl = buildStorefrontAbsoluteUrl(store, '/');
    const currency = selectedCurrency || store.default_currency || 'USD';

    return [
      buildBreadcrumbStructuredData([
        { name: store.name, item: storeUrl },
        { name: 'Catalog', item: buildStorefrontAbsoluteUrl(store, '/products') },
        { name: product.name, item: productUrl }
      ]),
      cleanStructuredData({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: sanitizePlainText(product.description || buildStoreSeoDescription(store), { maxLength: 320 }),
        image: (Array.isArray(product.images) ? product.images : [product.image])
          .filter(Boolean)
          .map((entry) => buildStorefrontAssetUrl(store, entry)),
        sku: product.sku || undefined,
        category: product.category || undefined,
        brand: {
          '@type': 'Brand',
          name: store.name
        },
        url: productUrl,
        offers: {
          '@type': 'Offer',
          priceCurrency: currency,
          price: Number(product.price || 0),
          availability: Number(product.inventory || 0) > 0
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          seller: {
            '@type': 'Organization',
            name: store.name
          },
          url: productUrl
        },
        aggregateRating: product.rating
          ? {
            '@type': 'AggregateRating',
            ratingValue: Number(product.rating || 0),
            reviewCount: Number(product.review_count || 1)
          }
          : undefined
      })
    ];
  };

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
        structuredData: buildCollectionStructuredData(store, products, {
          name: `Catalog for ${store.name}`
        }),
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

      const [relatedResult, reviewData] = await Promise.all([
        listStoreProducts(req, store, {
          limit: 24,
          category: product.category
        }),
        getStoreProductReviews(req, store, product.id, {
          auth: req.customerAuth
        })
      ]);
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
        structuredData: buildProductStructuredData(
          store,
          product,
          res.locals.selectedCurrency || store.default_currency || 'USD'
        ),
        product,
        productReviews: reviewData.reviews,
        viewerReview: reviewData.viewerReview,
        reviewEligibility: reviewData.reviewEligibility,
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

  app.post('/products/:slug/reviews', validate([
    allowBodyFields(['rating', 'title', 'body', '_csrf']),
    param('slug').trim().notEmpty().customSanitizer((value) => sanitizeSlug(value)),
    body('rating').isInt({ min: 1, max: 5 }).toInt(),
    body('title').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 255 })),
    body('body').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 2000 }))
  ]), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      const product = mergeProductPresentation(await getStoreProductBySlug(req, store, sanitizeSlug(req.params.slug)));
      if (!product) {
        return res.redirect('/products?error=Product not found');
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect(`/login?returnTo=${encodeURIComponent(`/products/${product.slug}`)}`);
      }

      await createStorefrontProductReview(req, store, req.customerAuth, product.id, {
        rating: req.body.rating,
        title: req.body.title,
        body: req.body.body
      });

      return res.redirect(`/products/${product.slug}?success=${encodeURIComponent('Thanks. Your review was submitted for moderation and will appear after approval.')}`);
    } catch (error) {
      const fallbackSlug = sanitizeSlug(req.params.slug);
      const fallbackPath = fallbackSlug ? `/products/${fallbackSlug}` : '/products';

      if (Number(error.status) === 404) {
        return res.redirect('/products?error=Product not found');
      }

      if ([400, 401, 403, 409, 422].includes(Number(error.status))) {
        return res.redirect(`${fallbackPath}?error=${encodeURIComponent(error.message || 'Unable to save your review right now.')}`);
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

  app.get('/cart', async (req, res, next) => {
    const store = resolveStore(req);
    if (!store) {
      return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
    }

    try {
      await loadAppliedCouponPreview(req, res, store);
      return renderStorefront(req, res, 'storefront/cart', {
        pageTitle: 'Cart',
        couponPreview: req.storeCouponPreview || null
      });
    } catch (error) {
      return next(error);
    }
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

  app.get('/checkout', async (req, res, next) => {
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

    try {
      await loadAppliedCouponPreview(req, res, store);
      await loadCheckoutProviders(req, store);
      return renderCheckoutPage(req, res);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/checkout', async (req, res, next) => {
    const store = resolveStore(req);
    if (!store) {
      return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
    }

    try {
      await loadAppliedCouponPreview(req, res, store);
      await loadCheckoutProviders(req, store);
      return next();
    } catch (error) {
      return next(error);
    }
  }, checkoutValidation, handleFormValidation((req, res, errors) => {
    return renderCheckoutPage(req, res, errors, 422);
  }), async (req, res, next) => {
    const store = resolveStore(req);

    try {
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect('/login?returnTo=/checkout');
      }

      if (!req.currentCart?.items?.length) {
        return res.redirect('/cart?error=Your cart is empty');
      }

      const checkoutProviders = req.storeCheckoutProviders || [];
      const selectedProvider = String(req.body.provider || 'paystack').trim().toLowerCase();
      if (!checkoutProviders.some((entry) => entry.provider === selectedProvider)) {
        return res.redirect('/checkout?error=That payment provider is not active for this store right now.');
      }

      const checkout = await checkoutStorefrontCart(req, store, req.customerAuth, {
        ...req.body,
        email: req.currentCustomer.email,
        phone: req.currentCustomer.phone,
        provider: selectedProvider,
        callback_url: buildStorefrontAbsoluteUrl(store, '/checkout/callback'),
        currency: res.locals.baseCurrency || store.default_currency || 'USD',
        coupon_code: req.storeCouponPreview?.coupon?.code || getAppliedCouponCode(req, store.id) || null,
        sessionId: req.storefrontSessionId || ensureStorefrontSession(req, res)
      });

      if (!checkout?.order?.id) {
        return res.redirect('/cart?error=Your cart is empty');
      }

      const checkoutUrl = checkout?.providers?.[0]?.checkout_url;
      if (!checkoutUrl) {
        return res.redirect('/checkout?error=Unable to start the payment session right now.');
      }

      clearAppliedCoupon(req, res, store.id);
      return res.redirect(checkoutUrl);
    } catch (error) {
      if ([404, 422].includes(Number(error.status))) {
        clearAppliedCoupon(req, res, store.id);
      }

      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/checkout?error=${encodeURIComponent(error.message || 'Unable to place the order right now.')}`);
      }

      return next(error);
    }
  });

  app.post('/checkout/quote', validate([
    allowBodyFields(['name', 'address', 'city', 'country', 'postal_code']),
    body('name').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('address').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 190 })),
    body('city').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('country').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('postal_code').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 30 }))
  ]), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.status(401).json({
          error: 'Customer authentication is required for checkout.'
        });
      }

      if (!req.currentCart?.items?.length) {
        return res.status(400).json({
          error: 'Your cart is empty.'
        });
      }

      const quote = await quoteStorefrontCheckout(req, store, req.customerAuth, {
        ...req.body,
        currency: res.locals.baseCurrency || store.default_currency || 'USD',
        coupon_code: req.storeCouponPreview?.coupon?.code || getAppliedCouponCode(req, store.id) || null,
        sessionId: req.storefrontSessionId || ensureStorefrontSession(req, res)
      });

      return res.json(quote);
    } catch (error) {
      if ([400, 401, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.status(Number(error.status) || 400).json({
          error: error.message || 'Unable to calculate checkout totals right now.'
        });
      }

      return next(error);
    }
  });

  app.get('/checkout/callback', rateLimit({
    windowMs: env.authRateLimitWindowMs,
    limit: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  }), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCustomer || !req.customerAuth) {
        return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl || '/checkout/callback')}`);
      }

      const reference = String(req.query.reference || req.query.trxref || req.query.tx_ref || '').trim();
      if (!reference) {
        return res.redirect('/checkout?error=Payment reference was not returned by the payment provider.');
      }

      const verification = await verifyStorefrontCheckout(req, store, req.customerAuth, reference);
      const order = verification?.order || null;
      const payment = verification?.payment || null;

      if (order && String(payment?.status || '').trim().toLowerCase() === 'success') {
        setOrderTrackingCookie(req, res, store.id, order.id);
        return res.redirect(`/order-confirmation?order=${encodeURIComponent(order.id)}&success=${encodeURIComponent('Payment confirmed and your order is now in progress.')}`);
      }

      return res.redirect('/orders?error=The payment was not completed successfully. You can try checkout again from your cart.');
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/checkout?error=${encodeURIComponent(error.message || 'Unable to verify the payment session.')}`);
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
      clearAppliedCoupon(req, res, store.id);

      return res.json({ cart });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/cart/coupon', cartCouponValidation, handleFormValidation((req, res) => {
    return res.redirect('/cart?error=Enter a valid coupon code.');
  }), async (req, res, next) => {
    try {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      if (!req.currentCart?.items?.length) {
        return res.redirect('/cart?error=Your cart is empty');
      }

      const preview = await previewStoreCoupon(req, store, {
        code: req.body.coupon_code,
        subtotal: req.currentCart.total
      }, req.customerAuth);
      persistAppliedCoupon(req, res, store.id, preview?.coupon?.code || req.body.coupon_code);
      return res.redirect('/cart?success=Coupon applied');
    } catch (error) {
      if ([400, 404, 422].includes(Number(error.status))) {
        return res.redirect(`/cart?error=${encodeURIComponent(error.message || 'Unable to apply that coupon.')}`);
      }

      return next(error);
    }
  });

  app.post('/cart/coupon/remove', validate([
    allowBodyFields(['_csrf'])
  ]), (req, res) => {
    const store = resolveStore(req);
    if (!store) {
      return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
    }

    clearAppliedCoupon(req, res, store.id);
    return res.redirect('/cart?success=Coupon removed');
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
