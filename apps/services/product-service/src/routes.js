const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  EVENT_NAMES,
  parsePagination
} = require('../../../../packages/shared');

const slugify = (value = '') => {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
    return res.status(403).json({ error: 'Platform operator authentication required.' });
  }

  return next();
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.get('/products', async (req, res) => {
    try {
      const storeId = Number(req.headers['x-store-id'] || req.query.store_id);
      if (!storeId) {
        return res.status(400).json({ error: 'Store context is required.' });
      }

      const { page, limit, offset } = parsePagination(req.query);
      const search = String(req.query.search || '').trim().toLowerCase();
      const status = String(req.query.status || '').trim().toLowerCase();
      const includeDrafts = status || req.headers['x-actor-type'] === 'platform_user';
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
        conditions.push('(LOWER(title) LIKE ? OR LOWER(sku) LIKE ?)');
        values.push(`%${search}%`, `%${search}%`);
      }

      const rows = await db.query(
        `
          SELECT * FROM products
          WHERE ${conditions.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `,
        [...values, limit, offset]
      );

      return res.json({
        page,
        limit,
        products: rows.map(sanitizeProduct)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/products/id/:id', async (req, res) => {
    try {
      const storeId = Number(req.headers['x-store-id'] || req.query.store_id);
      const rows = await db.query('SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL', [req.params.id, storeId]);
      const product = rows[0];
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      return res.json({ product: sanitizeProduct(product) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/products/:slug', async (req, res) => {
    try {
      const storeId = Number(req.headers['x-store-id'] || req.query.store_id);
      const rows = await db.query(
        'SELECT * FROM products WHERE slug = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1',
        [req.params.slug, storeId]
      );
      const product = rows[0];
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      if (product.status !== 'published' && req.headers['x-actor-type'] !== 'platform_user') {
        return res.status(404).json({ error: 'Product not found.' });
      }

      return res.json({ product: sanitizeProduct(product) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/products', requireInternal, requirePlatformOperator, async (req, res) => {
    try {
      const storeId = Number(req.authContext.storeId || req.body.store_id);
      const title = String(req.body.title || '').trim();
      const slug = slugify(req.body.slug || title);
      if (!storeId || !title || !slug) {
        return res.status(400).json({ error: 'store_id, title, and slug are required.' });
      }

      const result = await db.execute(
        `
          INSERT INTO products (
            store_id, title, slug, description, price, compare_at_price, sku, inventory_count, reserved_count, images, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `,
        [
          storeId,
          title,
          slug,
          req.body.description || null,
          Number(req.body.price || 0),
          req.body.compare_at_price === undefined ? null : Number(req.body.compare_at_price),
          req.body.sku || null,
          Number(req.body.inventory_count || 0),
          JSON.stringify(req.body.images || []),
          String(req.body.status || 'draft').trim().toLowerCase()
        ]
      );
      const product = (await db.query('SELECT * FROM products WHERE id = ?', [result.insertId]))[0];
      await bus.publish(EVENT_NAMES.PRODUCT_CREATED, {
        product_id: product.id,
        store_id: product.store_id,
        title: product.title
      });

      return res.status(201).json({ product: sanitizeProduct(product) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.put('/products/:id', requireInternal, requirePlatformOperator, async (req, res) => {
    try {
      const storeId = Number(req.authContext.storeId || req.body.store_id);
      const existing = (await db.query('SELECT * FROM products WHERE id = ? AND store_id = ?', [req.params.id, storeId]))[0];
      if (!existing) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      const slug = slugify(req.body.slug || req.body.title || existing.slug);
      await db.execute(
        `
          UPDATE products
          SET title = ?, slug = ?, description = ?, price = ?, compare_at_price = ?, sku = ?, inventory_count = ?, images = ?, status = ?
          WHERE id = ? AND store_id = ?
        `,
        [
          req.body.title || existing.title,
          slug,
          req.body.description || existing.description,
          req.body.price === undefined ? existing.price : Number(req.body.price),
          req.body.compare_at_price === undefined ? existing.compare_at_price : Number(req.body.compare_at_price),
          req.body.sku || existing.sku,
          req.body.inventory_count === undefined ? existing.inventory_count : Number(req.body.inventory_count),
          JSON.stringify(req.body.images || (existing.images ? JSON.parse(existing.images) : [])),
          req.body.status || existing.status,
          req.params.id,
          storeId
        ]
      );
      const product = (await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]))[0];
      await bus.publish(EVENT_NAMES.PRODUCT_UPDATED, {
        product_id: product.id,
        store_id: product.store_id
      });
      return res.json({ product: sanitizeProduct(product) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.delete('/products/:id', requireInternal, requirePlatformOperator, async (req, res) => {
    try {
      const storeId = Number(req.authContext.storeId || req.body.store_id);
      const existing = (await db.query('SELECT * FROM products WHERE id = ? AND store_id = ?', [req.params.id, storeId]))[0];
      if (!existing) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      await db.execute('UPDATE products SET deleted_at = CURRENT_TIMESTAMP, status = ? WHERE id = ? AND store_id = ?', ['deleted', req.params.id, storeId]);
      await bus.publish(EVENT_NAMES.PRODUCT_DELETED, {
        product_id: existing.id,
        store_id: existing.store_id
      });
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/inventory/reservations', requireInternal, async (req, res) => {
    try {
      const storeId = Number(req.authContext.storeId || req.body.store_id);
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      if (!storeId || !items.length) {
        return res.status(400).json({ error: 'store_id and items are required.' });
      }

      const reservationId = randomUUID();
      await db.withTransaction(async (connection) => {
        const [insertReservation] = await connection.execute(
          'INSERT INTO inventory_reservations (id, store_id, order_id, status) VALUES (?, ?, ?, ?)',
          [reservationId, storeId, req.body.order_id || null, 'reserved']
        );
        void insertReservation;

        for (const item of items) {
          const [[product]] = await connection.query(
            'SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL FOR UPDATE',
            [item.product_id, storeId]
          );
          if (!product) {
            throw new Error(`Product ${item.product_id} not found.`);
          }

          const available = Number(product.inventory_count) - Number(product.reserved_count);
          if (available < Number(item.quantity)) {
            throw new Error(`Insufficient stock for product ${item.product_id}.`);
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

      return res.status(201).json({
        reservation_id: reservationId,
        status: 'reserved'
      });
    } catch (error) {
      return res.status(409).json({ error: error.message });
    }
  });

  app.post('/inventory/reservations/:id/release', requireInternal, async (req, res) => {
    try {
      const reservationId = req.params.id;
      await db.withTransaction(async (connection) => {
        const [[reservation]] = await connection.query('SELECT * FROM inventory_reservations WHERE id = ? FOR UPDATE', [reservationId]);
        if (!reservation || reservation.status !== 'reserved') {
          return;
        }

        const [items] = await connection.query('SELECT * FROM inventory_reservation_items WHERE reservation_id = ?', [reservationId]);
        for (const item of items) {
          await connection.execute(
            'UPDATE products SET reserved_count = GREATEST(0, reserved_count - ?) WHERE id = ? AND store_id = ?',
            [Number(item.quantity), item.product_id, reservation.store_id]
          );
        }

        await connection.execute('UPDATE inventory_reservations SET status = ? WHERE id = ?', ['released', reservationId]);
      });

      return res.json({ reservation_id: reservationId, status: 'released' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/inventory/reservations/:id/commit', requireInternal, async (req, res) => {
    try {
      const reservationId = req.params.id;
      await db.withTransaction(async (connection) => {
        const [[reservation]] = await connection.query('SELECT * FROM inventory_reservations WHERE id = ? FOR UPDATE', [reservationId]);
        if (!reservation || reservation.status !== 'reserved') {
          return;
        }

        const [items] = await connection.query('SELECT * FROM inventory_reservation_items WHERE reservation_id = ?', [reservationId]);
        for (const item of items) {
          await connection.execute(
            'UPDATE products SET reserved_count = GREATEST(0, reserved_count - ?), inventory_count = GREATEST(0, inventory_count - ?) WHERE id = ? AND store_id = ?',
            [Number(item.quantity), Number(item.quantity), item.product_id, reservation.store_id]
          );
        }

        await connection.execute('UPDATE inventory_reservations SET status = ? WHERE id = ?', ['committed', reservationId]);
      });

      return res.json({ reservation_id: reservationId, status: 'committed' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  registerRoutes
};
