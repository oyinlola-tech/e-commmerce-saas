const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { fileTypeFromBuffer } = require('file-type');
const { query, body } = require('express-validator');
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
  allowBodyFields,
  allowQueryFields,
  commonRules,
  sanitizePlainText,
  sanitizeSlug
} = require('../../../../packages/shared');

const STORE_CACHE_TTL_SECONDS = 5 * 60;
const LOGO_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LOGO_UPLOAD_LIMIT_BYTES,
    files: 1
  }
});

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

const getLogoUploadDirectory = (config) => {
  return process.env.STORE_LOGO_UPLOAD_DIR
    ? path.resolve(process.env.STORE_LOGO_UPLOAD_DIR)
    : path.join(config.workspaceRoot, 'uploads', 'logos');
};

const ensureLogoDirectory = async (config) => {
  await fs.mkdir(getLogoUploadDirectory(config), { recursive: true });
};

const buildLogoUrl = (filename) => `/logos/${filename}`;

const sanitizeLogoFilename = (storeId, mimeType) => {
  const extensionMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
  };

  const extension = extensionMap[mimeType] || 'bin';
  return `store-${storeId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
};

const uploadLogoMiddleware = (req, res, next) => {
  return logoUpload.single('logo')(req, res, (error) => {
    if (!error) {
      return next();
    }

    return next(createHttpError(422, error.message, {
      fields: [{
        field: 'logo',
        message: error.message
      }]
    }, { expose: true }));
  });
};

const updateStoreRecord = async ({ db, cache, bus, storeId, existingStore, payload }) => {
  const theme = normalizeThemeContract({
    store_type: payload.store_type || existingStore.store_type,
    template_key: payload.template_key || existingStore.template_key,
    font_preset: payload.font_preset || existingStore.font_preset
  });

  await db.execute(
    `
      UPDATE stores
      SET name = ?, custom_domain = ?, logo_url = ?, theme_color = ?, store_type = ?, template_key = ?,
          font_preset = ?, support_email = ?, contact_phone = ?, is_active = ?, ssl_status = ?
      WHERE id = ?
    `,
    [
      payload.name || existingStore.name,
      payload.custom_domain === undefined ? existingStore.custom_domain : payload.custom_domain,
      payload.logo_url === undefined ? existingStore.logo_url : payload.logo_url,
      payload.theme_color || existingStore.theme_color,
      theme.store_type,
      theme.template_key,
      theme.font_preset,
      payload.support_email === undefined ? existingStore.support_email : payload.support_email,
      payload.contact_phone === undefined ? existingStore.contact_phone : payload.contact_phone,
      typeof payload.is_active === 'undefined' ? existingStore.is_active : Number(Boolean(payload.is_active)),
      payload.ssl_status || existingStore.ssl_status,
      storeId
    ]
  );

  const store = (await db.query('SELECT * FROM stores WHERE id = ?', [storeId]))[0];
  await invalidateStoreCache(cache, store);
  await bus.publish(EVENT_NAMES.STORE_UPDATED, {
    store_id: store.id,
    owner_id: store.owner_id,
    custom_domain: store.custom_domain
  });

  return store;
};

const registerRoutes = async ({ app, db, bus, config, cache }) => {
  const requireInternal = buildRequireInternal(config);
  await ensureLogoDirectory(config);

  app.use('/logos', express.static(getLogoUploadDirectory(config), {
    immutable: true,
    maxAge: '1y',
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  app.get('/resolve', validate([
    allowQueryFields(['host']),
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
    allowQueryFields(['user_id']),
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
    allowBodyFields([
      'name',
      'subdomain',
      'custom_domain',
      'logo_url',
      'theme_color',
      'store_type',
      'template_key',
      'font_preset',
      'support_email',
      'contact_phone',
      'is_active',
      'ssl_status',
      'owner_id'
    ]),
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
    allowQueryFields([]),
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
    allowBodyFields([
      'name',
      'custom_domain',
      'logo_url',
      'theme_color',
      'store_type',
      'template_key',
      'font_preset',
      'support_email',
      'contact_phone',
      'is_active',
      'ssl_status'
    ]),
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

    const store = await updateStoreRecord({
      db,
      cache,
      bus,
      storeId: req.params.id,
      existingStore: result.store,
      payload: req.body
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
    allowBodyFields([
      'name',
      'custom_domain',
      'logo_url',
      'theme_color',
      'store_type',
      'template_key',
      'font_preset',
      'support_email',
      'contact_phone',
      'is_active',
      'ssl_status'
    ]),
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

    const store = await updateStoreRecord({
      db,
      cache,
      bus,
      storeId,
      existingStore: result.store,
      payload: req.body
    });

    return res.json({
      store: sanitizeStore(store)
    });
  }));

  app.post('/stores/:id/logo', requireInternal, validate([
    allowBodyFields([]),
    commonRules.paramId('id')
  ]), uploadLogoMiddleware, asyncHandler(async (req, res) => {
    const result = await ensureStoreAccess(db, req.params.id, req.authContext.userId, req.authContext.actorRole);
    if (!result.store) {
      throw createHttpError(404, 'Store not found.', null, { expose: true });
    }

    if (!result.allowed) {
      throw createHttpError(403, 'You do not have access to this store.', null, { expose: true });
    }

    if (!req.file || !req.file.buffer?.length) {
      throw createHttpError(422, 'A logo image is required.', {
        fields: [{
          field: 'logo',
          message: 'Upload a PNG, JPEG, or WebP image up to 2MB.'
        }]
      }, { expose: true });
    }

    const detectedFileType = await fileTypeFromBuffer(req.file.buffer);
    const mimeType = detectedFileType?.mime || req.file.mimetype;
    if (!ALLOWED_LOGO_MIME_TYPES.has(mimeType)) {
      throw createHttpError(422, 'Unsupported logo format.', {
        fields: [{
          field: 'logo',
          message: 'Only PNG, JPEG, and WebP logos are supported.'
        }]
      }, { expose: true });
    }

    const filename = sanitizeLogoFilename(req.params.id, mimeType);
    const absolutePath = path.join(getLogoUploadDirectory(config), filename);
    await fs.writeFile(absolutePath, req.file.buffer);

    const logoUrl = buildLogoUrl(filename);
    const store = await updateStoreRecord({
      db,
      cache,
      bus,
      storeId: req.params.id,
      existingStore: result.store,
      payload: {
        logo_url: logoUrl
      }
    });

    return res.status(201).json({
      logo_url: logoUrl,
      store: sanitizeStore(store)
    });
  }));
};

module.exports = {
  registerRoutes
};
