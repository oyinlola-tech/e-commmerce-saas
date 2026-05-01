const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  buildSignedInternalHeaders,
  requestJson,
  EVENT_NAMES
} = require('../../../../packages/shared');

const resolveIdentity = (req) => {
  const storeId = Number(req.authContext?.storeId || req.headers['x-store-id'] || req.body.store_id || req.query.store_id);
  const customerId = req.authContext?.customerId ? Number(req.authContext.customerId) : (req.body.customer_id ? Number(req.body.customer_id) : null);
  const sessionId = String(
    req.cookies.aisle_session_id ||
    req.headers['x-session-id'] ||
    req.body.session_id ||
    req.query.session_id ||
    randomUUID()
  );

  return {
    storeId,
    customerId,
    sessionId
  };
};

const loadCart = async (db, cartId) => {
  const cart = (await db.query('SELECT * FROM carts WHERE id = ?', [cartId]))[0];
  if (!cart) {
    return null;
  }

  const items = await db.query('SELECT * FROM cart_items WHERE cart_id = ? ORDER BY created_at ASC', [cartId]);
  const total = items.reduce((sum, item) => sum + Number(item.price_at_time) * Number(item.quantity), 0);
  return {
    ...cart,
    items,
    total
  };
};

const findOrCreateCart = async (db, identity) => {
  let cart = null;
  if (identity.customerId) {
    cart = (await db.query(
      'SELECT * FROM carts WHERE store_id = ? AND customer_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
      [identity.storeId, identity.customerId, 'active']
    ))[0];
  } else {
    cart = (await db.query(
      'SELECT * FROM carts WHERE store_id = ? AND session_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
      [identity.storeId, identity.sessionId, 'active']
    ))[0];
  }

  if (!cart) {
    const result = await db.execute(
      'INSERT INTO carts (store_id, customer_id, session_id, status) VALUES (?, ?, ?, ?)',
      [identity.storeId, identity.customerId, identity.sessionId, 'active']
    );
    cart = (await db.query('SELECT * FROM carts WHERE id = ?', [result.insertId]))[0];
  }

  return cart;
};

