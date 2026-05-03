const { body, param, query } = require('express-validator');
const {
  requireInternalRequest,
  buildSignedInternalHeaders,
  requestJson,
  EVENT_NAMES,
  PAYMENT_PROVIDERS,
  PLATFORM_ROLES,
  createAuditLog,
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
const {
  hasPlanCapability,
  isCouponPauseOnlyUpdate
} = require('./coupon-plan-access');
const {
  isReviewEligibleOrder
} = require('./review-eligibility');

const MANUAL_ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'payment_failed', 'refund_pending', 'refunded'];
const DEFAULT_TAX_LABEL = 'Tax';

const normalizeCountry = (value = '') => {
  return sanitizePlainText(value, { maxLength: 120 }).trim().toLowerCase();
};

const normalizeMoneyAmount = (value = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return roundMoney(parsed);
};

const normalizePercentageRate = (value = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(100, roundMoney(parsed));
};

const sanitizeStoreCheckoutConfig = (store = {}) => {
  return {
    id: Number(store.id || 0) || null,
    shipping_origin_country: sanitizePlainText(store.shipping_origin_country || '', { maxLength: 120 }) || null,
    shipping_flat_rate: normalizeMoneyAmount(store.shipping_flat_rate || 0),
    domestic_shipping_rate: normalizeMoneyAmount(store.domestic_shipping_rate || 0),
    international_shipping_rate: normalizeMoneyAmount(store.international_shipping_rate || 0),
    free_shipping_threshold: normalizeMoneyAmount(store.free_shipping_threshold || 0),
    tax_rate: normalizePercentageRate(store.tax_rate || 0),
    tax_label: sanitizePlainText(store.tax_label || '', { maxLength: 80 }) || DEFAULT_TAX_LABEL,
    tax_apply_to_shipping: Boolean(store.tax_apply_to_shipping)
  };
};

const buildSystemHeaders = ({ config, requestId, storeId }) => {
  return buildSignedInternalHeaders({
    requestId,
    storeId,
    actorType: 'platform_user',
    actorRole: PLATFORM_ROLES.PLATFORM_OWNER,
    secret: config.internalSharedSecret
  });
};

const fetchStoreBillingAccess = async ({ config, req, storeId }) => {
  const headers = buildSystemHeaders({
    config,
    requestId: `${req.requestId || 'order'}:coupon-plan:${storeId}`,
    storeId
  });
  const storeResponse = await requestJson(
    `${config.serviceUrls.store}/stores/${encodeURIComponent(storeId)}`,
    {
      headers,
      timeoutMs: config.requestTimeoutMs
    }
  );
  const store = storeResponse?.store || null;
  if (!store?.owner_id) {
    throw createHttpError(404, 'Store not found for plan enforcement.', null, { expose: true });
  }

  const access = await requestJson(
    `${config.serviceUrls.billing}/internal/subscriptions/check?owner_id=${encodeURIComponent(store.owner_id)}`,
    {
      headers,
      timeoutMs: config.requestTimeoutMs
    }
  );

  if (!access?.allowed) {
    throw createHttpError(403, 'An active subscription or trial is required for coupon management.', null, { expose: true });
  }

  return {
    store,
    access
  };
};

const enforceCouponPlanAccess = async ({
  config,
  req,
  storeId,
  existingCoupon = null,
  couponDraft = null
}) => {
  const { access } = await fetchStoreBillingAccess({
    config,
    req,
    storeId
  });

  if (hasPlanCapability(access, 'automated_marketing')) {
    return access;
  }

  if (existingCoupon && couponDraft && isCouponPauseOnlyUpdate(existingCoupon, couponDraft)) {
    return access;
  }

  const message = existingCoupon
    ? 'The current plan keeps existing coupons read-only. Upgrade to Scale to create or edit marketing offers. Pause-only updates remain allowed after downgrade.'
    : 'Automated marketing and coupon creation are available on the Scale plan and above.';

  throw createHttpError(403, message, null, { expose: true });
};

