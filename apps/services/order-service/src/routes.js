const {
  requireInternalRequest,
  buildSignedInternalHeaders,
  requestJson,
  EVENT_NAMES
} = require('../../../../packages/shared');

const hydrateOrder = async (db, orderId) => {
  const order = (await db.query('SELECT * FROM orders WHERE id = ?', [orderId]))[0];
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
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.post('/checkout', requireInternal, async (req, res) => {
    try {
      if (!req.authContext.customerId) {
        return res.status(401).json({ error: 'Customer authentication is required for checkout.' });
      }

      const headers = buildServiceHeaders(req, config);
      const cartResponse = await requestJson(`${config.serviceUrls.cart}/cart`, {
        headers,
        timeoutMs: config.requestTimeoutMs
      });
      const cart = cartResponse.cart;
      if (!cart || !Array.isArray(cart.items) || !cart.items.length) {
        return res.status(400).json({ error: 'Cart is empty.' });
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

      const shippingAddress = req.body.shipping_address || {};
      const customerSnapshot = req.body.customer || {};
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
        'UPDATE orders SET payment_reference = ? WHERE id = ?',
        [paymentSession.payment.reference, orderId]
      );

      await requestJson(`${config.serviceUrls.cart}/cart/clear`, {
        method: 'POST',
        headers,
        body: {},
        timeoutMs: config.requestTimeoutMs
      });

      const order = await hydrateOrder(db, orderId);
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
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.payload?.error || error.message
      });
    }
  });

  app.get('/orders', requireInternal, async (req, res) => {
    try {
      let rows = [];
      if (req.authContext.customerId) {
        rows = await db.query(
          'SELECT * FROM orders WHERE store_id = ? AND customer_id = ? ORDER BY created_at DESC',
          [req.authContext.storeId, req.authContext.customerId]
        );
      } else {
        rows = await db.query(
          'SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC',
          [req.authContext.storeId]
        );
      }

      const orders = [];
      for (const row of rows) {
        orders.push(await hydrateOrder(db, row.id));
      }

      return res.json({ orders });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/orders/:id', requireInternal, async (req, res) => {
    try {
      const order = await hydrateOrder(db, req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      if (req.authContext.customerId && String(order.customer_id) !== String(req.authContext.customerId)) {
        return res.status(403).json({ error: 'You do not have access to this order.' });
      }

      if (String(order.store_id) !== String(req.authContext.storeId)) {
        return res.status(403).json({ error: 'Store context mismatch.' });
      }

      return res.json({ order });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.patch('/orders/:id/status', requireInternal, async (req, res) => {
    try {
      if (req.authContext.actorType !== 'platform_user') {
        return res.status(403).json({ error: 'Only store operators can update order status.' });
      }

      await db.execute(
        'UPDATE orders SET status = ? WHERE id = ? AND store_id = ?',
        [req.body.status || 'pending', req.params.id, req.authContext.storeId]
      );
      const order = await hydrateOrder(db, req.params.id);
      await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
        order_id: order.id,
        store_id: order.store_id,
        status: order.status
      });

      return res.json({ order });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  registerRoutes,
  hydrateOrder
};
