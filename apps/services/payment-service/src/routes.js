const crypto = require('crypto');
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
  sanitizePlainText,
  requestJson
} = require('../../../../packages/shared');

const PAYMENT_PROVIDER_STATUSES = ['active', 'inactive'];
const PAYSTACK_API_BASE = 'https://api.paystack.co';
const SUCCESS_STATUSES = new Set(['success', 'successful', 'paid']);
const FAILURE_STATUSES = new Set(['failed', 'abandoned', 'cancelled', 'reversed', 'error']);

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

const normalizePaymentStatus = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUCCESS_STATUSES.has(normalized)) {
    return 'success';
  }

  if (FAILURE_STATUSES.has(normalized)) {
    return 'failed';
  }

  return normalized || 'pending';
};

const toSubunitAmount = (amount = 0) => {
  return String(Math.max(0, Math.round(Number(amount || 0) * 100)));
};

const parsePaymentMetadata = (value) => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const resolvePaystackSecretKey = ({ paymentScope, storeConfig, config }) => {
  if (paymentScope === 'subscription') {
    return String(process.env.PAYSTACK_PLATFORM_SECRET_KEY || '').trim() || null;
  }

  if (!storeConfig?.secret_key_encrypted) {
    return null;
  }

  try {
    return decryptText(storeConfig.secret_key_encrypted, config.internalSharedSecret);
  } catch {
    return null;
  }
};

const buildPaystackHeaders = (secretKey) => ({
  Authorization: `Bearer ${secretKey}`
});

