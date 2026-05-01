const { body } = require('express-validator');
const {
  requireInternalRequest,
  buildSignedInternalHeaders,
  requestJson,
  EVENT_NAMES,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  commonRules,
  paginationRules,
  sanitizeJsonObject,
  sanitizeEmail
} = require('../../../../packages/shared');

const hydrateOrder = async (db, orderId, storeId) => {
  const order = (await db.query(
    'SELECT * FROM orders WHERE id = ? AND store_id = ?',
    [orderId, storeId]
  ))[0];
  if (!order) {
    return null;
  }

  const items = await db.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [orderId]);
  return {
    ...order,
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    shipping_address: order.shipping_address ? JSON.parse(order.shipping_address) : null,
    customer_snapshot: order.customer_snapshot ? JSON.parse(order.customer_snapshot) : null,
    items: items.map((item) => ({
      ...item,
      price: Number(item.price),
      quantity: Number(item.quantity)
    }))
  };
};

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const buildServiceHeaders = (req, config) => {
  return buildSignedInternalHeaders({
    requestId: req.requestId,
    storeId: req.authContext.storeId,
    userId: req.authContext.userId,
    actorRole: req.authContext.actorRole,
    customerId: req.authContext.customerId,
    actorType: req.authContext.actorType,
    secret: config.internalSharedSecret
  });
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/checkout', requireInternal, validate([
    allowBodyFields(['shipping_address', 'customer', 'currency', 'email']),
    body('shipping_address').optional().isObject(),
    body('customer').optional().isObject(),
    body('currency').optional().isLength({ min: 3, max: 3 }),
    body('email').optional().isEmail().customSanitizer((value) => sanitizeEmail(value))
  ]), asyncHandler(async (req, res) => {
    if (!req.authContext.customerId) {
      throw createHttpError(401, 'Customer authentication is required for checkout.', null, { expose: true });
    }

    const headers = buildServiceHeaders(req, config);
    const cartResponse = await requestJson(`${config.serviceUrls.cart}/cart`, {
      headers,
      timeoutMs: config.requestTimeoutMs
    });
    const cart = cartResponse.cart;
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) {
      throw createHttpError(400, 'Cart is empty.', null, { expose: true });
    }

    const reservation = await requestJson(`${config.serviceUrls.product}/inventory/reservations`, {
      method: 'POST',
      headers,
      body: {
        store_id: req.authContext.storeId,
        items: cart.items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity
        }))
      },
      timeoutMs: config.requestTimeoutMs
    });

    const shippingAddress = sanitizeJsonObject(req.body.shipping_address || {});
    const customerSnapshot = sanitizeJsonObject(req.body.customer || {});
    const orderId = await db.withTransaction(async (connection) => {
      const [orderResult] = await connection.execute(
        `
          INSERT INTO orders (
            store_id, customer_id, status, payment_status, reservation_id, subtotal, total, currency, shipping_address, customer_snapshot
          ) VALUES (?, ?, 'pending', 'pending', ?, ?, ?, ?, ?, ?)
        `,
        [
          Number(req.authContext.storeId),
          Number(req.authContext.customerId),
          reservation.reservation_id,
          Number(cart.total),
          Number(cart.total),
          req.body.currency || 'NGN',
          JSON.stringify(shippingAddress),
          JSON.stringify(customerSnapshot)
        ]
      );

      for (const item of cart.items) {
        await connection.execute(
          'INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
          [orderResult.insertId, item.product_id, item.title_snapshot, item.price_at_time, item.quantity]
        );
      }

      return orderResult.insertId;
    });

    const paymentSession = await requestJson(`${config.serviceUrls.payment}/payments/create-checkout-session`, {
      method: 'POST',
      headers,
      body: {
        order_id: orderId,
        store_id: Number(req.authContext.storeId),
        customer_id: Number(req.authContext.customerId),
        amount: Number(cart.total),
        currency: req.body.currency || 'NGN',
        email: req.body.email || customerSnapshot.email || null
      },
      timeoutMs: config.requestTimeoutMs
    });

    await db.execute(
      'UPDATE orders SET payment_reference = ? WHERE id = ? AND store_id = ?',
      [paymentSession.payment.reference, orderId, req.authContext.storeId]
    );

    await requestJson(`${config.serviceUrls.cart}/cart/clear`, {
      method: 'POST',
      headers,
      body: {},
      timeoutMs: config.requestTimeoutMs
    });

    const order = await hydrateOrder(db, orderId, req.authContext.storeId);
    await bus.publish(EVENT_NAMES.ORDER_CREATED, {
      order_id: order.id,
      store_id: order.store_id,
      customer_id: order.customer_id,
      total: order.total
    });

    return res.status(201).json({
      order,
      payment: paymentSession.payment,
      providers: paymentSession.providers
    });
  }));

  app.get('/orders', requireInternal, validate([
    ...paginationRules()
  ]), asyncHandler(async (req, res) => {
    if (!req.authContext.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const page = Math.max(1, Number(req.query.page || 1));
    const offset = (page - 1) * limit;

    let totalRows = [];
    let rows = [];
    if (req.authContext.customerId) {
      totalRows = await db.query(
        'SELECT COUNT(*) AS total FROM orders WHERE store_id = ? AND customer_id = ?',
        [req.authContext.storeId, req.authContext.customerId]
      );
      rows = await db.query(
        'SELECT * FROM orders WHERE store_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [req.authContext.storeId, req.authContext.customerId, limit, offset]
      );
    } else {
      totalRows = await db.query(
        'SELECT COUNT(*) AS total FROM orders WHERE store_id = ?',
        [req.authContext.storeId]
      );
      rows = await db.query(
        'SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [req.authContext.storeId, limit, offset]
      );
    }

    const orders = [];
    for (const row of rows) {
      orders.push(await hydrateOrder(db, row.id, req.authContext.storeId));
    }

    return res.json({
      page,
      limit,
      total: Number(totalRows[0]?.total || 0),
      orders
    });
  }));

  app.get('/orders/:id', requireInternal, validate([
    commonRules.paramId('id')
  ]), asyncHandler(async (req, res) => {
    const order = await hydrateOrder(db, req.params.id, req.authContext.storeId);
    if (!order) {
      throw createHttpError(404, 'Order not found.', null, { expose: true });
    }

    if (req.authContext.customerId && String(order.customer_id) !== String(req.authContext.customerId)) {
      throw createHttpError(403, 'You do not have access to this order.', null, { expose: true });
    }

    return res.json({ order });
  }));

  app.patch('/orders/:id/status', requireInternal, validate([
    allowBodyFields(['status']),
    commonRules.paramId('id'),
    commonRules.plainText('status', 40)
  ]), asyncHandler(async (req, res) => {
    if (req.authContext.actorType !== 'platform_user') {
      throw createHttpError(403, 'Only store operators can update order status.', null, { expose: true });
    }

    await db.execute(
      'UPDATE orders SET status = ? WHERE id = ? AND store_id = ?',
      [req.body.status || 'pending', req.params.id, req.authContext.storeId]
    );
    const order = await hydrateOrder(db, req.params.id, req.authContext.storeId);
    if (!order) {
      throw createHttpError(404, 'Order not found.', null, { expose: true });
    }

    await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
      order_id: order.id,
      store_id: order.store_id,
      status: order.status
    });

    return res.json({ order });
  }));
};

module.exports = {
  registerRoutes,
  hydrateOrder
};
