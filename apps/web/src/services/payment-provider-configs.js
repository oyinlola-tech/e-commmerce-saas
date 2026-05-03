const createPaymentProviderConfigService = (context, helpers) => {
  const {
    env,
    storePaymentProviders,
    requestJson,
    sanitizePlainText
  } = context;
  const {
    resolveStore,
    buildInternalServiceHeaders
  } = helpers;

  const createEmptyPaymentProviderConfigs = () => {
    return storePaymentProviders.reduce((accumulator, provider) => {
      accumulator[provider] = {
        provider,
        public_key: '',
        status: 'inactive',
        has_secret_key: false,
        has_webhook_secret_hash: false
      };
      return accumulator;
    }, {});
  };

  const mapPaymentProviderConfigs = (configs = []) => {
    const mapped = createEmptyPaymentProviderConfigs();

    configs.forEach((config) => {
      const provider = sanitizePlainText(config?.provider || '', { maxLength: 40 }).toLowerCase();
      if (!mapped[provider]) {
        return;
      }

      mapped[provider] = {
        provider,
        public_key: String(config?.public_key || '').trim(),
        status: String(config?.status || 'inactive').trim().toLowerCase() || 'inactive',
        has_secret_key: Boolean(config?.has_secret_key),
        has_webhook_secret_hash: Boolean(config?.has_webhook_secret_hash)
      };
    });

    return mapped;
  };

  const buildPaymentProviderDrafts = (req) => {
    return storePaymentProviders.reduce((accumulator, provider) => {
      accumulator[provider] = {
        public_key: sanitizePlainText(req.body?.[`${provider}_public_key`] || '', { maxLength: 255 }),
        secret_key: sanitizePlainText(req.body?.[`${provider}_secret_key`] || '', { maxLength: 255 }),
        webhook_secret_hash: sanitizePlainText(req.body?.[`${provider}_webhook_secret_hash`] || '', { maxLength: 255 }),
        status: sanitizePlainText(req.body?.[`${provider}_status`] || '', { maxLength: 40 }).toLowerCase()
      };
      return accumulator;
    }, {});
  };

  const listStorePaymentProviderConfigs = async (req, store) => {
    if (!store?.id) {
      return createEmptyPaymentProviderConfigs();
    }

    const response = await requestJson(`${env.serviceUrls.payment}/payments/config`, {
      headers: buildInternalServiceHeaders(req, store.id),
      timeoutMs: env.backendRequestTimeoutMs
    });

    return mapPaymentProviderConfigs(response?.configs || []);
  };

  const shouldPersistPaymentProviderConfig = (existingConfig, draft = {}) => {
    return Boolean(
      existingConfig?.public_key
      || existingConfig?.has_secret_key
      || existingConfig?.has_webhook_secret_hash
      || String(existingConfig?.status || '').trim().toLowerCase() === 'active'
      || String(draft.public_key || '').trim()
      || String(draft.secret_key || '').trim()
      || String(draft.webhook_secret_hash || '').trim()
      || String(draft.status || '').trim().toLowerCase() === 'active'
    );
  };

  const upsertStorePaymentProviderConfig = async (req, store, provider, draft = {}) => {
    const body = {
      provider,
      status: String(draft.status || '').trim().toLowerCase() === 'active'
        ? 'active'
        : 'inactive'
    };

    if (String(draft.public_key || '').trim()) {
      body.public_key = draft.public_key.trim();
    }

    if (String(draft.secret_key || '').trim()) {
      body.secret_key = draft.secret_key.trim();
    }

    if (String(draft.webhook_secret_hash || '').trim()) {
      body.webhook_secret_hash = draft.webhook_secret_hash.trim();
    }

    return requestJson(`${env.serviceUrls.payment}/payments/config`, {
      method: 'POST',
      headers: buildInternalServiceHeaders(req, store.id),
      body,
      timeoutMs: env.backendRequestTimeoutMs
    });
  };

  const loadStorePaymentProviderConfigs = async (req, res, next) => {
    const store = resolveStore(req);
    req.storePaymentProviderConfigs = createEmptyPaymentProviderConfigs();
    req.storePaymentProviderConfigWarning = '';

    if (!store?.id) {
      return next();
    }

    try {
      req.storePaymentProviderConfigs = await listStorePaymentProviderConfigs(req, store);
    } catch (error) {
      req.storePaymentProviderConfigWarning = 'Payment provider settings are temporarily unavailable.';
      req.log?.warn('payment_provider_config_load_failed', {
        storeId: store.id,
        error: error.message
      });
    }

    return next();
  };

  return {
    createEmptyPaymentProviderConfigs,
    mapPaymentProviderConfigs,
    buildPaymentProviderDrafts,
    listStorePaymentProviderConfigs,
    shouldPersistPaymentProviderConfig,
    upsertStorePaymentProviderConfig,
    loadStorePaymentProviderConfigs
  };
};

module.exports = {
  createPaymentProviderConfigService
};
