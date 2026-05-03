const { body, param } = require('express-validator');
const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  encryptText,
  decryptText,
  EVENT_NAMES,
  PAYMENT_PROVIDERS,
  createAuditLog,
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
const {
  verifyWebhookSignature
} = require('./webhook-security');

const PAYMENT_PROVIDER_STATUSES = ['active', 'inactive'];
const PAYSTACK_API_BASE = 'https://api.paystack.co';
const FLUTTERWAVE_API_BASE = 'https://api.flutterwave.com/v3';
const SUCCESS_STATUSES = new Set(['success', 'successful', 'paid', 'succeeded']);
const FAILURE_STATUSES = new Set(['failed', 'abandoned', 'cancelled', 'error']);
const REFUND_STATUSES = new Set(['reversed', 'refunded']);
const COMPLETED_REFUND_STATUSES = new Set(['processed', 'successful', 'completed', 'refunded']);

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
    secretKey: String(process.env.FLUTTERWAVE_PLATFORM_SECRET_KEY || '').trim() || null,
    webhookSecretHash: String(process.env.FLUTTERWAVE_PLATFORM_SECRET_HASH || '').trim() || null
  }
});

const normalizeProviderStatus = (value = '') => {
  const normalized = sanitizePlainText(value, { maxLength: 40 }).toLowerCase();
  return PAYMENT_PROVIDER_STATUSES.includes(normalized)
    ? normalized
    : 'inactive';
};

const normalizeProvider = (value = '') => {
  return sanitizePlainText(value, { maxLength: 40 }).toLowerCase();
};

const normalizePaymentStatus = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();

  if (SUCCESS_STATUSES.has(normalized)) {
    return 'success';
  }

  if (REFUND_STATUSES.has(normalized)) {
    return 'refunded';
  }

  if (FAILURE_STATUSES.has(normalized)) {
    return 'failed';
  }

  return normalized || 'pending';
};

const hasConfiguredStoreSecret = (config) => Boolean(config?.secret_key_encrypted);
const hasConfiguredStorePublicKey = (config) => Boolean(String(config?.public_key || '').trim());
const hasConfiguredWebhookSecretHash = (config) => Boolean(config?.webhook_secret_hash_encrypted);
const hasConfiguredPlatformProvider = (config) => Boolean(config?.publicKey && config?.secretKey);

const isActiveStoreProviderConfig = (config) => {
  const provider = normalizeProvider(config?.provider);
  return normalizeProviderStatus(config?.status) === 'active'
    && hasConfiguredStorePublicKey(config)
    && hasConfiguredStoreSecret(config)
    && (provider !== 'flutterwave' || hasConfiguredWebhookSecretHash(config));
};

const serializeProviderConfig = (row) => ({
  id: row.id,
  store_id: row.store_id,
  provider: row.provider,
  public_key: row.public_key,
  status: normalizeProviderStatus(row.status),
  has_secret_key: hasConfiguredStoreSecret(row),
  has_webhook_secret_hash: hasConfiguredWebhookSecretHash(row)
});

const serializePayment = (payment) => ({
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
});

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