const determineShippingCharge = ({ storeConfig, discountedSubtotal, shippingAddress }) => {
  const freeShippingThreshold = normalizeMoneyAmount(storeConfig.free_shipping_threshold);
  if (freeShippingThreshold > 0 && discountedSubtotal >= freeShippingThreshold) {
    return {
      amount: 0,
      mode: 'free_threshold'
    };
  }

  const flatRate = normalizeMoneyAmount(storeConfig.shipping_flat_rate);
  const domesticRate = normalizeMoneyAmount(storeConfig.domestic_shipping_rate);
  const internationalRate = normalizeMoneyAmount(storeConfig.international_shipping_rate);
  const originCountry = normalizeCountry(storeConfig.shipping_origin_country);
  const destinationCountry = normalizeCountry(shippingAddress?.country || '');

  if (flatRate > 0) {
    return {
      amount: flatRate,
      mode: 'flat'
    };
  }

  if (!domesticRate && !internationalRate) {
    return {
      amount: 0,
      mode: 'free'
    };
  }

  if (!destinationCountry) {
    if (domesticRate && internationalRate && domesticRate !== internationalRate) {
      return {
        amount: 0,
        mode: 'destination_required'
      };
    }

    return {
      amount: domesticRate || internationalRate,
      mode: 'estimated'
    };
  }

  if (originCountry && destinationCountry === originCountry) {
    return {
      amount: domesticRate || internationalRate || 0,
      mode: 'domestic'
    };
  }

  if (originCountry && destinationCountry !== originCountry) {
    return {
      amount: internationalRate || domesticRate || 0,
      mode: 'international'
    };
  }

  return {
    amount: domesticRate || internationalRate || 0,
    mode: 'estimated'
  };
};

const buildCheckoutQuote = ({
  storeConfig,
  subtotal,
  discountTotal,
  shippingAddress = {},
  currency = 'NGN'
}) => {
  const safeSubtotal = roundMoney(Number(subtotal || 0));
  const safeDiscountTotal = roundMoney(Math.min(safeSubtotal, Number(discountTotal || 0)));
  const discountedSubtotal = roundMoney(Math.max(0, safeSubtotal - safeDiscountTotal));
  const shipping = determineShippingCharge({
    storeConfig,
    discountedSubtotal,
    shippingAddress
  });
  const shippingTotal = roundMoney(shipping.amount || 0);
  const taxableAmount = roundMoney(
    discountedSubtotal + (storeConfig.tax_apply_to_shipping ? shippingTotal : 0)
  );
  const taxRate = normalizePercentageRate(storeConfig.tax_rate);
  const taxTotal = taxRate > 0
    ? roundMoney((taxableAmount * taxRate) / 100)
    : 0;
  const total = roundMoney(discountedSubtotal + shippingTotal + taxTotal);

  return {
    currency: String(currency || 'NGN').trim().toUpperCase() || 'NGN',
    subtotal: safeSubtotal,
    discount_total: safeDiscountTotal,
    discounted_subtotal: discountedSubtotal,
    shipping_total: shippingTotal,
    tax_total: taxTotal,
    total,
    tax_label: taxRate > 0 ? storeConfig.tax_label || DEFAULT_TAX_LABEL : null,
    requires_shipping_destination: shipping.mode === 'destination_required',
    pricing_snapshot: sanitizeJsonObject({
      shipping: {
        mode: shipping.mode,
        origin_country: storeConfig.shipping_origin_country || null,
        destination_country: shippingAddress?.country || null,
        flat_rate: storeConfig.shipping_flat_rate,
        domestic_rate: storeConfig.domestic_shipping_rate,
        international_rate: storeConfig.international_shipping_rate,
        free_shipping_threshold: storeConfig.free_shipping_threshold
      },
      tax: {
        label: taxRate > 0 ? (storeConfig.tax_label || DEFAULT_TAX_LABEL) : null,
        rate: taxRate,
        apply_to_shipping: storeConfig.tax_apply_to_shipping,
        taxable_amount: taxRate > 0 ? taxableAmount : 0
      }
    })
  };
};

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
    shipping_total: Number(order.shipping_total || 0),
    tax_total: Number(order.tax_total || 0),
    total: Number(order.total),
    tax_label: order.tax_label || null,
    coupon_code: order.coupon_code || null,
    coupon: order.coupon_snapshot ? JSON.parse(order.coupon_snapshot) : null,
    shipping_address: order.shipping_address ? JSON.parse(order.shipping_address) : null,
    customer_snapshot: order.customer_snapshot ? JSON.parse(order.customer_snapshot) : null,
    pricing_snapshot: order.pricing_snapshot ? JSON.parse(order.pricing_snapshot) : null,
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