const serializeCart = (cart) => {
  return {
    id: cart.id,
    store_id: cart.store_id,
    customer_id: cart.customer_id,
    session_id: cart.session_id,
    status: cart.status,
    items: cart.items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      quantity: Number(item.quantity),
      price_at_time: Number(item.price_at_time),
      title_snapshot: item.title_snapshot,
      image_snapshot: item.image_snapshot
    })),
    total: Number(cart.total)
  };
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.get('/cart', async (req, res) => {
    try {
      const identity = resolveIdentity(req);
      if (!identity.storeId) {
        return res.status(400).json({ error: 'Store context is required.' });
      }

      const cart = await findOrCreateCart(db, identity);
      const hydrated = await loadCart(db, cart.id);
      res.cookie('aisle_session_id', identity.sessionId, { sameSite: 'lax', httpOnly: false });
      return res.json({ cart: serializeCart(hydrated) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/cart/items', async (req, res) => {
    try {
      const identity = resolveIdentity(req);
      const productId = Number(req.body.product_id);
      const quantity = Math.max(1, Number(req.body.quantity || 1));
      if (!identity.storeId || !productId) {
        return res.status(400).json({ error: 'store_id and product_id are required.' });
      }

      const headers = buildSignedInternalHeaders({
        requestId: req.requestId,
        storeId: identity.storeId,
        actorType: identity.customerId ? 'customer' : '',
        customerId: identity.customerId || '',
        secret: config.internalSharedSecret
      });
      const productResponse = await requestJson(`${config.serviceUrls.product}/products/id/${productId}`, {
        headers,
        timeoutMs: config.requestTimeoutMs
      });
      const product = productResponse.product;
      if (!product || product.status !== 'published') {
        return res.status(404).json({ error: 'Product not found.' });
      }

      const cart = await findOrCreateCart(db, identity);
      const existingItem = (await db.query('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?', [cart.id, productId]))[0];
      if (existingItem) {
        await db.execute(
          'UPDATE cart_items SET quantity = quantity + ?, price_at_time = ?, title_snapshot = ?, image_snapshot = ? WHERE id = ?',
          [quantity, product.price, product.title, product.images[0] || null, existingItem.id]
        );
      } else {
        await db.execute(
          'INSERT INTO cart_items (cart_id, product_id, quantity, price_at_time, title_snapshot, image_snapshot) VALUES (?, ?, ?, ?, ?, ?)',
          [cart.id, productId, quantity, product.price, product.title, product.images[0] || null]
        );
      }

      const hydrated = await loadCart(db, cart.id);
      await bus.publish(EVENT_NAMES.CART_UPDATED, {
        cart_id: cart.id,
        store_id: identity.storeId,
        customer_id: identity.customerId,
        session_id: identity.sessionId
      });

      res.cookie('aisle_session_id', identity.sessionId, { sameSite: 'lax', httpOnly: false });
      return res.status(201).json({ cart: serializeCart(hydrated) });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.payload?.error || error.message });
    }
  });

  app.patch('/cart/items/:productId', async (req, res) => {
    try {
      const identity = resolveIdentity(req);
      const quantity = Math.max(0, Number(req.body.quantity || 0));
      const cart = await findOrCreateCart(db, identity);
      const existingItem = (await db.query('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?', [cart.id, req.params.productId]))[0];
      if (!existingItem) {
        return res.status(404).json({ error: 'Cart item not found.' });
      }

      if (quantity === 0) {
        await db.execute('DELETE FROM cart_items WHERE id = ?', [existingItem.id]);
      } else {
        await db.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', [quantity, existingItem.id]);
      }

      const hydrated = await loadCart(db, cart.id);
      await bus.publish(EVENT_NAMES.CART_UPDATED, {
        cart_id: cart.id,
        store_id: identity.storeId,
        customer_id: identity.customerId,
        session_id: identity.sessionId
      });

      return res.json({ cart: serializeCart(hydrated) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.delete('/cart/items/:productId', async (req, res) => {
    try {
      const identity = resolveIdentity(req);
      const cart = await findOrCreateCart(db, identity);
      await db.execute('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?', [cart.id, req.params.productId]);
      const hydrated = await loadCart(db, cart.id);
      await bus.publish(EVENT_NAMES.CART_UPDATED, {
        cart_id: cart.id,
        store_id: identity.storeId,
        customer_id: identity.customerId,
        session_id: identity.sessionId
      });

      return res.json({ cart: serializeCart(hydrated) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/cart/merge', requireInternal, async (req, res) => {
    try {
      if (!req.authContext.customerId) {
        return res.status(401).json({ error: 'Customer authentication required.' });
      }

      const sourceSessionId = String(req.body.session_id || '').trim();
      if (!sourceSessionId) {
        return res.status(400).json({ error: 'session_id is required.' });
      }

      const storeId = Number(req.authContext.storeId);
      const customerId = Number(req.authContext.customerId);
      const sourceCart = (await db.query(
        'SELECT * FROM carts WHERE store_id = ? AND session_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
        [storeId, sourceSessionId, 'active']
      ))[0];
      const targetCart = await findOrCreateCart(db, {
        storeId,
        customerId,
        sessionId: sourceSessionId
      });

      if (sourceCart && Number(sourceCart.id) !== Number(targetCart.id)) {
        const items = await db.query('SELECT * FROM cart_items WHERE cart_id = ?', [sourceCart.id]);
        for (const item of items) {
          const existingTargetItem = (await db.query(
            'SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?',
            [targetCart.id, item.product_id]
          ))[0];

          if (existingTargetItem) {
            await db.execute(
              'UPDATE cart_items SET quantity = quantity + ? WHERE id = ?',
              [item.quantity, existingTargetItem.id]
            );
          } else {
            await db.execute(
              'INSERT INTO cart_items (cart_id, product_id, quantity, price_at_time, title_snapshot, image_snapshot) VALUES (?, ?, ?, ?, ?, ?)',
              [targetCart.id, item.product_id, item.quantity, item.price_at_time, item.title_snapshot, item.image_snapshot]
            );
          }
        }

        await db.execute('UPDATE carts SET status = ? WHERE id = ?', ['abandoned', sourceCart.id]);
      }

      const hydrated = await loadCart(db, targetCart.id);
      return res.json({ cart: serializeCart(hydrated) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  registerRoutes
};
