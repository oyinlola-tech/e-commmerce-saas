const path = require('path');
const express = require('express');
const multer = require('multer');
const { query, body } = require('express-validator');
const {
  requireInternalRequest,
  normalizeThemeContract,
  EVENT_NAMES,
  PLATFORM_ROLES,
  buildSignedInternalHeaders,
  requestJson,
  createAuditLog,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  allowQueryFields,
  commonRules,
  sanitizePlainText,
  sanitizeSlug,
  ONBOARDING_STEP_SEQUENCE,
  normalizeOnboardingTask,
  buildOnboardingProgress
} = require('../../../../packages/shared');
const {
  validateUploadedFile,
  generateSafeFilename,
  saveFile,
  deleteFile,
  ensureUploadDirectory,
  LOGO_UPLOAD_LIMIT_BYTES
} = require('./file-upload-security');

const STORE_CACHE_TTL_SECONDS = 5 * 60;

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
    shipping_origin_country: store.shipping_origin_country || null,
    shipping_flat_rate: Number(store.shipping_flat_rate || 0),
    domestic_shipping_rate: Number(store.domestic_shipping_rate || 0),
    international_shipping_rate: Number(store.international_shipping_rate || 0),
    free_shipping_threshold: Number(store.free_shipping_threshold || 0),
    tax_rate: Number(store.tax_rate || 0),
    tax_label: store.tax_label || null,
    tax_apply_to_shipping: Boolean(store.tax_apply_to_shipping),
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

const buildBillingHeaders = (config, req) => {
  return buildSignedInternalHeaders({
    requestId: req.requestId,
    userId: req.authContext.userId || '',
    actorRole: req.authContext.actorRole || PLATFORM_ROLES.PLATFORM_OWNER,
    actorType: req.authContext.actorType || 'platform_user',
    secret: config.internalSharedSecret
  });
};

const getPlanLimit = (access = {}, key) => {
  const rawValue = access?.entitlements?.limits?.[key];
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
};

const hasPlanCapability = (access = {}, capability) => {
  return Boolean(access?.entitlements?.capabilities?.[capability]);
};

const fetchOwnerSubscriptionAccess = async ({ config, req, ownerId }) => {
  return requestJson(
    `${config.serviceUrls.billing}/internal/subscriptions/check?owner_id=${encodeURIComponent(ownerId)}`,
    {
      headers: buildBillingHeaders(config, req),
      timeoutMs: config.requestTimeoutMs
    }
  );
};

