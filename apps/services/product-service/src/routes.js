const { body, param, query } = require('express-validator');
const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  EVENT_NAMES,
  parsePagination,
  createAuditLog,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  commonRules,
  storeIdRule,
  paginationRules,
  sanitizeSlug,
  sanitizePlainText
} = require('../../../../packages/shared');
const {
  DISCOUNT_TYPES,
  PROMOTION_TYPES,
  roundMoney,
  normalizeDiscountType,
  normalizePromotionType,
  toDatabaseDateTime,
  resolveProductPricing
} = require('./pricing');

const PRODUCT_CACHE_TTL_SECONDS = 5 * 60;

const slugify = (value = '') => {
  return sanitizeSlug(value);
};

const sanitizeProduct = (product) => {
  if (!product) {
    return null;
  }

  const pricing = resolveProductPricing(product);

  return {
    id: product.id,
    store_id: product.store_id,
    title: product.title,
    slug: product.slug,
    category: product.category,
    description: product.description,
    price: pricing.price,
    base_price: pricing.basePrice,
    compare_at_price: pricing.compareAtPrice,
    has_discount: pricing.hasDiscount,
    discount_amount: pricing.discountAmount,
    discount_percentage: pricing.discountPercentage,
    discount_type: pricing.discountType,
    discount_value: pricing.discountType === 'none' ? null : roundMoney(pricing.discountValue),
    promotion_type: pricing.promotionType,
    is_flash_sale: pricing.isFlashSale,
    discount_label: pricing.discountLabel || null,
    discount_starts_at: pricing.discountStartsAt,
    discount_ends_at: pricing.discountEndsAt,
    sku: product.sku,
    inventory_count: Number(product.inventory_count),
    reserved_count: Number(product.reserved_count),
    available_inventory: Number(product.inventory_count) - Number(product.reserved_count),
    images: product.images ? JSON.parse(product.images) : [],
    status: product.status,
    deleted_at: product.deleted_at,
    created_at: product.created_at,
    updated_at: product.updated_at
  };
};

const buildStoredPricingInput = ({ payload = {}, existingProduct = null }) => {
  const existingBasePrice = existingProduct?.base_price === null || existingProduct?.base_price === undefined
    ? Number(existingProduct?.price || 0)
    : Number(existingProduct.base_price);
  const basePrice = roundMoney(
    payload.base_price === undefined && payload.price === undefined
      ? existingBasePrice
      : (payload.base_price === undefined ? payload.price : payload.base_price)
  );
  const discountType = normalizeDiscountType(
    payload.discount_type === undefined
      ? existingProduct?.discount_type
      : payload.discount_type
  );
  const promotionType = discountType === 'none'
    ? 'none'
    : normalizePromotionType(
      payload.promotion_type === undefined
        ? existingProduct?.promotion_type
        : payload.promotion_type
    );
  const rawDiscountValue = payload.discount_value === undefined
    ? existingProduct?.discount_value
    : payload.discount_value;
  const discountValue = discountType === 'none' || rawDiscountValue === null || rawDiscountValue === undefined || rawDiscountValue === ''
    ? null
    : roundMoney(rawDiscountValue);
  const manualCompareAtPrice = payload.compare_at_price === undefined
    ? existingProduct?.compare_at_price ?? null
    : (payload.compare_at_price === null || payload.compare_at_price === ''
      ? null
      : roundMoney(payload.compare_at_price));

  return {
    price: basePrice,
    base_price: basePrice,
    compare_at_price: manualCompareAtPrice,
    discount_type: discountType,
    promotion_type: promotionType,
    discount_value: discountValue,
    discount_label: discountType === 'none'
      ? null
      : (payload.discount_label === undefined
        ? (existingProduct?.discount_label || null)
        : (String(payload.discount_label || '').trim() || null)),
    discount_starts_at: discountType === 'none'
      ? null
      : (payload.discount_starts_at === undefined
        ? (existingProduct?.discount_starts_at || null)
        : toDatabaseDateTime(payload.discount_starts_at)),
    discount_ends_at: discountType === 'none'
      ? null
      : (payload.discount_ends_at === undefined
        ? (existingProduct?.discount_ends_at || null)
        : toDatabaseDateTime(payload.discount_ends_at))
  };
};

