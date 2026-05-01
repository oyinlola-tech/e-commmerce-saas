const express = require('express');
const { createAppContext } = require('./config/app-context');
const { createAppHelpers } = require('./lib/app-helpers');
const { createRenderers } = require('./lib/renderers');
const { configureApp } = require('./middleware/configure-app');
const { applyRequestContextMiddleware } = require('./middleware/request-context');
const { registerPlatformRoutes } = require('./routes/platform');
const { registerAdminRoutes } = require('./routes/admin');
const { registerStorefrontRoutes } = require('./routes/storefront');
const { registerErrorRoutes } = require('./routes/errors');
const { createValidations } = require('./routes/validations');
const { createPaymentProviderConfigService } = require('./services/payment-provider-configs');

const createApp = (appRoot) => {
  const app = express();
  const context = createAppContext(appRoot);
  const helpers = createAppHelpers(context);
  const paymentProviderService = createPaymentProviderConfigService(context, helpers);
  const renderers = createRenderers(context, helpers, paymentProviderService);
  const validations = createValidations(context, helpers);
  const deps = {
    context,
    helpers,
    renderers,
    validations,
    paymentProviderService
  };

  configureApp(app, context, helpers, renderers);
  applyRequestContextMiddleware(app, context, helpers);
  registerPlatformRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerStorefrontRoutes(app, deps);
  registerErrorRoutes(app, deps);

  return {
    app,
    context
  };
};

module.exports = {
  createApp
};
