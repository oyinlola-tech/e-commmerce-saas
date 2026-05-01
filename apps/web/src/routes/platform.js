const registerPlatformRoutes = (app, deps) => {
  const { context, helpers, validations, renderers } = deps;
  const {
    authRateLimiter,
    authPageRateLimiter,
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
    createPlatformStore,
    getPlatformStoreById
  } = context;
  const {
    resolveStore,
    isStorefrontHost,
    resolveSafeLocalRedirect,
    buildStoreSeoDescription,
    buildStoreSeoKeywords,
    buildStorefrontAssetUrl,
    sortProducts,
    decorateProducts,
    buildProductDiscovery,
    buildStoreStats,
    requirePlatformUser,
    handleMultipartLogo,
    buildStorefrontUrl,
    buildStoreAdminUrl,
    setCurrencyPreferenceCookie
  } = helpers;
  const {
    currencyValidation,
    ownerSignupValidation,
    ownerLoginValidation,
    storeCreationValidation
  } = validations;
  const {
    renderPlatform,
    renderStorefront,
    renderCustomerSignup,
    renderOwnerSignup,
    renderCustomerLogin,
    renderOwnerLogin,
    renderOwnerDashboard,
    renderPlatformAdmin,
    renderErrorPage
  } = renderers;

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
    return res.redirect(safeReturnTo);
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
          products: sortedProducts,
          featuredProducts: sortedProducts.filter((product) => product.featured).slice(0, 4),
          categories: productResult.categories || discovery.categories,
          discoveryTags: discovery.tags.slice(0, 8),
          stats: buildStoreStats({ store, products: sortedProducts })
        });
      }

      return renderPlatform(res, 'platform/index', {
        pageTitle: 'Aisle',
        metaDescription: 'Aisle gives retail teams a polished storefront, real authentication, and an owner workspace that feels like product, not a mockup.',
        metrics: {},
        stores: []
      });
    } catch (error) {
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
      return res.redirect('/dashboard');
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
              return res.redirect('/dashboard?success=Account created&error=Store setup will unlock as soon as the trial subscription finishes provisioning.');
            }

            throw error;
          }
        }

        return res.redirect('/dashboard?success=Welcome to Aisle');
      } catch (error) {
        if ([400, 401, 403, 409, 422].includes(Number(error.status))) {
          return res.redirect(`/signup?error=${encodeURIComponent(error.message || 'Unable to create the account right now.')}`);
        }

        return next(error);
      }
    }
  );

  app.get('/login', authPageRateLimiter, (req, res) => {
    if (isStorefrontHost(req)) {
      if (!resolveStore(req)) {
        return renderErrorPage(req, res, 404, createHttpError(404, 'Store not found.', null, { expose: true }));
      }

      return renderCustomerLogin(req, res);
    }

    if (req.platformAuth && req.currentPlatformUser) {
      return res.redirect('/dashboard');
    }

    return renderOwnerLogin(req, res);
  });

  app.post('/login', authRateLimiter, ownerLoginValidation, handleFormValidation((req, res, errors) => {
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

      await loginPlatformUser(req, res, {
        email: req.body.email,
        password: req.body.password
      });

      return res.redirect(resolveSafeLocalRedirect(req, req.body.returnTo || req.query.returnTo, '/dashboard'));
    } catch (error) {
      if ([400, 401, 403].includes(Number(error.status))) {
        return res.redirect(`/login?error=${encodeURIComponent(error.message || 'Unable to sign in with those credentials.')}`);
      }

      return next(error);
    }
  });

  app.get('/dashboard', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res)) {
        return;
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

  app.get('/platform-admin', (req, res) => {
    if (requirePlatformUser(req, res)) {
      return;
    }

    return renderPlatformAdmin(res, 'platform/control-placeholder', {
      pageTitle: 'Operations preview',
      placeholderEyebrow: 'Operations preview',
      placeholderTitle: 'Platform operations are not enabled in this build.',
      placeholderBody: 'Aisle no longer ships fake tenant data, seeded support queues, or fabricated incident dashboards. This workspace stays intentionally empty until the real multi-tenant operations layer is ready.',
      placeholderHighlights: [
        'Owner accounts, store creation, storefronts, and store admin are live.',
        'Platform-wide support, incident management, and tenant oversight are reserved for a later release.',
        'You will see an honest placeholder here instead of demo records that look production-ready.'
      ]
    });
  });

  app.get('/platform-admin/stores', (req, res) => {
    if (requirePlatformUser(req, res)) {
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
    if (requirePlatformUser(req, res)) {
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
    if (requirePlatformUser(req, res)) {
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