const validateStoredPricingInput = (pricingInput) => {
  if (!Number.isFinite(pricingInput.base_price) || pricingInput.base_price < 0) {
    throw createHttpError(422, 'Base price must be zero or greater.', {
      fields: [{
        field: 'price',
        message: 'Base price must be zero or greater.'
      }]
    }, { expose: true });
  }

  if (!DISCOUNT_TYPES.includes(pricingInput.discount_type)) {
    throw createHttpError(422, 'Choose a valid discount type.', {
      fields: [{
        field: 'discount_type',
        message: 'Choose a valid discount type.'
      }]
    }, { expose: true });
  }

  if (!PROMOTION_TYPES.includes(pricingInput.promotion_type)) {
    throw createHttpError(422, 'Choose a valid promotion type.', {
      fields: [{
        field: 'promotion_type',
        message: 'Choose a valid promotion type.'
      }]
    }, { expose: true });
  }

  if (pricingInput.discount_type === 'percentage') {
    if (!Number.isFinite(pricingInput.discount_value) || pricingInput.discount_value <= 0 || pricingInput.discount_value > 95) {
      throw createHttpError(422, 'Percentage discounts must be greater than zero and no more than 95%.', {
        fields: [{
          field: 'discount_value',
          message: 'Percentage discounts must be greater than zero and no more than 95%.'
        }]
      }, { expose: true });
    }
  }

  if (pricingInput.discount_type === 'amount') {
    if (!Number.isFinite(pricingInput.discount_value) || pricingInput.discount_value <= 0) {
      throw createHttpError(422, 'Fixed discounts must be greater than zero.', {
        fields: [{
          field: 'discount_value',
          message: 'Fixed discounts must be greater than zero.'
        }]
      }, { expose: true });
    }

    if (pricingInput.discount_value >= pricingInput.base_price && pricingInput.base_price > 0) {
      throw createHttpError(422, 'Fixed discounts must be less than the product price.', {
        fields: [{
          field: 'discount_value',
          message: 'Fixed discounts must be less than the product price.'
        }]
      }, { expose: true });
    }
  }

  const discountStartsAt = pricingInput.discount_starts_at
    ? new Date(pricingInput.discount_starts_at)
    : null;
  const discountEndsAt = pricingInput.discount_ends_at
    ? new Date(pricingInput.discount_ends_at)
    : null;
  if (discountStartsAt && discountEndsAt && discountEndsAt.getTime() <= discountStartsAt.getTime()) {
    throw createHttpError(422, 'Discount end time must be later than the start time.', {
      fields: [{
        field: 'discount_ends_at',
        message: 'Discount end time must be later than the start time.'
      }]
    }, { expose: true });
  }
};

const requirePlatformOperator = (req, res, next) => {
  if (req.authContext.actorType !== 'platform_user') {
    return next(createHttpError(403, 'Platform operator authentication required.', null, { expose: true }));
  }

  return next();
};

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const buildProductCacheKey = (storeId, suffix) => `product:${storeId}:${suffix}`;

const invalidateProductCache = async (cache, storeId) => {
  // Security: Sanitize storeId to prevent path traversal in cache keys
  const sanitizedStoreId = String(storeId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitizedStoreId) {
    return;
  }
  await cache.delByPattern(`product:${sanitizedStoreId}:*`);
};

const normalizeProductQuery = (req) => {
  const { page, limit, offset } = parsePagination(req.query);
  const search = sanitizePlainText(req.query.search || '', { maxLength: 120 });
  const status = String(req.query.status || '').trim().toLowerCase();
  const category = sanitizePlainText(req.query.category || '', { maxLength: 120 });
  const minPrice = req.query.min_price === undefined ? null : Number(req.query.min_price);
  const maxPrice = req.query.max_price === undefined ? null : Number(req.query.max_price);

  return {
    page,
    limit,
    offset,
    search,
    status,
    category,
    minPrice: Number.isFinite(minPrice) ? minPrice : null,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : null
  };
};

const buildProductFilters = ({ storeId, search, status, category, minPrice, maxPrice, includeDrafts }) => {
  const conditions = ['store_id = ?', 'deleted_at IS NULL'];
  const values = [storeId];

  if (!includeDrafts) {
    conditions.push('status = ?');
    values.push('published');
  } else if (status) {
    conditions.push('status = ?');
    values.push(status);
  }

  if (search) {
    conditions.push('(title LIKE ? OR sku LIKE ?)');
    values.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    conditions.push('category = ?');
    values.push(category);
  }

  if (minPrice !== null) {
    conditions.push('price >= ?');
    values.push(minPrice);
  }

  if (maxPrice !== null) {
    conditions.push('price <= ?');
    values.push(maxPrice);
  }

  return {
    conditions,
    values
  };
};

