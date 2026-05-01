const { body, param } = require('express-validator');
const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  encryptText,
  EVENT_NAMES,
  PAYMENT_PROVIDERS,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  commonRules,
  sanitizeJsonObject,
  sanitizeEmail,
  sanitizePlainText
} = require('../../../../packages/shared');

const PAYMENT_PROVIDER_STATUSES = ['active', 'inactive'];

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const getPlatformProviderConfigs = () => ({
  paystack: {
    publicKey: String(process.env.PAYSTACK_PLATFORM_PUBLIC_KEY || '').trim() || null,
    secretKey: String(process.env.PAYSTACK_PLATFORM_SECRET_KEY || '').trim() || null
  },
  flutterwave: {
    publicKey: String(process.env.FLUTTERWAVE_PLATFORM_PUBLIC_KEY || '').trim() || null,
    secretKey: String(process.env.FLUTTERWAVE_PLATFORM_SECRET_KEY || '').trim() || null
  }
});

const normalizeProviderStatus = (value = '') => {
  const normalized = sanitizePlainText(value, { maxLength: 40 }).toLowerCase();
  return PAYMENT_PROVIDER_STATUSES.includes(normalized)
    ? normalized
    : 'inactive';
};

const hasConfiguredStoreSecret = (config) => Boolean(config?.secret_key_encrypted);
const hasConfiguredStorePublicKey = (config) => Boolean(String(config?.public_key || '').trim());
const hasConfiguredPlatformProvider = (config) => Boolean(config?.publicKey && config?.secretKey);

const isActiveStoreProviderConfig = (config) => {
  return normalizeProviderStatus(config?.status) === 'active'
    && hasConfiguredStorePublicKey(config)
    && hasConfiguredStoreSecret(config);
};

const serializeProviderConfig = (row) => ({
  id: row.id,
  store_id: row.store_id,
  provider: row.provider,
  public_key: row.public_key,
  status: normalizeProviderStatus(row.status),
  has_secret_key: hasConfiguredStoreSecret(row)
});

const buildProviderPayloads = ({ amount, currency, reference, storeId, configs, gatewayUrl, paymentScope }) => {
  const platformProviderConfigs = getPlatformProviderConfigs();

  return PAYMENT_PROVIDERS.flatMap((provider) => {
    const storeConfig = configs.find((entry) => entry.provider === provider);
    const platformConfig = platformProviderConfigs[provider];
    const publicKey = paymentScope === 'subscription'
      ? platformConfig?.publicKey || null
      : (storeConfig?.public_key || null);
    const isAvailable = paymentScope === 'subscription'
      ? hasConfiguredPlatformProvider(platformConfig)
      : isActiveStoreProviderConfig(storeConfig);

    if (!isAvailable || !publicKey) {
      return [];
    }

    return {
      provider,
      inline: true,
      public_key: publicKey,
      checkout_url: `${gatewayUrl}/payments/mock/${provider}/${reference}?store_id=${storeId || ''}&amount=${amount}&currency=${currency}&scope=${paymentScope}`
    };
  });
};

const serializePayment = (payment) => {
  return {
    id: payment.id,
    order_id: payment.order_id,
    store_id: payment.store_id,
    owner_id: payment.owner_id,
    customer_id: payment.customer_id,
    payment_scope: payment.payment_scope,
    entity_type: payment.entity_type,
    entity_id: payment.entity_id,
    reference: payment.reference,
    amount: Number(payment.amount),
    currency: payment.currency,
    provider: payment.provider,
    status: payment.status
  };
};

const normalizeProvider = (value = '') => {
  return sanitizePlainText(value, { maxLength: 40 }).toLowerCase();
};

