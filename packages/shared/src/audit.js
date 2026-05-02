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
    const [result] = await db.query(
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

    return result.insertId;
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

    // Continue with request
    next();

    // Log after response
    res.on('finish', async () => {
      const action = actionPrefix
        ? `${resourceType}.${actionPrefix}`
        : `${resourceType}.${req.method.toLowerCase()}`;

      const details = {};

      if (captureRequestBody && req.body) {
        // Redact sensitive fields
        const { password, secret_key, password_hash, ...safe } = req.body;
        details.request = safe;
      }

      if (captureResponseBody) {
        details.response_preview = responseBody?.slice(0, 500);
      }

      await createAuditLog(req.db || req.app.get('db'), {
        actorType: req.authContext?.actor_type || 'system',
        actorId: req.authContext?.user_id || req.authContext?.customer_id,
        action,
        resourceType,
        resourceId: req.params.id || req.body?.id,
        storeId: req.storeContext?.store?.id,
        details,
        req,
        status: res.statusCode >= 400 ? 'failure' : 'success'
      });
    });
  };
};

module.exports = {
  createAuditLog,
  auditMiddleware
};
