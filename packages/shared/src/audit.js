/**
 * Audit Logging Module
 * Tracks critical actions for compliance and security auditing
 * Actions logged:
 * - User/store owner authentication
 * - Data modifications (product create/update/delete)
 * - Payment configuration changes
 * - Store settings updates
 * - Admin actions
 */

const SENSITIVE_AUDIT_FIELDS = new Set([
  'password',
  'password_hash',
  'secret_key',
  'webhook_secret_hash',
  'authorization_code',
  'token',
  'access_token',
  'refresh_token'
]);

const redactAuditPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  return Object.entries(payload).reduce((accumulator, [key, value]) => {
    accumulator[key] = SENSITIVE_AUDIT_FIELDS.has(String(key || '').trim().toLowerCase())
      ? '[redacted]'
      : value;
    return accumulator;
  }, {});
};

const normalizeInsertResult = (result) => {
  if (Array.isArray(result)) {
    return result[0] || null;
  }

  return result || null;
};

const createAuditLog = async (db, {
  actorType,          // 'platform_user', 'store_owner', 'customer', 'system'
  actorId,            // User/customer ID
  action,             // e.g., 'product.created', 'order.confirmed', 'auth.login_failed'
  resourceType,       // e.g., 'product', 'order', 'store'
  resourceId,         // ID of affected resource
  storeId,            // Store context (null for platform actions)
  details,            // Additional context as JSON
  req,                // Express request for IP/UA
  status = 'success'  // 'success' or 'failure'
}) => {
  if (!db) {
    console.error('Audit log: Database not initialized');
    return null;
  }

  try {
    const runner = typeof db.execute === 'function'
      ? db.execute.bind(db)
      : db.query.bind(db);
    const rawResult = await runner(
      `INSERT INTO audit_logs 
       (actor_type, actor_id, action, resource_type, resource_id, store_id, details, ip_address, user_agent, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        actorType,
        actorId || null,
        action,
        resourceType || null,
        resourceId || null,
        storeId || null,
        JSON.stringify(details || {}),
        req?.ip || 'unknown',
        req?.get('user-agent') || 'unknown',
        status
      ]
    );
    const result = normalizeInsertResult(rawResult);

    return result?.insertId || null;
  } catch (error) {
    console.error('Failed to create audit log', {
      action,
      error: error.message
    });
    // Don't throw - audit logging should never break functionality
    return null;
  }
};

/**
 * Audit middleware for Express
 * Automatically logs requests to specific routes
 */
const auditMiddleware = (options = {}) => {
  const {
    resourceType,
    actionPrefix = '',
    captureRequestBody = false,
    captureResponseBody = false
  } = options;

  return async (req, res, next) => {
    const originalSend = res.send.bind(res);
    let responseBody;

    // Intercept response to log if needed
    res.send = (body) => {
      if (captureResponseBody && typeof body === 'string') {
        responseBody = body.slice(0, 1000); // Limit size
      }
      return originalSend(body);
    };

    // Log after response
    res.on('finish', async () => {
      const action = actionPrefix
        ? `${resourceType}.${actionPrefix}`
        : `${resourceType}.${req.method.toLowerCase()}`;

      const details = {};

      if (captureRequestBody && req.body) {
        details.request = redactAuditPayload(req.body);
      }

      if (captureResponseBody) {
        details.response_preview = responseBody?.slice(0, 500);
      }

      await createAuditLog(req.db || req.app.get('db'), {
        actorType: req.authContext?.actorType || req.authContext?.actor_type || 'system',
        actorId: req.authContext?.userId || req.authContext?.user_id || req.authContext?.customerId || req.authContext?.customer_id,
        action,
        resourceType,
        resourceId: req.params.id || req.body?.id,
        storeId: req.storeContext?.store?.id || req.authContext?.storeId || req.authContext?.store_id || null,
        details,
        req,
        status: res.statusCode >= 400 ? 'failure' : 'success'
      });
    });

    // Continue with request
    next();
  };
};

module.exports = {
  createAuditLog,
  auditMiddleware
};
