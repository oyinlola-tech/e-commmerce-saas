const { body, param } = require('express-validator');
const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  encryptText,
  decryptText,
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

const PLATFORM_PUBLIC_KEYS = {
  paystack: process.env.PAYSTACK_PLATFORM_PUBLIC_KEY || null,
  flutterwave: process.env.FLUTTERWAVE_PLATFORM_PUBLIC_KEY || null
};

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const buildProviderPayloads = ({ amount, currency, reference, storeId, configs, gatewayUrl, paymentScope }) => {
  return PAYMENT_PROVIDERS.map((provider) => {
    const config = configs.find((entry) => entry.provider === provider);
    const publicKey = paymentScope === 'subscription'
      ? PLATFORM_PUBLIC_KEYS[provider]
      : (config?.public_key || null);

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
      providers: buildProviderPayloads({
        amount,
        currency,
        reference,
        storeId,
        configs,
        gatewayUrl: config.gatewayUrl,
        paymentScope
      })
    });
  }));

  app.get('/payments/config', requireInternal, asyncHandler(async (req, res) => {
    if (!req.authContext.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const rows = await db.query('SELECT * FROM payment_provider_configs WHERE store_id = ?', [req.authContext.storeId]);
    return res.json({
      configs: rows.map((row) => ({
        id: row.id,
        store_id: row.store_id,
        provider: row.provider,
        public_key: row.public_key,
        status: row.status,
        has_secret_key: Boolean(row.secret_key_encrypted)
      }))
    });
  }));

  app.post('/payments/config', requireInternal, validate([
    allowBodyFields(['provider', 'public_key', 'secret_key', 'status']),
    body('provider').isIn(PAYMENT_PROVIDERS),
    commonRules.optionalPlainText('public_key', 255),
    commonRules.optionalPlainText('secret_key', 255),
    commonRules.optionalPlainText('status', 40)
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId);
    const provider = normalizeProvider(req.body.provider);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
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
        req.body.public_key || null,
        req.body.secret_key ? encryptText(req.body.secret_key, config.internalSharedSecret) : null,
        req.body.status || 'active'
      ]
    );

    const row = (await db.query(
      'SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
      [storeId, provider]
    ))[0];
    return res.status(201).json({
      config: {
        ...row,
        secret_key_encrypted: undefined,
        secret_key_preview: row.secret_key_encrypted
          ? decryptText(row.secret_key_encrypted, config.internalSharedSecret).slice(0, 6)
          : null
      }
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
