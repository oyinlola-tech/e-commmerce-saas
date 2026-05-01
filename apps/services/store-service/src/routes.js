const {
  requireInternalRequest,
  normalizeThemeContract,
  EVENT_NAMES,
  PLATFORM_ROLES,
  buildSignedInternalHeaders,
  requestJson
} = require('../../../../packages/shared');

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

const ensureStoreAccess = async (db, storeId, userId, actorRole) => {
  const rows = await db.query('SELECT * FROM stores WHERE id = ?', [storeId]);
  const store = rows[0];
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

const registerRoutes = async ({ app, db, bus, config, logger }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.get('/resolve', async (req, res) => {
    try {
      const host = String(req.query.host || '').trim().toLowerCase();
      if (!host) {
        return res.status(400).json({ error: 'host is required.' });
      }

      const baseHost = host.split(':')[0];
      const [subdomain] = baseHost.split('.');
      const stores = await db.query(
        'SELECT * FROM stores WHERE custom_domain = ? OR subdomain = ? LIMIT 1',
        [baseHost, subdomain]
      );
      const store = stores[0];

      if (!store) {
        return res.status(404).json({ error: 'Store not found.' });
      }

      return res.json({
        store: sanitizeStore(store)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/stores/:id/access-check', requireInternal, async (req, res) => {
    try {
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
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/stores', requireInternal, async (req, res) => {
    try {
      if (![PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER].includes(req.authContext.actorRole)) {
        return res.status(403).json({ error: 'Only store owners and platform owners can create stores.' });
      }

      const ownerId = Number(req.authContext.userId || req.body.owner_id);
      if (!ownerId) {
        return res.status(400).json({ error: 'owner_id is required.' });
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
        return res.status(403).json({ error: 'An active subscription or trial is required before creating a store.' });
      }

      const theme = normalizeThemeContract(req.body);
      const name = String(req.body.name || '').trim();
      const subdomain = String(req.body.subdomain || '').trim().toLowerCase();
      if (!name || !subdomain) {
        return res.status(400).json({ error: 'name and subdomain are required.' });
      }

      const duplicate = await db.query(
        'SELECT id FROM stores WHERE subdomain = ? OR custom_domain = ? LIMIT 1',
        [subdomain, req.body.custom_domain || null]
      );
      if (duplicate.length) {
        return res.status(409).json({ error: 'Subdomain or custom domain already exists.' });
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

      const rows = await db.query('SELECT * FROM stores WHERE id = ?', [result.insertId]);
      const store = rows[0];
      await bus.publish(EVENT_NAMES.STORE_CREATED, {
        store_id: store.id,
        owner_id: store.owner_id,
        subdomain: store.subdomain
      });

      return res.status(201).json({
        store: sanitizeStore(store)
      });
    } catch (error) {
      logger.error('Failed to create store', { error: error.message });
      return res.status(error.status || 500).json({ error: error.payload?.error || error.message });
    }
  });

  app.get('/stores', requireInternal, async (req, res) => {
    try {
      const actorRole = req.authContext.actorRole;
      let stores = [];

      if ([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(actorRole)) {
        stores = await db.query('SELECT * FROM stores ORDER BY created_at DESC');
      } else {
        stores = await db.query('SELECT * FROM stores WHERE owner_id = ? ORDER BY created_at DESC', [req.authContext.userId]);
      }

      return res.json({
        stores: stores.map(sanitizeStore)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/stores/:id', requireInternal, async (req, res) => {
    try {
      const result = await ensureStoreAccess(db, req.params.id, req.authContext.userId, req.authContext.actorRole);
      if (!result.store) {
        return res.status(404).json({ error: 'Store not found.' });
      }

      if (!result.allowed) {
        return res.status(403).json({ error: 'You do not have access to this store.' });
      }

      return res.json({
        store: sanitizeStore(result.store)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.put('/stores/:id', requireInternal, async (req, res) => {
    try {
      const result = await ensureStoreAccess(db, req.params.id, req.authContext.userId, req.authContext.actorRole);
      if (!result.store) {
        return res.status(404).json({ error: 'Store not found.' });
      }

      if (!result.allowed) {
        return res.status(403).json({ error: 'You do not have access to this store.' });
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
          req.body.custom_domain || result.store.custom_domain,
          req.body.logo_url || result.store.logo_url,
          req.body.theme_color || result.store.theme_color,
          theme.store_type,
          theme.template_key,
          theme.font_preset,
          req.body.support_email || result.store.support_email,
          req.body.contact_phone || result.store.contact_phone,
          typeof req.body.is_active === 'undefined' ? result.store.is_active : Number(Boolean(req.body.is_active)),
          req.body.ssl_status || result.store.ssl_status,
          req.params.id
        ]
      );

      const rows = await db.query('SELECT * FROM stores WHERE id = ?', [req.params.id]);
      const store = rows[0];
      await bus.publish(EVENT_NAMES.STORE_UPDATED, {
        store_id: store.id,
        owner_id: store.owner_id,
        custom_domain: store.custom_domain
      });

      return res.json({
        store: sanitizeStore(store)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/settings', requireInternal, async (req, res) => {
    try {
      const result = await ensureStoreAccess(db, req.authContext.storeId, req.authContext.userId, req.authContext.actorRole);
      if (!result.allowed || !result.store) {
        return res.status(403).json({ error: 'You do not have access to this store.' });
      }

      return res.json({
        store: sanitizeStore(result.store)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.put('/settings', requireInternal, async (req, res) => {
    req.params.id = req.authContext.storeId;
    return app._router.handle(req, res, () => undefined);
  });
};

module.exports = {
  registerRoutes
};
