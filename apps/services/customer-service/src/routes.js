const crypto = require('crypto');
const { body, query } = require('express-validator');
const {
  hashPassword,
  comparePassword,
  signCustomerToken,
  requireInternalRequest,
  buildSignedInternalHeaders,
  requestJson,
  EVENT_NAMES,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  allowQueryFields,
  commonRules,
  storeIdRule,
  sanitizeEmail,
  sanitizeJsonObject,
  sanitizePlainText
} = require('../../../../packages/shared');
const {
  parseMarketingUnsubscribeToken,
  sanitizeMarketingSubscriber
} = require('./marketing');

const PASSWORD_RESET_OTP_TTL_MINUTES = Math.max(5, Number(process.env.PASSWORD_RESET_OTP_TTL_MINUTES || 15));

const sanitizeCustomer = (customer) => {
  if (!customer) {
    return null;
  }

  return {
    id: customer.id,
    store_id: customer.store_id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    addresses: customer.addresses ? JSON.parse(customer.addresses) : [],
    metadata: customer.metadata ? JSON.parse(customer.metadata) : {},
    created_at: customer.created_at,
    updated_at: customer.updated_at
  };
};

const resolveStoreId = (req) => {
  return Number(req.authContext?.storeId || req.body.store_id || req.query.store_id || req.headers['x-store-id']);
};

const sanitizeAddresses = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 10).map((entry) => sanitizeJsonObject(entry));
};

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const normalizeEmail = (value = '') => {
  return sanitizeEmail(value || '');
};

const generateOtp = () => {
  return String(crypto.randomInt(100000, 1000000));
};

const getOtpExpiryDate = () => {
  return new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000);
};

const buildGenericPasswordResetResponse = () => ({
  status: 'accepted',
  message: 'If that account exists, an OTP has been sent to the email address.'
});

