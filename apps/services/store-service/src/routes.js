const { param, query, body } = require('express-validator');
const {
  requireInternalRequest,
  normalizeThemeContract,
  EVENT_NAMES,
  PLATFORM_ROLES,
  buildSignedInternalHeaders,
  requestJson,
  asyncHandler,
  createHttpError,
  validate,
  commonRules,
  sanitizePlainText,
  sanitizeSlug
} = require('../../../../packages/shared');

const STORE_CACHE_TTL_SECONDS = 5 * 60;

const sanitizeStore = (store) => {
  if (!store) {
    return null;
  }

  return {
    id: store.id,
    owner_id: store.owner_id,
    name: store.name,
    subdomain: store.subdomain,
    custom_domain: store.custom_domain,
    logo_url: store.logo_url,
    theme_color: store.theme_color,
    store_type: store.store_type,
    template_key: store.template_key,
    font_preset: store.font_preset,
    support_email: store.support_email,
    contact_phone: store.contact_phone,
    is_active: Boolean(store.is_active),
    ssl_status: store.ssl_status,
    created_at: store.created_at,
    updated_at: store.updated_at
  };
};

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const ensureStoreAccess = async (db, storeId, userId, actorRole) => {
  const store = (await db.query('SELECT * FROM stores WHERE id = ?', [storeId]))[0] || null;
  if (!store) {
    return { allowed: false, store: null };
  }

  if ([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(actorRole)) {
    return { allowed: true, store };
  }

  return {
    allowed: String(store.owner_id) === String(userId),
    store
  };
};

const buildStoreCacheKey = (suffix) => `store:${suffix}`;

const invalidateStoreCache = async (cache, store) => {
  await cache.delByPattern('store:*');
  if (store?.id) {
    await cache.del(buildStoreCacheKey(`settings:${store.id}`));
  }
};

const normalizeDomain = (value = '') => {
  const clean = sanitizePlainText(value, { maxLength: 190 }).toLowerCase();
  return clean.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
};

const normalizeSubdomain = (value = '') => {
  return sanitizeSlug(value).slice(0, 120);
};

const registerRoutes = async ({ app, db, bus, config, logger, cache }) => {
  const requireInternal = buildRequireInternal(config);

  app.get('/resolve', validate([
    query('host').trim().notEmpty().customSanitizer((value) => normalizeDomain(value))
  ]), asyncHandler(async (req, res) => {
    const host = String(req.query.host || '').trim().toLowerCase();
    const cacheKey = buildStoreCacheKey(`resolve:${host}`);
    const cached = await cache.getOrSetJson(cacheKey, STORE_CACHE_TTL_SECONDS, async () => {
      const baseHost = host.split(':')[0];
      const [subdomain] = baseHost.split('.');
      const store = (await db.query(
        'SELECT * FROM stores WHERE custom_domain = ? OR subdomain = ? LIMIT 1',
        [baseHost, subdomain]
      ))[0];

      if (!store) {
        throw createHttpError(404, 'Store not found.', null, { expose: true });
      }

      return {
        store: sanitizeStore(store)
      };
    });

    res.setHeader('x-cache', cached.cacheHit ? 'hit' : 'miss');
    return res.json(cached.value);
  }));

  app.get('/stores/:id/access-check', requireInternal, validate([
    commonRules.paramId('id'),
    query('user_id').optional().isInt({ min: 1 }).toInt()
  ]), asyncHandler(async (req, res) => {
    const result = await ensureStoreAccess(
      db,
      req.params.id,
      req.query.user_id || req.authContext.userId,
      req.authContext.actorRole
    );

    return res.json({
      allowed: result.allowed,
      store: sanitizeStore(result.store)
    });
  }));

  app.post('/stores', requireInternal, validate([
    commonRules.plainText('name', 150),
    body('subdomain').trim().notEmpty().customSanitizer((value) => normalizeSubdomain(value)),
    body('custom_domain').optional().customSanitizer((value) => normalizeDomain(value)),
    commonRules.url('logo_url'),
    commonRules.optionalPlainText('theme_color', 20),
    commonRules.optionalPlainText('support_email', 190),
    commonRules.phone('contact_phone'),
    body('is_active').optional().isBoolean().toBoolean(),
    commonRules.optionalPlainText('ssl_status', 40)
  ]), asyncHandler(async (req, res) => {
    if (![PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER].includes(req.authContext.actorRole)) {
      throw createHttpError(403, 'Only store owners and platform owners can create stores.', null, { expose: true });
    }

    const ownerId = Number(req.authContext.userId || req.body.owner_id);
    if (!ownerId) {
      throw createHttpError(400, 'owner_id is required.', null, { expose: true });
    }

    const subscriptionCheckHeaders = buildSignedInternalHeaders({
      requestId: req.requestId,
      userId: req.authContext.userId,
      actorRole: req.authContext.actorRole,
      actorType: 'platform_user',
      secret: config.internalSharedSecret
    });
    const subscriptionCheck = await requestJson(
      `${config.serviceUrls.billing}/internal/subscriptions/check?owner_id=${encodeURIComponent(ownerId)}`,
      {
        headers: subscriptionCheckHeaders,
        timeoutMs: config.requestTimeoutMs
      }
    );

    if (!subscriptionCheck.allowed) {
      throw createHttpError(403, 'An active subscription or trial is required before creating a store.', null, { expose: true });
    }

    const theme = normalizeThemeContract(req.body);
    const name = String(req.body.name || '').trim();
    const subdomain = normalizeSubdomain(req.body.subdomain);
    if (!name || !subdomain) {
      throw createHttpError(400, 'name and subdomain are required.', null, { expose: true });
    }

    const duplicate = await db.query(
      'SELECT id FROM stores WHERE subdomain = ? OR custom_domain = ? LIMIT 1',
      [subdomain, req.body.custom_domain || null]
    );
    if (duplicate.length) {
      throw createHttpError(409, 'Subdomain or custom domain already exists.', null, { expose: true });
    }

    const result = await db.execute(
      `
        INSERT INTO stores (
          owner_id, name, subdomain, custom_domain, logo_url, theme_color, store_type,
          template_key, font_preset, support_email, contact_phone, is_active, ssl_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ownerId,
        name,
        subdomain,
        req.body.custom_domain || null,
        req.body.logo_url || null,
        req.body.theme_color || '#0F766E',
        theme.store_type,
        theme.template_key,
        theme.font_preset,
        req.body.support_email || null,
        req.body.contact_phone || null,
        req.body.is_active === false ? 0 : 1,
        req.body.ssl_status || 'pending'
      ]
    );

    const store = (await db.query('SELECT * FROM stores WHERE id = ?', [result.insertId]))[0];
    await invalidateStoreCache(cache, store);
    await bus.publish(EVENT_NAMES.STORE_CREATED, {
      store_id: store.id,
      owner_id: store.owner_id,
      subdomain: store.subdomain
    });

    return res.status(201).json({
      store: sanitizeStore(store)
    });
  }));

  app.get('/stores', requireInternal, asyncHandler(async (req, res) => {
    const actorRole = req.authContext.actorRole;
    let stores = [];

    if ([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(actorRole)) {
      stores = await db.query('SELECT * FROM stores ORDER BY created_at DESC');
    } else {
      stores = await db.query(
        'SELECT * FROM stores WHERE owner_id = ? ORDER BY created_at DESC',
        [req.authContext.userId]
      );
    }

    return res.json({
      stores: stores.map(sanitizeStore)
    });
  }));

  app.get('/stores/:id', requireInternal, validate([
    commonRules.paramId('id')
  ]), asyncHandler(async (req, res) => {
    const result = await ensureStoreAccess(db, req.params.id, req.authContext.userId, req.authContext.actorRole);
    if (!result.store) {
      throw createHttpError(404, 'Store not found.', null, { expose: true });
    }

    if (!result.allowed) {
      throw createHttpError(403, 'You do not have access to this store.', null, { expose: true });
    }

    return res.json({
      store: sanitizeStore(result.store)
    });
  }));

  app.put('/stores/:id', requireInternal, validate([
    commonRules.paramId('id'),
    commonRules.optionalPlainText('name', 150),
    body('custom_domain').optional().customSanitizer((value) => normalizeDomain(value)),
    commonRules.url('logo_url'),
    commonRules.optionalPlainText('theme_color', 20),
    commonRules.optionalPlainText('support_email', 190),
    commonRules.phone('contact_phone'),
    body('is_active').optional().isBoolean().toBoolean(),
    commonRules.optionalPlainText('ssl_status', 40)
  ]), asyncHandler(async (req, res) => {
    const result = await ensureStoreAccess(db, req.params.id, req.authContext.userId, req.authContext.actorRole);
    if (!result.store) {
      throw createHttpError(404, 'Store not found.', null, { expose: true });
    }

    if (!result.allowed) {
      throw createHttpError(403, 'You do not have access to this store.', null, { expose: true });
    }

    const theme = normalizeThemeContract({
      store_type: req.body.store_type || result.store.store_type,
      template_key: req.body.template_key || result.store.template_key,
      font_preset: req.body.font_preset || result.store.font_preset
    });

    await db.execute(
      `
        UPDATE stores
        SET name = ?, custom_domain = ?, logo_url = ?, theme_color = ?, store_type = ?, template_key = ?,
            font_preset = ?, support_email = ?, contact_phone = ?, is_active = ?, ssl_status = ?
        WHERE id = ?
      `,
      [
        req.body.name || result.store.name,
        req.body.custom_domain === undefined ? result.store.custom_domain : req.body.custom_domain,
        req.body.logo_url === undefined ? result.store.logo_url : req.body.logo_url,
        req.body.theme_color || result.store.theme_color,
        theme.store_type,
        theme.template_key,
        theme.font_preset,
        req.body.support_email === undefined ? result.store.support_email : req.body.support_email,
        req.body.contact_phone === undefined ? result.store.contact_phone : req.body.contact_phone,
        typeof req.body.is_active === 'undefined' ? result.store.is_active : Number(Boolean(req.body.is_active)),
        req.body.ssl_status || result.store.ssl_status,
        req.params.id
      ]
    );

    const store = (await db.query('SELECT * FROM stores WHERE id = ?', [req.params.id]))[0];
    await invalidateStoreCache(cache, store);
    await bus.publish(EVENT_NAMES.STORE_UPDATED, {
      store_id: store.id,
      owner_id: store.owner_id,
      custom_domain: store.custom_domain
    });

    return res.json({
      store: sanitizeStore(store)
    });
  }));

  app.get('/settings', requireInternal, asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId);
    const result = await ensureStoreAccess(db, storeId, req.authContext.userId, req.authContext.actorRole);
    if (!result.allowed || !result.store) {
      throw createHttpError(403, 'You do not have access to this store.', null, { expose: true });
    }

    const cacheKey = buildStoreCacheKey(`settings:${storeId}`);
    const cached = await cache.getOrSetJson(cacheKey, STORE_CACHE_TTL_SECONDS, async () => ({
      store: sanitizeStore(result.store)
    }));
    res.setHeader('x-cache', cached.cacheHit ? 'hit' : 'miss');
    return res.json(cached.value);
  }));

  app.put('/settings', requireInternal, validate([
    commonRules.optionalPlainText('name', 150),
    body('custom_domain').optional().customSanitizer((value) => normalizeDomain(value)),
    commonRules.url('logo_url'),
    commonRules.optionalPlainText('theme_color', 20),
    commonRules.optionalPlainText('support_email', 190),
    commonRules.phone('contact_phone'),
    body('is_active').optional().isBoolean().toBoolean(),
    commonRules.optionalPlainText('ssl_status', 40)
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId);
    const result = await ensureStoreAccess(db, storeId, req.authContext.userId, req.authContext.actorRole);
    if (!result.allowed || !result.store) {
      throw createHttpError(403, 'You do not have access to this store.', null, { expose: true });
    }

    req.params.id = String(storeId);
    return app._router.handle(req, res, () => undefined);
  }));
};

module.exports = {
  registerRoutes
};
