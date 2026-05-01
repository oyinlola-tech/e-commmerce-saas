const { body, query } = require('express-validator');
const {
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  allowQueryFields,
  commonRules,
  sanitizeJsonObject,
  sanitizePlainText
} = require('../../../../packages/shared');

const allowedReviewRoles = [PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT];

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const normalizeStatus = (value = '') => {
  return sanitizePlainText(value, { maxLength: 40 }).toLowerCase();
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/compliance/kyc', requireInternal, validate([
    allowBodyFields(['first_name', 'last_name', 'bvn', 'country', 'metadata']),
    commonRules.plainText('first_name', 120),
    commonRules.plainText('last_name', 120),
    commonRules.optionalPlainText('bvn', 40),
    commonRules.optionalPlainText('country', 120),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    if (req.authContext.actorType !== 'platform_user') {
      throw createHttpError(403, 'Only platform users can submit KYC.', null, { expose: true });
    }

    const ownerId = Number(req.authContext.userId);
    if (!ownerId) {
      throw createHttpError(400, 'Authenticated owner context is required.', null, { expose: true });
    }

    await db.execute(
      `
        INSERT INTO kyc_profiles (owner_id, first_name, last_name, bvn, country, status, metadata)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
        ON DUPLICATE KEY UPDATE
          first_name = VALUES(first_name),
          last_name = VALUES(last_name),
          bvn = VALUES(bvn),
          country = VALUES(country),
          status = 'pending',
          metadata = VALUES(metadata)
      `,
      [
        ownerId,
        req.body.first_name,
        req.body.last_name,
        req.body.bvn || null,
        req.body.country || null,
        JSON.stringify(sanitizeJsonObject(req.body.metadata || {}))
      ]
    );

    const profile = (await db.query('SELECT * FROM kyc_profiles WHERE owner_id = ?', [ownerId]))[0];
    await bus.publish(EVENT_NAMES.KYC_SUBMITTED, {
      owner_id: ownerId,
      profile_id: profile.id
    });

    return res.status(201).json({ kyc_profile: profile });
  }));

  app.post('/compliance/kyb', requireInternal, validate([
    allowBodyFields(['store_id', 'business_name', 'registration_number', 'country', 'metadata']),
    body('store_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    commonRules.plainText('business_name', 150),
    commonRules.optionalPlainText('registration_number', 120),
    commonRules.optionalPlainText('country', 120),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    const ownerId = Number(req.authContext.userId);
    if (!ownerId) {
      throw createHttpError(400, 'Authenticated owner context is required.', null, { expose: true });
    }

    await db.execute(
      `
        INSERT INTO kyb_profiles (owner_id, store_id, business_name, registration_number, country, status, metadata)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
        ON DUPLICATE KEY UPDATE
          store_id = VALUES(store_id),
          business_name = VALUES(business_name),
          registration_number = VALUES(registration_number),
          country = VALUES(country),
          status = 'pending',
          metadata = VALUES(metadata)
      `,
      [
        ownerId,
        req.body.store_id || null,
        req.body.business_name,
        req.body.registration_number || null,
        req.body.country || null,
        JSON.stringify(sanitizeJsonObject(req.body.metadata || {}))
      ]
    );

    const profile = (await db.query('SELECT * FROM kyb_profiles WHERE owner_id = ?', [ownerId]))[0];
    await bus.publish(EVENT_NAMES.KYB_SUBMITTED, {
      owner_id: ownerId,
      store_id: profile.store_id,
      profile_id: profile.id
    });

    return res.status(201).json({ kyb_profile: profile });
  }));

  app.post('/compliance/documents', requireInternal, validate([
    allowBodyFields(['store_id', 'profile_type', 'profile_id', 'document_type', 'file_url']),
    body('store_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    body('profile_type').isIn(['kyc', 'kyb']),
    body('profile_id').isInt({ min: 1 }).toInt(),
    commonRules.plainText('document_type', 120),
    body('file_url').customSanitizer((value) => sanitizePlainText(value, { maxLength: 255 })).notEmpty().withMessage('file_url is required.')
  ]), asyncHandler(async (req, res) => {
    const ownerId = Number(req.authContext.userId);
    if (!ownerId) {
      throw createHttpError(400, 'Authenticated owner context is required.', null, { expose: true });
    }

    const result = await db.execute(
      `
        INSERT INTO compliance_documents (owner_id, store_id, profile_type, profile_id, document_type, file_url, status)
        VALUES (?, ?, ?, ?, ?, ?, 'uploaded')
      `,
      [
        ownerId,
        req.body.store_id || null,
        req.body.profile_type,
        req.body.profile_id,
        req.body.document_type,
        req.body.file_url
      ]
    );

    const rows = await db.query('SELECT * FROM compliance_documents WHERE id = ?', [result.insertId]);
    return res.status(201).json({ document: rows[0] });
  }));

  app.get('/compliance/me', requireInternal, asyncHandler(async (req, res) => {
    const ownerId = Number(req.authContext.userId);
    const kycProfile = (await db.query('SELECT * FROM kyc_profiles WHERE owner_id = ?', [ownerId]))[0] || null;
    const kybProfile = (await db.query('SELECT * FROM kyb_profiles WHERE owner_id = ?', [ownerId]))[0] || null;
    const documents = await db.query('SELECT * FROM compliance_documents WHERE owner_id = ? ORDER BY created_at DESC', [ownerId]);
    const reviews = await db.query('SELECT * FROM compliance_reviews WHERE owner_id = ? ORDER BY created_at DESC', [ownerId]);

    return res.json({
      kyc_profile: kycProfile,
      kyb_profile: kybProfile,
      documents,
      reviews
    });
  }));

  app.get('/compliance/submissions', requireInternal, validate([
    allowQueryFields(['owner_id']),
    query('owner_id').optional().isInt({ min: 1 }).toInt()
  ]), asyncHandler(async (req, res) => {
    const actorRole = req.authContext.actorRole;
    const ownerId = Number(req.authContext.userId);
    const canViewAll = allowedReviewRoles.includes(actorRole);
    const requestedOwnerId = req.query.owner_id ? Number(req.query.owner_id) : null;
    const effectiveOwnerId = canViewAll
      ? requestedOwnerId
      : ownerId;

    const whereClause = effectiveOwnerId ? 'WHERE owner_id = ?' : '';
    const values = effectiveOwnerId ? [effectiveOwnerId] : [];
    const kycProfiles = await db.query(
      `SELECT * FROM kyc_profiles ${whereClause} ORDER BY updated_at DESC`,
      values
    );
    const kybProfiles = await db.query(
      `SELECT * FROM kyb_profiles ${whereClause} ORDER BY updated_at DESC`,
      values
    );

    return res.json({
      kyc_profiles: kycProfiles,
      kyb_profiles: kybProfiles
    });
  }));

  app.post('/compliance/reviews', requireInternal, validate([
    allowBodyFields(['target_type', 'target_id', 'status', 'owner_id', 'store_id', 'note']),
    body('target_type').isIn(['kyc', 'kyb']),
    body('target_id').isInt({ min: 1 }).toInt(),
    body('status').isIn(['pending', 'approved', 'rejected', 'monitoring']),
    body('owner_id').isInt({ min: 1 }).toInt(),
    body('store_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    commonRules.optionalPlainText('note', 2000)
  ]), asyncHandler(async (req, res) => {
    if (!allowedReviewRoles.includes(req.authContext.actorRole)) {
      throw createHttpError(403, 'Only platform owners and support agents can review compliance records.', null, { expose: true });
    }

    const targetTable = req.body.target_type === 'kyc'
      ? 'kyc_profiles'
      : 'kyb_profiles';
    const status = normalizeStatus(req.body.status);

    await db.execute(`UPDATE ${targetTable} SET status = ? WHERE id = ?`, [status, req.body.target_id]);
    const result = await db.execute(
      `
        INSERT INTO compliance_reviews (owner_id, store_id, target_type, target_id, reviewer_user_id, reviewer_role, status, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.body.owner_id,
        req.body.store_id || null,
        req.body.target_type,
        req.body.target_id,
        req.authContext.userId,
        req.authContext.actorRole,
        status,
        req.body.note || null
      ]
    );
    const review = (await db.query('SELECT * FROM compliance_reviews WHERE id = ?', [result.insertId]))[0];

    await bus.publish(EVENT_NAMES.COMPLIANCE_STATUS_CHANGED, {
      owner_id: req.body.owner_id,
      store_id: req.body.store_id || null,
      target_type: req.body.target_type,
      target_id: req.body.target_id,
      status
    });

    return res.status(201).json({ review });
  }));
};

module.exports = {
  registerRoutes
};