const fetchStoreCheckoutConfig = async ({ config, req, storeId }) => {
  const response = await requestJson(
    `${config.serviceUrls.store}/stores/${encodeURIComponent(storeId)}`,
    {
      headers: buildSystemHeaders({
        config,
        requestId: `${req.requestId || 'checkout'}:store:${storeId}`,
        storeId
      }),
      timeoutMs: config.requestTimeoutMs
    }
  );

  return sanitizeStoreCheckoutConfig(response?.store || {});
};

const requirePlatformOperator = (req) => {
  if (req.authContext.actorType !== 'platform_user') {
    throw createHttpError(403, 'Only store operators can perform this action.', null, { expose: true });
  }
};

const releaseReservation = async ({
  reservationId,
  headers,
  config,
  logger,
  storeId = null,
  orderId = null,
  reason = 'checkout_cleanup'
}) => {
  if (!reservationId) {
    return;
  }

  try {
    await requestJson(`${config.serviceUrls.product}/inventory/reservations/${reservationId}/release`, {
      method: 'POST',
      headers,
      timeoutMs: config.requestTimeoutMs
    });
  } catch (error) {
    logger?.warn('inventory_reservation_release_failed', {
      reservationId,
      storeId,
      orderId,
      reason,
      error: error.message
    });
  }
};

const markCheckoutAsPaymentFailed = async ({ db, orderId, storeId }) => {
  if (!orderId) {
    return;
  }

  await db.execute(
    'UPDATE orders SET payment_status = ?, status = ? WHERE id = ? AND store_id = ?',
    ['failed', 'payment_failed', orderId, storeId]
  );
  await db.execute(
    'UPDATE coupon_redemptions SET status = ? WHERE order_id = ?',
    ['voided', orderId]
  );
};

const applyPaymentOutcomeToOrder = async ({ db, bus, config, order, payment }) => {
  if (!order || !payment) {
    return order;
  }

  const paymentStatus = String(payment.status || '').trim().toLowerCase();
  const systemHeaders = buildSignedInternalHeaders({
    requestId: `payment-sync-${order.id}`,
    storeId: order.store_id,
    actorType: 'platform_user',
    actorRole: PLATFORM_ROLES.PLATFORM_OWNER,
    secret: config.internalSharedSecret
  });

  if (paymentStatus === 'success') {
    const needsStateUpdate = String(order.payment_status || '').toLowerCase() !== 'paid'
      || String(order.status || '').toLowerCase() !== 'confirmed';

    if (needsStateUpdate) {
      await db.execute(
        'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
        ['paid', 'confirmed', order.id]
      );
      await db.execute(
        'UPDATE coupon_redemptions SET status = ? WHERE order_id = ?',
        ['confirmed', order.id]
      );
      if (order.reservation_id) {
        await requestJson(`${config.serviceUrls.product}/inventory/reservations/${order.reservation_id}/commit`, {
          method: 'POST',
          headers: systemHeaders,
          timeoutMs: config.requestTimeoutMs
        });
      }
      await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
        order_id: order.id,
        store_id: order.store_id,
        status: 'confirmed'
      });
    }
  } else if (paymentStatus === 'failed') {
    const needsStateUpdate = String(order.payment_status || '').toLowerCase() !== 'failed'
      || String(order.status || '').toLowerCase() !== 'payment_failed';

    if (needsStateUpdate) {
      await db.execute(
        'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
        ['failed', 'payment_failed', order.id]
      );
      await db.execute(
        'UPDATE coupon_redemptions SET status = ? WHERE order_id = ?',
        ['voided', order.id]
      );
      if (order.reservation_id) {
        await requestJson(`${config.serviceUrls.product}/inventory/reservations/${order.reservation_id}/release`, {
          method: 'POST',
          headers: systemHeaders,
          timeoutMs: config.requestTimeoutMs
        });
      }
      await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
        order_id: order.id,
        store_id: order.store_id,
        status: 'payment_failed'
      });
    }
  } else if (paymentStatus === 'refunded') {
    const needsStateUpdate = String(order.payment_status || '').toLowerCase() !== 'refunded'
      || String(order.status || '').toLowerCase() !== 'refunded';

    if (needsStateUpdate) {
      await db.execute(
        'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
        ['refunded', 'refunded', order.id]
      );
      await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
        order_id: order.id,
        store_id: order.store_id,
        status: 'refunded'
      });
    }
  }

  return hydrateOrder(db, order.id, order.store_id);
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

