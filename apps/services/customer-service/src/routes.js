const {
  hashPassword,
  comparePassword,
  signCustomerToken,
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES
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

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.post('/customers/register', async (req, res) => {
    try {
      const storeId = resolveStoreId(req);
      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');

      if (!storeId || !name || !email || password.length < 8) {
        return res.status(400).json({ error: 'store_id, name, email, and password are required.' });
      }

      const existing = await db.query('SELECT id FROM customers WHERE store_id = ? AND email = ?', [storeId, email]);
      if (existing.length) {
        return res.status(409).json({ error: 'A customer with this email already exists for this store.' });
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
          JSON.stringify(req.body.addresses || []),
          JSON.stringify(req.body.metadata || {})
        ]
      );
      const customer = (await db.query('SELECT * FROM customers WHERE id = ?', [result.insertId]))[0];
      const token = signCustomerToken(customer, config.jwtSecret);

      await bus.publish(EVENT_NAMES.CUSTOMER_REGISTERED, {
        customer_id: customer.id,
        store_id: customer.store_id,
        email: customer.email
      });

      return res.status(201).json({
        token,
        customer: sanitizeCustomer(customer)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/customers/login', async (req, res) => {
    try {
      const storeId = resolveStoreId(req);
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const customer = (await db.query(
        'SELECT * FROM customers WHERE store_id = ? AND email = ?',
        [storeId, email]
      ))[0];

      if (!customer) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const passwordMatches = await comparePassword(password, customer.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      return res.json({
        token: signCustomerToken(customer, config.jwtSecret),
        customer: sanitizeCustomer(customer)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/customers/me', requireInternal, async (req, res) => {
    try {
      if (!req.authContext.customerId) {
        return res.status(401).json({ error: 'Customer authentication required.' });
      }

      const customer = (await db.query(
        'SELECT * FROM customers WHERE id = ? AND store_id = ?',
        [req.authContext.customerId, req.authContext.storeId]
      ))[0];
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found.' });
      }

      return res.json({
        customer: sanitizeCustomer(customer)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.put('/customers/me', requireInternal, async (req, res) => {
    try {
      if (!req.authContext.customerId) {
        return res.status(401).json({ error: 'Customer authentication required.' });
      }

      await db.execute(
        'UPDATE customers SET name = ?, phone = ?, addresses = ?, metadata = ? WHERE id = ? AND store_id = ?',
        [
          req.body.name || 'Customer',
          req.body.phone || null,
          JSON.stringify(req.body.addresses || []),
          JSON.stringify(req.body.metadata || {}),
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
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/customers', requireInternal, async (req, res) => {
    try {
      if (!req.authContext.storeId) {
        return res.status(400).json({ error: 'Store context is required.' });
      }

      if (req.authContext.actorType !== 'platform_user') {
        return res.status(403).json({ error: 'Only store operators can view customer lists.' });
      }

      const customers = await db.query('SELECT * FROM customers WHERE store_id = ? ORDER BY created_at DESC', [req.authContext.storeId]);
      return res.json({
        customers: customers.map(sanitizeCustomer)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  registerRoutes
};
