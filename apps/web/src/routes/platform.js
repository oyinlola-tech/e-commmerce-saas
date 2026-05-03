const rateLimit = require('express-rate-limit');
const {
  buildOwnerTermsPage,
  buildOwnerPrivacyPage,
  buildCustomerTermsPage,
  buildCustomerPrivacyPage
} = require('../lib/legal-content');
const {
  cleanStructuredData,
  toIsoDate,
  buildSitemapXml,
  buildRobotsTxt,
  buildItemListStructuredData,
  buildFaqStructuredData
} = require('../lib/seo');

const registerPlatformRoutes = (app, deps) => {
  const { context, helpers, validations, renderers } = deps;
  const {
    authRateLimiter,
    authPageRateLimiter,
    env,
    PLATFORM_ROLES,
    buildCurrencyContext,
    normalizeCurrencyCode,
    handleFormValidation,
    saveLogoFile,
    safeRedirect,
    createHttpError,
    mergeStorePresentation,
    upsertStoreContent,
    listStoreProducts,
    registerStorefrontCustomer,
    registerPlatformUser,
    loginStorefrontCustomer,
    loginPlatformUser,
    requestStorefrontPasswordReset,
    confirmStorefrontPasswordReset,
    requestPlatformPasswordReset,
    confirmPlatformPasswordReset,
    unsubscribeStorefrontMarketing,
    createOwnerSubscriptionCheckout,
    verifyOwnerSubscriptionCheckout,
    getPublicBillingPlans,
    getAdminBillingPlans,
    updateAdminBillingPlan,
    listPlatformStores,
    doubleCsrfProtection,
    createPlatformStore,
    getPlatformStoreById,
    clearWebAuthCookies
  } = context;
  const {
    resolveStore,
    isStorefrontHost,
    resolveSafeLocalRedirect,
    joinKeywordList,
    buildPlatformAbsoluteUrl,
    buildPlatformAssetUrl,
    buildPlatformSeoDescription,
    buildStoreSeoDescription,
    buildStoreSeoKeywords,
    buildStorefrontAssetUrl,
    sortProducts,
    decorateProducts,
    buildProductDiscovery,
    buildStoreStats,
    getPlatformHomePath,
    isPlatformAdminUser,
    requirePlatformUser,
    requirePlatformAdmin,
    handleMultipartLogo,
    buildStorefrontUrl,
    buildStoreAdminUrl,
    setCurrencyPreferenceCookie
  } = helpers;
  const {
    currencyValidation,
    ownerSignupValidation,
    ownerLoginValidation,
    passwordResetRequestValidation,
    passwordResetConfirmValidation,
    subscriptionCheckoutValidation,
    adminBillingPlanValidation,
    storeCreationValidation
  } = validations;
  const {
    renderPlatform,
    renderStorefront,
    renderCustomerSignup,
    renderOwnerSignup,
    renderCustomerLogin,
    renderOwnerLogin,
    renderCustomerForgotPassword,
    renderCustomerResetPassword,
    renderOwnerForgotPassword,
    renderOwnerResetPassword,
    renderPlatformAdminLogin,
    renderOwnerDashboard,
    renderPlatformAdmin,
    renderErrorPage
  } = renderers;

  const sendPlainText = (res, body) => {
    res.type('text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    return res.send(body);
  };

  const sendXml = (res, body) => {
    res.type('application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    return res.send(body);
  };

  const collectPublicStoreProducts = async (req, store, options = {}) => {
    const limit = Math.max(1, Number(options.limit || 200));
    const products = [];
    let total = Infinity;
    let page = 1;

    while (products.length < total) {
      const pageResult = await listStoreProducts(req, store, {
        limit,
        page
      });
      const pageProducts = Array.isArray(pageResult.products) ? pageResult.products : [];
      if (!pageProducts.length) {
        break;
      }

      products.push(...pageProducts);
      total = Number(pageResult.total || pageProducts.length || 0);
      page += 1;
    }

    return products;
  };

  const buildPlatformLandingStructuredData = (req, brand = {}, selectedCurrency = 'USD', billingPlans = [], faqItems = []) => {
    const platformUrl = buildPlatformAbsoluteUrl(req, '/');
    const socialImage = buildPlatformAssetUrl(req, '/brand/aisle-logo.svg');

    return [
      cleanStructuredData({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: brand.platformName || 'Aisle',
        url: platformUrl,
        logo: socialImage,
        image: socialImage,
        email: brand.supportEmail || undefined,
        description: buildPlatformSeoDescription(brand)
      }),
      cleanStructuredData({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: brand.platformName || 'Aisle',
        url: platformUrl,
        description: buildPlatformSeoDescription(brand)
      }),
      cleanStructuredData({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: brand.platformName || 'Aisle',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: platformUrl,
        image: socialImage,
        description: 'Ecommerce SaaS for multi-store retail teams that want a branded storefront, real authentication, and an owner workspace.',
        offers: billingPlans.map((plan) => cleanStructuredData({
          '@type': 'Offer',
          name: plan.name,
          description: plan.description,
          price: Number(plan.monthly_amount || 0),
          priceCurrency: plan.currency || selectedCurrency || 'USD',
          url: `${platformUrl}#pricing`
        }))
      }),
      faqItems.length ? buildFaqStructuredData(faqItems) : null
    ].filter(Boolean);
  };

  const buildStorefrontLandingStructuredData = (req, store, products = []) => {
    const storefrontUrl = buildStorefrontUrl(store);
    const featuredItems = products.slice(0, 8).map((product) => ({
      url: storefrontUrl.startsWith('http')
        ? `${storefrontUrl}/products/${encodeURIComponent(product.slug)}`
        : buildPlatformAbsoluteUrl(req, `/products/${encodeURIComponent(product.slug)}`),
      name: product.name,
      image: buildStorefrontAssetUrl(store, product.image || store.logo || '')
    }));

    return [
      cleanStructuredData({
        '@context': 'https://schema.org',
        '@type': 'OnlineStore',
        name: store.name,
        url: storefrontUrl,
        image: buildStorefrontAssetUrl(store, store.logo || products[0]?.image || ''),
        description: buildStoreSeoDescription(store),
        email: store.support_email || undefined,
        telephone: store.contact_phone || undefined,
        areaServed: Array.isArray(store.markets) ? store.markets.slice(0, 12) : undefined
      }),
      cleanStructuredData({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: store.name,
        url: storefrontUrl,
        description: buildStoreSeoDescription(store),
        potentialAction: {
          '@type': 'SearchAction',
          target: `${storefrontUrl}/products?search={search_term_string}`,
          'query-input': 'required name=search_term_string'
        }
      }),
      featuredItems.length
        ? buildItemListStructuredData(featuredItems, {
          name: `Featured products from ${store.name}`
        })
        : null
    ].filter(Boolean);
  };

  const renderLegalPage = (req, res, kind) => {
    const isStorefront = isStorefrontHost(req);
    const canonicalPath = kind === 'privacy' ? '/privacy' : '/terms';

    if (isStorefront) {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      const legalPage = kind === 'privacy'
        ? buildCustomerPrivacyPage({ store, brand: res.locals.platformBrand })
        : buildCustomerTermsPage({ store, brand: res.locals.platformBrand });

      return renderStorefront(req, res, 'shared/legal', {
        pageTitle: legalPage.title,
        pageBrandLabel: store.name,
        metaTitle: `${legalPage.title} | ${store.name}`,
        metaDescription: legalPage.metaDescription,
        canonicalPath,
        legalPage
      });
    }

    const legalPage = kind === 'privacy'
      ? buildOwnerPrivacyPage({ brand: res.locals.platformBrand })
      : buildOwnerTermsPage({ brand: res.locals.platformBrand });

    return renderPlatform(res, 'shared/legal', {
      pageTitle: legalPage.title,
      metaTitle: `${legalPage.title} | ${res.locals.platformBrand?.platformName || 'Aisle'}`,
      metaDescription: legalPage.metaDescription,
      canonicalPath,
      legalPage
    });
  };

  const renderPlatformAdminOverview = async (req, res) => {
    const stores = (await listPlatformStores(req, req.platformAuth)).map((store) => mergeStorePresentation(store));
    const adminPricing = await getAdminBillingPlans(req, req.platformAuth);
    const publicPricing = await getPublicBillingPlans(req, {
      currency: res.locals.selectedCurrency || 'USD'
    });
    const publicPricingMap = new Map(publicPricing.map((plan) => [String(plan.code || '').trim().toLowerCase(), plan]));
    const billingPlans = adminPricing.plans.map((plan) => ({
      ...plan,
      preview: publicPricingMap.get(String(plan.code || '').trim().toLowerCase()) || null
    }));
    const metrics = {
      storesCount: stores.length,
      liveStores: stores.filter((store) => store.is_active).length,
      planCount: billingPlans.length,
      trialDays: adminPricing.trial_days,
      trialAuthorizationAmount: adminPricing.trial_authorization_amount,
      trialAuthorizationCurrency: adminPricing.trial_authorization_currency
    };

    return renderPlatformAdmin(res, 'platform/admin-dashboard', {
      pageTitle: 'Platform operations',
      stores,
      metrics,
      billingPlans,
      supportedBillingCurrencies: adminPricing.supported_currencies,
      editablePricing: String(req.currentPlatformUser?.role || '').trim().toLowerCase() === PLATFORM_ROLES.PLATFORM_OWNER
    });
  };

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
    const safeReturnTo = resolveSafeLocalRedirect(req, req.body.returnTo || req.headers.referer || '/', '/', pricingStore);

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
    req.signedCookies = req.signedCookies || {};
    req.cookies = req.cookies || {};
    req.signedCookies[currencyContext.cookieName] = requestedCurrency;
    req.cookies[currencyContext.cookieName] = requestedCurrency;
    return res.redirect(safeReturnTo);
  });

  app.get('/robots.txt', (req, res) => {
    if (isStorefrontHost(req)) {
      const store = resolveStore(req);
      if (!store) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      return sendPlainText(res, buildRobotsTxt({
        lines: [
          'Allow: /',
          'Disallow: /account',
          'Disallow: /orders',
          'Disallow: /checkout',
          'Disallow: /cart',
          'Disallow: /wishlist',
          'Disallow: /order-confirmation',
          'Disallow: /cart/',
          'Disallow: /wishlist/items',
          'Disallow: /preferences/currency'
        ],
        sitemapUrl: `${buildStorefrontUrl(store)}/sitemap.xml`
      }));
    }

    return sendPlainText(res, buildRobotsTxt({
      lines: [
        'Allow: /',
        'Disallow: /dashboard',
        'Disallow: /platform-admin',
        'Disallow: /billing/callback',
        'Disallow: /preferences/currency'
      ],
      sitemapUrl: buildPlatformAbsoluteUrl(req, '/sitemap.xml')
    }));
  });

  app.get('/sitemap.xml', async (req, res, next) => {
    try {
      if (isStorefrontHost(req)) {
        const store = resolveStore(req);
        if (!store) {
          return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
        }

        const storefrontUrl = buildStorefrontUrl(store);
        const products = await collectPublicStoreProducts(req, store, { limit: 200 });
        const productsUpdatedAt = products.reduce((latest, product) => {
          const candidate = new Date(product.updated_at || product.created_at || 0).getTime();
          return candidate > latest ? candidate : latest;
        }, 0);
        const sitemapEntries = [
          {
            loc: storefrontUrl,
            lastmod: toIsoDate(store.updated_at || store.created_at),
            changefreq: 'daily',
            priority: '1.0'
          },
          {
            loc: `${storefrontUrl}/products`,
            lastmod: productsUpdatedAt ? new Date(productsUpdatedAt).toISOString() : toIsoDate(store.updated_at || store.created_at),
            changefreq: 'daily',
            priority: '0.9'
          },
          {
            loc: `${storefrontUrl}/terms`,
            lastmod: toIsoDate(store.updated_at || store.created_at),
            changefreq: 'monthly',
            priority: '0.3'
          },
          {
            loc: `${storefrontUrl}/privacy`,
            lastmod: toIsoDate(store.updated_at || store.created_at),
            changefreq: 'monthly',
            priority: '0.3'
          },
          ...products.map((product) => ({
            loc: `${storefrontUrl}/products/${encodeURIComponent(product.slug)}`,
            lastmod: toIsoDate(product.updated_at || product.created_at),
            changefreq: 'weekly',
            priority: '0.8'
          }))
        ];

        return sendXml(res, buildSitemapXml(sitemapEntries));
      }

      return sendXml(res, buildSitemapXml([
        {
          loc: buildPlatformAbsoluteUrl(req, '/'),
          changefreq: 'weekly',
          priority: '1.0'
        },
        {
          loc: buildPlatformAbsoluteUrl(req, '/terms'),
          changefreq: 'monthly',
          priority: '0.3'
        },
        {
          loc: buildPlatformAbsoluteUrl(req, '/privacy'),
          changefreq: 'monthly',
          priority: '0.3'
        }
      ]));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/', async (req, res, next) => {
    try {
      if (isStorefrontHost(req)) {
        const store = resolveStore(req);
        if (!store) {
          return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
        }

        const productResult = await listStoreProducts(req, store, { limit: 200 });
        const products = decorateProducts(productResult.products || []);
        const sortedProducts = sortProducts(products, 'featured');
        const discovery = buildProductDiscovery(sortedProducts);

        return renderStorefront(req, res, 'storefront/home', {
          pageTitle: store.name,
          metaTitle: String(store.seo_title || '').trim() || store.name,
          metaDescription: buildStoreSeoDescription(store),
          metaKeywords: buildStoreSeoKeywords(store),
          canonicalPath: '/',
          socialImage: buildStorefrontAssetUrl(store, store.logo || ''),
          structuredData: buildStorefrontLandingStructuredData(req, store, sortedProducts),
          products: sortedProducts,
          featuredProducts: sortedProducts.filter((product) => product.featured).slice(0, 4),
          categories: productResult.categories || discovery.categories,
          discoveryTags: discovery.tags.slice(0, 8),
          stats: buildStoreStats({ store, products: sortedProducts })
        });
      }

      const billingPlans = await getPublicBillingPlans(req, {
        currency: res.locals.selectedCurrency || 'USD'
      });
      const platformFaqItems = [
        {
          question: 'Can I create and manage real stores from this build?',
          answer: 'Yes. Owner accounts, store creation, store admin, storefront auth, and customer checkout flows are all wired to services.'
        },
        {
          question: 'Does Aisle integrate directly with Shopify, AliExpress, or Jumia today?',
          answer: 'No direct integrations are advertised in this build. Those names are referenced only to describe the ecommerce patterns and comparisons merchants often evaluate.'
        },
        {
          question: 'Why is the platform operations area a placeholder?',
          answer: 'Because platform-wide support, incident handling, and staff operations will only appear once they are backed by real permissions and workflows.'
        },
        {
          question: 'Does this support custom storefront identity?',
          answer: 'Yes. Each store can carry its own theme color, typography, content, catalog, domain, and support details.'
        }
      ];

      return renderPlatform(res, 'platform/index', {
        pageTitle: 'Aisle',
        metaDescription: 'Aisle is an ecommerce SaaS platform for teams comparing Shopify alternatives and wanting marketplace-inspired storefronts, real authentication, and a serious owner workspace.',
        metaKeywords: joinKeywordList(
          ['ecommerce saas', 'shopify alternative', 'multistore ecommerce platform', 'online store builder'],
          ['marketplace-inspired storefront', 'aliexpress shopping experience', 'jumia ecommerce workflow', 'retail operations software']
        ),
        canonicalPath: '/',
        structuredData: buildPlatformLandingStructuredData(
          req,
          res.locals.platformBrand,
          res.locals.selectedCurrency || 'USD',
          billingPlans,
          platformFaqItems
        ),
        metrics: {},
        stores: [],
        billingPlans
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/terms', (req, res) => {
    return renderLegalPage(req, res, 'terms');
  });

  app.get('/privacy', (req, res) => {
    return renderLegalPage(req, res, 'privacy');
  });

  app.get('/email/unsubscribe', async (req, res, next) => {
    const token = String(req.query.token || '').trim();

    if (!token) {
      return renderPlatform(res, 'shared/marketing-unsubscribe', {
        pageTitle: 'Email preferences',
        metaTitle: 'Email preferences | Aisle',
        metaDescription: 'Marketing email preference update.',
        unsubscribeSucceeded: false,
        unsubscribeAlreadyUnsubscribed: false,
        unsubscribeCustomer: null,
        unsubscribeStore: null,
        unsubscribeStorefrontUrl: ''
      });
    }

    try {
      const result = await unsubscribeStorefrontMarketing(req, token);
      return renderPlatform(res, 'shared/marketing-unsubscribe', {
        pageTitle: 'Email preferences',
        metaTitle: `${result.store?.name || 'Store'} email preferences`,
        metaDescription: `Monthly marketing emails have been turned off for ${result.customer?.email || 'this address'}.`,
        unsubscribeSucceeded: true,
        unsubscribeAlreadyUnsubscribed: Boolean(result.already_unsubscribed),
        unsubscribeCustomer: result.customer,
        unsubscribeStore: result.store,
        unsubscribeStorefrontUrl: result.store ? buildStorefrontUrl(result.store) : ''
      });
    } catch (error) {
      if ([400, 404, 422].includes(Number(error.status))) {
        res.status(Number(error.status) || 400);
        return renderPlatform(res, 'shared/marketing-unsubscribe', {
          pageTitle: 'Email preferences',
          metaTitle: 'Email preferences | Aisle',
          metaDescription: 'Marketing email preference update.',
          unsubscribeSucceeded: false,
          unsubscribeAlreadyUnsubscribed: false,
          unsubscribeCustomer: null,
          unsubscribeStore: null,
          unsubscribeStorefrontUrl: ''
        });
      }

      return next(error);
    }
  });

  app.get('/signup', (req, res) => {
    if (isStorefrontHost(req)) {
      if (!resolveStore(req)) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      return renderCustomerSignup(req, res);
    }

    if (req.platformAuth && req.currentPlatformUser) {
      return res.redirect(getPlatformHomePath(req.currentPlatformUser));
    }

    return renderOwnerSignup(req, res);
  });

  app.post(
    '/signup',
    authRateLimiter,
    handleMultipartLogo((req, res, errors, status) => {
      if (isStorefrontHost(req)) {
        return renderCustomerSignup(req, res, errors, status);
      }

      return renderOwnerSignup(req, res, errors, status);
    }),
    doubleCsrfProtection,
    ownerSignupValidation,
    handleFormValidation((req, res, errors) => {
      if (isStorefrontHost(req)) {
        return renderCustomerSignup(req, res, errors, 422);
      }

      return renderOwnerSignup(req, res, errors, 422);
    }),
    async (req, res, next) => {
      try {
        if (isStorefrontHost(req)) {
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
        }

        const registration = await registerPlatformUser(req, res, {
          name: req.body.name,
          email: req.body.email,
          password: req.body.password
        });

        const ownerAuth = registration?.user
          ? {
              userId: String(registration.user.id),
              actorRole: registration.user.role,
              actorType: 'platform_user'
            }
          : null;
        const wantsStoreSetup = req.body.store_name || req.body.store_subdomain || req.body.store_type;

        if (wantsStoreSetup && ownerAuth) {
          const logoUrl = req.file ? await saveLogoFile(req.file, req.body.store_subdomain || 'store') : '';

          try {
            const store = await createPlatformStore(req, ownerAuth, {
              name: req.body.store_name || `${String(req.body.name || 'New').trim() || 'New'} Store`,
              subdomain: req.body.store_subdomain,
              logo_url: logoUrl || null,
              theme_color: req.body.theme_color,
              store_type: req.body.store_type,
              template_key: req.body.template_key,
              font_preset: req.body.font_preset
            });

            upsertStoreContent(store.id, {});
            return res.redirect(`/dashboard?success=${encodeURIComponent(`${store.name} created successfully`)}`);
          } catch (error) {
            if (Number(error.status) === 403) {
              return res.redirect('/dashboard?success=Account created&error=Add a card and finish the 7-day trial setup before creating your first store.');
            }

            throw error;
          }
        }

        return res.redirect(`${getPlatformHomePath(registration?.user || ownerAuth)}?success=Welcome%20to%20Aisle`);
      } catch (error) {
        if ([400, 401, 403, 409, 422].includes(Number(error.status))) {
          return res.redirect(`/signup?error=${encodeURIComponent(error.message || 'Unable to create the account right now.')}`);
        }

        return next(error);
      }
    }
  );

  app.get('/login', rateLimit({
    windowMs: env.authPageRateLimitWindowMs,
    limit: env.authPageRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  }), (req, res) => {
    if (isStorefrontHost(req)) {
      if (!resolveStore(req)) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      return renderCustomerLogin(req, res);
    }

    if (req.platformAuth && req.currentPlatformUser) {
      return res.redirect(getPlatformHomePath(req.currentPlatformUser));
    }

    return renderOwnerLogin(req, res);
  });

  app.post('/login', rateLimit({
    windowMs: env.authRateLimitWindowMs,
    limit: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  }), ownerLoginValidation, handleFormValidation((req, res, errors) => {
    if (isStorefrontHost(req)) {
      return renderCustomerLogin(req, res, errors, 422);
    }

    return renderOwnerLogin(req, res, errors, 422);
  }), async (req, res, next) => {
    try {
      if (isStorefrontHost(req)) {
        const store = resolveStore(req);
        if (!store) {
          return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
        }

        await loginStorefrontCustomer(req, res, store, {
          email: req.body.email,
          password: req.body.password
        });

        const redirectTarget = resolveSafeLocalRedirect(req, req.body.returnTo || req.query.returnTo, '/account?success=Signed in', store);
        return res.redirect(redirectTarget);
      }

      const response = await loginPlatformUser(req, res, {
        email: req.body.email,
        password: req.body.password
      });

      return res.redirect(resolveSafeLocalRedirect(
        req,
        req.body.returnTo || req.query.returnTo,
        getPlatformHomePath(response?.user || req.platformAuth)
      ));
    } catch (error) {
      if ([400, 401, 403].includes(Number(error.status))) {
        return res.redirect(`/login?error=${encodeURIComponent(error.message || 'Unable to sign in with those credentials.')}`);
      }

      return next(error);
    }
  });

  app.get('/forgot-password', authPageRateLimiter, (req, res) => {
    if (isStorefrontHost(req)) {
      if (!resolveStore(req)) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      return renderCustomerForgotPassword(req, res);
    }

    return renderOwnerForgotPassword(req, res);
  });

  app.post('/forgot-password', authRateLimiter, passwordResetRequestValidation, handleFormValidation((req, res, errors) => {
    if (isStorefrontHost(req)) {
      return renderCustomerForgotPassword(req, res, errors, 422);
    }

    return renderOwnerForgotPassword(req, res, errors, 422);
  }), async (req, res, next) => {
    try {
      if (isStorefrontHost(req)) {
        const store = resolveStore(req);
        if (!store) {
          return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
        }

        await requestStorefrontPasswordReset(req, store, {
          email: req.body.email
        });
      } else {
        await requestPlatformPasswordReset(req, {
          email: req.body.email
        });
      }

      const email = encodeURIComponent(String(req.body.email || '').trim());
      return res.redirect(`/reset-password?email=${email}&success=${encodeURIComponent('If that account exists, an OTP has been sent to the email address.')}`);
    } catch (error) {
      if ([400, 404, 422].includes(Number(error.status))) {
        const target = isStorefrontHost(req) ? '/forgot-password' : '/forgot-password';
        return res.redirect(`${target}?error=${encodeURIComponent(error.message || 'Unable to send a reset OTP right now.')}`);
      }

      return next(error);
    }
  });

  app.get('/reset-password', authPageRateLimiter, (req, res) => {
    if (req.query.email || req.query.returnTo) {
      req.body = {
        ...req.body,
        email: req.query.email || '',
        returnTo: req.query.returnTo || ''
      };
    }

    if (isStorefrontHost(req)) {
      if (!resolveStore(req)) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      return renderCustomerResetPassword(req, res);
    }

    return renderOwnerResetPassword(req, res);
  });

  app.post('/reset-password', authRateLimiter, passwordResetConfirmValidation, handleFormValidation((req, res, errors) => {
    if (isStorefrontHost(req)) {
      return renderCustomerResetPassword(req, res, errors, 422);
    }

    return renderOwnerResetPassword(req, res, errors, 422);
  }), async (req, res, next) => {
    try {
      if (isStorefrontHost(req)) {
        const store = resolveStore(req);
        if (!store) {
          return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
        }

        await confirmStorefrontPasswordReset(req, store, {
          email: req.body.email,
          otp: req.body.otp,
          password: req.body.password
        });
      } else {
        await confirmPlatformPasswordReset(req, {
          email: req.body.email,
          otp: req.body.otp,
          password: req.body.password
        });
      }

      return res.redirect(`/login?success=${encodeURIComponent('Password reset complete. Sign in with your new password.')}`);
    } catch (error) {
      if ([400, 401, 404, 422].includes(Number(error.status))) {
        return res.redirect(`/reset-password?email=${encodeURIComponent(req.body.email || '')}&error=${encodeURIComponent(error.message || 'Unable to reset the password.')}`);
      }

      return next(error);
    }
  });

  app.get('/platform-admin/login', rateLimit({
    windowMs: env.authPageRateLimitWindowMs,
    limit: env.authPageRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  }), (req, res) => {
    if (req.platformAuth && req.currentPlatformUser && isPlatformAdminUser(req.currentPlatformUser)) {
      return res.redirect('/platform-admin');
    }

    return renderPlatformAdminLogin(req, res);
  });

  app.post('/platform-admin/login', rateLimit({
    windowMs: env.authRateLimitWindowMs,
    limit: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  }), ownerLoginValidation, handleFormValidation((req, res, errors) => {
    return renderPlatformAdminLogin(req, res, errors, 422);
  }), async (req, res, next) => {
    try {
      const response = await loginPlatformUser(req, res, {
        email: req.body.email,
        password: req.body.password
      });

      if (!isPlatformAdminUser(response?.user)) {
        clearWebAuthCookies(req, res);
        return res.redirect('/platform-admin/login?error=That account does not have platform admin access.');
      }

      return res.redirect(resolveSafeLocalRedirect(req, req.body.returnTo || req.query.returnTo, '/platform-admin'));
    } catch (error) {
      if ([400, 401, 403].includes(Number(error.status))) {
        return res.redirect(`/platform-admin/login?error=${encodeURIComponent(error.message || 'Unable to sign in with those credentials.')}`);
      }

      return next(error);
    }
  });

  app.post('/billing/subscribe', subscriptionCheckoutValidation, handleFormValidation((req, res) => {
    return res.redirect('/dashboard?error=Choose a valid plan before starting the trial.');
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res)) {
        return;
      }

      const checkout = await createOwnerSubscriptionCheckout(req, req.platformAuth, {
        plan: req.body.plan,
        billing_cycle: req.body.billing_cycle || 'monthly',
        currency: res.locals.selectedCurrency || 'USD',
        email: req.currentPlatformUser?.email || null,
        callback_url: buildPlatformAbsoluteUrl(req, '/billing/callback')
      });
      const checkoutUrl = checkout?.providers?.[0]?.checkout_url;

      if (!checkoutUrl) {
        return res.redirect('/dashboard?error=Unable to start the billing session right now.');
      }

      return res.redirect(checkoutUrl);
    } catch (error) {
      if ([400, 403, 404, 422].includes(Number(error.status))) {
        return res.redirect(`/dashboard?error=${encodeURIComponent(error.message || 'Unable to start the billing session right now.')}`);
      }

      return next(error);
    }
  });

  app.get('/billing/callback', rateLimit({
    windowMs: env.authRateLimitWindowMs,
    limit: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res)) {
        return;
      }

      const reference = String(req.query.reference || req.query.trxref || '').trim();
      if (!reference) {
        return res.redirect('/dashboard?error=Payment reference was not returned by the payment provider.');
      }

      const verification = await verifyOwnerSubscriptionCheckout(req, req.platformAuth, reference);
      const subscription = verification?.subscription || null;
      if (subscription && ['trialing', 'active'].includes(String(subscription.status || '').toLowerCase())) {
        return res.redirect('/dashboard?success=Card verified and your 7-day trial is now active.');
      }

      return res.redirect('/dashboard?error=We could not activate the trial with that payment method. Please try another card.');
    } catch (error) {
      if ([400, 403, 404, 422].includes(Number(error.status))) {
        return res.redirect(`/dashboard?error=${encodeURIComponent(error.message || 'Unable to verify the billing session.')}`);
      }

      return next(error);
    }
  });

  app.get('/dashboard', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res)) {
        return;
      }

      if (isPlatformAdminUser(req.currentPlatformUser)) {
        return res.redirect(getPlatformHomePath(req.currentPlatformUser));
      }

      return await renderOwnerDashboard(req, res);
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    '/stores',
    authRateLimiter,
    handleMultipartLogo((req, res) => {
      return res.redirect('/dashboard?error=Logo upload failed. Please try a PNG, JPEG, or WebP under 2MB.');
    }),
    doubleCsrfProtection,
    storeCreationValidation,
    handleFormValidation((req, res) => {
      return res.redirect('/dashboard?error=Review the store fields and try again.');
    }),
    async (req, res, next) => {
      try {
        if (requirePlatformUser(req, res)) {
          return;
        }

        const logoUrl = req.file ? await saveLogoFile(req.file, req.body.subdomain || 'store') : '';
        const store = await createPlatformStore(req, req.platformAuth, {
          name: req.body.name,
          subdomain: req.body.subdomain,
          logo_url: logoUrl || null,
          theme_color: req.body.theme_color,
          store_type: req.body.store_type,
          template_key: req.body.template_key,
          font_preset: req.body.font_preset
        });

        upsertStoreContent(store.id, {});
        return res.redirect(`/dashboard?success=${encodeURIComponent(`${store.name} created successfully`)}`);
      } catch (error) {
        if ([400, 403, 409, 422].includes(Number(error.status))) {
          return res.redirect(`/dashboard?error=${encodeURIComponent(error.message || 'Unable to create the store.')}`);
        }

        return next(error);
      }
    }
  );

  app.get('/stores/:id/manage', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res)) {
        return;
      }

      const store = mergeStorePresentation(await getPlatformStoreById(req, req.platformAuth, req.params.id));
      return res.redirect(safeRedirect(req, buildStoreAdminUrl(store), '/dashboard?error=Store not found', store, {
        preferRelative: false
      }));
    } catch (error) {
      if ([403, 404].includes(Number(error.status))) {
        return res.redirect('/dashboard?error=Store not found');
      }

      return next(error);
    }
  });

  app.get('/stores/:id/preview', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res)) {
        return;
      }

      const store = mergeStorePresentation(await getPlatformStoreById(req, req.platformAuth, req.params.id));
      return res.redirect(safeRedirect(req, buildStorefrontUrl(store), '/dashboard?error=Store not found', store, {
        preferRelative: false
      }));
    } catch (error) {
      if ([403, 404].includes(Number(error.status))) {
        return res.redirect('/dashboard?error=Store not found');
      }

      return next(error);
    }
  });

  app.post('/platform-admin/billing/plans', adminBillingPlanValidation, handleFormValidation((req, res) => {
    return res.redirect('/platform-admin?error=Review the subscription fee fields and try again.');
  }), async (req, res, next) => {
    try {
      if (requirePlatformAdmin(req, res)) {
        return;
      }

      if (String(req.currentPlatformUser?.role || '').trim().toLowerCase() !== PLATFORM_ROLES.PLATFORM_OWNER) {
        return res.redirect('/platform-admin?error=Only the platform owner can change subscription pricing.');
      }

      await updateAdminBillingPlan(req, req.platformAuth, {
        plan: req.body.plan,
        currency: req.body.currency,
        monthly_amount: req.body.monthly_amount,
        yearly_discount_percentage: req.body.yearly_discount_percentage
      });

      return res.redirect(`/platform-admin?success=${encodeURIComponent('Subscription pricing updated successfully.')}`);
    } catch (error) {
      if ([400, 403, 404, 422].includes(Number(error.status))) {
        return res.redirect(`/platform-admin?error=${encodeURIComponent(error.message || 'Unable to update subscription pricing right now.')}`);
      }

      return next(error);
    }
  });

  app.get('/platform-admin', async (req, res, next) => {
    try {
      if (requirePlatformAdmin(req, res)) {
        return;
      }

      return await renderPlatformAdminOverview(req, res);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/platform-admin/stores', (req, res) => {
    if (requirePlatformAdmin(req, res)) {
      return;
    }

    return renderPlatformAdmin(res, 'platform/control-placeholder', {
      pageTitle: 'Store directory preview',
      placeholderEyebrow: 'Tenant directory',
      placeholderTitle: 'The multi-store directory is staged, not simulated.',
      placeholderBody: 'Store ownership, preview, and admin access already work from the owner workspace. A true platform-wide directory for support and operations has not been enabled in this build yet.',
      placeholderHighlights: [
        'Use the owner workspace to open any store you own right now.',
        'Cross-tenant staff tooling will appear here once it is backed by real permissions and workflows.'
      ]
    });
  });

  app.get('/platform-admin/support', (req, res) => {
    if (requirePlatformAdmin(req, res)) {
      return;
    }

    return renderPlatformAdmin(res, 'platform/control-placeholder', {
      pageTitle: 'Support preview',
      placeholderEyebrow: 'Support operations',
      placeholderTitle: 'There is no platform support queue in this build yet.',
      placeholderBody: 'Rather than showing fake conversations or seeded customers, Aisle keeps this area disabled until support workflows are connected to real data and permissions.',
      placeholderHighlights: [
        'Storefront customers and orders are real.',
        'Platform-level support inboxes and reply tools are not enabled here yet.'
      ]
    });
  });

  app.get('/platform-admin/incidents', (req, res) => {
    if (requirePlatformAdmin(req, res)) {
      return;
    }

    return renderPlatformAdmin(res, 'platform/control-placeholder', {
      pageTitle: 'Incident preview',
      placeholderEyebrow: 'Incident operations',
      placeholderTitle: 'Incident management is reserved for a future release.',
      placeholderBody: 'This area is intentionally withheld until there is a real reliability workflow behind it. No mock incidents, fabricated severities, or placeholder responders are shown as if they were live.',
      placeholderHighlights: [
        'The storefront and store admin operate on real service data.',
        'Platform-wide reliability tooling will land here when it is ready to be trusted.'
      ]
    });
  });
};

module.exports = {
  registerPlatformRoutes
};
