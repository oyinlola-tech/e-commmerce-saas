const { body, param } = require('express-validator');
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
  sanitizeEmail,
  sanitizePlainText
} = require('../../../../packages/shared');
const {
  COUPON_DISCOUNT_TYPES,
  ACTIVE_REDEMPTION_STATUSES,
  roundMoney,
  normalizeCouponCode,
  normalizeCouponDiscountType,
  toDatabaseDateTime,
  serializeCoupon,
  buildCouponPreview
} = require('./coupons');

const hydrateOrder = async (db, orderId, storeId) => {
  const query = storeId
    ? {
        sql: 'SELECT * FROM orders WHERE id = ? AND store_id = ?',
        values: [orderId, storeId]
      }
    : {
        sql: 'SELECT * FROM orders WHERE id = ?',
        values: [orderId]
      };
  const order = (await db.query(query.sql, query.values))[0];
  if (!order) {
    return null;
  }

  const items = await db.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [orderId]);
  return {
    ...order,
    subtotal: Number(order.subtotal),
    discount_total: Number(order.discount_total || 0),
    total: Number(order.total),
    coupon_code: order.coupon_code || null,
    coupon: order.coupon_snapshot ? JSON.parse(order.coupon_snapshot) : null,
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

const requirePlatformOperator = (req) => {
  if (req.authContext.actorType !== 'platform_user') {
    throw createHttpError(403, 'Only store operators can perform this action.', null, { expose: true });
  }
};

const getCouponByCode = async (db, storeId, code) => {
  const normalizedCode = normalizeCouponCode(code);
  if (!storeId || !normalizedCode) {
    return null;
  }

  return (await db.query(
    'SELECT * FROM coupons WHERE store_id = ? AND code = ? LIMIT 1',
    [storeId, normalizedCode]
  ))[0] || null;
};

const getCouponById = async (db, storeId, couponId) => {
  return (await db.query(
    'SELECT * FROM coupons WHERE id = ? AND store_id = ? LIMIT 1',
    [couponId, storeId]
  ))[0] || null;
};

const getCouponUsageCount = async (db, couponId) => {
  const rows = await db.query(
    `SELECT COUNT(*) AS total FROM coupon_redemptions WHERE coupon_id = ? AND status IN (${ACTIVE_REDEMPTION_STATUSES.map(() => '?').join(', ')})`,
    [couponId, ...ACTIVE_REDEMPTION_STATUSES]
  );

  return Number(rows[0]?.total || 0);
};

const previewCouponForStore = async ({ db, storeId, code, subtotal, now = new Date() }) => {
  const coupon = await getCouponByCode(db, storeId, code);
  if (!coupon) {
    return buildCouponPreview({
      coupon: null,
      subtotal,
      now
    });
  }

  const usageCount = await getCouponUsageCount(db, coupon.id);
  return buildCouponPreview({
    coupon,
    subtotal,
    usageCount,
    now
  });
};

const sanitizeCouponSnapshot = (coupon = null) => {
  if (!coupon) {
    return null;
  }

  return sanitizeJsonObject({
    id: coupon.id,
    code: coupon.code,
    description: coupon.description || '',
    discount_type: coupon.discount_type,
    discount_value: roundMoney(coupon.discount_value || 0),
    minimum_order_amount: roundMoney(coupon.minimum_order_amount || 0),
    usage_limit: coupon.usage_limit,
    starts_at: coupon.starts_at || null,
    ends_at: coupon.ends_at || null
  });
};

const buildCouponDraft = ({ payload = {}, existingCoupon = null }) => {
  const code = payload.code === undefined
    ? normalizeCouponCode(existingCoupon?.code || '')
    : normalizeCouponCode(payload.code);
  const discountType = normalizeCouponDiscountType(
    payload.discount_type === undefined
      ? existingCoupon?.discount_type
      : payload.discount_type
  );
  const discountValue = roundMoney(
    payload.discount_value === undefined
      ? Number(existingCoupon?.discount_value || 0)
      : Number(payload.discount_value || 0)
  );
  const minimumOrderAmount = roundMoney(
    payload.minimum_order_amount === undefined
      ? Number(existingCoupon?.minimum_order_amount || 0)
      : Number(payload.minimum_order_amount || 0)
  );
  const usageLimitValue = payload.usage_limit === undefined
    ? existingCoupon?.usage_limit
    : payload.usage_limit;
  const usageLimit = usageLimitValue === null || usageLimitValue === undefined || usageLimitValue === ''
    ? null
    : Number(usageLimitValue);

  return {
    code,
    description: payload.description === undefined
      ? (existingCoupon?.description || null)
      : (sanitizePlainText(payload.description || '', { maxLength: 190 }) || null),
    discount_type: discountType,
    discount_value: discountValue,
    minimum_order_amount: minimumOrderAmount,
    starts_at: payload.starts_at === undefined
      ? (existingCoupon?.starts_at || null)
      : toDatabaseDateTime(payload.starts_at),
    ends_at: payload.ends_at === undefined
      ? (existingCoupon?.ends_at || null)
      : toDatabaseDateTime(payload.ends_at),
    usage_limit: usageLimit,
    is_active: payload.is_active === undefined
      ? Boolean(existingCoupon?.is_active ?? true)
      : Boolean(payload.is_active)
  };
};

const validateCouponDraft = (couponDraft) => {
  if (!couponDraft.code) {
    throw createHttpError(422, 'Coupon code is required.', {
      fields: [{
        field: 'code',
        message: 'Coupon code is required.'
      }]
    }, { expose: true });
  }

  if (!COUPON_DISCOUNT_TYPES.includes(couponDraft.discount_type)) {
    throw createHttpError(422, 'Choose a valid coupon discount type.', {
      fields: [{
        field: 'discount_type',
        message: 'Choose a valid coupon discount type.'
      }]
    }, { expose: true });
  }

  if (!Number.isFinite(couponDraft.discount_value) || couponDraft.discount_value <= 0) {
    throw createHttpError(422, 'Coupon discount value must be greater than zero.', {
      fields: [{
        field: 'discount_value',
        message: 'Coupon discount value must be greater than zero.'
      }]
    }, { expose: true });
  }

  if (couponDraft.discount_type === 'percentage' && couponDraft.discount_value > 95) {
    throw createHttpError(422, 'Percentage coupons must be no more than 95%.', {
      fields: [{
        field: 'discount_value',
        message: 'Percentage coupons must be no more than 95%.'
      }]
    }, { expose: true });
  }

  if (!Number.isFinite(couponDraft.minimum_order_amount) || couponDraft.minimum_order_amount < 0) {
    throw createHttpError(422, 'Minimum order amount must be zero or greater.', {
      fields: [{
        field: 'minimum_order_amount',
        message: 'Minimum order amount must be zero or greater.'
      }]
    }, { expose: true });
  }

  if (couponDraft.usage_limit !== null && (!Number.isInteger(couponDraft.usage_limit) || couponDraft.usage_limit < 1)) {
    throw createHttpError(422, 'Usage limit must be a whole number greater than zero.', {
      fields: [{
        field: 'usage_limit',
        message: 'Usage limit must be a whole number greater than zero.'
      }]
    }, { expose: true });
  }

  const startsAt = couponDraft.starts_at ? new Date(couponDraft.starts_at) : null;
  const endsAt = couponDraft.ends_at ? new Date(couponDraft.ends_at) : null;
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw createHttpError(422, 'Coupon end time must be later than the start time.', {
      fields: [{
        field: 'ends_at',
        message: 'Coupon end time must be later than the start time.'
      }]
    }, { expose: true });
  }
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.get('/coupons', requireInternal, asyncHandler(async (req, res) => {
    requirePlatformOperator(req);
    if (!req.authContext.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const rows = await db.query(
      `
        SELECT
          coupons.*,
          (
            SELECT COUNT(*)
            FROM coupon_redemptions
            WHERE coupon_redemptions.coupon_id = coupons.id
              AND coupon_redemptions.status IN (${ACTIVE_REDEMPTION_STATUSES.map(() => '?').join(', ')})
          ) AS usage_count
        FROM coupons
        WHERE store_id = ?
        ORDER BY updated_at DESC, id DESC
      `,
      [...ACTIVE_REDEMPTION_STATUSES, req.authContext.storeId]
    );

    return res.json({
      coupons: rows.map((row) => serializeCoupon(row, {
        usage_count: Number(row.usage_count || 0)
      }))
    });
  }));

  app.post('/coupons/preview', requireInternal, validate([
    allowBodyFields(['code', 'subtotal']),
    body('code').trim().notEmpty().withMessage('Coupon code is required.'),
    body('subtotal').isFloat({ min: 0 }).toFloat()
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const preview = await previewCouponForStore({
      db,
      storeId,
      code: req.body.code,
      subtotal: Number(req.body.subtotal || 0)
    });

    if (!preview.valid) {
      throw createHttpError(preview.status || 422, preview.reason || 'Coupon is not valid.', null, { expose: true });
    }

    return res.json(preview);
  }));

  app.post('/coupons', requireInternal, validate([
    allowBodyFields(['code', 'description', 'discount_type', 'discount_value', 'minimum_order_amount', 'starts_at', 'ends_at', 'usage_limit', 'is_active']),
    body('code').trim().notEmpty().isLength({ max: 80 }),
    commonRules.optionalPlainText('description', 190),
    body('discount_type').isIn(COUPON_DISCOUNT_TYPES),
    body('discount_value').isFloat({ min: 0.01 }).toFloat(),
    body('minimum_order_amount').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('starts_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('ends_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('usage_limit').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    body('is_active').optional().isBoolean().toBoolean()
  ]), asyncHandler(async (req, res) => {
    requirePlatformOperator(req);
    const storeId = Number(req.authContext.storeId);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const couponDraft = buildCouponDraft({
      payload: req.body
    });
    validateCouponDraft(couponDraft);

    const existingCoupon = await getCouponByCode(db, storeId, couponDraft.code);
    if (existingCoupon) {
      throw createHttpError(409, 'A coupon with that code already exists.', null, { expose: true });
    }

    const result = await db.execute(
      `
        INSERT INTO coupons (
          store_id, code, description, discount_type, discount_value, minimum_order_amount,
          starts_at, ends_at, usage_limit, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        storeId,
        couponDraft.code,
        couponDraft.description,
        couponDraft.discount_type,
        couponDraft.discount_value,
        couponDraft.minimum_order_amount,
        couponDraft.starts_at,
        couponDraft.ends_at,
        couponDraft.usage_limit,
        couponDraft.is_active ? 1 : 0
      ]
    );

    const coupon = await getCouponById(db, storeId, result.insertId);
    return res.status(201).json({
      coupon: serializeCoupon(coupon)
    });
  }));

  app.put('/coupons/:id', requireInternal, validate([
    allowBodyFields(['code', 'description', 'discount_type', 'discount_value', 'minimum_order_amount', 'starts_at', 'ends_at', 'usage_limit', 'is_active']),
    param('id').isInt({ min: 1 }).toInt(),
    body('code').optional().trim().notEmpty().isLength({ max: 80 }),
    commonRules.optionalPlainText('description', 190),
    body('discount_type').optional().isIn(COUPON_DISCOUNT_TYPES),
    body('discount_value').optional().isFloat({ min: 0.01 }).toFloat(),
    body('minimum_order_amount').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('starts_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('ends_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('usage_limit').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    body('is_active').optional().isBoolean().toBoolean()
  ]), asyncHandler(async (req, res) => {
    requirePlatformOperator(req);
    const storeId = Number(req.authContext.storeId);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const existingCoupon = await getCouponById(db, storeId, req.params.id);
    if (!existingCoupon) {
      throw createHttpError(404, 'Coupon not found.', null, { expose: true });
    }

    const couponDraft = buildCouponDraft({
      payload: req.body,
      existingCoupon
    });
    validateCouponDraft(couponDraft);

    const duplicateCoupon = await getCouponByCode(db, storeId, couponDraft.code);
    if (duplicateCoupon && Number(duplicateCoupon.id) !== Number(existingCoupon.id)) {
      throw createHttpError(409, 'A coupon with that code already exists.', null, { expose: true });
    }

    await db.execute(
      `
        UPDATE coupons
        SET code = ?, description = ?, discount_type = ?, discount_value = ?, minimum_order_amount = ?,
            starts_at = ?, ends_at = ?, usage_limit = ?, is_active = ?
        WHERE id = ? AND store_id = ?
      `,
      [
        couponDraft.code,
        couponDraft.description,
        couponDraft.discount_type,
        couponDraft.discount_value,
        couponDraft.minimum_order_amount,
        couponDraft.starts_at,
        couponDraft.ends_at,
        couponDraft.usage_limit,
        couponDraft.is_active ? 1 : 0,
        req.params.id,
        storeId
      ]
    );

    const coupon = await getCouponById(db, storeId, req.params.id);
    const usageCount = await getCouponUsageCount(db, coupon.id);
    return res.json({
      coupon: serializeCoupon(coupon, {
        usage_count: usageCount
      })
    });
  }));

  app.post('/checkout', requireInternal, validate([
    allowBodyFields(['shipping_address', 'customer', 'currency', 'email', 'coupon_code']),
    body('shipping_address').optional().isObject(),
    body('customer').optional().isObject(),
    body('currency').optional().isLength({ min: 3, max: 3 }),
    body('email').optional().isEmail().customSanitizer((value) => sanitizeEmail(value)),
    body('coupon_code').optional().trim().isLength({ max: 80 })
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

    const subtotal = roundMoney(cart.total || 0);
    const couponCode = normalizeCouponCode(req.body.coupon_code || '');
    const couponPreview = couponCode
      ? await previewCouponForStore({
        db,
        storeId: Number(req.authContext.storeId),
        code: couponCode,
        subtotal
      })
      : null;
    if (couponCode && (!couponPreview || !couponPreview.valid)) {
      throw createHttpError(couponPreview?.status || 422, couponPreview?.reason || 'Coupon is not valid.', null, {
        expose: true
      });
    }
    const discountTotal = roundMoney(couponPreview?.discount_total || 0);
    const orderTotal = roundMoney(couponPreview?.total || subtotal);

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
            store_id, customer_id, status, payment_status, reservation_id, subtotal, discount_total, total,
            currency, coupon_code, coupon_snapshot, shipping_address, customer_snapshot
          ) VALUES (?, ?, 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          Number(req.authContext.storeId),
          Number(req.authContext.customerId),
          reservation.reservation_id,
          subtotal,
          discountTotal,
          orderTotal,
          req.body.currency || 'NGN',
          couponPreview?.coupon?.code || null,
          couponPreview?.coupon ? JSON.stringify(sanitizeCouponSnapshot(couponPreview.coupon)) : null,
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

      if (couponPreview?.coupon?.id) {
        await connection.execute(
          `
            INSERT INTO coupon_redemptions (
              coupon_id, order_id, store_id, customer_id, status, discount_total
            ) VALUES (?, ?, ?, ?, 'pending', ?)
          `,
          [
            couponPreview.coupon.id,
            orderResult.insertId,
            Number(req.authContext.storeId),
            Number(req.authContext.customerId),
            discountTotal
          ]
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
        amount: orderTotal,
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
    requirePlatformOperator(req);

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
