const { randomUUID } = require('crypto');
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
  storeIdRule,
  buildCookieOptions,
  isSecureRequest
} = require('../../../../packages/shared');

const buildSessionCookieOptions = (config) => {
  return buildCookieOptions(config, {
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
};

const setSessionCookie = (req, res, config, sessionId) => {
  if (config.isProduction && !isSecureRequest(req)) {
    return;
  }

  res.cookie('aisle_session_id', sessionId, buildSessionCookieOptions(config));
};

const resolveIdentity = (req) => {
  const storeId = Number(req.authContext?.storeId || req.headers['x-store-id'] || req.body.store_id || req.query.store_id);
  const customerId = req.authContext?.customerId
    ? Number(req.authContext.customerId)
    : (req.body.customer_id ? Number(req.body.customer_id) : null);
  const sessionId = String(
    req.cookies.aisle_session_id
    || req.headers['x-session-id']
    || req.body.session_id
    || req.query.session_id
    || randomUUID()
  );

  return {
    storeId,
    customerId,
    sessionId
  };
};

const loadCart = async (db, { cartId, storeId }) => {
  const cart = (await db.query(
    'SELECT * FROM carts WHERE id = ? AND store_id = ?',
    [cartId, storeId]
  ))[0];
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

const serializeCart = (cart, identity = {}) => {
  const safeCart = cart || {
    id: null,
    store_id: identity.storeId || null,
    customer_id: identity.customerId || null,
    session_id: identity.sessionId || null,
    status: 'active',
    items: [],
    total: 0
  };

  return {
    id: safeCart.id,
    store_id: safeCart.store_id,
    customer_id: safeCart.customer_id,
    session_id: safeCart.session_id,
    status: safeCart.status,
    items: (safeCart.items || []).map((item) => ({
      id: item.id,
      product_id: item.product_id,
      quantity: Number(item.quantity),
      price_at_time: Number(item.price_at_time),
      title_snapshot: item.title_snapshot,
      image_snapshot: item.image_snapshot,
      name: item.title_snapshot,
      image: item.image_snapshot,
      price: Number(item.price_at_time)
    })),
    total: Number(safeCart.total || 0)
  };
};

const findActiveCart = async (db, identity) => {
  if (identity.customerId) {
    return (await db.query(
      'SELECT * FROM carts WHERE store_id = ? AND customer_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
      [identity.storeId, identity.customerId, 'active']
    ))[0] || null;
  }

  return (await db.query(
    'SELECT * FROM carts WHERE store_id = ? AND session_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
    [identity.storeId, identity.sessionId, 'active']
  ))[0] || null;
};

const findOrCreateCart = async (db, identity) => {
  let cart = await findActiveCart(db, identity);

  if (!cart) {
    const result = await db.execute(
      'INSERT INTO carts (store_id, customer_id, session_id, status) VALUES (?, ?, ?, ?)',
      [identity.storeId, identity.customerId, identity.sessionId, 'active']
    );
    cart = (await db.query(
      'SELECT * FROM carts WHERE id = ? AND store_id = ?',
      [result.insertId, identity.storeId]
    ))[0];
  }

  return cart;
};

const publishCartUpdated = async (bus, cart, identity) => {
  await bus.publish(EVENT_NAMES.CART_UPDATED, {
    cart_id: cart?.id || null,
    store_id: identity.storeId,
    customer_id: identity.customerId,
    session_id: identity.sessionId
  });
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });

  app.get('/cart', validate([
    ...storeIdRule()
  ]), asyncHandler(async (req, res) => {
    const identity = resolveIdentity(req);
    if (!identity.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const cart = await findOrCreateCart(db, identity);
    const hydrated = await loadCart(db, {
      cartId: cart.id,
      storeId: identity.storeId
    });

    setSessionCookie(req, res, config, identity.sessionId);
    return res.json({ cart: serializeCart(hydrated, identity) });
  }));

  app.post('/cart/items', validate([
    allowBodyFields(['store_id', 'customer_id', 'session_id', 'product_id', 'quantity']),
    ...storeIdRule(),
    commonRules.int('product_id', { min: 1 }),
    commonRules.optionalInt('quantity', { min: 1, max: 999 })
  ]), asyncHandler(async (req, res) => {
    const identity = resolveIdentity(req);
    const productId = Number(req.body.product_id);
    const quantity = Math.max(1, Number(req.body.quantity || 1));

    if (!identity.storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
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
      throw createHttpError(404, 'Product not found.', null, { expose: true });
    }

    const cart = await findOrCreateCart(db, identity);
    const existingItem = (await db.query(
      'SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cart.id, productId]
    ))[0];

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

    const hydrated = await loadCart(db, {
      cartId: cart.id,
      storeId: identity.storeId
    });
    await publishCartUpdated(bus, cart, identity);

    setSessionCookie(req, res, config, identity.sessionId);
    return res.status(201).json({ cart: serializeCart(hydrated, identity) });
  }));

  app.patch('/cart/items/:productId', validate([
    allowBodyFields(['store_id', 'customer_id', 'session_id', 'quantity']),
    commonRules.paramId('productId'),
    commonRules.int('quantity', { min: 0, max: 999 }),
    ...storeIdRule()
  ]), asyncHandler(async (req, res) => {
    const identity = resolveIdentity(req);
    if (!identity.storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
    }

    const quantity = Math.max(0, Number(req.body.quantity || 0));
    const cart = await findOrCreateCart(db, identity);
    const existingItem = (await db.query(
      'SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cart.id, req.params.productId]
    ))[0];

    if (!existingItem) {
      throw createHttpError(404, 'Cart item not found.', null, { expose: true });
    }

    if (quantity === 0) {
      await db.execute('DELETE FROM cart_items WHERE id = ?', [existingItem.id]);
    } else {
      await db.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', [quantity, existingItem.id]);
    }

    const hydrated = await loadCart(db, {
      cartId: cart.id,
      storeId: identity.storeId
    });
    await publishCartUpdated(bus, cart, identity);

    return res.json({ cart: serializeCart(hydrated, identity) });
  }));

  app.delete('/cart/items/:productId', validate([
    commonRules.paramId('productId'),
    ...storeIdRule()
  ]), asyncHandler(async (req, res) => {
    const identity = resolveIdentity(req);
    if (!identity.storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
    }

    const cart = await findOrCreateCart(db, identity);
    await db.execute('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?', [cart.id, req.params.productId]);
    const hydrated = await loadCart(db, {
      cartId: cart.id,
      storeId: identity.storeId
    });
    await publishCartUpdated(bus, cart, identity);

    return res.json({ cart: serializeCart(hydrated, identity) });
  }));

  app.post('/cart/clear', validate([
    allowBodyFields(['store_id', 'customer_id', 'session_id']),
    ...storeIdRule()
  ]), asyncHandler(async (req, res) => {
    const identity = resolveIdentity(req);
    if (!identity.storeId) {
      throw createHttpError(400, 'store_id is required.', null, { expose: true });
    }

    const cart = await findActiveCart(db, identity);
    if (!cart) {
      setSessionCookie(req, res, config, identity.sessionId);
      return res.json({ cart: serializeCart(null, identity) });
    }

    await db.execute('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);
    const hydrated = await loadCart(db, {
      cartId: cart.id,
      storeId: identity.storeId
    });
    await publishCartUpdated(bus, cart, identity);

    setSessionCookie(req, res, config, identity.sessionId);
    return res.json({ cart: serializeCart(hydrated, identity) });
  }));

  app.post('/cart/merge', requireInternal, validate([
    commonRules.plainText('session_id', 120)
  ]), asyncHandler(async (req, res) => {
    if (!req.authContext.customerId) {
      throw createHttpError(401, 'Customer authentication required.', null, { expose: true });
    }

    const sourceSessionId = String(req.body.session_id || '').trim();
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

    const hydrated = await loadCart(db, {
      cartId: targetCart.id,
      storeId
    });
    await publishCartUpdated(bus, targetCart, {
      storeId,
      customerId,
      sessionId: sourceSessionId
    });

    return res.json({ cart: serializeCart(hydrated, {
      storeId,
      customerId,
      sessionId: sourceSessionId
    }) });
  }));
};

module.exports = {
  registerRoutes
};
