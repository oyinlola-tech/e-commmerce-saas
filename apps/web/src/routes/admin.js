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
    listAdminStoreOrders,
    listAdminStoreCustomers,
    getAdminStoreProductById,
    createAdminStoreProduct,
    updateAdminStoreProduct,
    deleteAdminStoreProduct,
    getAdminStoreOrderById,
    updateAdminStoreOrderStatus,
    updatePlatformStore,
    storePaymentProviders,
    validate,
    allowBodyFields,
    sanitizePlainText,
    normalizeHostname
  } = context;
  const {
    requirePlatformUser,
    requireActiveStore,
    resolveStore,
    decorateProducts,
    buildStoreStats,
    buildProductDraft,
    buildProductServicePayload,
    buildProductPresentationPayload,
    buildStoreServicePayload,
    buildStoreContentPayload,
    handleMultipartLogo
  } = helpers;
  const {
    productValidation,
    orderStatusValidation,
    storeSettingsValidation,
    domainValidation
  } = validations;
  const {
    renderStoreAdmin,
    renderProductForm,
    renderSettingsPage,
    renderDomainPage
  } = renderers;
  const {
    loadStorePaymentProviderConfigs,
    buildPaymentProviderDrafts,
    createEmptyPaymentProviderConfigs,
    shouldPersistPaymentProviderConfig,
    upsertStorePaymentProviderConfig
  } = paymentProviderService;

  app.get('/admin', async (req, res, next) => {
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

      return renderStoreAdmin(req, res, 'admin/dashboard', {
        pageTitle: 'Store admin',
        products,
        orders,
        recentOrders: orders.slice(0, 5),
        stats: buildStoreStats({ store, products, orders, customers }),
        supportQueue: [],
        customers: customers.slice(0, 5)
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
};

module.exports = {
  registerAdminRoutes
};