const publishPaymentEvent = async ({ bus, eventName, payment }) => {
  await bus.publish(eventName, {
    payment_id: payment.id,
    order_id: payment.order_id,
    store_id: payment.store_id,
    owner_id: payment.owner_id,
    customer_id: payment.customer_id,
    reference: payment.reference,
    provider: payment.provider,
    payment_scope: payment.payment_scope,
    entity_type: payment.entity_type,
    entity_id: payment.entity_id,
    amount: Number(payment.amount),
    currency: payment.currency,
    metadata: payment.metadata ? JSON.parse(payment.metadata) : {}
  });
};

const processWebhook = async ({ req, res, db, bus }) => {
  const provider = normalizeProvider(req.params.provider);
  const reference = String(req.body.reference || req.body.data?.reference || '').trim();
  const status = normalizeProvider(req.body.status || req.body.data?.status || 'received');

  await db.execute(
    'INSERT INTO payment_webhooks (provider, reference, payload, status) VALUES (?, ?, ?, ?)',
    [provider, reference || null, JSON.stringify(req.body || {}), status]
  );

  if (reference) {
    await db.execute('UPDATE payments SET status = ? WHERE reference = ?', [status, reference]);
    const payment = (await db.query('SELECT * FROM payments WHERE reference = ?', [reference]))[0];
    if (payment) {
      await publishPaymentEvent({
        bus,
        payment,
        eventName: status === 'success' || status === 'successful'
          ? EVENT_NAMES.PAYMENT_SUCCEEDED
          : EVENT_NAMES.PAYMENT_FAILED
      });
    }
  }

  return res.json({ received: true });
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/payments/create-checkout-session', requireInternal, validate([
    allowBodyFields(['provider', 'amount', 'currency', 'payment_scope', 'store_id', 'owner_id', 'customer_id', 'order_id', 'entity_type', 'entity_id', 'email', 'metadata']),
    body('provider').optional().isIn(PAYMENT_PROVIDERS),
    body('amount').isFloat({ min: 0.5 }).toFloat(),
    body('currency').optional().isLength({ min: 3, max: 3 }).customSanitizer((value) => String(value).trim().toUpperCase()),
    body('payment_scope').optional().isIn(['storefront', 'subscription']),
    body('store_id').optional().isInt({ min: 1 }).toInt(),
    body('owner_id').optional().isInt({ min: 1 }).toInt(),
    body('customer_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    body('order_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    commonRules.optionalPlainText('entity_type', 60),
    commonRules.optionalPlainText('entity_id', 191),
    body('email').optional().isEmail().customSanitizer((value) => sanitizeEmail(value)),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    const reference = `pay_${randomUUID()}`;
    const provider = normalizeProvider(req.body.provider || 'paystack');
    const amount = Number(req.body.amount || 0);
    const paymentScope = String(req.body.payment_scope || 'storefront').trim().toLowerCase();
    const storeId = req.body.store_id || req.authContext.storeId || null;
    const ownerId = req.body.owner_id || req.authContext.userId || null;
    const customerId = req.body.customer_id || req.authContext.customerId || null;
    const currency = String(req.body.currency || 'NGN').trim().toUpperCase();

    if (!PAYMENT_PROVIDERS.includes(provider)) {
      throw createHttpError(400, 'Unsupported payment provider.', null, { expose: true });
    }

    if (paymentScope === 'storefront' && !storeId) {
      throw createHttpError(400, 'store_id is required for storefront payments.', null, { expose: true });
    }

    if (paymentScope === 'subscription' && !ownerId) {
      throw createHttpError(400, 'owner_id is required for subscription payments.', null, { expose: true });
    }

    const configs = storeId
      ? await db.query('SELECT * FROM payment_provider_configs WHERE store_id = ?', [storeId])
      : [];
    const availableProviders = buildProviderPayloads({
      amount,
      currency,
      reference,
      storeId,
      configs,
      gatewayUrl: config.gatewayUrl,
      paymentScope
    });

    if (!availableProviders.some((entry) => entry.provider === provider)) {
      const message = paymentScope === 'subscription'
        ? 'The selected subscription payment provider is not configured in platform env.'
        : 'The selected store payment provider is not fully configured or active.';
      throw createHttpError(400, message, null, { expose: true });
    }

    const result = await db.execute(
      `
        INSERT INTO payments (
          order_id, store_id, owner_id, customer_id, payment_scope, entity_type, entity_id,
          amount, currency, provider, reference, provider_session_id, status, metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `,
      [
        req.body.order_id || null,
        storeId,
        ownerId,
        customerId,
        paymentScope,
        req.body.entity_type || null,
        req.body.entity_id || null,
        amount,
        currency,
        provider,
        reference,
        `${provider}_${randomUUID()}`,
        JSON.stringify({
          email: req.body.email || null,
          ...(sanitizeJsonObject(req.body.metadata || {}))
        })
      ]
    );
    const payment = (await db.query('SELECT * FROM payments WHERE id = ?', [result.insertId]))[0];

    return res.status(201).json({
      payment: serializePayment(payment),
      providers: availableProviders
    });
  }));

  app.get('/payments/config', requireInternal, asyncHandler(async (req, res) => {
    if (!req.authContext.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const rows = await db.query('SELECT * FROM payment_provider_configs WHERE store_id = ?', [req.authContext.storeId]);
    return res.json({
      configs: rows.map(serializeProviderConfig)
    });
  }));

  app.post('/payments/config', requireInternal, validate([
    allowBodyFields(['provider', 'public_key', 'secret_key', 'status']),
    body('provider').isIn(PAYMENT_PROVIDERS),
    commonRules.optionalPlainText('public_key', 255),
    commonRules.optionalPlainText('secret_key', 255),
    body('status').optional().isIn(PAYMENT_PROVIDER_STATUSES)
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId);
    const provider = normalizeProvider(req.body.provider);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const existingRow = (await db.query(
      'SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
      [storeId, provider]
    ))[0] || null;
    const nextPublicKey = String(req.body.public_key || '').trim() || existingRow?.public_key || null;
    const nextSecretEncrypted = String(req.body.secret_key || '').trim()
      ? encryptText(req.body.secret_key, config.internalSharedSecret)
      : (existingRow?.secret_key_encrypted || null);
    const nextStatus = normalizeProviderStatus(req.body.status || existingRow?.status || 'inactive');

    if (nextStatus === 'active' && (!nextPublicKey || !nextSecretEncrypted)) {
      throw createHttpError(400, 'Active payment providers require both a public key and a secret key.', {
        fields: [
          !nextPublicKey ? { field: 'public_key', message: 'Public key is required for active providers.' } : null,
          !nextSecretEncrypted ? { field: 'secret_key', message: 'Secret key is required for active providers.' } : null
        ].filter(Boolean)
      }, { expose: true });
    }

    await db.execute(
      `
        INSERT INTO payment_provider_configs (store_id, provider, public_key, secret_key_encrypted, status)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          public_key = VALUES(public_key),
          secret_key_encrypted = VALUES(secret_key_encrypted),
          status = VALUES(status)
      `,
      [
        storeId,
        provider,
        nextPublicKey,
        nextSecretEncrypted,
        nextStatus
      ]
    );

    const row = (await db.query(
      'SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
      [storeId, provider]
    ))[0];
    return res.status(201).json({
      config: serializeProviderConfig(row)
    });
  }));

  app.post('/payments/webhooks/:provider', validate([
    param('provider').isIn(PAYMENT_PROVIDERS)
  ]), asyncHandler(async (req, res) => {
    return processWebhook({ req, res, db, bus });
  }));

  app.post('/payments/mock/:provider/:reference', validate([
    param('provider').isIn(PAYMENT_PROVIDERS),
    commonRules.optionalPlainText('status', 40)
  ]), asyncHandler(async (req, res) => {
    req.body.reference = req.params.reference;
    req.body.status = req.query.status || 'success';
    return processWebhook({ req, res, db, bus });
  }));
};

module.exports = {
  registerRoutes
};
