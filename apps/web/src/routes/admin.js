const { param } = require('express-validator');

const registerAdminRoutes = (app, deps) => {
  const { context, helpers, validations, renderers, paymentProviderService } = deps;
  const {
    mergeProductPresentation,
    removeProductContent,
    upsertProductContent,
    upsertStoreContent,
    handleFormValidation,
    saveLogoFile,
    listStoreProducts,
    listStoreCoupons,
    listAdminStoreOrders,
    listAdminStoreCustomers,
    getAdminStoreProductById,
    createAdminStoreProduct,
    createStoreCoupon,
    updateAdminStoreProduct,
    updateStoreCoupon,
    deleteAdminStoreProduct,
    getAdminStoreOrderById,
    refundAdminStoreOrder,
    updateAdminStoreOrderStatus,
    getOwnerSubscriptionAccess,
    syncPlatformStoreOnboarding,
    updatePlatformStore,
    storePaymentProviders,
    doubleCsrfProtection,
    validate,
    allowBodyFields,
    commonRules,
    sanitizePlainText,
    normalizeHostname
  } = context;
  const {
    requirePlatformUser,
    requireActiveStore,
    resolveStore,
    decorateProducts,
    hasPlanCapability,
    buildStoreStats,
    buildStoreOnboardingGuide,
    buildStoreLaunchChecklist,
    buildProductDraft,
    buildProductServicePayload,
    buildProductPresentationPayload,
    buildStoreServicePayload,
    buildStoreContentPayload,
    handleMultipartLogo,
    parseCheckbox
  } = helpers;
  const {
    productValidation,
    couponValidation,
    orderStatusValidation,
    storeSettingsValidation,
    domainValidation
  } = validations;
  const {
    renderStoreAdmin,
    renderProductForm,
    renderSettingsPage,
    renderDomainPage,
    renderMarketingPage
  } = renderers;
  const {
    loadStorePaymentProviderConfigs,
    buildPaymentProviderDrafts,
    createEmptyPaymentProviderConfigs,
    shouldPersistPaymentProviderConfig,
    upsertStorePaymentProviderConfig
  } = paymentProviderService;

  const buildCouponFormData = (coupon = {}) => {
    return {
      id: coupon.id || '',
      code: coupon.code || '',
      description: coupon.description || '',
      discount_type: coupon.discount_type || 'percentage',
      discount_value: coupon.discount_value === null || coupon.discount_value === undefined ? '' : coupon.discount_value,
      minimum_order_amount: coupon.minimum_order_amount === null || coupon.minimum_order_amount === undefined ? '' : coupon.minimum_order_amount,
      starts_at: coupon.starts_at || '',
      ends_at: coupon.ends_at || '',
      usage_limit: coupon.usage_limit === null || coupon.usage_limit === undefined ? '' : coupon.usage_limit,
      is_active: coupon.is_active === undefined ? true : Boolean(coupon.is_active)
    };
  };

  const loadMarketingCoupons = async (req, res, next) => {
    try {
      if (!req.currentStore?.id || !req.platformAuth) {
        req.storeCoupons = [];
        return next();
      }

      req.storeCoupons = await listStoreCoupons(req, req.currentStore, req.platformAuth);
      return next();
    } catch (error) {
      return next(error);
    }
  };

  const loadStoreSubscriptionAccess = async (req, res, next) => {
    try {
      if (!req.currentStore?.owner_id || !req.platformAuth) {
        req.storeSubscriptionAccess = null;
        return next();
      }

      req.storeSubscriptionAccess = await getOwnerSubscriptionAccess(
        req,
        req.platformAuth,
        req.currentStore.owner_id
      );
      return next();
    } catch (error) {
      return next(error);
    }
  };

  const automatedMarketingLocked = (req) => {
    return !hasPlanCapability(req.storeSubscriptionAccess?.entitlements, 'automated_marketing');
  };

  const automatedMarketingUpgradeMessage = 'Automated marketing requires the Scale plan or higher. Existing coupons stay visible, but editing is locked until you upgrade.';

  const buildAndSyncStoreOnboarding = async (req, store, products = [], orders = []) => {
    const onboarding = buildStoreOnboardingGuide({
      store,
      products,
      orders,
      paymentProviderConfigs: req.storePaymentProviderConfigs || {},
      entitlements: req.storeSubscriptionAccess?.entitlements || null
    });

    let syncedState = null;
    if (store?.id && req.platformAuth && onboarding.tasks.length) {
      try {
        const synced = await syncPlatformStoreOnboarding(req, req.platformAuth, store.id, onboarding.tasks);
        syncedState = synced?.state || null;
      } catch (error) {
        req.log?.warn('store_onboarding_sync_failed', {
          storeId: store.id,
          status: error.status,
          error: error.message
        });
      }
    }

    return {
      ...onboarding,
      state: syncedState || {
        ...onboarding.progress,
        current_step: onboarding.progress.current_step
      }
    };
  };

  app.get('/admin', loadStorePaymentProviderConfigs, loadStoreSubscriptionAccess, async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const store = resolveStore(req);
      const [productResult, orders, customers] = await Promise.all([
        listStoreProducts(req, store, { limit: 200, auth: req.platformAuth }),
        listAdminStoreOrders(req, store, req.platformAuth, { limit: 100 }),
        listAdminStoreCustomers(req, store, req.platformAuth)
      ]);
      const products = decorateProducts(productResult.products || []);
      const onboarding = await buildAndSyncStoreOnboarding(req, store, products, orders);

      return renderStoreAdmin(req, res, 'admin/dashboard', {
        pageTitle: 'Store admin',
        products,
        orders,
        recentOrders: orders.slice(0, 5),
        stats: buildStoreStats({ store, products, orders, customers }),
        launchChecklist: buildStoreLaunchChecklist({
          store,
          products,
          orders,
          paymentProviderConfigs: req.storePaymentProviderConfigs || {},
          entitlements: req.storeSubscriptionAccess?.entitlements || null
        }),
        onboardingProgress: onboarding.state,
        supportQueue: [],
        customers: customers.slice(0, 5)
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/onboarding', loadStorePaymentProviderConfigs, loadStoreSubscriptionAccess, async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const store = resolveStore(req);
      const [productResult, orders] = await Promise.all([
        listStoreProducts(req, store, { limit: 200, auth: req.platformAuth }),
        listAdminStoreOrders(req, store, req.platformAuth, { limit: 100 })
      ]);
      const products = decorateProducts(productResult.products || []);
      const onboarding = await buildAndSyncStoreOnboarding(req, store, products, orders);

      return renderStoreAdmin(req, res, 'admin/onboarding', {
        pageTitle: 'Launch guide',
        onboardingTasks: onboarding.tasks,
        onboardingProgress: onboarding.state,
        orderCount: orders.length,
        publishedProductsCount: products.filter((entry) => String(entry.status || '').trim().toLowerCase() === 'published').length,
        paymentProvidersReady: Object.values(req.storePaymentProviderConfigs || {})
          .filter((entry) => String(entry?.status || '').trim().toLowerCase() === 'active')
          .length
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/products', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const productResult = await listStoreProducts(req, req.currentStore, {
        limit: 200,
        auth: req.platformAuth
      });

      return renderStoreAdmin(req, res, 'admin/products', {
        pageTitle: 'Products',
        products: decorateProducts(productResult.products || [])
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/products/new', (req, res) => {
    if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
      return;
    }

    return renderProductForm(req, res, null);
  });

  app.get('/admin/products/:id/edit', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const product = mergeProductPresentation(await getAdminStoreProductById(req, req.currentStore, req.platformAuth, req.params.id));
      return renderProductForm(req, res, product || null);
    } catch (error) {
      if (Number(error.status) === 404) {
        return res.redirect('/admin/products?error=Product not found');
      }

      return next(error);
    }
  });

  app.post('/admin/products', productValidation, handleFormValidation((req, res, errors) => {
    return renderProductForm(req, res, buildProductDraft(req), errors, 422);
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const product = await createAdminStoreProduct(req, req.currentStore, req.platformAuth, buildProductServicePayload(req));
      upsertProductContent(product.id, buildProductPresentationPayload(req));
      return res.redirect('/admin/products?success=Product created');
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/admin/products?error=${encodeURIComponent(error.message || 'Unable to create the product.')}`);
      }

      return next(error);
    }
  });

  app.post('/admin/products/:id', productValidation, handleFormValidation((req, res, errors) => {
    return renderProductForm(req, res, buildProductDraft(req, req.params.id), errors, 422);
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      await updateAdminStoreProduct(req, req.currentStore, req.platformAuth, req.params.id, buildProductServicePayload(req));
      upsertProductContent(req.params.id, buildProductPresentationPayload(req));
      return res.redirect('/admin/products?success=Product updated');
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/admin/products?error=${encodeURIComponent(error.message || 'Unable to update the product.')}`);
      }

      return next(error);
    }
  });

  app.post('/admin/products/:id/delete', validate([
    allowBodyFields(['_csrf']),
    param('id')
      .trim()
      .notEmpty()
      .isLength({ max: 120 })
      .withMessage('id is required.')
      .customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 }))
  ]), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      await deleteAdminStoreProduct(req, req.currentStore, req.platformAuth, req.params.id);
      removeProductContent(req.params.id);
      return res.redirect('/admin/products?success=Product deleted');
    } catch (error) {
      if ([403, 404].includes(Number(error.status))) {
        return res.redirect('/admin/products?error=Product not found');
      }

      return next(error);
    }
  });

  app.get('/admin/orders', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const orders = await listAdminStoreOrders(req, req.currentStore, req.platformAuth, { limit: 100 });
      return renderStoreAdmin(req, res, 'admin/orders', {
        pageTitle: 'Orders',
        orders
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/orders/:id', async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const order = await getAdminStoreOrderById(req, req.currentStore, req.platformAuth, req.params.id);
      return renderStoreAdmin(req, res, 'admin/order-detail', {
        pageTitle: order ? `Order #${order.id}` : 'Order detail',
        order: order || null
      });
    } catch (error) {
      if (Number(error.status) === 404) {
        return res.redirect('/admin/orders?error=Order not found');
      }

      return next(error);
    }
  });

  app.post('/admin/orders/:id/status', orderStatusValidation, handleFormValidation((req, res) => {
    return res.redirect('/admin/orders?error=Choose a valid order status.');
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const order = await updateAdminStoreOrderStatus(req, req.currentStore, req.platformAuth, req.params.id, req.body.status);
      return res.redirect(`/admin/orders/${order.id}?success=Order status updated`);
    } catch (error) {
      if ([403, 404].includes(Number(error.status))) {
        return res.redirect('/admin/orders?error=Order not found');
      }

      return next(error);
    }
  });

  app.post('/admin/orders/:id/refund', validate([
    allowBodyFields(['refund_reason', '_csrf']),
    param('id')
      .trim()
      .notEmpty()
      .isLength({ max: 120 })
      .withMessage('id is required.')
      .customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    commonRules.optionalPlainText('refund_reason', 255)
  ]), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      const order = await getAdminStoreOrderById(req, req.currentStore, req.platformAuth, req.params.id);
      if (!order || !order.payment_reference) {
        return res.redirect(`/admin/orders/${encodeURIComponent(req.params.id)}?error=${encodeURIComponent('This order does not have a refundable payment reference yet.')}`);
      }

      const refundResult = await refundAdminStoreOrder(
        req,
        req.currentStore,
        req.platformAuth,
        order.payment_reference,
        {
          reason: req.body.refund_reason || ''
        }
      );
      const normalizedRefundStatus = String(refundResult?.refund?.status || '').trim().toLowerCase();
      const nextOrderStatus = ['processed', 'successful', 'completed', 'refunded'].includes(normalizedRefundStatus)
        ? 'refunded'
        : 'refund_pending';

      await updateAdminStoreOrderStatus(req, req.currentStore, req.platformAuth, req.params.id, nextOrderStatus);
      return res.redirect(`/admin/orders/${encodeURIComponent(req.params.id)}?success=${encodeURIComponent('Refund initiated for this order.')}`);
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/admin/orders/${encodeURIComponent(req.params.id)}?error=${encodeURIComponent(error.message || 'Unable to refund the order right now.')}`);
      }

      return next(error);
    }
  });

  app.get('/admin/settings', loadStorePaymentProviderConfigs, (req, res) => {
    if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
      return;
    }

    return renderSettingsPage(req, res);
  });

  app.post(
    '/admin/settings',
    loadStorePaymentProviderConfigs,
    handleMultipartLogo((req, res, errors, status) => renderSettingsPage(req, res, errors, status)),
    doubleCsrfProtection,
    storeSettingsValidation,
    handleFormValidation((req, res, errors) => renderSettingsPage(req, res, errors, 422)),
    async (req, res, next) => {
      try {
        if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
          return;
        }

        const store = resolveStore(req);
        const logoUrl = req.file ? await saveLogoFile(req.file, store.id) : undefined;

        await updatePlatformStore(req, req.platformAuth, store.id, buildStoreServicePayload(req, {
          logoUrl
        }));
        upsertStoreContent(store.id, buildStoreContentPayload(req));

        const paymentProviderDrafts = buildPaymentProviderDrafts(req);
        const existingPaymentProviderConfigs = req.storePaymentProviderConfigs || createEmptyPaymentProviderConfigs();

        for (const provider of storePaymentProviders) {
          const draft = paymentProviderDrafts[provider] || {};
          const existingConfig = existingPaymentProviderConfigs[provider] || {};
          if (!shouldPersistPaymentProviderConfig(existingConfig, draft)) {
            continue;
          }

          await upsertStorePaymentProviderConfig(req, store, provider, draft);
        }

        return res.redirect('/admin/settings?success=Store settings updated');
      } catch (error) {
        if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
          return res.redirect(`/admin/settings?error=${encodeURIComponent(error.message || 'Unable to update store settings.')}`);
        }

        return next(error);
      }
    }
  );

  app.get('/admin/domain', (req, res) => {
    if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
      return;
    }

    return renderDomainPage(req, res);
  });

  app.post('/admin/domain', domainValidation, handleFormValidation((req, res, errors) => {
    return renderDomainPage(req, res, errors, 422);
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      await updatePlatformStore(req, req.platformAuth, req.currentStore.id, {
        custom_domain: normalizeHostname(req.body.custom_domain || '') || null
      });
      return res.redirect('/admin/domain?success=Domain settings saved');
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/admin/domain?error=${encodeURIComponent(error.message || 'Unable to update the domain settings.')}`);
      }

      return next(error);
    }
  });

  app.get('/admin/marketing', loadStoreSubscriptionAccess, loadMarketingCoupons, (req, res) => {
    if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
      return;
    }

    const editingCoupon = (req.storeCoupons || []).find((coupon) => String(coupon.id) === String(req.query.edit || '')) || null;
    return renderMarketingPage(req, res, {
      coupons: req.storeCoupons || [],
      formData: buildCouponFormData(editingCoupon || {}),
      editingCouponId: editingCoupon ? String(editingCoupon.id) : null,
      subscriptionAccess: req.storeSubscriptionAccess,
      marketingFeatureLocked: automatedMarketingLocked(req)
    });
  });

  app.post('/admin/marketing/coupons', loadStoreSubscriptionAccess, loadMarketingCoupons, couponValidation, handleFormValidation((req, res, errors) => {
    return renderMarketingPage(req, res, {
      coupons: req.storeCoupons || [],
      errors,
      formData: buildCouponFormData({
        ...req.body,
        is_active: parseCheckbox(req.body.is_active)
      }),
      subscriptionAccess: req.storeSubscriptionAccess,
      marketingFeatureLocked: automatedMarketingLocked(req)
    }, 422);
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      if (automatedMarketingLocked(req)) {
        return res.redirect(`/admin/marketing?error=${encodeURIComponent(automatedMarketingUpgradeMessage)}`);
      }

      await createStoreCoupon(req, req.currentStore, req.platformAuth, {
        code: req.body.code,
        description: req.body.description,
        discount_type: req.body.discount_type,
        discount_value: req.body.discount_value,
        minimum_order_amount: req.body.minimum_order_amount || 0,
        starts_at: req.body.starts_at || null,
        ends_at: req.body.ends_at || null,
        usage_limit: req.body.usage_limit || null,
        is_active: parseCheckbox(req.body.is_active)
      });

      return res.redirect('/admin/marketing?success=Coupon created');
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/admin/marketing?error=${encodeURIComponent(error.message || 'Unable to save the coupon.')}`);
      }

      return next(error);
    }
  });

  app.post('/admin/marketing/coupons/:id', loadStoreSubscriptionAccess, loadMarketingCoupons, couponValidation, handleFormValidation((req, res, errors) => {
    return renderMarketingPage(req, res, {
      coupons: req.storeCoupons || [],
      errors,
      formData: buildCouponFormData({
        ...req.body,
        id: req.params.id,
        is_active: parseCheckbox(req.body.is_active)
      }),
      editingCouponId: String(req.params.id),
      subscriptionAccess: req.storeSubscriptionAccess,
      marketingFeatureLocked: automatedMarketingLocked(req)
    }, 422);
  }), async (req, res, next) => {
    try {
      if (requirePlatformUser(req, res) || requireActiveStore(req, res)) {
        return;
      }

      if (automatedMarketingLocked(req)) {
        return res.redirect(`/admin/marketing?error=${encodeURIComponent(automatedMarketingUpgradeMessage)}`);
      }

      await updateStoreCoupon(req, req.currentStore, req.platformAuth, req.params.id, {
        code: req.body.code,
        description: req.body.description,
        discount_type: req.body.discount_type,
        discount_value: req.body.discount_value,
        minimum_order_amount: req.body.minimum_order_amount || 0,
        starts_at: req.body.starts_at || null,
        ends_at: req.body.ends_at || null,
        usage_limit: req.body.usage_limit || null,
        is_active: parseCheckbox(req.body.is_active)
      });

      return res.redirect('/admin/marketing?success=Coupon updated');
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(Number(error.status))) {
        return res.redirect(`/admin/marketing?error=${encodeURIComponent(error.message || 'Unable to update the coupon.')}`);
      }

      return next(error);
    }
  });
};

module.exports = {
  registerAdminRoutes
};
