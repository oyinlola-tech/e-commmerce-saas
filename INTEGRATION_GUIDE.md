# Integration Guide: Security & Feature Modules

This guide explains how to integrate the new production-ready modules into your Aisle Commerce platform.

---

## 1. WEBHOOK SIGNATURE VERIFICATION

### Integration into Payment Service

```javascript
// apps/services/payment-service/src/routes.js

const { verifyWebhookSignature } = require('./webhook-security');
const {
  requireInternalRequest,
  createHttpError,
  asyncHandler
} = require('../../../../packages/shared');

// Get the secret key based on provider and scope
const getWebhookSecretKey = async (db, provider, storeId, paymentScope) => {
  if (paymentScope === 'subscription') {
    // Use platform secret
    return String(process.env.PAYSTACK_PLATFORM_SECRET_KEY || '').trim() ||
           String(process.env.FLUTTERWAVE_PLATFORM_SECRET_KEY || '').trim();
  }

  // Use store-specific secret
  const [[config]] = await db.query(
    'SELECT secret_key_encrypted FROM payment_provider_configs WHERE store_id = ? AND provider = ?',
    [storeId, provider]
  );

  if (!config) {
    return null;
  }

  // Decrypt using your encryption key
  return decryptText(config.secret_key_encrypted, process.env.ENCRYPTION_KEY);
};

// Webhook endpoint
app.post('/payments/webhooks/:provider', 
  [param('provider').isIn(['paystack', 'flutterwave', 'stripe'])],
  asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const logger = req.log;

    // Determine store ID from webhook payload
    let storeId;
    let paymentScope = 'payment'; // or 'subscription'

    if (provider === 'paystack') {
      // Extract from metadata
      storeId = req.body?.data?.metadata?.store_id;
      paymentScope = req.body?.data?.metadata?.payment_scope || 'payment';
    } else if (provider === 'flutterwave') {
      storeId = req.body?.data?.customer?.customer_code?.store_id;
    }

    // Get secret key
    const secretKey = await getWebhookSecretKey(db, provider, storeId, paymentScope);

    if (!secretKey) {
      logger.warn('Webhook secret not configured', { provider, storeId });
      // Return 200 to prevent provider retries, but log the failure
      return res.json({ received: true, verified: false, reason: 'secret_not_configured' });
    }

    // Verify signature
    let isValid;
    try {
      isValid = verifyWebhookSignature({
        provider,
        req,
        secretKey,
        rawBody: req.rawBody // For Stripe compatibility
      });
    } catch (error) {
      logger.error('Webhook verification error', { provider, error: error.message });
      return res.json({ received: true, verified: false, reason: 'verification_error' });
    }

    if (!isValid) {
      logger.warn('Invalid webhook signature', {
        provider,
        storeId,
        signature: req.headers['x-paystack-signature'] || req.headers['verif-hash'],
        ip: req.ip
      });

      // Log to audit
      await createAuditLog(db, {
        actorType: 'system',
        action: 'webhook.signature_invalid',
        resourceType: 'payment_webhook',
        storeId,
        details: { provider, ip: req.ip },
        status: 'failure'
      });

      return res.json({ received: true, verified: false });
    }

    // Log successful verification
    await createAuditLog(db, {
      actorType: 'system',
      action: 'webhook.verified',
      resourceType: 'payment_webhook',
      storeId,
      details: { provider },
      status: 'success'
    });

    // Process webhook
    await processPaymentWebhook(req, res, { provider, storeId, paymentScope });
  })
);
```

**Update package.json to handle raw body for Stripe:**

```javascript
// In middleware setup
app.use(express.raw({ type: 'application/json', limit: '2mb' })); // Stripe needs raw body
app.use((req, res, next) => {
  if (req.body instanceof Buffer) {
    req.rawBody = req.body;
    req.body = JSON.parse(req.body);
  }
  next();
});
```

---

## 2. SECURE FILE UPLOADS

### Integration into Store Service