const registerRoutes = async ({ app, db, bus, config, cache }) => {
  const requireInternal = buildRequireInternal(config);

  app.get('/products', validate([
    ...storeIdRule(),
    ...paginationRules(),
    commonRules.querySearch(),
    query('status').optional().isIn(['draft', 'published', 'archived', 'deleted']),
    query('category').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    query('min_price').optional().isFloat({ min: 0 }).toFloat(),
    query('max_price').optional().isFloat({ min: 0 }).toFloat()
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.headers['x-store-id'] || req.query.store_id);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const filters = normalizeProductQuery(req);
    const includeDrafts = Boolean(filters.status || req.headers['x-actor-type'] === 'platform_user');
    const usePublicCache = !includeDrafts;
    const cacheKey = buildProductCacheKey(
      storeId,
      `list:${filters.page}:${filters.limit}:${filters.search}:${filters.category}:${filters.minPrice ?? ''}:${filters.maxPrice ?? ''}`
    );

    const loader = async () => {
      const { conditions, values } = buildProductFilters({
        storeId,
        ...filters,
        includeDrafts
      });

      const countRows = await db.query(
        `SELECT COUNT(*) AS total FROM products WHERE ${conditions.join(' AND ')}`,
        values
      );
      const rows = await db.query(
        `
          SELECT * FROM products
          WHERE ${conditions.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?
        `,
        [...values, filters.limit, filters.offset]
      );

      return {
        page: filters.page,
        limit: filters.limit,
        total: Number(countRows[0]?.total || 0),
        products: rows.map(sanitizeProduct)
      };
    };

    if (usePublicCache) {
      const cached = await cache.getOrSetJson(cacheKey, PRODUCT_CACHE_TTL_SECONDS, loader);
      res.setHeader('x-cache', cached.cacheHit ? 'hit' : 'miss');
      return res.json(cached.value);
    }

    return res.json(await loader());
  }));

  app.get('/products/id/:id', validate([
    commonRules.paramId('id'),
    ...storeIdRule()
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.headers['x-store-id'] || req.query.store_id);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const usePublicCache = req.headers['x-actor-type'] !== 'platform_user';
    const cacheKey = buildProductCacheKey(storeId, `id:${req.params.id}`);

    const loader = async () => {
      const rows = await db.query(
        'SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL',
        [req.params.id, storeId]
      );
      const product = rows[0];
      if (!product) {
        throw createHttpError(404, 'Product not found.', null, { expose: true });
      }

      return {
        product: sanitizeProduct(product)
      };
    };

    if (usePublicCache) {
      const cached = await cache.getOrSetJson(cacheKey, PRODUCT_CACHE_TTL_SECONDS, loader);
      res.setHeader('x-cache', cached.cacheHit ? 'hit' : 'miss');
      return res.json(cached.value);
    }

    return res.json(await loader());
  }));

  app.get('/products/:slug', validate([
    param('slug').trim().notEmpty().customSanitizer((value) => sanitizeSlug(value)),
    ...storeIdRule()
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.headers['x-store-id'] || req.query.store_id);
    if (!storeId) {
      throw createHttpError(400, 'Store context is required.', null, { expose: true });
    }

    const includeDrafts = req.headers['x-actor-type'] === 'platform_user';
    const cacheKey = buildProductCacheKey(storeId, `slug:${req.params.slug}`);

    const loader = async () => {
      const rows = await db.query(
        'SELECT * FROM products WHERE slug = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1',
        [req.params.slug, storeId]
      );
      const product = rows[0];
      if (!product) {
        throw createHttpError(404, 'Product not found.', null, { expose: true });
      }

      if (product.status !== 'published' && !includeDrafts) {
        throw createHttpError(404, 'Product not found.', null, { expose: true });
      }

      return { product: sanitizeProduct(product) };
    };

    if (!includeDrafts) {
      const cached = await cache.getOrSetJson(cacheKey, PRODUCT_CACHE_TTL_SECONDS, loader);
      res.setHeader('x-cache', cached.cacheHit ? 'hit' : 'miss');
      return res.json(cached.value);
    }

    return res.json(await loader());
  }));

  app.post('/products', requireInternal, requirePlatformOperator, validate([
    allowBodyFields([
      'store_id',
      'title',
      'slug',
      'category',
      'description',
      'price',
      'base_price',
      'compare_at_price',
      'discount_type',
      'discount_value',
      'promotion_type',
      'discount_label',
      'discount_starts_at',
      'discount_ends_at',
      'sku',
      'inventory_count',
      'images',
      'status'
    ]),
    commonRules.name('title', 180),
    commonRules.slug('slug'),
    commonRules.optionalPlainText('category', 120),
    commonRules.richText('description', 5000),
    commonRules.amount('price'),
    commonRules.optionalAmount('base_price'),
    commonRules.optionalAmount('compare_at_price'),
    body('discount_type').optional().isIn(DISCOUNT_TYPES),
    body('discount_value').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('promotion_type').optional().isIn(PROMOTION_TYPES),
    commonRules.optionalPlainText('discount_label', 120),
    body('discount_starts_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('discount_ends_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    commonRules.optionalPlainText('sku', 120),
    commonRules.optionalInt('inventory_count', { min: 0, max: 1000000 }),
    commonRules.urlArray('images', 12),
    body('status').optional().isIn(['draft', 'published', 'archived'])
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId || req.body.store_id);
    const title = String(req.body.title || '').trim();
    const slug = slugify(req.body.slug || title);
    if (!storeId || !title || !slug) {
      throw createHttpError(400, 'store_id, title, and slug are required.', null, { expose: true });
    }

    const pricingInput = buildStoredPricingInput({
      payload: req.body
    });
    validateStoredPricingInput(pricingInput);

    const result = await db.execute(
      `
        INSERT INTO products (
          store_id, title, slug, category, description, price, base_price, compare_at_price, promotion_type,
          discount_type, discount_value, discount_label, discount_starts_at, discount_ends_at, sku,
          inventory_count, reserved_count, images, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `,
      [
        storeId,
        title,
        slug,
        req.body.category || null,
        req.body.description || null,
        pricingInput.price,
        pricingInput.base_price,
        pricingInput.compare_at_price,
        pricingInput.promotion_type,
        pricingInput.discount_type,
        pricingInput.discount_value,
        pricingInput.discount_label,
        pricingInput.discount_starts_at,
        pricingInput.discount_ends_at,
        req.body.sku || null,
        Number(req.body.inventory_count || 0),
        JSON.stringify(req.body.images || []),
        String(req.body.status || 'draft').trim().toLowerCase()
      ]
    );
    const product = (await db.query('SELECT * FROM products WHERE id = ? AND store_id = ?', [result.insertId, storeId]))[0];
    await invalidateProductCache(cache, storeId);
    await bus.publish(EVENT_NAMES.PRODUCT_CREATED, {
      product_id: product.id,
      store_id: product.store_id,
      title: product.title
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'product.created',
      resourceType: 'product',
      resourceId: product.id,
      storeId: product.store_id,
      details: {
        title: product.title,
        slug: product.slug,
        status: product.status,
        price: Number(product.price),
        inventory_count: Number(product.inventory_count)
      },
      req
    });

    return res.status(201).json({ product: sanitizeProduct(product) });
  }));

  app.put('/products/:id', requireInternal, requirePlatformOperator, validate([
    allowBodyFields([
      'store_id',
      'title',
      'slug',
      'category',
      'description',
      'price',
      'base_price',
      'compare_at_price',
      'discount_type',
      'discount_value',
      'promotion_type',
      'discount_label',
      'discount_starts_at',
      'discount_ends_at',
      'sku',
      'inventory_count',
      'images',
      'status'
    ]),
    commonRules.paramId('id'),
    commonRules.optionalName('title', 180),
    commonRules.slug('slug'),
    commonRules.optionalPlainText('category', 120),
    commonRules.richText('description', 5000),
    commonRules.optionalAmount('price'),
    commonRules.optionalAmount('base_price'),
    commonRules.optionalAmount('compare_at_price'),
    body('discount_type').optional().isIn(DISCOUNT_TYPES),
    body('discount_value').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('promotion_type').optional().isIn(PROMOTION_TYPES),
    commonRules.optionalPlainText('discount_label', 120),
    body('discount_starts_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('discount_ends_at').optional({ values: 'falsy' }).isISO8601().toDate(),
    commonRules.optionalPlainText('sku', 120),
    commonRules.optionalInt('inventory_count', { min: 0, max: 1000000 }),
    commonRules.urlArray('images', 12),
    body('status').optional().isIn(['draft', 'published', 'archived'])
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId || req.body.store_id);
    const existing = (await db.query(
      'SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL',
      [req.params.id, storeId]
    ))[0];
    if (!existing) {
      throw createHttpError(404, 'Product not found.', null, { expose: true });
    }

    const slug = slugify(req.body.slug || req.body.title || existing.slug);
    const updatedFields = Object.keys(req.body || {})
      .filter((field) => field !== 'store_id')
      .sort();
    const pricingInput = buildStoredPricingInput({
      payload: req.body,
      existingProduct: existing
    });
    validateStoredPricingInput(pricingInput);
    await db.execute(
      `
        UPDATE products
        SET title = ?, slug = ?, category = ?, description = ?, price = ?, base_price = ?, compare_at_price = ?,
            promotion_type = ?, discount_type = ?, discount_value = ?, discount_label = ?, discount_starts_at = ?,
            discount_ends_at = ?, sku = ?, inventory_count = ?, images = ?, status = ?
        WHERE id = ? AND store_id = ?
      `,
      [
        req.body.title || existing.title,
        slug,
        req.body.category === undefined ? existing.category : req.body.category,
        req.body.description === undefined ? existing.description : req.body.description,
        pricingInput.price,
        pricingInput.base_price,
        pricingInput.compare_at_price,
        pricingInput.promotion_type,
        pricingInput.discount_type,
        pricingInput.discount_value,
        pricingInput.discount_label,
        pricingInput.discount_starts_at,
        pricingInput.discount_ends_at,
        req.body.sku === undefined ? existing.sku : req.body.sku,
        req.body.inventory_count === undefined ? existing.inventory_count : Number(req.body.inventory_count),
        JSON.stringify(req.body.images || (existing.images ? JSON.parse(existing.images) : [])),
        req.body.status || existing.status,
        req.params.id,
        storeId
      ]
    );
    const product = (await db.query(
      'SELECT * FROM products WHERE id = ? AND store_id = ?',
      [req.params.id, storeId]
    ))[0];
    await invalidateProductCache(cache, storeId);
    await bus.publish(EVENT_NAMES.PRODUCT_UPDATED, {
      product_id: product.id,
      store_id: product.store_id
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'product.updated',
      resourceType: 'product',
      resourceId: product.id,
      storeId: product.store_id,
      details: {
        updated_fields: updatedFields,
        before: {
          title: existing.title,
          slug: existing.slug,
          status: existing.status,
          price: Number(existing.price),
          inventory_count: Number(existing.inventory_count)
        },
        after: {
          title: product.title,
          slug: product.slug,
          status: product.status,
          price: Number(product.price),
          inventory_count: Number(product.inventory_count)
        }
      },
      req
    });
    return res.json({ product: sanitizeProduct(product) });
  }));

  app.delete('/products/:id', requireInternal, requirePlatformOperator, validate([
    commonRules.paramId('id')
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId || req.body.store_id);
    const existing = (await db.query(
      'SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL',
      [req.params.id, storeId]
    ))[0];
    if (!existing) {
      throw createHttpError(404, 'Product not found.', null, { expose: true });
    }

    await db.execute(
      'UPDATE products SET deleted_at = CURRENT_TIMESTAMP, status = ? WHERE id = ? AND store_id = ?',
      ['deleted', req.params.id, storeId]
    );
    await invalidateProductCache(cache, storeId);
    await bus.publish(EVENT_NAMES.PRODUCT_DELETED, {
      product_id: existing.id,
      store_id: existing.store_id
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'product.deleted',
      resourceType: 'product',
      resourceId: existing.id,
      storeId: existing.store_id,
      details: {
        title: existing.title,
        slug: existing.slug,
        previous_status: existing.status
      },
      req
    });
    return res.status(204).send();
  }));

  app.post('/inventory/reservations', requireInternal, validate([
    allowBodyFields(['store_id', 'order_id', 'items']),
    body('items').isArray({ min: 1, max: 100 }).withMessage('At least one reservation item is required.'),
    body('items.*.product_id').isInt({ min: 1 }).toInt(),
    body('items.*.quantity').isInt({ min: 1, max: 100000 }).toInt(),
    ...storeIdRule()
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId || req.body.store_id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!storeId || !items.length) {
      throw createHttpError(400, 'store_id and items are required.', null, { expose: true });
    }

    const reservationId = randomUUID();
    await db.withTransaction(async (connection) => {
      await connection.execute(
        'INSERT INTO inventory_reservations (id, store_id, order_id, status) VALUES (?, ?, ?, ?)',
        [reservationId, storeId, req.body.order_id || null, 'reserved']
      );

      for (const item of items) {
        const [[product]] = await connection.query(
          'SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL FOR UPDATE',
          [item.product_id, storeId]
        );
        if (!product) {
          throw createHttpError(404, `Product ${item.product_id} not found.`, null, { expose: true });
        }

        const available = Number(product.inventory_count) - Number(product.reserved_count);
        if (available < Number(item.quantity)) {
          throw createHttpError(409, `Insufficient stock for product ${item.product_id}.`, null, { expose: true });
        }

        await connection.execute(
          'UPDATE products SET reserved_count = reserved_count + ? WHERE id = ? AND store_id = ?',
          [Number(item.quantity), item.product_id, storeId]
        );
        await connection.execute(
          'INSERT INTO inventory_reservation_items (reservation_id, product_id, quantity) VALUES (?, ?, ?)',
          [reservationId, item.product_id, Number(item.quantity)]
        );
      }
    });

    await invalidateProductCache(cache, storeId);
    return res.status(201).json({
      reservation_id: reservationId,
      status: 'reserved'
    });
  }));

  app.post('/inventory/reservations/:id/release', requireInternal, validate([
    param('id').isUUID()
  ]), asyncHandler(async (req, res) => {
    const reservationId = req.params.id;
    let reservationStoreId = null;

    await db.withTransaction(async (connection) => {
      const [[reservation]] = await connection.query(
        'SELECT * FROM inventory_reservations WHERE id = ? FOR UPDATE',
        [reservationId]
      );
      if (!reservation || reservation.status !== 'reserved') {
        return;
      }

      if (String(reservation.store_id) !== String(req.authContext.storeId)) {
        throw createHttpError(403, 'Store context mismatch.', null, { expose: true });
      }

      reservationStoreId = reservation.store_id;
      const [items] = await connection.query('SELECT * FROM inventory_reservation_items WHERE reservation_id = ?', [reservationId]);
      for (const item of items) {
        await connection.execute(
          'UPDATE products SET reserved_count = GREATEST(0, reserved_count - ?) WHERE id = ? AND store_id = ?',
          [Number(item.quantity), item.product_id, reservation.store_id]
        );
      }

      await connection.execute('UPDATE inventory_reservations SET status = ? WHERE id = ?', ['released', reservationId]);
    });

    if (reservationStoreId) {
      await invalidateProductCache(cache, reservationStoreId);
    }

    return res.json({ reservation_id: reservationId, status: 'released' });
  }));

  app.post('/inventory/reservations/:id/commit', requireInternal, validate([
    param('id').isUUID()
  ]), asyncHandler(async (req, res) => {
    const reservationId = req.params.id;
    let reservationStoreId = null;

    await db.withTransaction(async (connection) => {
      const [[reservation]] = await connection.query(
        'SELECT * FROM inventory_reservations WHERE id = ? FOR UPDATE',
        [reservationId]
      );
      if (!reservation || reservation.status !== 'reserved') {
        return;
      }

      if (String(reservation.store_id) !== String(req.authContext.storeId)) {
        throw createHttpError(403, 'Store context mismatch.', null, { expose: true });
      }

      reservationStoreId = reservation.store_id;
      const [items] = await connection.query('SELECT * FROM inventory_reservation_items WHERE reservation_id = ?', [reservationId]);
      for (const item of items) {
        await connection.execute(
          'UPDATE products SET reserved_count = GREATEST(0, reserved_count - ?), inventory_count = GREATEST(0, inventory_count - ?) WHERE id = ? AND store_id = ?',
          [Number(item.quantity), Number(item.quantity), item.product_id, reservation.store_id]
        );
      }

      await connection.execute('UPDATE inventory_reservations SET status = ? WHERE id = ?', ['committed', reservationId]);
    });

    if (reservationStoreId) {
      await invalidateProductCache(cache, reservationStoreId);
    }

    return res.json({ reservation_id: reservationId, status: 'committed' });
  }));
};

module.exports = {
  registerRoutes
};