const enforceStorePlanAccess = async ({
  db,
  config,
  req,
  ownerId,
  existingStore = null,
  payload = {}
}) => {
  const access = await fetchOwnerSubscriptionAccess({
    config,
    req,
    ownerId
  });

  if (!access.allowed) {
    throw createHttpError(403, 'An active subscription or trial is required for this store action.', null, { expose: true });
  }

  const normalizedCustomDomain = payload.custom_domain === undefined
    ? undefined
    : normalizeDomain(payload.custom_domain || '');
  const hasExistingCustomDomain = Boolean(existingStore?.custom_domain);
  const isChangingCustomDomain = normalizedCustomDomain !== undefined
    && normalizedCustomDomain !== normalizeDomain(existingStore?.custom_domain || '');

  if (normalizedCustomDomain && !hasPlanCapability(access, 'custom_domain') && (!hasExistingCustomDomain || isChangingCustomDomain)) {
    throw createHttpError(403, 'Custom domains are not available on the current billing plan.', null, { expose: true });
  }

  const maxStores = getPlanLimit(access, 'stores');
  const nextIsActive = payload.is_active === undefined
    ? Boolean(existingStore?.is_active ?? true)
    : Boolean(payload.is_active);

  if (nextIsActive && maxStores !== null) {
    const rows = await db.query(
      `
        SELECT COUNT(*) AS total
        FROM stores
        WHERE owner_id = ?
          AND is_active = 1
          AND (? IS NULL OR id <> ?)
      `,
      [
        ownerId,
        existingStore?.id || null,
        existingStore?.id || null
      ]
    );
    const activeStoreCount = Number(rows[0]?.total || 0);
    if (activeStoreCount + 1 > maxStores) {
      throw createHttpError(403, `The current plan allows up to ${maxStores} active store${maxStores === 1 ? '' : 's'}. Upgrade before activating another store.`, null, {
        expose: true
      });
    }
  }

  return access;
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

const roundMoney = (value = 0) => {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
};

const normalizeMoneyAmount = (value = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return roundMoney(parsed);
};

const normalizeTaxRate = (value = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(100, roundMoney(parsed));
};

const getLogoUploadDirectory = (config) => {
  return process.env.STORE_LOGO_UPLOAD_DIR
    ? path.resolve(process.env.STORE_LOGO_UPLOAD_DIR)
    : path.join(config.workspaceRoot, 'uploads', 'logos');
};

const ensureLogoDirectory = async (config) => {
  await ensureUploadDirectory(getLogoUploadDirectory(config));
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

const extractManagedLogoFilename = (logoUrl = '') => {
  const normalized = String(logoUrl || '').trim();
  if (!normalized.startsWith('/logos/')) {
    return null;
  }

  return path.basename(normalized);
};

const buildStoreAuditDetails = ({ existingStore = null, nextStore = null, payload = {}, extra = {} } = {}) => {
  const updatedFields = Object.keys(payload || {})
    .filter((field) => field !== 'owner_id')
    .sort();

  return {
    updated_fields: updatedFields,
    before: existingStore
      ? {
          name: existingStore.name,
          custom_domain: existingStore.custom_domain,
          logo_url: existingStore.logo_url,
          theme_color: existingStore.theme_color,
          store_type: existingStore.store_type,
          template_key: existingStore.template_key,
          font_preset: existingStore.font_preset,
          support_email: existingStore.support_email,
          contact_phone: existingStore.contact_phone,
          shipping_origin_country: existingStore.shipping_origin_country,
          shipping_flat_rate: Number(existingStore.shipping_flat_rate || 0),
          domestic_shipping_rate: Number(existingStore.domestic_shipping_rate || 0),
          international_shipping_rate: Number(existingStore.international_shipping_rate || 0),
          free_shipping_threshold: Number(existingStore.free_shipping_threshold || 0),
          tax_rate: Number(existingStore.tax_rate || 0),
          tax_label: existingStore.tax_label,
          tax_apply_to_shipping: Boolean(existingStore.tax_apply_to_shipping),
          is_active: Boolean(existingStore.is_active),
          ssl_status: existingStore.ssl_status
        }
      : null,
    after: nextStore
      ? {
          name: nextStore.name,
          custom_domain: nextStore.custom_domain,
          logo_url: nextStore.logo_url,
          theme_color: nextStore.theme_color,
          store_type: nextStore.store_type,
          template_key: nextStore.template_key,
          font_preset: nextStore.font_preset,
          support_email: nextStore.support_email,
          contact_phone: nextStore.contact_phone,
          shipping_origin_country: nextStore.shipping_origin_country,
          shipping_flat_rate: Number(nextStore.shipping_flat_rate || 0),
          domestic_shipping_rate: Number(nextStore.domestic_shipping_rate || 0),
          international_shipping_rate: Number(nextStore.international_shipping_rate || 0),
          free_shipping_threshold: Number(nextStore.free_shipping_threshold || 0),
          tax_rate: Number(nextStore.tax_rate || 0),
          tax_label: nextStore.tax_label,
          tax_apply_to_shipping: Boolean(nextStore.tax_apply_to_shipping),
          is_active: Boolean(nextStore.is_active),
          ssl_status: nextStore.ssl_status
        }
      : null,
    ...extra
  };
};

const ONBOARDING_TASK_STEPS = ONBOARDING_STEP_SEQUENCE.filter((step) => step !== 'completed');

const parseJsonField = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const sanitizeOnboardingState = (state = null) => {
  if (!state) {
    return null;
  }

  const metadata = parseJsonField(state.step_metadata) || {};
  return {
    current_step: state.current_step || 'initial',
    completed: state.current_step === 'completed',
    completed_at: state.completed_at || null,
    created_at: state.created_at || null,
    updated_at: state.updated_at || null,
    total_tasks: Number(metadata.total_tasks || 0),
    completed_tasks: Number(metadata.completed_tasks || 0),
    required_tasks: Number(metadata.required_tasks || 0),
    completed_required_tasks: Number(metadata.completed_required_tasks || 0),
    remaining_required_tasks: Number(metadata.remaining_required_tasks || 0),
    next_task_key: metadata.next_task_key || null,
    next_task_title: metadata.next_task_title || null,
    next_action: metadata.next_action || null,
    next_href: metadata.next_href || null,
    estimated_minutes_remaining: Number(metadata.estimated_minutes_remaining || 0),
    synced_at: metadata.synced_at || null
  };
};

const sanitizeOnboardingTaskRecord = (task = null) => {
  if (!task) {
    return null;
  }

  const normalized = normalizeOnboardingTask({
    key: task.task_key,
    title: task.task_title,
    description: task.task_description,
    step: task.task_step,
    complete: Boolean(task.is_complete),
    required: Boolean(task.required)
  });
  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    completed_at: task.completed_at || null,
    created_at: task.created_at || null,
    updated_at: task.updated_at || null
  };
};

const loadStoreOnboarding = async (db, storeId) => {
  const state = (await db.query(
    'SELECT * FROM store_onboarding_states WHERE store_id = ? LIMIT 1',
    [storeId]
  ))[0] || null;
  const stepOrder = ONBOARDING_TASK_STEPS.map(() => '?').join(', ');
  const tasks = await db.query(
    `
      SELECT *
      FROM onboarding_tasks
      WHERE store_id = ?
      ORDER BY FIELD(task_step, ${stepOrder}), required DESC, created_at ASC
    `,
    [storeId, ...ONBOARDING_TASK_STEPS]
  );

  return {
    state: sanitizeOnboardingState(state),
    tasks: tasks.map((task) => sanitizeOnboardingTaskRecord(task)).filter(Boolean)
  };
};

const syncStoreOnboarding = async (db, storeId, tasks = []) => {
  const normalizedTasks = tasks
    .map((task) => normalizeOnboardingTask(task))
    .filter(Boolean);

  if (!normalizedTasks.length) {
    throw createHttpError(422, 'At least one onboarding task is required.', null, { expose: true });
  }

  const previousStateRow = (await db.query(
    'SELECT * FROM store_onboarding_states WHERE store_id = ? LIMIT 1',
    [storeId]
  ))[0] || null;
  const progress = buildOnboardingProgress(normalizedTasks);
  const now = new Date();
  const metadata = JSON.stringify({
    total_tasks: progress.total_tasks,
    completed_tasks: progress.completed_tasks,
    required_tasks: progress.required_tasks,
    completed_required_tasks: progress.completed_required_tasks,
    remaining_required_tasks: progress.remaining_required_tasks,
    next_task_key: progress.next_task_key,
    next_task_title: progress.next_task_title,
    next_action: progress.next_action,
    next_href: progress.next_href,
    estimated_minutes_remaining: progress.estimated_minutes_remaining,
    synced_at: now.toISOString()
  });
  const completedAt = progress.completed
    ? (previousStateRow?.completed_at || now)
    : null;

  await db.execute(
    `
      INSERT INTO store_onboarding_states (
        store_id, current_step, step_metadata, completed_at
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        current_step = VALUES(current_step),
        step_metadata = VALUES(step_metadata),
        completed_at = VALUES(completed_at)
    `,
    [
      storeId,
      progress.current_step,
      metadata,
      completedAt
    ]
  );

  for (const task of normalizedTasks) {
    await db.execute(
      `
        INSERT INTO onboarding_tasks (
          store_id, task_key, task_title, task_description, task_step, is_complete, required, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          task_title = VALUES(task_title),
          task_description = VALUES(task_description),
          task_step = VALUES(task_step),
          is_complete = VALUES(is_complete),
          required = VALUES(required),
          completed_at = IF(VALUES(is_complete) = 1, COALESCE(completed_at, VALUES(completed_at)), NULL)
      `,
      [
        storeId,
        task.key,
        task.title,
        task.description || null,
        task.step,
        task.complete ? 1 : 0,
        task.required ? 1 : 0,
        task.complete ? now : null
      ]
    );
  }

  const keys = normalizedTasks.map((task) => task.key);
  const placeholders = keys.map(() => '?').join(', ');
  await db.execute(
    `
      DELETE FROM onboarding_tasks
      WHERE store_id = ?
        AND task_key NOT IN (${placeholders})
    `,
    [storeId, ...keys]
  );

  const current = await loadStoreOnboarding(db, storeId);
  return {
    previousState: sanitizeOnboardingState(previousStateRow),
    currentState: current.state,
    tasks: current.tasks
  };
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
          font_preset = ?, support_email = ?, contact_phone = ?, shipping_origin_country = ?, shipping_flat_rate = ?,
          domestic_shipping_rate = ?, international_shipping_rate = ?, free_shipping_threshold = ?, tax_rate = ?,
          tax_label = ?, tax_apply_to_shipping = ?, is_active = ?, ssl_status = ?
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
      payload.shipping_origin_country === undefined ? existingStore.shipping_origin_country : payload.shipping_origin_country,
      payload.shipping_flat_rate === undefined ? Number(existingStore.shipping_flat_rate || 0) : payload.shipping_flat_rate,
      payload.domestic_shipping_rate === undefined ? Number(existingStore.domestic_shipping_rate || 0) : payload.domestic_shipping_rate,
      payload.international_shipping_rate === undefined ? Number(existingStore.international_shipping_rate || 0) : payload.international_shipping_rate,
      payload.free_shipping_threshold === undefined ? Number(existingStore.free_shipping_threshold || 0) : payload.free_shipping_threshold,
      payload.tax_rate === undefined ? Number(existingStore.tax_rate || 0) : payload.tax_rate,
      payload.tax_label === undefined ? existingStore.tax_label : payload.tax_label,
      typeof payload.tax_apply_to_shipping === 'undefined'
        ? Number(Boolean(existingStore.tax_apply_to_shipping))
        : Number(Boolean(payload.tax_apply_to_shipping)),
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
      'shipping_origin_country',
      'shipping_flat_rate',
      'domestic_shipping_rate',
      'international_shipping_rate',
      'free_shipping_threshold',
      'tax_rate',
      'tax_label',
      'tax_apply_to_shipping',
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
    commonRules.optionalPlainText('shipping_origin_country', 120),
    body('shipping_flat_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('domestic_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('international_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('free_shipping_threshold').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('tax_rate').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).toFloat(),
    commonRules.optionalPlainText('tax_label', 80),
    body('tax_apply_to_shipping').optional().isBoolean().toBoolean(),
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

    await enforceStorePlanAccess({
      db,
      config,
      req,
      ownerId,
      payload: {
        ...req.body,
        is_active: req.body.is_active === false ? false : true
      }
    });

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
          template_key, font_preset, support_email, contact_phone, shipping_origin_country, shipping_flat_rate,
          domestic_shipping_rate, international_shipping_rate, free_shipping_threshold, tax_rate, tax_label,
          tax_apply_to_shipping, is_active, ssl_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        sanitizePlainText(req.body.shipping_origin_country || '', { maxLength: 120 }) || null,
        normalizeMoneyAmount(req.body.shipping_flat_rate || 0),
        normalizeMoneyAmount(req.body.domestic_shipping_rate || 0),
        normalizeMoneyAmount(req.body.international_shipping_rate || 0),
        normalizeMoneyAmount(req.body.free_shipping_threshold || 0),
        normalizeTaxRate(req.body.tax_rate || 0),
        sanitizePlainText(req.body.tax_label || '', { maxLength: 80 }) || null,
        req.body.tax_apply_to_shipping ? 1 : 0,
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
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || ownerId,
      action: 'store.created',
      resourceType: 'store',
      resourceId: store.id,
      storeId: store.id,
      details: buildStoreAuditDetails({
        nextStore: store,
        payload: req.body,
        extra: {
          owner_id: store.owner_id,
          subdomain: store.subdomain
        }
      }),
      req
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

  app.get('/stores/:id/onboarding', requireInternal, validate([
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

    const onboarding = await loadStoreOnboarding(db, req.params.id);
    return res.json(onboarding);
  }));

  app.post('/stores/:id/onboarding/sync', requireInternal, validate([
    allowBodyFields(['tasks']),
    commonRules.paramId('id'),
    body('tasks').isArray({ min: 1, max: 10 }),
    body('tasks.*.key').trim().notEmpty().customSanitizer((value) => sanitizePlainText(value, { maxLength: 100 })),
    body('tasks.*.title').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 255 })),
    body('tasks.*.description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 1000 })),
    body('tasks.*.step').optional().isIn(ONBOARDING_TASK_STEPS),
    body('tasks.*.complete').optional().isBoolean().toBoolean(),
    body('tasks.*.required').optional().isBoolean().toBoolean(),
    body('tasks.*.action').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 80 })),
    body('tasks.*.href').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 255 })),
    body('tasks.*.estimate_minutes').optional().isInt({ min: 0, max: 60 }).toInt()
  ]), asyncHandler(async (req, res) => {
    const result = await ensureStoreAccess(db, req.params.id, req.authContext.userId, req.authContext.actorRole);
    if (!result.store) {
      throw createHttpError(404, 'Store not found.', null, { expose: true });
    }

    if (!result.allowed) {
      throw createHttpError(403, 'You do not have access to this store.', null, { expose: true });
    }

    const synced = await syncStoreOnboarding(db, req.params.id, req.body.tasks || []);
    if (
      synced.previousState?.current_step !== synced.currentState?.current_step
      || Boolean(synced.previousState?.completed_at) !== Boolean(synced.currentState?.completed_at)
    ) {
      await createAuditLog(db, {
        actorType: req.authContext.actorType || 'platform_user',
        actorId: req.authContext.userId || null,
        action: 'store.onboarding_synced',
        resourceType: 'store',
        resourceId: result.store.id,
        storeId: result.store.id,
        details: {
          previous_step: synced.previousState?.current_step || null,
          current_step: synced.currentState?.current_step || 'initial',
          completed_required_tasks: synced.currentState?.completed_required_tasks || 0,
          required_tasks: synced.currentState?.required_tasks || 0,
          remaining_required_tasks: synced.currentState?.remaining_required_tasks || 0
        },
        req
      });
    }

    return res.json({
      state: synced.currentState,
      tasks: synced.tasks
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
      'shipping_origin_country',
      'shipping_flat_rate',
      'domestic_shipping_rate',
      'international_shipping_rate',
      'free_shipping_threshold',
      'tax_rate',
      'tax_label',
      'tax_apply_to_shipping',
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
    commonRules.optionalPlainText('shipping_origin_country', 120),
    body('shipping_flat_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('domestic_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('international_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('free_shipping_threshold').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('tax_rate').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).toFloat(),
    commonRules.optionalPlainText('tax_label', 80),
    body('tax_apply_to_shipping').optional().isBoolean().toBoolean(),
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

    await enforceStorePlanAccess({
      db,
      config,
      req,
      ownerId: result.store.owner_id,
      existingStore: result.store,
      payload: req.body
    });

    const store = await updateStoreRecord({
      db,
      cache,
      bus,
      storeId: req.params.id,
      existingStore: result.store,
      payload: req.body
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'store.updated',
      resourceType: 'store',
      resourceId: store.id,
      storeId: store.id,
      details: buildStoreAuditDetails({
        existingStore: result.store,
        nextStore: store,
        payload: req.body
      }),
      req
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
      'shipping_origin_country',
      'shipping_flat_rate',
      'domestic_shipping_rate',
      'international_shipping_rate',
      'free_shipping_threshold',
      'tax_rate',
      'tax_label',
      'tax_apply_to_shipping',
      'is_active',
      'ssl_status'
    ]),
    commonRules.optionalPlainText('name', 150),
    body('custom_domain').optional().customSanitizer((value) => normalizeDomain(value)),
    commonRules.url('logo_url'),
    commonRules.optionalPlainText('theme_color', 20),
    commonRules.optionalPlainText('support_email', 190),
    commonRules.phone('contact_phone'),
    commonRules.optionalPlainText('shipping_origin_country', 120),
    body('shipping_flat_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('domestic_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('international_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('free_shipping_threshold').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
    body('tax_rate').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).toFloat(),
    commonRules.optionalPlainText('tax_label', 80),
    body('tax_apply_to_shipping').optional().isBoolean().toBoolean(),
    body('is_active').optional().isBoolean().toBoolean(),
    commonRules.optionalPlainText('ssl_status', 40)
  ]), asyncHandler(async (req, res) => {
    const storeId = Number(req.authContext.storeId);
    const result = await ensureStoreAccess(db, storeId, req.authContext.userId, req.authContext.actorRole);
    if (!result.allowed || !result.store) {
      throw createHttpError(403, 'You do not have access to this store.', null, { expose: true });
    }

    await enforceStorePlanAccess({
      db,
      config,
      req,
      ownerId: result.store.owner_id,
      existingStore: result.store,
      payload: req.body
    });

    const store = await updateStoreRecord({
      db,
      cache,
      bus,
      storeId,
      existingStore: result.store,
      payload: req.body
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'store.settings_updated',
      resourceType: 'store',
      resourceId: store.id,
      storeId: store.id,
      details: buildStoreAuditDetails({
        existingStore: result.store,
        nextStore: store,
        payload: req.body
      }),
      req
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

    const uploadDir = getLogoUploadDirectory(config);
    const previousLogoFilename = extractManagedLogoFilename(result.store.logo_url);
    let filename = null;
    let logoUrl = null;
    let store = null;

    try {
      const sanitizedBuffer = await validateUploadedFile(req.file.buffer, req.file.mimetype);
      filename = generateSafeFilename(req.params.id, req.file.mimetype);
      logoUrl = await saveFile(sanitizedBuffer, uploadDir, filename);
      store = await updateStoreRecord({
        db,
        cache,
        bus,
        storeId: req.params.id,
        existingStore: result.store,
        payload: {
          logo_url: logoUrl
        }
      });

      if (previousLogoFilename && previousLogoFilename !== filename) {
        try {
          await deleteFile(uploadDir, previousLogoFilename);
        } catch (error) {
          req.log?.warn('store_logo_delete_failed', {
            storeId: req.params.id,
            filename: previousLogoFilename,
            error: error.message
          });
        }
      }

      await createAuditLog(db, {
        actorType: req.authContext.actorType || 'platform_user',
        actorId: req.authContext.userId || null,
        action: 'store.logo_uploaded',
        resourceType: 'store',
        resourceId: store.id,
        storeId: store.id,
        details: {
          filename,
          logo_url: logoUrl,
          previous_logo_url: result.store.logo_url || null,
          size: req.file.size || sanitizedBuffer.length,
          mime_type: req.file.mimetype
        },
        req
      });
    } catch (error) {
      if (filename) {
        try {
          await deleteFile(uploadDir, filename);
        } catch (cleanupError) {
          req.log?.warn('store_logo_cleanup_failed', {
            storeId: req.params.id,
            filename,
            error: cleanupError.message
          });
        }
      }

      await createAuditLog(db, {
        actorType: req.authContext.actorType || 'platform_user',
        actorId: req.authContext.userId || null,
        action: 'store.logo_upload_failed',
        resourceType: 'store',
        resourceId: result.store.id,
        storeId: result.store.id,
        details: {
          error: error.message,
          mime_type: req.file.mimetype,
          size: req.file.size || req.file.buffer.length
        },
        req,
        status: 'failure'
      });
      throw error;
    }

    return res.status(201).json({
      logo_url: logoUrl,
      store: sanitizeStore(store)
    });
  }));
};

module.exports = {
  registerRoutes
};