const buildCheckoutPricingContext = async ({
  db,
  config,
  req,
  subtotal,
  couponCode,
  shippingAddress,
  currency
}) => {
  const normalizedSubtotal = roundMoney(Number(subtotal || 0));
  const normalizedCouponCode = normalizeCouponCode(couponCode || '');
  const couponPreview = normalizedCouponCode
    ? await previewCouponForStore({
      db,
      storeId: Number(req.authContext.storeId),
      code: normalizedCouponCode,
      subtotal: normalizedSubtotal
    })
    : null;

  if (normalizedCouponCode && (!couponPreview || !couponPreview.valid)) {
    throw createHttpError(couponPreview?.status || 422, couponPreview?.reason || 'Coupon is not valid.', null, {
      expose: true
    });
  }

  const storeConfig = await fetchStoreCheckoutConfig({
    config,
    req,
    storeId: Number(req.authContext.storeId)
  });
  const discountTotal = roundMoney(couponPreview?.discount_total || 0);
  const quote = buildCheckoutQuote({
    storeConfig,
    subtotal: normalizedSubtotal,
    discountTotal,
    shippingAddress,
    currency
  });

  return {
    couponPreview,
    discountTotal,
    quote
  };
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
    await enforceCouponPlanAccess({
      config,
      req,
      storeId
    });

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
    await enforceCouponPlanAccess({
      config,
      req,
      storeId,
      existingCoupon,
      couponDraft
    });

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

  app.post('/checkout/quote', requireInternal, validate([
    allowBodyFields(['shipping_address', 'currency', 'coupon_code']),
    body('shipping_address').optional().isObject(),
    body('currency').optional().isLength({ min: 3, max: 3 }).customSanitizer((value) => String(value).trim().toUpperCase()),
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

    const shippingAddress = sanitizeJsonObject(req.body.shipping_address || {});
    const pricingContext = await buildCheckoutPricingContext({
      db,
      config,
      req,
      subtotal: roundMoney(cart.total || 0),
      couponCode: req.body.coupon_code || '',
      shippingAddress,
      currency: req.body.currency || 'NGN'
    });

    return res.json({
      coupon: pricingContext.couponPreview?.coupon
        ? sanitizeCouponSnapshot(pricingContext.couponPreview.coupon)
        : null,
      quote: pricingContext.quote
    });
  }));

  app.post('/checkout', requireInternal, validate([
    allowBodyFields(['shipping_address', 'customer', 'currency', 'email', 'coupon_code', 'provider', 'callback_url']),
    body('shipping_address').optional().isObject(),
    body('customer').optional().isObject(),
    body('currency').optional().isLength({ min: 3, max: 3 }).customSanitizer((value) => String(value).trim().toUpperCase()),
    body('email').optional().isEmail().customSanitizer((value) => sanitizeEmail(value)),
    body('coupon_code').optional().trim().isLength({ max: 80 }),
    body('provider').optional().isIn(PAYMENT_PROVIDERS),
    body('callback_url').optional().isURL({ require_protocol: true }).withMessage('callback_url must be a valid absolute URL.')
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
    const shippingAddress = sanitizeJsonObject(req.body.shipping_address || {});
    const customerSnapshot = sanitizeJsonObject(req.body.customer || {});
    const pricingContext = await buildCheckoutPricingContext({
      db,
      config,
      req,
      subtotal,
      couponCode: req.body.coupon_code || '',
      shippingAddress,
      currency: req.body.currency || 'NGN'
    });
    const couponPreview = pricingContext.couponPreview;
    const quote = pricingContext.quote;
    const discountTotal = quote.discount_total;
    const shippingTotal = quote.shipping_total;
    const taxTotal = quote.tax_total;
    const orderTotal = quote.total;

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
    const reservationId = reservation.reservation_id;

    let orderId = null;
    try {
      orderId = await db.withTransaction(async (connection) => {
        const [orderResult] = await connection.execute(
          `
            INSERT INTO orders (
              store_id, customer_id, status, payment_status, reservation_id, subtotal, discount_total, shipping_total,
              tax_total, total, currency, tax_label, coupon_code, coupon_snapshot, shipping_address, customer_snapshot,
              pricing_snapshot
            ) VALUES (?, ?, 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Number(req.authContext.storeId),
            Number(req.authContext.customerId),
            reservationId,
            subtotal,
            discountTotal,
            shippingTotal,
            taxTotal,
            orderTotal,
            quote.currency,
            quote.tax_label,
            couponPreview?.coupon?.code || null,
            couponPreview?.coupon ? JSON.stringify(sanitizeCouponSnapshot(couponPreview.coupon)) : null,
            JSON.stringify(shippingAddress),
            JSON.stringify(customerSnapshot),
            JSON.stringify(quote.pricing_snapshot || {})
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
    } catch (error) {
      await createAuditLog(db, {
        actorType: req.authContext.actorType || 'customer',
        actorId: req.authContext.customerId || req.authContext.userId || null,
        action: 'order.checkout_failed',
        resourceType: 'order',
        resourceId: orderId,
        storeId: Number(req.authContext.storeId || 0) || null,
        details: {
          stage: 'order_persist',
          error: error.message,
          item_count: cart.items.length
        },
        req,
        status: 'failure'
      });
      await releaseReservation({
        reservationId,
        headers,
        config,
        logger: req.log,
        storeId: Number(req.authContext.storeId),
        reason: 'order_persist_failure'
      });
      throw error;
    }

    let paymentSession = null;
    try {
      paymentSession = await requestJson(`${config.serviceUrls.payment}/payments/create-checkout-session`, {
        method: 'POST',
        headers,
        body: {
          order_id: orderId,
          store_id: Number(req.authContext.storeId),
          customer_id: Number(req.authContext.customerId),
          amount: orderTotal,
          currency: quote.currency,
          email: req.body.email || customerSnapshot.email || null,
          provider: req.body.provider || 'paystack',
          callback_url: req.body.callback_url || null,
          customer_name: customerSnapshot.name || null,
          customer_phone: customerSnapshot.phone || null
        },
        timeoutMs: config.requestTimeoutMs
      });

      if (!paymentSession?.payment?.reference) {
        throw createHttpError(502, 'Payment session did not return a payment reference.', null, {
          expose: true
        });
      }
    } catch (error) {
      await markCheckoutAsPaymentFailed({
        db,
        orderId,
        storeId: Number(req.authContext.storeId)
      });
      await releaseReservation({
        reservationId,
        headers,
        config,
        logger: req.log,
        storeId: Number(req.authContext.storeId),
        orderId,
        reason: 'payment_session_failure'
      });
      await createAuditLog(db, {
        actorType: req.authContext.actorType || 'customer',
        actorId: req.authContext.customerId || req.authContext.userId || null,
        action: 'order.checkout_failed',
        resourceType: 'order',
        resourceId: orderId,
        storeId: Number(req.authContext.storeId || 0) || null,
        details: {
          stage: 'payment_session',
          provider: req.body.provider || 'paystack',
          error: error.message
        },
        req,
        status: 'failure'
      });

      if (!Number(error.status) || Number(error.status) >= 500) {
        throw createHttpError(502, 'Unable to start the payment session right now.', null, {
          expose: true
        });
      }

      throw error;
    }

    await db.execute(
      'UPDATE orders SET payment_reference = ? WHERE id = ? AND store_id = ?',
      [paymentSession.payment.reference, orderId, req.authContext.storeId]
    );

    try {
      await requestJson(`${config.serviceUrls.cart}/cart/clear`, {
        method: 'POST',
        headers,
        body: {},
        timeoutMs: config.requestTimeoutMs
      });
    } catch (error) {
      req.log?.warn('checkout_cart_clear_failed', {
        orderId,
        storeId: Number(req.authContext.storeId),
        error: error.message
      });
    }

    const order = await hydrateOrder(db, orderId, req.authContext.storeId);
    await bus.publish(EVENT_NAMES.ORDER_CREATED, {
      order_id: order.id,
      store_id: order.store_id,
      customer_id: order.customer_id,
      subtotal: order.subtotal,
      discount_total: order.discount_total,
      shipping_total: order.shipping_total,
      tax_total: order.tax_total,
      total: order.total,
      currency: order.currency
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'customer',
      actorId: req.authContext.customerId || req.authContext.userId || null,
      action: 'order.created',
      resourceType: 'order',
      resourceId: order.id,
      storeId: order.store_id,
      details: {
        status: order.status,
        payment_status: order.payment_status,
        subtotal: Number(order.subtotal),
        discount_total: Number(order.discount_total),
        shipping_total: Number(order.shipping_total || 0),
        tax_total: Number(order.tax_total || 0),
        total: Number(order.total),
        currency: order.currency,
        item_count: Array.isArray(order.items) ? order.items.length : 0,
        provider: req.body.provider || 'paystack',
        payment_reference: paymentSession.payment.reference
      },
      req
    });

    return res.status(201).json({
      order,
      payment: paymentSession.payment,
      providers: paymentSession.providers
    });
  }));

  app.post('/checkout/verify', requireInternal, validate([
    allowBodyFields(['reference']),
    body('reference').isString().notEmpty().isLength({ max: 191 })
  ]), asyncHandler(async (req, res) => {
    if (!req.authContext.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    if (!req.authContext.customerId) {
      throw createHttpError(401, 'Customer authentication is required for payment verification.', null, { expose: true });
    }

    const paymentVerification = await requestJson(
      `${config.serviceUrls.payment}/payments/verify/${encodeURIComponent(req.body.reference)}`,
      {
        method: 'GET',
        headers: buildServiceHeaders(req, config),
        timeoutMs: config.requestTimeoutMs
      }
    );
    const payment = paymentVerification?.payment || null;
    if (!payment || String(payment.store_id || '') !== String(req.authContext.storeId || '')) {
      throw createHttpError(404, 'Payment not found for this store.', null, { expose: true });
    }

    const order = await hydrateOrder(db, payment.order_id, req.authContext.storeId);
    if (!order) {
      throw createHttpError(404, 'Order not found for this payment.', null, { expose: true });
    }

    if (String(order.customer_id || '') !== String(req.authContext.customerId || '')) {
      throw createHttpError(403, 'You do not have access to this order.', null, { expose: true });
    }

    const syncedOrder = await applyPaymentOutcomeToOrder({
      db,
      bus,
      config,
      order,
      payment
    });

    return res.json({
      order: syncedOrder,
      payment
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

  app.get('/orders/review-eligibility', requireInternal, validate([
    allowBodyFields([]),
    query('product_id').isInt({ min: 1 }).toInt()
  ]), asyncHandler(async (req, res) => {
    const productId = Number(req.query.product_id || 0);
    if (!req.authContext.storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    if (!req.authContext.customerId) {
      throw createHttpError(401, 'Customer authentication is required for review checks.', null, { expose: true });
    }

    if (!productId) {
      throw createHttpError(400, 'product_id is required.', null, { expose: true });
    }

    const rows = await db.query(
      `
        SELECT
          oi.id AS order_item_id,
          oi.order_id,
          oi.product_id,
          o.customer_id,
          o.payment_status,
          o.status,
          o.created_at
        FROM order_items AS oi
        INNER JOIN orders AS o
          ON o.id = oi.order_id
        WHERE o.store_id = ?
          AND o.customer_id = ?
          AND oi.product_id = ?
        ORDER BY o.created_at DESC, oi.id DESC
      `,
      [
        Number(req.authContext.storeId),
        Number(req.authContext.customerId),
        productId
      ]
    );
    const eligibleItem = rows.find((row) => isReviewEligibleOrder(row)) || null;

    return res.json({
      can_review: Boolean(eligibleItem),
      verified_purchase: Boolean(eligibleItem),
      order_item_id: eligibleItem?.order_item_id || null,
      latest_order_id: eligibleItem?.order_id || null
    });
  }));

  app.patch('/orders/:id/status', requireInternal, validate([
    allowBodyFields(['status']),
    commonRules.paramId('id'),
    body('status').trim().isIn(MANUAL_ORDER_STATUSES).withMessage('Choose a valid order status.')
  ]), asyncHandler(async (req, res) => {
    requirePlatformOperator(req);
    const existingOrder = await hydrateOrder(db, req.params.id, req.authContext.storeId);
    if (!existingOrder) {
      throw createHttpError(404, 'Order not found.', null, { expose: true });
    }

    await db.execute(
      'UPDATE orders SET status = ? WHERE id = ? AND store_id = ?',
      [req.body.status || 'pending', req.params.id, req.authContext.storeId]
    );
    const order = await hydrateOrder(db, req.params.id, req.authContext.storeId);
    await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
      order_id: order.id,
      store_id: order.store_id,
      status: order.status
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'order.status_updated',
      resourceType: 'order',
      resourceId: order.id,
      storeId: order.store_id,
      details: {
        previous_status: existingOrder.status,
        next_status: order.status,
        payment_status: order.payment_status
      },
      req
    });

    return res.json({ order });
  }));
};

module.exports = {
  registerRoutes,
  hydrateOrder,
  applyPaymentOutcomeToOrder
};