const sendPasswordResetOtpEmail = async (config, requestId, payload = {}) => {
  try {
    await requestJson(`${config.serviceUrls.notification}/emails/send`, {
      method: 'POST',
      headers: buildSignedInternalHeaders({
        requestId: requestId || crypto.randomUUID(),
        actorType: 'service',
        actorRole: 'system',
        secret: config.internalSharedSecret
      }),
      body: {
        to: normalizeEmail(payload.email),
        template_key: 'store.customer_password_reset_otp',
        template_data: {
          name: sanitizePlainText(payload.name || 'there', { maxLength: 120 }) || 'there',
          otp: String(payload.otp || '').trim(),
          expires_in_minutes: PASSWORD_RESET_OTP_TTL_MINUTES
        },
        store_id: Number(payload.store_id) || null,
        metadata: {
          kind: 'password_reset_otp',
          audience: 'customer'
        }
      },
      timeoutMs: config.requestTimeoutMs
    });
  } catch (error) {
    const upstreamMessage = typeof error?.payload === 'object' && error?.payload?.error
      ? error.payload.error
      : error.message;
    throw createHttpError(Number(error.status) || 503, upstreamMessage || 'Unable to send password reset email right now.', null, {
      expose: true
    });
  }
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/customers/register', validate([
    allowBodyFields(['store_id', 'name', 'email', 'password', 'phone', 'addresses', 'metadata']),
    ...storeIdRule(),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password(),
    commonRules.phone(),
    body('addresses').optional().isArray({ max: 10 }),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    const storeId = resolveStoreId(req);
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
    }

    const existing = await db.query('SELECT id FROM customers WHERE store_id = ? AND email = ?', [storeId, email]);
    if (existing.length) {
      throw createHttpError(409, 'A customer with this email already exists for this store.', null, { expose: true });
    }

    const passwordHash = await hashPassword(password);
    const result = await db.execute(
      'INSERT INTO customers (store_id, name, email, password_hash, phone, addresses, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        storeId,
        name,
        email,
        passwordHash,
        req.body.phone || null,
        JSON.stringify(sanitizeAddresses(req.body.addresses)),
        JSON.stringify(sanitizeJsonObject(req.body.metadata || {}))
      ]
    );
    const customer = (await db.query(
      'SELECT * FROM customers WHERE id = ? AND store_id = ?',
      [result.insertId, storeId]
    ))[0];
    const token = signCustomerToken(customer, config.jwtSecret, config.jwtAccessTtl);

    await bus.publish(EVENT_NAMES.CUSTOMER_REGISTERED, {
      customer_id: customer.id,
      store_id: customer.store_id,
      email: customer.email
    });

    return res.status(201).json({
      token,
      customer: sanitizeCustomer(customer)
    });
  }));

  app.post('/customers/login', validate([
    allowBodyFields(['store_id', 'email', 'password']),
    ...storeIdRule(),
    commonRules.email(),
    body('password').isString().notEmpty().withMessage('Password is required.')
  ]), asyncHandler(async (req, res) => {
    const storeId = resolveStoreId(req);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
    }

    const customer = (await db.query(
      'SELECT * FROM customers WHERE store_id = ? AND email = ?',
      [storeId, email]
    ))[0];

    if (!customer) {
      throw createHttpError(401, 'Invalid credentials.', null, { expose: true });
    }

    const passwordMatches = await comparePassword(password, customer.password_hash);
    if (!passwordMatches) {
      throw createHttpError(401, 'Invalid credentials.', null, { expose: true });
    }

    return res.json({
      token: signCustomerToken(customer, config.jwtSecret, config.jwtAccessTtl),
      customer: sanitizeCustomer(customer)
    });
  }));

  app.post('/customers/password-reset/request', validate([
    allowBodyFields(['store_id', 'email']),
    ...storeIdRule(),
    commonRules.email()
  ]), asyncHandler(async (req, res) => {
    const storeId = resolveStoreId(req);
    const email = normalizeEmail(req.body.email);

    if (!storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
    }

    const customer = (await db.query(
      'SELECT * FROM customers WHERE store_id = ? AND email = ? LIMIT 1',
      [storeId, email]
    ))[0] || null;

    if (!customer) {
      return res.json(buildGenericPasswordResetResponse());
    }

    const otp = generateOtp();
    const otpHash = await hashPassword(otp);
    const expiresAt = getOtpExpiryDate();

    await db.execute(
      `
        UPDATE customers
        SET password_reset_otp_hash = ?, password_reset_otp_expires_at = ?, password_reset_requested_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ?
      `,
      [
        otpHash,
        expiresAt,
        customer.id,
        storeId
      ]
    );

    await sendPasswordResetOtpEmail(config, req.requestId, {
      store_id: storeId,
      email: customer.email,
      name: customer.name,
      otp
    });

    return res.json(buildGenericPasswordResetResponse());
  }));

  app.post('/customers/password-reset/confirm', validate([
    allowBodyFields(['store_id', 'email', 'otp', 'password']),
    ...storeIdRule(),
    commonRules.email(),
    body('otp')
      .isString()
      .trim()
      .isLength({ min: 4, max: 12 })
      .withMessage('Enter the OTP that was sent to your email.'),
    commonRules.password()
  ]), asyncHandler(async (req, res) => {
    const storeId = resolveStoreId(req);
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const password = String(req.body.password || '');

    if (!storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
    }

    const customer = (await db.query(
      'SELECT * FROM customers WHERE store_id = ? AND email = ? LIMIT 1',
      [storeId, email]
    ))[0] || null;

    if (!customer || !customer.password_reset_otp_hash || !customer.password_reset_otp_expires_at) {
      throw createHttpError(401, 'Invalid or expired OTP.', null, { expose: true });
    }

    const expiresAt = new Date(customer.password_reset_otp_expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await db.execute(
        `
          UPDATE customers
          SET password_reset_otp_hash = NULL, password_reset_otp_expires_at = NULL, password_reset_requested_at = NULL
          WHERE id = ? AND store_id = ?
        `,
        [customer.id, storeId]
      );
      throw createHttpError(401, 'Invalid or expired OTP.', null, { expose: true });
    }

    const otpMatches = await comparePassword(otp, customer.password_reset_otp_hash);
    if (!otpMatches) {
      throw createHttpError(401, 'Invalid or expired OTP.', null, { expose: true });
    }

    const passwordHash = await hashPassword(password);
    await db.execute(
      `
        UPDATE customers
        SET password_hash = ?, password_reset_otp_hash = NULL, password_reset_otp_expires_at = NULL, password_reset_requested_at = NULL
        WHERE id = ? AND store_id = ?
      `,
      [
        passwordHash,
        customer.id,
        storeId
      ]
    );

    return res.json({
      status: 'ok'
    });
  }));

  app.get('/customers/me', requireInternal, asyncHandler(async (req, res) => {
    if (!req.authContext.customerId) {
      throw createHttpError(401, 'Customer authentication required.', null, { expose: true });
    }

    const customer = (await db.query(
      'SELECT * FROM customers WHERE id = ? AND store_id = ?',
      [req.authContext.customerId, req.authContext.storeId]
    ))[0];
    if (!customer) {
      throw createHttpError(404, 'Customer not found.', null, { expose: true });
    }

    return res.json({
      customer: sanitizeCustomer(customer)
    });
  }));

  app.put('/customers/me', requireInternal, validate([
    allowBodyFields(['name', 'phone', 'addresses', 'metadata']),
    commonRules.optionalName('name', 120),
    commonRules.phone(),
    body('addresses').optional().isArray({ max: 10 }),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    if (!req.authContext.customerId) {
      throw createHttpError(401, 'Customer authentication required.', null, { expose: true });
    }

    const existing = (await db.query(
      'SELECT * FROM customers WHERE id = ? AND store_id = ?',
      [req.authContext.customerId, req.authContext.storeId]
    ))[0];
    if (!existing) {
      throw createHttpError(404, 'Customer not found.', null, { expose: true });
    }

    await db.execute(
      'UPDATE customers SET name = ?, phone = ?, addresses = ?, metadata = ? WHERE id = ? AND store_id = ?',
      [
        req.body.name || existing.name,
        req.body.phone === undefined ? existing.phone : req.body.phone,
        JSON.stringify(req.body.addresses === undefined
          ? (existing.addresses ? JSON.parse(existing.addresses) : [])
          : sanitizeAddresses(req.body.addresses)),
        JSON.stringify(req.body.metadata === undefined
          ? (existing.metadata ? JSON.parse(existing.metadata) : {})
          : sanitizeJsonObject(req.body.metadata || {})),
        req.authContext.customerId,
        req.authContext.storeId
      ]
    );
    const customer = (await db.query(
      'SELECT * FROM customers WHERE id = ? AND store_id = ?',
      [req.authContext.customerId, req.authContext.storeId]
    ))[0];
    return res.json({
      customer: sanitizeCustomer(customer)
    });
  }));

  app.get('/customers', requireInternal, asyncHandler(async (req, res) => {
    if (!req.authContext.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    if (req.authContext.actorType !== 'platform_user') {
      throw createHttpError(403, 'Only store operators can view customer lists.', null, { expose: true });
    }

    const customers = await db.query(
      'SELECT * FROM customers WHERE store_id = ? ORDER BY created_at DESC',
      [req.authContext.storeId]
    );
    return res.json({
      customers: customers.map(sanitizeCustomer)
    });
  }));

  app.get('/customers/marketing/subscribers', requireInternal, asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId || req.headers['x-store-id']);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const customers = await db.query(
      `
        SELECT id, store_id, name, email, marketing_email_subscribed, marketing_email_subscribed_at, marketing_email_unsubscribed_at
        FROM customers
        WHERE store_id = ? AND marketing_email_subscribed = 1
        ORDER BY created_at DESC, id DESC
      `,
      [storeId]
    );

    return res.json({
      customers: customers.map(sanitizeMarketingSubscriber)
    });
  }));

  app.get('/customers/marketing/unsubscribe', validate([
    allowQueryFields(['token']),
    query('token')
      .trim()
      .notEmpty()
      .withMessage('token is required.')
      .isLength({ max: 4096 })
      .withMessage('token is invalid.')
  ]), asyncHandler(async (req, res) => {
    const tokenData = parseMarketingUnsubscribeToken(req.query.token, config.internalSharedSecret);
    const customer = (await db.query(
      'SELECT * FROM customers WHERE id = ? AND store_id = ? AND email = ? LIMIT 1',
      [tokenData.customerId, tokenData.storeId, tokenData.email]
    ))[0] || null;

    if (!customer) {
      throw createHttpError(404, 'Customer not found for this unsubscribe link.', null, { expose: true });
    }

    const alreadyUnsubscribed = !Boolean(customer.marketing_email_subscribed);
    if (!alreadyUnsubscribed) {
      await db.execute(
        `
          UPDATE customers
          SET marketing_email_subscribed = 0,
              marketing_email_unsubscribed_at = CURRENT_TIMESTAMP
          WHERE id = ? AND store_id = ?
        `,
        [customer.id, customer.store_id]
      );
    }

    const refreshedCustomer = (await db.query(
      `
        SELECT id, store_id, name, email, marketing_email_subscribed, marketing_email_subscribed_at, marketing_email_unsubscribed_at
        FROM customers
        WHERE id = ? AND store_id = ?
        LIMIT 1
      `,
      [customer.id, customer.store_id]
    ))[0] || customer;

    return res.json({
      status: 'unsubscribed',
      already_unsubscribed: alreadyUnsubscribed,
      customer: sanitizeMarketingSubscriber(refreshedCustomer)
    });
  }));
};

module.exports = {
  registerRoutes
};
