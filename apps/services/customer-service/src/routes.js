const { body } = require('express-validator');
const {
  hashPassword,
  comparePassword,
  signCustomerToken,
  requireInternalRequest,
  EVENT_NAMES,
  asyncHandler,
  createHttpError,
  validate,
  commonRules,
  storeIdRule,
  sanitizeJsonObject
} = require('../../../../packages/shared');

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

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/customers/register', validate([
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
    const email = String(req.body.email || '').trim().toLowerCase();
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
    ...storeIdRule(),
    commonRules.email(),
    body('password').isString().notEmpty().withMessage('Password is required.')
  ]), asyncHandler(async (req, res) => {
    const storeId = resolveStoreId(req);
    const email = String(req.body.email || '').trim().toLowerCase();
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
};

module.exports = {
  registerRoutes
};
