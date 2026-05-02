const createRenderers = (context, helpers, paymentProviderService) => {
  const {
    env,
    fs,
    path,
    brand,
    mergeStorePresentation,
    getStoreTheme,
    safeRedirect
  } = context;
  const {
    resolveStore,
    getCurrentCustomer,
    getWishlistProductIds,
    buildPlatformMeta,
    buildStorefrontMeta,
    resolveFormReturnTo,
    buildFormData,
    buildOwnerDashboardMetrics,
    buildStorefrontUrl,
    buildStoreAdminUrl,
    buildStoreSeoDescription,
    wantsJson
  } = helpers;
  const {
    createEmptyPaymentProviderConfigs,
    buildPaymentProviderDrafts
  } = paymentProviderService;

  const supportedErrorPageStatuses = new Set([400, 401, 403, 404, 422, 429, 500, 502, 503]);

  const renderPlatform = (res, view, payload = {}) => {
    const platformMeta = buildPlatformMeta(res.req, payload, res.locals.platformBrand);
    return res.render(view, {
      layout: 'layouts/main',
      ...platformMeta,
      ...payload
    });
  };

  const renderStorefront = (req, res, view, payload = {}) => {
    const store = resolveStore(req);
    const customer = getCurrentCustomer(req);
    const cart = req.currentCart || { items: [], total: 0 };
    const storeTheme = getStoreTheme(store);
    const storefrontMeta = buildStorefrontMeta(req, store, payload);
    const wishlistIds = store?.id ? getWishlistProductIds(req, store.id) : [];

    return res.render(view, {
      layout: 'layouts/store',
      store,
      storeTheme,
      customer,
      cart,
      wishlistIds,
      wishlistProducts: payload.wishlistProducts || [],
      wishlistCount: wishlistIds.length,
      recentlyViewedProducts: payload.recentlyViewedProducts || [],
      ...storefrontMeta,
      ...payload
    });
  };

  const renderStoreAdmin = (req, res, view, payload = {}) => {
    const store = resolveStore(req);
    return res.render(view, {
      layout: 'layouts/admin',
      store,
      storeTheme: store ? getStoreTheme(store) : null,
      pageBrandLabel: store?.name || '',
      metaRobots: payload.metaRobots || 'noindex, nofollow',
      ...payload
    });
  };

  const renderPlatformAdmin = (res, view, payload = {}) => {
    const platformMeta = buildPlatformMeta(res.req, payload, res.locals.platformBrand);
    return res.render(view, {
      layout: 'layouts/platform-admin',
      ...platformMeta,
      ...payload
    });
  };

  const renderOwnerDashboard = async (req, res, options = {}) => {
    const ownerStores = await helpers.listPlatformStores(req, req.platformAuth);
    const stores = ownerStores.map((store) => mergeStorePresentation(store));
    const billing = await helpers.getOwnerSubscription(req, req.platformAuth);
    const billingPlans = await context.getPublicBillingPlans(req, {
      currency: res.locals.selectedCurrency || 'USD'
    });

    res.status(options.status || 200);
    return renderPlatform(res, 'platform/dashboard', {
      pageTitle: 'Owner dashboard',
      stores,
      metrics: buildOwnerDashboardMetrics(stores, billing.subscription),
      subscription: billing.subscription,
      latestInvoice: billing.latestInvoice,
      billingPlans,
      errors: options.errors || {}
    });
  };

  const renderCustomerSignup = (req, res, errors = {}, status = 200) => {
    const store = resolveStore(req);
    res.status(status);
    return renderStorefront(req, res, 'storefront/register', {
      pageTitle: 'Create account',
      errors,
      formData: buildFormData(req, ['name', 'email', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/account', store)
    });
  };

  const renderCustomerLogin = (req, res, errors = {}, status = 200) => {
    const store = resolveStore(req);
    res.status(status);
    return renderStorefront(req, res, 'storefront/login', {
      pageTitle: 'Sign in',
      errors,
      formData: buildFormData(req, ['email', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/account', store)
    });
  };

  const renderCustomerForgotPassword = (req, res, errors = {}, status = 200) => {
    const store = resolveStore(req);
    res.status(status);
    return renderStorefront(req, res, 'storefront/forgot-password', {
      pageTitle: 'Forgot password',
      errors,
      formData: buildFormData(req, ['email', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/account', store)
    });
  };

  const renderCustomerResetPassword = (req, res, errors = {}, status = 200) => {
    const store = resolveStore(req);
    res.status(status);
    return renderStorefront(req, res, 'storefront/reset-password', {
      pageTitle: 'Reset password',
      errors,
      formData: buildFormData(req, ['email', 'otp', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/account', store)
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
      formData: buildFormData(req, ['email', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/dashboard')
    });
  };

  const renderOwnerForgotPassword = (req, res, errors = {}, status = 200) => {
    res.status(status);
    return renderPlatform(res, 'platform/forgot-password', {
      pageTitle: 'Forgot password',
      errors,
      formData: buildFormData(req, ['email', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/dashboard')
    });
  };

  const renderOwnerResetPassword = (req, res, errors = {}, status = 200) => {
    res.status(status);
    return renderPlatform(res, 'platform/reset-password', {
      pageTitle: 'Reset password',
      errors,
      formData: buildFormData(req, ['email', 'otp', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/dashboard')
    });
  };

  const renderPlatformAdminLogin = (req, res, errors = {}, status = 200) => {
    res.status(status);
    return renderPlatform(res, 'platform/admin-login', {
      pageTitle: 'Platform admin sign in',
      errors,
      formData: buildFormData(req, ['email', 'returnTo']),
      returnTo: resolveFormReturnTo(req, '/platform-admin')
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
      errors,
      paymentProviderConfigs: req.storePaymentProviderConfigs || createEmptyPaymentProviderConfigs(),
      paymentProviderDrafts: buildPaymentProviderDrafts(req),
      paymentProviderConfigWarning: req.storePaymentProviderConfigWarning || ''
    });
  };

  const renderDomainPage = (req, res, errors = {}, status = 200) => {
    res.status(status);
    return renderStoreAdmin(req, res, 'admin/domain', {
      pageTitle: 'Domain setup',
      errors
    });
  };

  const renderMarketingPage = (req, res, payload = {}, status = 200) => {
    res.status(status);
    return renderStoreAdmin(req, res, 'admin/marketing', {
      pageTitle: 'Promotions',
      errors: payload.errors || {},
      formData: payload.formData || {},
      coupons: payload.coupons || [],
      editingCouponId: payload.editingCouponId || null
    });
  };

  const renderCheckoutPage = (req, res, errors = {}, status = 200) => {
    res.status(status);
    return renderStorefront(req, res, 'storefront/checkout', {
      pageTitle: 'Checkout',
      errors,
      couponPreview: req.storeCouponPreview || null
    });
  };

  const resolveErrorView = (status) => {
    const normalizedStatus = supportedErrorPageStatuses.has(Number(status)) ? Number(status) : 500;
    const targetPath = path.join(context.viewsDir, 'errors', `${normalizedStatus}.ejs`);
    return fs.existsSync(targetPath) ? `errors/${normalizedStatus}` : 'errors/500';
  };

  const resolveErrorLayout = (req) => {
    if (req.path.startsWith('/platform-admin')) {
      return 'layouts/platform-admin';
    }

    if (req.path.startsWith('/admin')) {
      return 'layouts/admin';
    }

    return helpers.isStorefrontHost(req) ? 'layouts/store' : 'layouts/main';
  };

  const resolveErrorHomeHref = (req) => {
    if (req.path.startsWith('/platform-admin')) {
      return '/platform-admin';
    }

    if (req.path.startsWith('/admin')) {
      return '/admin';
    }

    if (!helpers.isStorefrontHost(req)) {
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
          const field = context.sanitizePlainText(entry.field || '', { maxLength: 80 });
          const message = context.sanitizePlainText(entry.message || '', { maxLength: 180 });
          return field ? `${field}: ${message}` : message;
        })
        .filter(Boolean);
    }

    if (Array.isArray(error.details)) {
      return error.details
        .slice(0, 5)
        .map((entry) => context.sanitizePlainText(String(entry || ''), { maxLength: 180 }))
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
    const customer = store ? getCurrentCustomer(req) : null;
    const cart = req.currentCart || { items: [], total: 0 };

    return res.status(Number(status || errorState.statusCode || 500)).render(resolveErrorView(errorState.statusCode), {
      layout,
      pageTitle: overrides.pageTitle || errorState.title,
      metaDescription: errorState.message,
      metaRobots: 'noindex, nofollow',
      store,
      storeTheme: getStoreTheme(store),
      customer,
      cart,
      errorState
    });
  };

  return {
    supportedErrorPageStatuses,
    renderPlatform,
    renderStorefront,
    renderStoreAdmin,
    renderPlatformAdmin,
    renderOwnerDashboard,
    renderCustomerSignup,
    renderCustomerLogin,
    renderCustomerForgotPassword,
    renderCustomerResetPassword,
    renderOwnerSignup,
    renderOwnerLogin,
    renderOwnerForgotPassword,
    renderOwnerResetPassword,
    renderPlatformAdminLogin,
    renderProductForm,
    renderSettingsPage,
    renderDomainPage,
    renderMarketingPage,
    renderCheckoutPage,
    resolveErrorView,
    resolveErrorLayout,
    resolveErrorHomeHref,
    buildErrorDetailItems,
    buildErrorPageState,
    renderErrorPage,
    buildStorefrontUrl,
    buildStoreAdminUrl,
    buildStoreSeoDescription,
    wantsJson,
    brand
  };
};

module.exports = {
  createRenderers
};