```javascript
// apps/services/store-service/src/routes.js

const multer = require('multer');
const {
  validateUploadedFile,
  generateSafeFilename,
  saveFile,
  deleteFile
} = require('./file-upload-security');
const { createAuditLog } = require('../../../../packages/shared/src/audit');

// Configure multer for memory storage
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
    files: 1
  }
});

const getLogoUploadDirectory = (config) => {
  return process.env.STORE_LOGO_UPLOAD_DIR
    ? path.resolve(process.env.STORE_LOGO_UPLOAD_DIR)
    : path.join(config.workspaceRoot, 'uploads', 'logos');
};

// Update store endpoint with file upload
app.put('/stores/:id', 
  logoUpload.single('logo'),
  asyncHandler(async (req, res) => {
    const storeId = req.params.id;
    const { userId, role } = req.authContext;

    // Verify access
    const [store] = await db.query('SELECT * FROM stores WHERE id = ?', [storeId]);

    if (!store) {
      throw createHttpError(404, 'Store not found.');
    }

    // Check authorization
    if (role === 'store_owner' && String(store.owner_id) !== String(userId)) {
      throw createHttpError(403, 'You cannot modify this store.');
    }

    // Handle logo upload
    let logoUrl = store.logo_url; // Keep existing if no new upload
    let oldLogoFilename = null;

    if (req.file) {
      try {
        // Validate and sanitize
        const sanitizedBuffer = await validateUploadedFile(
          req.file.buffer,
          req.file.mimetype
        );

        // Extract filename from old URL
        if (store.logo_url) {
          oldLogoFilename = path.basename(store.logo_url);
        }

        // Generate safe filename
        const filename = generateSafeFilename(storeId, req.file.mimetype);

        // Save file
        const uploadDir = getLogoUploadDirectory(config);
        logoUrl = await saveFile(sanitizedBuffer, uploadDir, filename);

        // Delete old file
        if (oldLogoFilename) {
          try {
            await deleteFile(uploadDir, oldLogoFilename);
          } catch (error) {
            logger.warn('Failed to delete old logo', { storeId, filename: oldLogoFilename });
          }
        }

        // Log upload
        await createAuditLog(db, {
          actorType: 'platform_user',
          actorId: userId,
          action: 'store.logo_uploaded',
          resourceType: 'store',
          resourceId: storeId,
          storeId,
          details: { filename, size: sanitizedBuffer.length, mimeType: req.file.mimetype },
          req,
          status: 'success'
        });

      } catch (error) {
        // Log failure
        await createAuditLog(db, {
          actorType: 'platform_user',
          actorId: userId,
          action: 'store.logo_upload_failed',
          resourceType: 'store',
          resourceId: storeId,
          storeId,
          details: { error: error.message },
          req,
          status: 'failure'
        });

        if (error.status) {
          return res.status(error.status).json({ error: error.message });
        }
        throw error;
      }
    }

    // Update store with new logo URL
    const updates = { ...req.body, logo_url: logoUrl };
    
    await db.query(
      'UPDATE stores SET ? WHERE id = ?',
      [updates, storeId]
    );

    res.json({ success: true, logo_url: logoUrl });
  })
);
```

---

## 3. AUDIT LOGGING

### Add to All Critical Actions

```javascript
// In any service route that modifies data

const { createAuditLog, auditMiddleware } = require('../../../../packages/shared/src/audit');

// Option 1: Manual logging
app.post('/products', asyncHandler(async (req, res) => {
  const [result] = await db.query(
    'INSERT INTO products (store_id, name, price, ...) VALUES (?, ?, ?, ...)',
    [req.storeContext.store.id, req.body.name, req.body.price, ...]
  );

  // Log the action
  await createAuditLog(db, {
    actorType: 'platform_user',
    actorId: req.authContext.user_id,
    action: 'product.created',
    resourceType: 'product',
    resourceId: result.insertId,
    storeId: req.storeContext.store.id,
    details: {
      name: req.body.name,
      price: req.body.price,
      sku: req.body.sku
    },
    req,
    status: 'success'
  });

  res.json({ id: result.insertId });
}));

// Option 2: Using middleware
app.put('/products/:id',
  auditMiddleware({
    resourceType: 'product',
    actionPrefix: 'updated',
    captureRequestBody: true
  }),
  asyncHandler(async (req, res) => {
    // Update logic here
    // Audit is logged automatically by middleware
  })
);

// Query audit logs
app.get('/audit-logs', requireAdmin, asyncHandler(async (req, res) => {
  const { action, storeId, limit = 100, offset = 0 } = req.query;

  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (action) {
    query += ' AND action LIKE ?';
    params.push(`${action}%`);
  }

  if (storeId) {
    query += ' AND store_id = ?';
    params.push(storeId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const [logs] = await db.query(query, params);

  res.json(logs);
}));
```

---

## 4. RUNNING MIGRATIONS

### Option A: On Application Boot

```javascript
// In apps/gateway/server.js or apps/web/app.js

const { runMigrations } = require('../database/migrations');

const bootstrap = async () => {
  // ... existing setup ...

  // Run migrations
  if (process.env.RUN_MIGRATIONS !== 'false') {
    try {
      await runMigrations(db, false); // false = run UP migrations
      logger.info('Migrations completed successfully');
    } catch (error) {
      logger.error('Migration failed', { error: error.message });
      // Don't exit - non-critical tables might already exist
    }
  }

  // ... rest of bootstrap ...
};
```

