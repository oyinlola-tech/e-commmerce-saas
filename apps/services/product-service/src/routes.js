const { body, param, query } = require('express-validator');
const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  EVENT_NAMES,
  parsePagination,
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

const PRODUCT_CACHE_TTL_SECONDS = 60 * 60;

const slugify = (value = '') => {
  return sanitizeSlug(value);
};

const sanitizeProduct = (product) => {
  if (!product) {
    return null;
  }

  return {
    id: product.id,
    store_id: product.store_id,
    title: product.title,
    slug: product.slug,
    category: product.category,
    description: product.description,
    price: Number(product.price),
    compare_at_price: product.compare_at_price === null ? null : Number(product.compare_at_price),
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
    allowBodyFields(['store_id', 'title', 'slug', 'category', 'description', 'price', 'compare_at_price', 'sku', 'inventory_count', 'images', 'status']),
    commonRules.name('title', 180),
    commonRules.slug('slug'),
    commonRules.optionalPlainText('category', 120),
    commonRules.richText('description', 5000),
    commonRules.amount('price'),
    commonRules.optionalAmount('compare_at_price'),
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

    const result = await db.execute(
      `
        INSERT INTO products (
          store_id, title, slug, category, description, price, compare_at_price, sku, inventory_count, reserved_count, images, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `,
      [
        storeId,
        title,
        slug,
        req.body.category || null,
        req.body.description || null,
        Number(req.body.price || 0),
        req.body.compare_at_price === undefined ? null : Number(req.body.compare_at_price),
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

    return res.status(201).json({ product: sanitizeProduct(product) });
  }));

  app.put('/products/:id', requireInternal, requirePlatformOperator, validate([
    allowBodyFields(['store_id', 'title', 'slug', 'category', 'description', 'price', 'compare_at_price', 'sku', 'inventory_count', 'images', 'status']),
    commonRules.paramId('id'),
    commonRules.optionalName('title', 180),
    commonRules.slug('slug'),
    commonRules.optionalPlainText('category', 120),
    commonRules.richText('description', 5000),
    commonRules.optionalAmount('price'),
    commonRules.optionalAmount('compare_at_price'),
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
    await db.execute(
      `
        UPDATE products
        SET title = ?, slug = ?, category = ?, description = ?, price = ?, compare_at_price = ?, sku = ?, inventory_count = ?, images = ?, status = ?
        WHERE id = ? AND store_id = ?
      `,
      [
        req.body.title || existing.title,
        slug,
        req.body.category === undefined ? existing.category : req.body.category,
        req.body.description === undefined ? existing.description : req.body.description,
        req.body.price === undefined ? existing.price : Number(req.body.price),
        req.body.compare_at_price === undefined ? existing.compare_at_price : Number(req.body.compare_at_price),
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