const requestPaystack = async (secretKey, pathname, options = {}) => {
  if (!secretKey) {
    throw createHttpError(400, 'Paystack is not fully configured.', null, { expose: true });
  }

  return requestJson(`${PAYSTACK_API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      ...buildPaystackHeaders(secretKey),
      ...(options.headers || {})
    },
    body: options.body,
    timeoutMs: options.timeoutMs || 10000
  });
};

const publishPaymentEvent = async ({ bus, eventName, payment, extra = {} }) => {
  const metadata = {
    ...parsePaymentMetadata(payment.metadata),
    ...(extra.metadata && typeof extra.metadata === 'object' ? sanitizeJsonObject(extra.metadata) : {})
  };
  const payload = {
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
    metadata
  };

  ['authorization', 'refund', 'provider_response', 'provider_reference', 'status'].forEach((key) => {
    if (extra[key] !== undefined) {
      payload[key] = extra[key];
    }
  });

  await bus.publish(eventName, payload);
};

const getPaymentByReference = async (db, reference) => {
  return (await db.query('SELECT * FROM payments WHERE reference = ?', [reference]))[0] || null;
};

const verifyPaystackWebhookSignature = (req, secretKey) => {
  const signature = String(req.headers['x-paystack-signature'] || '').trim();
  if (!signature || !secretKey) {
    return false;
  }

  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(JSON.stringify(req.body || {}))
    .digest('hex');

  return hash === signature;
};

const determineVerificationPayload = async ({ provider, paymentScope, storeConfig, config, reference }) => {
  if (provider !== 'paystack') {
    return null;
  }

  const secretKey = resolvePaystackSecretKey({ paymentScope, storeConfig, config });
  const response = await requestPaystack(secretKey, `/transaction/verify/${encodeURIComponent(reference)}`);
  return response?.data || null;
};

const triggerPaystackRefund = async ({ payment, paymentMetadata, paymentScope, storeConfig, config }) => {
  if (!paymentMetadata.auto_refund_on_success || payment.provider !== 'paystack') {
    return null;
  }

  if (paymentMetadata.refund && paymentMetadata.refund.id) {
    return paymentMetadata.refund;
  }

  const secretKey = resolvePaystackSecretKey({ paymentScope, storeConfig, config });
  const response = await requestPaystack(secretKey, '/refund', {
    method: 'POST',
    body: {
      transaction: payment.reference
    }
  });
  const refund = response?.data || null;
  if (!refund) {
    return null;
  }

  return {
    id: refund.id || null,
    status: refund.status || 'queued',
    amount: Number(refund.amount || 0) / 100,
    transaction_reference: refund.transaction?.reference || payment.reference,
    initiated_at: new Date().toISOString()
  };
};

const persistPaymentOutcome = async ({
  db,
  bus,
  payment,
  normalizedStatus,
  providerReference,
  providerSessionId,
  metadata,
  authorization,
  refund,
  providerResponse
}) => {
  const existingStatus = normalizePaymentStatus(payment.status);
  const nextMetadata = {
    ...parsePaymentMetadata(payment.metadata),
    ...(metadata && typeof metadata === 'object' ? sanitizeJsonObject(metadata) : {})
  };
  if (authorization) {
    nextMetadata.authorization = sanitizeJsonObject(authorization);
  }
  if (refund) {
    nextMetadata.refund = sanitizeJsonObject(refund);
  }

  await db.execute(
    'UPDATE payments SET status = ?, provider_session_id = ?, metadata = ? WHERE id = ?',
    [
      normalizedStatus,
      providerSessionId || payment.provider_session_id || providerReference || null,
      JSON.stringify(nextMetadata),
      payment.id
    ]
  );

  const freshPayment = (await db.query('SELECT * FROM payments WHERE id = ?', [payment.id]))[0] || payment;
  if (existingStatus === normalizedStatus) {
    return freshPayment;
  }

  await publishPaymentEvent({
    bus,
    payment: freshPayment,
    eventName: normalizedStatus === 'success'
      ? EVENT_NAMES.PAYMENT_SUCCEEDED
      : EVENT_NAMES.PAYMENT_FAILED,
    extra: {
      authorization,
      refund,
      provider_response: providerResponse,
      provider_reference: providerReference,
      status: normalizedStatus,
      metadata: nextMetadata
    }
  });

  return freshPayment;
};

const verifyAndRecordPayment = async ({ db, bus, config, payment }) => {
  if (!payment) {
    throw createHttpError(404, 'Payment not found.', null, { expose: true });
  }

  if (normalizePaymentStatus(payment.status) === 'success') {
    return payment;
  }

  const storeConfig = payment.store_id
    ? (await db.query(
      'SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
      [payment.store_id, payment.provider]
    ))[0] || null
    : null;
  const providerPayload = await determineVerificationPayload({
    provider: payment.provider,
    paymentScope: payment.payment_scope,
    storeConfig,
    config,
    reference: payment.reference
  });

  if (!providerPayload) {
    return payment;
  }

  const normalizedStatus = normalizePaymentStatus(providerPayload.status);
  const paymentMetadata = parsePaymentMetadata(payment.metadata);
  const refund = normalizedStatus === 'success'
    ? await triggerPaystackRefund({
      payment,
      paymentMetadata,
      paymentScope: payment.payment_scope,
      storeConfig,
      config
    })
    : null;

  return persistPaymentOutcome({
    db,
    bus,
    payment,
    normalizedStatus,
    providerReference: String(providerPayload.reference || payment.reference || '').trim() || payment.reference,
    providerSessionId: providerPayload.id ? String(providerPayload.id) : payment.provider_session_id,
    metadata: {
      provider_data: sanitizeJsonObject(providerPayload)
    },
    authorization: providerPayload.authorization || null,
    refund,
    providerResponse: providerPayload
  });
};

const processWebhook = async ({ req, res, db, bus, config }) => {
  const provider = normalizeProvider(req.params.provider);
  const reference = String(req.body.reference || req.body.data?.reference || '').trim();
  const incomingStatus = normalizePaymentStatus(req.body.status || req.body.data?.status || req.body.event || 'received');

  await db.execute(
    'INSERT INTO payment_webhooks (provider, reference, payload, status) VALUES (?, ?, ?, ?)',
    [provider, reference || null, JSON.stringify(req.body || {}), incomingStatus]
  );

  if (!reference) {
    return res.json({ received: true });
  }

  const payment = await getPaymentByReference(db, reference);
  if (!payment) {
    return res.json({ received: true });
  }

  if (provider === 'paystack') {
    const storeConfig = payment.store_id
      ? (await db.query(
        'SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
        [payment.store_id, provider]
      ))[0] || null
      : null;
    const secretKey = resolvePaystackSecretKey({
      paymentScope: payment.payment_scope,
      storeConfig,
      config
    });

    if (!verifyPaystackWebhookSignature(req, secretKey)) {
      throw createHttpError(401, 'Invalid Paystack webhook signature.', null, { expose: true });
    }

    await verifyAndRecordPayment({
      db,
      bus,
      config,
      payment
    });
    return res.json({ received: true });
  }

  await persistPaymentOutcome({
    db,
    bus,
    payment,
    normalizedStatus: incomingStatus,
    providerReference: reference,
    providerSessionId: payment.provider_session_id
  });

  return res.json({ received: true });
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/payments/create-checkout-session', requireInternal, validate([
    allowBodyFields(['provider', 'amount', 'currency', 'payment_scope', 'store_id', 'owner_id', 'customer_id', 'order_id', 'entity_type', 'entity_id', 'email', 'metadata', 'callback_url']),
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
    commonRules.jsonObject('metadata'),
    body('callback_url').optional().isString().isLength({ max: 2000 })
  ]), asyncHandler(async (req, res) => {
    const reference = `pay_${randomUUID()}`;
    const provider = normalizeProvider(req.body.provider || 'paystack');
    const amount = Number(req.body.amount || 0);
    const paymentScope = String(req.body.payment_scope || 'storefront').trim().toLowerCase();
    const storeId = req.body.store_id || req.authContext.storeId || null;
    const ownerId = req.body.owner_id || req.authContext.userId || null;
    const customerId = req.body.customer_id || req.authContext.customerId || null;
    const currency = String(req.body.currency || 'NGN').trim().toUpperCase();
    const callbackUrl = String(req.body.callback_url || '').trim() || null;

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
    const sanitizedMetadata = sanitizeJsonObject(req.body.metadata || {});
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
          callback_url: callbackUrl,
          ...sanitizedMetadata
        })
      ]
    );
    const payment = (await db.query('SELECT * FROM payments WHERE id = ?', [result.insertId]))[0];

    if (paymentScope === 'subscription' && provider === 'paystack') {
      const platformConfig = getPlatformProviderConfigs().paystack;
      if (!hasConfiguredPlatformProvider(platformConfig)) {
        throw createHttpError(400, 'The selected subscription payment provider is not configured in platform env.', null, { expose: true });
      }

      const metadata = {
        ...sanitizedMetadata,
        payment_id: payment.id,
        payment_scope: paymentScope,
        entity_type: req.body.entity_type || null,
        entity_id: req.body.entity_id || null,
        custom_filters: {
          recurring: true
        }
      };
      const initializeResponse = await requestPaystack(platformConfig.secretKey, '/transaction/initialize', {
        method: 'POST',
        body: {
          email: req.body.email,
          amount: toSubunitAmount(amount),
          currency,
          reference,
          channels: ['card'],
          callback_url: callbackUrl || undefined,
          metadata
        }
      });
      const providerData = initializeResponse?.data || {};

      await db.execute(
        'UPDATE payments SET provider_session_id = ?, metadata = ? WHERE id = ?',
        [
          providerData.access_code || payment.provider_session_id,
          JSON.stringify({
            ...parsePaymentMetadata(payment.metadata),
            paystack_access_code: providerData.access_code || null,
            paystack_authorization_url: providerData.authorization_url || null
          }),
          payment.id
        ]
      );
      const freshPayment = (await db.query('SELECT * FROM payments WHERE id = ?', [payment.id]))[0];

      return res.status(201).json({
        payment: serializePayment(freshPayment),
        providers: [
          {
            provider: 'paystack',
            inline: false,
            public_key: platformConfig.publicKey,
            checkout_url: providerData.authorization_url || null,
            authorization_url: providerData.authorization_url || null,
            access_code: providerData.access_code || null,
            reference
          }
        ]
      });
    }

    if (!availableProviders.some((entry) => entry.provider === provider)) {
      const message = paymentScope === 'subscription'
        ? 'The selected subscription payment provider is not configured in platform env.'
        : 'The selected store payment provider is not fully configured or active.';
      throw createHttpError(400, message, null, { expose: true });
    }

    return res.status(201).json({
      payment: serializePayment(payment),
      providers: availableProviders
    });
  }));

  app.post('/payments/charge-authorization', requireInternal, validate([
    allowBodyFields(['provider', 'amount', 'currency', 'payment_scope', 'store_id', 'owner_id', 'customer_id', 'entity_type', 'entity_id', 'email', 'authorization_code', 'metadata']),
    body('provider').optional().isIn(PAYMENT_PROVIDERS),
    body('amount').isFloat({ min: 0.5 }).toFloat(),
    body('currency').optional().isLength({ min: 3, max: 3 }).customSanitizer((value) => String(value).trim().toUpperCase()),
    body('payment_scope').optional().isIn(['storefront', 'subscription']),
    body('store_id').optional().isInt({ min: 1 }).toInt(),
    body('owner_id').optional().isInt({ min: 1 }).toInt(),
    body('customer_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    commonRules.optionalPlainText('entity_type', 60),
    commonRules.optionalPlainText('entity_id', 191),
    body('email').isEmail().customSanitizer((value) => sanitizeEmail(value)),
    body('authorization_code').isString().notEmpty().isLength({ max: 191 }),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    const provider = normalizeProvider(req.body.provider || 'paystack');
    const amount = Number(req.body.amount || 0);
    const paymentScope = String(req.body.payment_scope || 'subscription').trim().toLowerCase();
    const storeId = req.body.store_id || req.authContext.storeId || null;
    const ownerId = req.body.owner_id || req.authContext.userId || null;
    const customerId = req.body.customer_id || req.authContext.customerId || null;
    const currency = String(req.body.currency || 'NGN').trim().toUpperCase();
    const reference = `pay_${randomUUID()}`;

    if (provider !== 'paystack') {
      throw createHttpError(400, 'Only Paystack authorization charges are supported right now.', null, { expose: true });
    }

    if (paymentScope === 'subscription' && !ownerId) {
      throw createHttpError(400, 'owner_id is required for subscription payments.', null, { expose: true });
    }

    const metadata = sanitizeJsonObject(req.body.metadata || {});
    const result = await db.execute(
      `
        INSERT INTO payments (
          order_id, store_id, owner_id, customer_id, payment_scope, entity_type, entity_id,
          amount, currency, provider, reference, provider_session_id, status, metadata
        )
        VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)
      `,
      [
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
        JSON.stringify({
          email: req.body.email,
          ...metadata
        })
      ]
    );
    const payment = (await db.query('SELECT * FROM payments WHERE id = ?', [result.insertId]))[0];

    const storeConfig = storeId
      ? (await db.query(
        'SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
        [storeId, provider]
      ))[0] || null
      : null;
    const secretKey = resolvePaystackSecretKey({
      paymentScope,
      storeConfig,
      config
    });
    const chargeResponse = await requestPaystack(secretKey, '/transaction/charge_authorization', {
      method: 'POST',
      body: {
        authorization_code: req.body.authorization_code,
        email: req.body.email,
        amount: toSubunitAmount(amount),
        currency,
        reference,
        queue: true,
        channels: ['card'],
        metadata
      }
    });
    const providerData = chargeResponse?.data || {};
    const normalizedStatus = normalizePaymentStatus(providerData.status || 'pending');
    const freshPayment = await persistPaymentOutcome({
      db,
      bus,
      payment,
      normalizedStatus,
      providerReference: providerData.reference || reference,
      providerSessionId: providerData.id ? String(providerData.id) : null,
      metadata: {
        provider_data: sanitizeJsonObject(providerData)
      },
      authorization: providerData.authorization || null,
      providerResponse: providerData
    });

    return res.status(201).json({
      payment: serializePayment(freshPayment),
      provider_response: providerData
    });
  }));

  app.get('/payments/verify/:reference', requireInternal, validate([
    param('reference').isString().notEmpty().isLength({ max: 191 })
  ]), asyncHandler(async (req, res) => {
    const payment = await getPaymentByReference(db, req.params.reference);
    const verifiedPayment = await verifyAndRecordPayment({
      db,
      bus,
      config,
      payment
    });

    return res.json({
      payment: {
        ...serializePayment(verifiedPayment),
        metadata: parsePaymentMetadata(verifiedPayment?.metadata)
      }
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
    return processWebhook({ req, res, db, bus, config });
  }));

  app.post('/payments/mock/:provider/:reference', validate([
    param('provider').isIn(PAYMENT_PROVIDERS),
    commonRules.optionalPlainText('status', 40)
  ]), asyncHandler(async (req, res) => {
    const payment = await getPaymentByReference(db, req.params.reference);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found.' });
    }

    const normalizedStatus = normalizePaymentStatus(req.query.status || 'success');
    await persistPaymentOutcome({
      db,
      bus,
      payment,
      normalizedStatus,
      providerReference: payment.reference,
      providerSessionId: payment.provider_session_id
    });

    return res.json({ received: true });
  }));
};

module.exports = {
  registerRoutes
};