### Option B: Manual Migration Script

```bash
# Create scripts/migrate.js
node scripts/migrate.js --up    # Run UP migrations
node scripts/migrate.js --down  # Run DOWN migrations (rollback)
```

```javascript
// scripts/migrate.js
const { createServiceConfig, createLogger, createDatabase } = require('../packages/shared');
const { runMigrations } = require('../database/migrations');

const main = async () => {
  const direction = process.argv[2];
  const isDown = direction === '--down';

  const config = createServiceConfig({});
  const logger = createLogger('migrations');
  const db = await createDatabase(config, logger);

  try {
    await runMigrations(db, isDown);
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', error);
    process.exit(1);
  }
};

main();
```

---

## 5. ENVIRONMENT VARIABLES

Add these to your `.env` files:

```env
# File Upload Storage (optional - uses local disk if not set)
STORE_LOGO_UPLOAD_DIR=/data/uploads/logos

# Security
ENCRYPTION_KEY=your_encryption_key_for_payment_secrets

# Payment Provider Secrets (already should exist)
PAYSTACK_PLATFORM_SECRET_KEY=sk_live_xxxxx
PAYSTACK_PLATFORM_PUBLIC_KEY=pk_live_xxxxx
FLUTTERWAVE_PLATFORM_SECRET_KEY=FLWSECK_TEST_xxxxx
FLUTTERWAVE_PLATFORM_PUBLIC_KEY=FLWPUBK_TEST_xxxxx

# Email Configuration (for abandoned cart recovery)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.xxxxx
SENDER_EMAIL=noreply@yourdomain.com
```

---

## 6. DEPENDENCY UPDATES

Add these to `package.json` in root and apps/services/* as needed:

```json
{
  "dependencies": {
    "sharp": "^0.33.0",
    "file-type": "^18.5.0",
    "express-rate-limit": "^6.10.0"
  }
}
```

Run: `npm install`

---

## 7. DATABASE SETUP

Run migrations to create all tables:

```sql
-- Or use the migration script above
-- The migrations.js file will create all required tables
```

Verify tables were created:

```sql
SHOW TABLES LIKE 'audit_logs';
SHOW TABLES LIKE 'store_onboarding%';
SHOW TABLES LIKE 'product_reviews';
SHOW TABLES LIKE 'product_categories';
```

---

## 8. TESTING

### Test Webhook Verification

```bash
# Test Paystack signature
curl -X POST http://localhost:4108/payments/webhooks/paystack \
  -H "Content-Type: application/json" \
  -H "X-Paystack-Signature: $(echo -n '{...}' | openssl dgst -sha512 -hmac 'your_secret' | sed 's/^.* //')" \
  -d '{...}'

# Test without signature (should fail gracefully)
curl -X POST http://localhost:4108/payments/webhooks/paystack \
  -H "Content-Type: application/json" \
  -d '{...}'
```

### Test File Upload

```bash
# Create test image
convert -size 100x100 xc:red test.png

# Upload with validation
curl -X PUT http://localhost:4102/stores/1 \
  -F "logo=@test.png" \
  -H "Authorization: Bearer $TOKEN"
```

### Test Audit Logging

```sql
-- Query audit logs
SELECT * FROM audit_logs WHERE action LIKE 'product.%' ORDER BY created_at DESC;
SELECT * FROM audit_logs WHERE store_id = 1 AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR);
```

---

## 9. MONITORING & OBSERVABILITY

### Audit Log Dashboard Query

```sql
-- Failed authentications in last 24 hours
SELECT COUNT(*) as failed_logins, ip_address
FROM audit_logs
WHERE action = 'auth.login_failed'
  AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY ip_address
ORDER BY failed_logins DESC
LIMIT 10;

-- Recent data modifications
SELECT action, COUNT(*) as count, store_id
FROM audit_logs
WHERE actor_type = 'platform_user'
  AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY action, store_id
ORDER BY created_at DESC;

-- Webhook failures
SELECT provider, COUNT(*) as failures, MAX(created_at) as last_failure
FROM audit_logs
WHERE action = 'webhook.signature_invalid'
  AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY provider;
```

---

## Next Steps

1. **Install dependencies**: `npm install sharp file-type express-rate-limit`
2. **Run migrations**: `node scripts/migrate.js --up`
3. **Integrate modules** into payment and store services using examples above
4. **Update environment variables** in all deployment environments
5. **Test webhooks** with real payment providers
6. **Enable audit logging** in admin dashboard
7. **Monitor logs** for security events

All modules are now production-ready!
