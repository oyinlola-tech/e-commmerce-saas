const applyRequestContextMiddleware = (app, context, helpers) => {
  const {
    env,
    ROOT_DOMAIN,
    storeTypes,
    storeTemplates,
    fontPresets,
    brand,
    systemAdminUser,
    mergeStorePresentation,
    getStoreTheme,
    buildCurrencyContext,
    getPlatformAuth,
    getCurrentPlatformUser,
    getPlatformStoreById,
    getStoreByHost: getBackendStoreByHost,
    getCurrentCustomer: getBackendCurrentCustomer,
    getCartForStore,
    ensureStorefrontSession,
    setSignedCookie,
    generateCsrfToken
  } = context;
  const {
    clearTokenCookie,
    requiresStoreContext,
    isStorefrontHost,
    isPlatformAdminUser,
    resolveRequestedStoreId,
    shouldLoadStorefrontIdentity,
    isStoreScopedPath,
    setCurrencyPreferenceCookie,
    buildStorefrontUrl,
    buildStoreAdminUrl
  } = helpers;

  app.use(async (req, res, next) => {
    try {
      req.platformAuth = getPlatformAuth(req);
      req.currentPlatformUser = null;
      req.currentStore = null;
      req.currentCustomer = null;
      req.customerAuth = null;
      req.currentCart = { items: [], total: 0 };
      req.currentCustomerOrders = [];

      if (req.platformAuth) {
        const platformState = await getCurrentPlatformUser(req);
        if (platformState.shouldClearToken) {
          clearTokenCookie(res, 'platform_token');
        }

        req.platformAuth = platformState.auth;
        req.currentPlatformUser = platformState.user;
      }

      if (requiresStoreContext(req)) {
        if (isStorefrontHost(req)) {
          try {
            req.currentStore = mergeStorePresentation(await getBackendStoreByHost(req));
          } catch (error) {
            if (Number(error.status) !== 404) {
              throw error;
            }
          }
        } else if (req.platformAuth) {
          const requestedStoreId = resolveRequestedStoreId(req);
          if (requestedStoreId) {
            try {
              const store = await getPlatformStoreById(req, req.platformAuth, requestedStoreId);
              req.currentStore = mergeStorePresentation(store);
              setSignedCookie(req, res, 'activeStoreId', requestedStoreId, {
                maxAge: 30 * 24 * 60 * 60 * 1000
              });
              req.signedCookies.activeStoreId = requestedStoreId;
            } catch (error) {
              if (![403, 404].includes(Number(error.status))) {
                throw error;
              }
            }
          }
        }
      }

      if (req.currentStore?.id && shouldLoadStorefrontIdentity(req) && req.query.guest !== '1') {
        const customerState = await getBackendCurrentCustomer(req, req.currentStore);
        if (customerState.shouldClearToken) {
          clearTokenCookie(res, 'customer_token');
        }

        req.currentCustomer = customerState.customer;
        req.customerAuth = customerState.auth;
        req.storefrontSessionId = ensureStorefrontSession(req, res);
        req.currentCart = await getCartForStore(req, req.currentStore, customerState.auth, req.storefrontSessionId);
      }

      const activeStore = req.currentStore;
      const pricingStore = isStorefrontHost(req) || req.path.startsWith('/admin') || isStoreScopedPath(req.path)
        ? activeStore
        : null;
      const currencyContext = await buildCurrencyContext(req, pricingStore);

      if (currencyContext.shouldPersistSelection) {
        setCurrencyPreferenceCookie(req, res, currencyContext.cookieName, currencyContext.selectedCurrency);
        req.signedCookies[currencyContext.cookieName] = currencyContext.selectedCurrency;
      }

      res.locals.pageTitle = '';
      res.locals.metaTitle = '';
      res.locals.metaDescription = '';
      res.locals.metaKeywords = '';
      res.locals.canonicalUrl = '';
      res.locals.socialImage = '';
      res.locals.metaType = 'website';
      res.locals.metaRobots = 'index, follow';
      res.locals.pageBrandLabel = '';
      res.locals.currentPath = req.path;
      res.locals.currentUrl = req.originalUrl;
      res.locals.platformBrand = {
        ...brand,
        platformName: 'Aisle',
        website: ROOT_DOMAIN,
        supportEmail: brand.supportEmail || (ROOT_DOMAIN === 'localhost' ? 'support@localhost' : `support@${ROOT_DOMAIN}`)
      };
      res.locals.platformUser = req.currentPlatformUser;
      res.locals.platformIsAdmin = isPlatformAdminUser(req.currentPlatformUser);
      res.locals.systemAdminUser = systemAdminUser;
      res.locals.success = req.query.success || null;
      res.locals.error = req.query.error || null;
      res.locals.currentStore = activeStore;
      res.locals.currentStoreTheme = activeStore ? getStoreTheme(activeStore) : null;
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
      res.locals.csrfToken = generateCsrfToken(req, res);
      res.locals.themeAssetVersion = context.themeAssetVersion;
      next();
    } catch (error) {
      next(error);
    }
  });
};

module.exports = {
  applyRequestContextMiddleware
};