const resolveFlutterwaveSecretKey = ({ paymentScope, storeConfig, config }) => {
  if (paymentScope === 'subscription') {
    return String(process.env.FLUTTERWAVE_PLATFORM_SECRET_KEY || '').trim() || null;
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

const resolveFlutterwaveWebhookSecretHash = ({ paymentScope, storeConfig, config }) => {
  if (paymentScope === 'subscription') {
    return String(process.env.FLUTTERWAVE_PLATFORM_SECRET_HASH || '').trim() || null;
  }

  if (!storeConfig?.webhook_secret_hash_encrypted) {
    return null;
  }

  try {
    return decryptText(storeConfig.webhook_secret_hash_encrypted, config.internalSharedSecret);
  } catch {
    return null;
  }
};

const buildPaystackHeaders = (secretKey) => ({
  Authorization: `Bearer ${secretKey}`
});

const buildFlutterwaveHeaders = (secretKey) => ({
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

const requestFlutterwave = async (secretKey, pathname, options = {}) => {
  if (!secretKey) {
    throw createHttpError(400, 'Flutterwave is not fully configured.', null, { expose: true });
  }

  return requestJson(`${FLUTTERWAVE_API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      ...buildFlutterwaveHeaders(secretKey),
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

const getStoreProviderConfig = async (db, storeId, provider) => {
  if (!storeId) {
    return null;
  }

  return (await db.query(
    'SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
    [storeId, provider]
  ))[0] || null;
};

const getProviderPublicKey = ({ provider, paymentScope, storeConfig }) => {
  if (paymentScope === 'subscription') {
    return getPlatformProviderConfigs()[provider]?.publicKey || null;
  }

  return storeConfig?.public_key || null;
};

const extractProviderReference = (providerPayload = {}, provider, fallbackReference = '') => {
  if (provider === 'flutterwave') {
    return String(
      providerPayload.tx_ref
      || providerPayload.txRef
      || providerPayload.reference
      || fallbackReference
      || ''
    ).trim();
  }

  return String(providerPayload.reference || fallbackReference || '').trim();
};

const extractProviderSessionId = (providerPayload = {}, provider, fallbackValue = null) => {
  if (provider === 'flutterwave') {
    return String(
      providerPayload.id
      || providerPayload.flw_ref
      || providerPayload.tx_ref
      || providerPayload.txRef
      || fallbackValue
      || ''
    ).trim() || null;
  }

  return String(
    providerPayload.id
    || providerPayload.access_code
    || providerPayload.reference
    || fallbackValue
    || ''
  ).trim() || null;
};

const extractVerifiedAmount = (providerPayload = {}, provider) => {
  if (provider === 'flutterwave') {
    const amount = Number(providerPayload.amount ?? providerPayload.charged_amount ?? 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  const amount = Number(providerPayload.amount || 0);
  return Number.isFinite(amount) ? amount / 100 : 0;
};

const extractVerifiedCurrency = (providerPayload = {}) => {
  return String(providerPayload.currency || '').trim().toUpperCase() || '';
};

const extractVerifiedStatus = (providerPayload = {}, provider, webhookEvent = '') => {
  if (provider === 'paystack' && !providerPayload.status && webhookEvent) {
    return webhookEvent;
  }

  if (provider === 'flutterwave' && !providerPayload.status && webhookEvent === 'charge.completed') {
    return 'successful';
  }

  return providerPayload.status || webhookEvent || 'pending';
};

const assertVerifiedPaymentMatches = ({ payment, providerPayload, provider }) => {
  const verifiedReference = extractProviderReference(providerPayload, provider, payment.reference);
  const verifiedCurrency = extractVerifiedCurrency(providerPayload);
  const verifiedAmount = extractVerifiedAmount(providerPayload, provider);

  if (!verifiedReference || verifiedReference !== payment.reference) {
    throw createHttpError(409, 'Payment reference mismatch during provider verification.', null, { expose: true });
  }

  if (!verifiedCurrency || verifiedCurrency !== String(payment.currency || '').trim().toUpperCase()) {
    throw createHttpError(409, 'Payment currency mismatch during provider verification.', null, { expose: true });
  }

  if (verifiedAmount < Number(payment.amount || 0)) {
    throw createHttpError(409, 'Verified payment amount is lower than the expected order total.', null, { expose: true });
  }
};

const buildPaystackCheckoutProvider = ({ payment, publicKey, providerData }) => {
  return {
    provider: 'paystack',
    inline: false,
    public_key: publicKey,
    checkout_url: providerData.authorization_url || null,
    authorization_url: providerData.authorization_url || null,
    access_code: providerData.access_code || null,
    reference: payment.reference
  };
};

const buildFlutterwaveCheckoutProvider = ({ payment, publicKey, providerData }) => {
  return {
    provider: 'flutterwave',
    inline: false,
    public_key: publicKey,
    checkout_url: providerData.link || null,
    checkout_link: providerData.link || null,
    reference: payment.reference
  };
};

const initializePaystackCheckout = async ({
  payment,
  secretKey,
  publicKey,
  email,
  callbackUrl,
  metadata
}) => {
  const initializeResponse = await requestPaystack(secretKey, '/transaction/initialize', {
    method: 'POST',
    body: {
      email,
      amount: toSubunitAmount(payment.amount),
      currency: payment.currency,
      reference: payment.reference,
      callback_url: callbackUrl || undefined,
      channels: ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money'],
      metadata
    }
  });

  const providerData = initializeResponse?.data || {};

  return {
    providerData,
    provider: buildPaystackCheckoutProvider({
      payment,
      publicKey,
      providerData
    }),
    providerSessionId: providerData.access_code || payment.provider_session_id
  };
};

const initializeFlutterwaveCheckout = async ({
  payment,
  secretKey,
  publicKey,
  email,
  customerName,
  customerPhone,
  callbackUrl,
  metadata
}) => {
  const checkoutResponse = await requestFlutterwave(secretKey, '/payments', {
    method: 'POST',
    body: {
      tx_ref: payment.reference,
      amount: Number(payment.amount),
      currency: payment.currency,
      redirect_url: callbackUrl,
      payment_options: 'card,banktransfer,ussd',
      customer: {
        email,
        name: customerName || undefined,
        phonenumber: customerPhone || undefined
      },
      customizations: {
        title: 'Aisle Commerce Checkout',
        description: `Payment for ${payment.entity_type || payment.payment_scope || 'order'} ${payment.reference}`
      },
      meta: metadata
    }
  });

  const providerData = checkoutResponse?.data || {};

  return {
    providerData,
    provider: buildFlutterwaveCheckoutProvider({
      payment,
      publicKey,
      providerData
    }),
    providerSessionId: providerData.link || payment.provider_session_id
  };
};

const determineVerificationPayload = async ({ provider, paymentScope, storeConfig, config, reference }) => {
  if (provider === 'paystack') {
    const secretKey = resolvePaystackSecretKey({ paymentScope, storeConfig, config });
    const response = await requestPaystack(secretKey, `/transaction/verify/${encodeURIComponent(reference)}`);
    return response?.data || null;
  }

  if (provider === 'flutterwave') {
    const secretKey = resolveFlutterwaveSecretKey({ paymentScope, storeConfig, config });
    const response = await requestFlutterwave(secretKey, `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    return response?.data || null;
  }

  return null;
};

const triggerAutomaticRefundIfNeeded = async ({
  payment,
  paymentMetadata,
  paymentScope,
  storeConfig,
  config
}) => {
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

const triggerManualRefund = async ({
  payment,
  paymentMetadata,
  paymentScope,
  storeConfig,
  config,
  reason
}) => {
  if (paymentMetadata.refund && paymentMetadata.refund.id) {
    throw createHttpError(409, 'A refund has already been initiated for this payment.', null, { expose: true });
  }

  if (payment.provider === 'paystack') {
    const secretKey = resolvePaystackSecretKey({ paymentScope, storeConfig, config });
    const response = await requestPaystack(secretKey, '/refund', {
      method: 'POST',
      body: {
        transaction: payment.reference
      }
    });
    const refund = response?.data || null;
    if (!refund) {
      throw createHttpError(502, 'Paystack did not return a refund payload.', null, { expose: true });
    }

    return {
      id: refund.id || null,
      status: refund.status || 'queued',
      amount: Number(refund.amount || 0) / 100,
      transaction_reference: refund.transaction?.reference || payment.reference,
      reason,
      initiated_at: new Date().toISOString()
    };
  }

  if (payment.provider === 'flutterwave') {
    const secretKey = resolveFlutterwaveSecretKey({ paymentScope, storeConfig, config });
    const verificationPayload = await determineVerificationPayload({
      provider: payment.provider,
      paymentScope,
      storeConfig,
      config,
      reference: payment.reference
    });
    const transactionId = verificationPayload?.id;

    if (!transactionId) {
      throw createHttpError(409, 'Flutterwave transaction ID is unavailable for refund.', null, { expose: true });
    }

    const response = await requestFlutterwave(secretKey, `/transactions/${encodeURIComponent(transactionId)}/refund`, {
      method: 'POST',
      body: {
        comments: reason || undefined
      }
    });
    const refund = response?.data || null;
    if (!refund) {
      throw createHttpError(502, 'Flutterwave did not return a refund payload.', null, { expose: true });
    }

    return {
      id: refund.id || refund.refund_id || null,
      status: refund.status || 'pending',
      amount: Number(refund.amount || payment.amount || 0),
      transaction_reference: payment.reference,
      reason,
      initiated_at: new Date().toISOString()
    };
  }

  throw createHttpError(400, 'Unsupported payment provider.', null, { expose: true });
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

  const eventName = normalizedStatus === 'success'
    ? EVENT_NAMES.PAYMENT_SUCCEEDED
    : normalizedStatus === 'refunded'
      ? EVENT_NAMES.PAYMENT_REFUNDED
      : EVENT_NAMES.PAYMENT_FAILED;

  await publishPaymentEvent({
    bus,
    payment: freshPayment,
    eventName,
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

const verifyAndRecordPayment = async ({ db, bus, config, payment, webhookEvent = '' }) => {
  if (!payment) {
    throw createHttpError(404, 'Payment not found.', null, { expose: true });
  }

  const storeConfig = await getStoreProviderConfig(db, payment.store_id, payment.provider);
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

  assertVerifiedPaymentMatches({
    payment,
    providerPayload,
    provider: payment.provider
  });

  const normalizedStatus = normalizePaymentStatus(
    extractVerifiedStatus(providerPayload, payment.provider, webhookEvent)
  );
  const paymentMetadata = parsePaymentMetadata(payment.metadata);
  const refund = normalizedStatus === 'success'
    ? await triggerAutomaticRefundIfNeeded({
      payment,
      paymentMetadata,
      paymentScope: payment.payment_scope,
      storeConfig,
      config
    })
    : (normalizedStatus === 'refunded' ? paymentMetadata.refund || null : null);

  return persistPaymentOutcome({
    db,
    bus,
    payment,
    normalizedStatus,
    providerReference: extractProviderReference(providerPayload, payment.provider, payment.reference),
    providerSessionId: extractProviderSessionId(providerPayload, payment.provider, payment.provider_session_id),
    metadata: {
      provider_data: sanitizeJsonObject(providerPayload)
    },
    authorization: providerPayload.authorization || providerPayload.payment_method || null,
    refund,
    providerResponse: providerPayload
  });
};

const extractWebhookReference = (provider, payload = {}) => {
  if (provider === 'flutterwave') {
    return String(
      payload.reference
      || payload.data?.tx_ref
      || payload.data?.reference
      || ''
    ).trim();
  }

  return String(
    payload.reference
    || payload.data?.reference
    || payload.data?.transaction_reference
    || ''
  ).trim();
};

const extractWebhookStatus = (provider, payload = {}) => {
  if (provider === 'flutterwave') {
    return normalizePaymentStatus(payload.data?.status || payload.status || payload.type || 'received');
  }

  return normalizePaymentStatus(payload.status || payload.data?.status || payload.event || 'received');
};

const requireStoreOperator = (req) => {
  if (req.authContext.actorType !== 'platform_user') {
    throw createHttpError(403, 'Only store operators can perform this action.', null, { expose: true });
  }

  if (!req.authContext.storeId) {
    throw createHttpError(400, 'Store context is required.', null, { expose: true });
  }
};

const processWebhook = async ({ req, res, db, bus, config }) => {
  const provider = normalizeProvider(req.params.provider);
  const reference = extractWebhookReference(provider, req.body || {});
  const incomingStatus = extractWebhookStatus(provider, req.body || {});

  await db.execute(
    'INSERT INTO payment_webhooks (provider, reference, payload, status) VALUES (?, ?, ?, ?)',
    [provider, reference || null, JSON.stringify(req.body || {}), incomingStatus]
  );

  if (!reference) {
    await createAuditLog(db, {
      actorType: 'system',
      action: 'payment.webhook_received_without_reference',
      resourceType: 'payment_webhook',
      storeId: null,
      details: {
        provider,
        status: incomingStatus
      },
      req,
      status: 'failure'
    });
    return res.json({ received: true });
  }

  const payment = await getPaymentByReference(db, reference);
  if (!payment) {
    await createAuditLog(db, {
      actorType: 'system',
      action: 'payment.webhook_payment_not_found',
      resourceType: 'payment_webhook',
      storeId: null,
      details: {
        provider,
        reference,
        status: incomingStatus
      },
      req,
      status: 'failure'
    });
    return res.json({ received: true });
  }

  const storeConfig = await getStoreProviderConfig(db, payment.store_id, provider);
  const secretKey = provider === 'paystack'
    ? resolvePaystackSecretKey({
      paymentScope: payment.payment_scope,
      storeConfig,
      config
    })
    : null;
  const webhookSecretHash = provider === 'flutterwave'
    ? resolveFlutterwaveWebhookSecretHash({
      paymentScope: payment.payment_scope,
      storeConfig,
      config
    })
    : null;

  if (!verifyWebhookSignature({
    provider,
    req,
    secretKey,
    secretHash: webhookSecretHash
  })) {
    await createAuditLog(db, {
      actorType: 'system',
      action: 'payment.webhook_signature_invalid',
      resourceType: 'payment_webhook',
      resourceId: payment.id,
      storeId: payment.store_id,
      details: {
        provider,
        reference,
        status: incomingStatus
      },
      req,
      status: 'failure'
    });
    throw createHttpError(401, `Invalid ${provider} webhook signature.`, null, { expose: true });
  }

  await verifyAndRecordPayment({
    db,
    bus,
    config,
    payment,
    webhookEvent: String(req.body.event || req.body.type || '').trim().toLowerCase()
  });
  await createAuditLog(db, {
    actorType: 'system',
    action: 'payment.webhook_verified',
    resourceType: 'payment_webhook',
    resourceId: payment.id,
    storeId: payment.store_id,
    details: {
      provider,
      reference,
      status: incomingStatus
    },
    req
  });

  return res.json({ received: true });
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/payments/create-checkout-session', requireInternal, validate([
    allowBodyFields([
      'provider',
      'amount',
      'currency',
      'payment_scope',
      'store_id',
      'owner_id',
      'customer_id',
      'order_id',
      'entity_type',
      'entity_id',
      'email',
      'metadata',
      'callback_url',
      'customer_name',
      'customer_phone'
    ]),
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
    body('callback_url').optional().isURL({ require_protocol: true }).withMessage('callback_url must be a valid absolute URL.'),
    commonRules.optionalPlainText('customer_name', 120),
    commonRules.optionalPlainText('customer_phone', 40)
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
    const sanitizedMetadata = sanitizeJsonObject(req.body.metadata || {});

    if (!PAYMENT_PROVIDERS.includes(provider)) {
      throw createHttpError(400, 'Unsupported payment provider.', null, { expose: true });
    }

    if (paymentScope === 'storefront' && !storeId) {
      throw createHttpError(400, 'store_id is required for storefront payments.', null, { expose: true });
    }

    if (paymentScope === 'subscription' && !ownerId) {
      throw createHttpError(400, 'owner_id is required for subscription payments.', null, { expose: true });
    }

    if (!callbackUrl) {
      throw createHttpError(400, 'callback_url is required for hosted checkout payments.', null, { expose: true });
    }

    const storeConfig = await getStoreProviderConfig(db, storeId, provider);
    if (paymentScope !== 'subscription' && !isActiveStoreProviderConfig(storeConfig)) {
      throw createHttpError(400, 'The selected store payment provider is not fully configured or active.', null, { expose: true });
    }

    if (paymentScope === 'subscription' && provider === 'flutterwave') {
      throw createHttpError(400, 'Flutterwave is not enabled for subscription billing.', null, { expose: true });
    }

    if (paymentScope === 'subscription' && !hasConfiguredPlatformProvider(getPlatformProviderConfigs()[provider])) {
      throw createHttpError(400, 'The selected subscription payment provider is not configured in platform env.', null, { expose: true });
    }

    const publicKey = getProviderPublicKey({ provider, paymentScope, storeConfig });
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
          customer_name: req.body.customer_name || null,
          customer_phone: req.body.customer_phone || null,
          ...sanitizedMetadata
        })
      ]
    );
    const payment = (await db.query('SELECT * FROM payments WHERE id = ?', [result.insertId]))[0];
    const metadata = {
      ...sanitizedMetadata,
      payment_id: payment.id,
      payment_scope: paymentScope,
      entity_type: req.body.entity_type || null,
      entity_id: req.body.entity_id || null
    };

    let checkoutSession = null;
    try {
      if (provider === 'paystack') {
        checkoutSession = await initializePaystackCheckout({
          payment,
          secretKey: resolvePaystackSecretKey({
            paymentScope,
            storeConfig,
            config
          }),
          publicKey,
          email: req.body.email,
          callbackUrl,
          metadata
        });
      } else {
        checkoutSession = await initializeFlutterwaveCheckout({
          payment,
          secretKey: resolveFlutterwaveSecretKey({
            paymentScope,
            storeConfig,
            config
          }),
          publicKey,
          email: req.body.email,
          customerName: req.body.customer_name || null,
          customerPhone: req.body.customer_phone || null,
          callbackUrl,
          metadata
        });
      }
    } catch (error) {
      await db.execute(
        'UPDATE payments SET status = ?, metadata = ? WHERE id = ?',
        [
          'failed',
          JSON.stringify({
            ...parsePaymentMetadata(payment.metadata),
            checkout_initialization_failed_at: new Date().toISOString(),
            checkout_initialization_error: sanitizePlainText(error.message || 'Unable to initialize checkout.', {
              maxLength: 255
            })
          }),
          payment.id
        ]
      );
      throw error;
    }

    await db.execute(
      'UPDATE payments SET provider_session_id = ?, metadata = ? WHERE id = ?',
      [
        checkoutSession.providerSessionId,
        JSON.stringify({
          ...parsePaymentMetadata(payment.metadata),
          provider_data: sanitizeJsonObject(checkoutSession.providerData)
        }),
        payment.id
      ]
    );
    const freshPayment = (await db.query('SELECT * FROM payments WHERE id = ?', [payment.id]))[0];

    return res.status(201).json({
      payment: serializePayment(freshPayment),
      providers: [checkoutSession.provider]
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

    const storeConfig = await getStoreProviderConfig(db, storeId, provider);
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

  app.post('/payments/:reference/refund', requireInternal, validate([
    allowBodyFields(['reason']),
    param('reference').isString().notEmpty().isLength({ max: 191 }),
    commonRules.optionalPlainText('reason', 255)
  ]), asyncHandler(async (req, res) => {
    requireStoreOperator(req);

    const payment = await getPaymentByReference(db, req.params.reference);
    if (!payment) {
      throw createHttpError(404, 'Payment not found.', null, { expose: true });
    }

    if (String(payment.store_id || '') !== String(req.authContext.storeId || '')) {
      throw createHttpError(403, 'You do not have access to this payment.', null, { expose: true });
    }

    if (!payment.order_id) {
      throw createHttpError(400, 'Only storefront order payments can be refunded here.', null, { expose: true });
    }

    const currentStatus = normalizePaymentStatus(payment.status);
    if (currentStatus !== 'success' && currentStatus !== 'refunded') {
      throw createHttpError(409, 'Only successful payments can be refunded.', null, { expose: true });
    }

    const paymentMetadata = parsePaymentMetadata(payment.metadata);
    const storeConfig = await getStoreProviderConfig(db, payment.store_id, payment.provider);
    const refund = currentStatus === 'refunded'
      ? paymentMetadata.refund || null
      : await triggerManualRefund({
        payment,
        paymentMetadata,
        paymentScope: payment.payment_scope,
        storeConfig,
        config,
        reason: req.body.reason || ''
      });

    const nextStatus = refund && COMPLETED_REFUND_STATUSES.has(String(refund.status || '').trim().toLowerCase())
      ? 'refunded'
      : currentStatus;
    const updatedPayment = await persistPaymentOutcome({
      db,
      bus,
      payment,
      normalizedStatus: nextStatus,
      providerReference: payment.reference,
      providerSessionId: payment.provider_session_id,
      refund,
      metadata: {
        refund_requested_at: new Date().toISOString(),
        refund_requested_by: {
          actor_type: req.authContext.actorType,
          user_id: req.authContext.userId,
          role: req.authContext.actorRole
        },
        refund_reason: req.body.reason || ''
      }
    });

    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'payment.refund_requested',
      resourceType: 'payment',
      resourceId: payment.id,
      storeId: payment.store_id,
      details: {
        provider: payment.provider,
        reference: payment.reference,
        order_id: payment.order_id,
        refund
      },
      req
    });

    return res.status(201).json({
      payment: {
        ...serializePayment(updatedPayment),
        metadata: parsePaymentMetadata(updatedPayment.metadata)
      },
      refund
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
    allowBodyFields(['provider', 'public_key', 'secret_key', 'webhook_secret_hash', 'status']),
    body('provider').isIn(PAYMENT_PROVIDERS),
    commonRules.optionalPlainText('public_key', 255),
    commonRules.optionalPlainText('secret_key', 255),
    commonRules.optionalPlainText('webhook_secret_hash', 255),
    body('status').optional().isIn(PAYMENT_PROVIDER_STATUSES)
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId);
    const provider = normalizeProvider(req.body.provider);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const existingRow = await getStoreProviderConfig(db, storeId, provider);
    const nextPublicKey = String(req.body.public_key || '').trim() || existingRow?.public_key || null;
    const nextSecretEncrypted = String(req.body.secret_key || '').trim()
      ? encryptText(req.body.secret_key, config.internalSharedSecret)
      : (existingRow?.secret_key_encrypted || null);
    const nextWebhookSecretHashEncrypted = String(req.body.webhook_secret_hash || '').trim()
      ? encryptText(req.body.webhook_secret_hash, config.internalSharedSecret)
      : (existingRow?.webhook_secret_hash_encrypted || null);
    const nextStatus = normalizeProviderStatus(req.body.status || existingRow?.status || 'inactive');

    const fieldErrors = [];
    if (nextStatus === 'active' && (!nextPublicKey || !nextSecretEncrypted)) {
      if (!nextPublicKey) {
        fieldErrors.push({ field: 'public_key', message: 'Public key is required for active providers.' });
      }
      if (!nextSecretEncrypted) {
        fieldErrors.push({ field: 'secret_key', message: 'Secret key is required for active providers.' });
      }
    }

    if (provider === 'flutterwave' && nextStatus === 'active' && !nextWebhookSecretHashEncrypted) {
      fieldErrors.push({
        field: 'webhook_secret_hash',
        message: 'Flutterwave webhook secret hash is required for active providers.'
      });
    }

    if (fieldErrors.length) {
      throw createHttpError(400, 'Active payment providers require complete credentials.', {
        fields: fieldErrors
      }, { expose: true });
    }

    await db.execute(
      `
        INSERT INTO payment_provider_configs (
          store_id, provider, public_key, secret_key_encrypted, webhook_secret_hash_encrypted, status
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          public_key = VALUES(public_key),
          secret_key_encrypted = VALUES(secret_key_encrypted),
          webhook_secret_hash_encrypted = VALUES(webhook_secret_hash_encrypted),
          status = VALUES(status)
      `,
      [
        storeId,
        provider,
        nextPublicKey,
        nextSecretEncrypted,
        nextWebhookSecretHashEncrypted,
        nextStatus
      ]
    );

    const row = await getStoreProviderConfig(db, storeId, provider);
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'payment.provider_config_updated',
      resourceType: 'payment_provider_config',
      resourceId: row?.id || null,
      storeId,
      details: {
        provider,
        status: nextStatus,
        has_public_key: Boolean(nextPublicKey),
        has_secret_key: Boolean(nextSecretEncrypted),
        has_webhook_secret_hash: Boolean(nextWebhookSecretHashEncrypted)
      },
      req
    });

    return res.status(201).json({
      config: serializeProviderConfig(row)
    });
  }));

  app.post('/payments/webhooks/:provider', validate([
    param('provider').isIn(PAYMENT_PROVIDERS)
  ]), asyncHandler(async (req, res) => {
    return processWebhook({ req, res, db, bus, config });
  }));
};

module.exports = {
  registerRoutes
};
