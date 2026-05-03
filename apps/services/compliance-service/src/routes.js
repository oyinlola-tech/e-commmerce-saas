const { body, query } = require('express-validator');
const {
  requireInternalRequest,
  encryptText,
  decryptText,
  EVENT_NAMES,
  PLATFORM_ROLES,
  createAuditLog,
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

const sensitiveViewQueryValues = new Set(['1', 'true', 'yes']);

const getComplianceEncryptionSecret = (config) => {
  return String(
    process.env.COMPLIANCE_DATA_ENCRYPTION_KEY
    || process.env.COMPLIANCE_ENCRYPTION_KEY
    || config.internalSharedSecret
    || ''
  ).trim();
};

const parseStoredJson = (value, fallback = null) => {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const shouldIncludeSensitiveData = (req) => {
  return sensitiveViewQueryValues.has(String(req.query.include_sensitive || '').trim().toLowerCase());
};

const assertSensitiveViewAccess = (req) => {
  if (!shouldIncludeSensitiveData(req)) {
    return false;
  }

  if (!allowedReviewRoles.includes(req.authContext.actorRole)) {
    throw createHttpError(403, 'Only compliance reviewers can request sensitive compliance fields.', null, { expose: true });
  }

  return true;
};

const encryptComplianceValue = (value, secret) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const payload = typeof value === 'string'
    ? value
    : JSON.stringify(value);
  return encryptText(payload, secret);
};

const decryptComplianceValue = (value, secret, options = {}) => {
  if (!value) {
    return options.defaultValue === undefined ? null : options.defaultValue;
  }

  try {
    const decrypted = decryptText(value, secret);
    if (options.json) {
      return parseStoredJson(decrypted, options.defaultValue === undefined ? {} : options.defaultValue);
    }

    return decrypted;
  } catch {
    return options.defaultValue === undefined ? null : options.defaultValue;
  }
};

const maskName = (value = '') => {
  const clean = sanitizePlainText(value, { maxLength: 120 });
  if (!clean) {
    return null;
  }

  if (clean.length === 1) {
    return `${clean}*`;
  }

  return `${clean.charAt(0)}${'*'.repeat(Math.min(6, Math.max(1, clean.length - 1)))}`;
};

const maskIdentifier = (value = '', keepEnd = 4, maxLength = 120) => {
  const clean = sanitizePlainText(value, { maxLength });
  if (!clean) {
    return null;
  }

  if (clean.length <= keepEnd) {
    return `${'*'.repeat(clean.length)}`;
  }

  return `${'*'.repeat(Math.max(2, clean.length - keepEnd))}${clean.slice(-keepEnd)}`;
};

const maskBusinessName = (value = '') => {
  const clean = sanitizePlainText(value, { maxLength: 180 });
  if (!clean) {
    return null;
  }

  if (clean.length <= 3) {
    return `${clean.charAt(0)}**`;
  }

  return `${clean.slice(0, 2)}${'*'.repeat(Math.min(8, Math.max(2, clean.length - 2)))}`;
};

const buildMetadataSummary = (value = {}) => {
  const metadata = sanitizeJsonObject(value || {});
  const keys = Object.keys(metadata).slice(0, 20);
  return {
    encrypted: true,
    key_count: keys.length,
    keys
  };
};

const extractDocumentLabel = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'document';
  }

  const withoutQuery = normalized.split('?')[0];
  const parts = withoutQuery.split('/').filter(Boolean);
  const lastPart = sanitizePlainText(parts[parts.length - 1] || 'document', { maxLength: 120 });
  return lastPart || 'document';
};

const buildKycRecordPayload = (payload = {}, secret) => {
  const metadata = sanitizeJsonObject(payload.metadata || {});
  return {
    first_name: maskName(payload.first_name || '') || 'Redacted',
    first_name_encrypted: encryptComplianceValue(payload.first_name || '', secret),
    last_name: maskName(payload.last_name || '') || 'Redacted',
    last_name_encrypted: encryptComplianceValue(payload.last_name || '', secret),
    bvn: maskIdentifier(payload.bvn || '', 4, 40),
    bvn_encrypted: encryptComplianceValue(payload.bvn || '', secret),
    country: sanitizePlainText(payload.country || '', { maxLength: 120 }) || null,
    country_encrypted: encryptComplianceValue(payload.country || '', secret),
    metadata: JSON.stringify(buildMetadataSummary(metadata)),
    metadata_encrypted: encryptComplianceValue(metadata, secret)
  };
};

const buildKybRecordPayload = (payload = {}, secret) => {
  const metadata = sanitizeJsonObject(payload.metadata || {});
  return {
    business_name: maskBusinessName(payload.business_name || '') || 'Redacted',
    business_name_encrypted: encryptComplianceValue(payload.business_name || '', secret),
    registration_number: maskIdentifier(payload.registration_number || '', 4, 120),
    registration_number_encrypted: encryptComplianceValue(payload.registration_number || '', secret),
    country: sanitizePlainText(payload.country || '', { maxLength: 120 }) || null,
    country_encrypted: encryptComplianceValue(payload.country || '', secret),
    metadata: JSON.stringify(buildMetadataSummary(metadata)),
    metadata_encrypted: encryptComplianceValue(metadata, secret)
  };
};

const buildDocumentRecordPayload = (payload = {}, secret) => {
  const fileLabel = extractDocumentLabel(payload.file_url || '');
  return {
    file_url: `encrypted:${fileLabel}`,
    file_url_encrypted: encryptComplianceValue(payload.file_url || '', secret)
  };
};

const serializeKycProfile = (row, secret, options = {}) => {
  if (!row) {
    return null;
  }

  const includeSensitive = Boolean(options.includeSensitive);
  return {
    id: row.id,
    owner_id: row.owner_id,
    status: row.status,
    first_name: includeSensitive
      ? (decryptComplianceValue(row.first_name_encrypted, secret) || row.first_name)
      : row.first_name,
    last_name: includeSensitive
      ? (decryptComplianceValue(row.last_name_encrypted, secret) || row.last_name)
      : row.last_name,
    bvn: includeSensitive
      ? (decryptComplianceValue(row.bvn_encrypted, secret) || row.bvn)
      : row.bvn,
    country: includeSensitive
      ? (decryptComplianceValue(row.country_encrypted, secret) || row.country)
      : row.country,
    metadata: includeSensitive
      ? decryptComplianceValue(row.metadata_encrypted, secret, { json: true, defaultValue: {} })
      : (parseStoredJson(row.metadata, {}) || {}),
    has_sensitive_payload: Boolean(
      row.first_name_encrypted
      || row.last_name_encrypted
      || row.bvn_encrypted
      || row.country_encrypted
      || row.metadata_encrypted
    ),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

const serializeKybProfile = (row, secret, options = {}) => {
  if (!row) {
    return null;
  }

  const includeSensitive = Boolean(options.includeSensitive);
  return {
    id: row.id,
    owner_id: row.owner_id,
    store_id: row.store_id,
    status: row.status,
    business_name: includeSensitive
      ? (decryptComplianceValue(row.business_name_encrypted, secret) || row.business_name)
      : row.business_name,
    registration_number: includeSensitive
      ? (decryptComplianceValue(row.registration_number_encrypted, secret) || row.registration_number)
      : row.registration_number,
    country: includeSensitive
      ? (decryptComplianceValue(row.country_encrypted, secret) || row.country)
      : row.country,
    metadata: includeSensitive
      ? decryptComplianceValue(row.metadata_encrypted, secret, { json: true, defaultValue: {} })
      : (parseStoredJson(row.metadata, {}) || {}),
    has_sensitive_payload: Boolean(
      row.business_name_encrypted
      || row.registration_number_encrypted
      || row.country_encrypted
      || row.metadata_encrypted
    ),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

const serializeComplianceDocument = (row, secret, options = {}) => {
  if (!row) {
    return null;
  }

  const includeSensitive = Boolean(options.includeSensitive);
  return {
    id: row.id,
    owner_id: row.owner_id,
    store_id: row.store_id,
    profile_type: row.profile_type,
    profile_id: row.profile_id,
    document_type: row.document_type,
    file_url: includeSensitive
      ? (decryptComplianceValue(row.file_url_encrypted, secret) || row.file_url)
      : row.file_url,
    status: row.status,
    has_sensitive_payload: Boolean(row.file_url_encrypted),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

const serializeComplianceReview = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    owner_id: row.owner_id,
    store_id: row.store_id,
    target_type: row.target_type,
    target_id: row.target_id,
    reviewer_user_id: row.reviewer_user_id,
    reviewer_role: row.reviewer_role,
    status: row.status,
    note: row.note || null,
    created_at: row.created_at
  };
};

const getProfileByType = async (db, profileType, profileId) => {
  const tableName = profileType === 'kyc'
    ? 'kyc_profiles'
    : 'kyb_profiles';
  const rows = await db.query(`SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`, [profileId]);
  return rows[0] || null;
};

const assertProfileOwnership = (profile, ownerId) => {
  if (!profile || String(profile.owner_id || '') !== String(ownerId || '')) {
    throw createHttpError(404, 'Compliance profile not found for this owner.', null, { expose: true });
  }
};

const backfillSensitiveComplianceData = async (db, config) => {
  const secret = getComplianceEncryptionSecret(config);

  const kycProfiles = await db.query('SELECT * FROM kyc_profiles');
  for (const profile of kycProfiles) {
    if (profile.first_name_encrypted && profile.last_name_encrypted && profile.metadata_encrypted) {
      continue;
    }

    const payload = buildKycRecordPayload({
      first_name: profile.first_name,
      last_name: profile.last_name,
      bvn: profile.bvn,
      country: profile.country,
      metadata: parseStoredJson(profile.metadata, {})
    }, secret);
    await db.execute(
      `
        UPDATE kyc_profiles
        SET first_name = ?, first_name_encrypted = ?, last_name = ?, last_name_encrypted = ?, bvn = ?,
            bvn_encrypted = ?, country = ?, country_encrypted = ?, metadata = ?, metadata_encrypted = ?
        WHERE id = ?
      `,
      [
        payload.first_name,
        payload.first_name_encrypted,
        payload.last_name,
        payload.last_name_encrypted,
        payload.bvn,
        payload.bvn_encrypted,
        payload.country,
        payload.country_encrypted,
        payload.metadata,
        payload.metadata_encrypted,
        profile.id
      ]
    );
  }

  const kybProfiles = await db.query('SELECT * FROM kyb_profiles');
  for (const profile of kybProfiles) {
    if (profile.business_name_encrypted && profile.metadata_encrypted) {
      continue;
    }

    const payload = buildKybRecordPayload({
      business_name: profile.business_name,
      registration_number: profile.registration_number,
      country: profile.country,
      metadata: parseStoredJson(profile.metadata, {})
    }, secret);
    await db.execute(
      `
        UPDATE kyb_profiles
        SET business_name = ?, business_name_encrypted = ?, registration_number = ?,
            registration_number_encrypted = ?, country = ?, country_encrypted = ?, metadata = ?,
            metadata_encrypted = ?
        WHERE id = ?
      `,
      [
        payload.business_name,
        payload.business_name_encrypted,
        payload.registration_number,
        payload.registration_number_encrypted,
        payload.country,
        payload.country_encrypted,
        payload.metadata,
        payload.metadata_encrypted,
        profile.id
      ]
    );
  }

  const documents = await db.query('SELECT * FROM compliance_documents');
  for (const document of documents) {
    if (document.file_url_encrypted) {
      continue;
    }

    const payload = buildDocumentRecordPayload({
      file_url: document.file_url
    }, secret);
    await db.execute(
      'UPDATE compliance_documents SET file_url = ?, file_url_encrypted = ? WHERE id = ?',
      [payload.file_url, payload.file_url_encrypted, document.id]
    );
  }
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);
  const encryptionSecret = getComplianceEncryptionSecret(config);
  await backfillSensitiveComplianceData(db, config);

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

    const profilePayload = buildKycRecordPayload(req.body, encryptionSecret);
    await db.execute(
      `
        INSERT INTO kyc_profiles (
          owner_id, first_name, first_name_encrypted, last_name, last_name_encrypted, bvn, bvn_encrypted,
          country, country_encrypted, status, metadata, metadata_encrypted
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON DUPLICATE KEY UPDATE
          first_name = VALUES(first_name),
          first_name_encrypted = VALUES(first_name_encrypted),
          last_name = VALUES(last_name),
          last_name_encrypted = VALUES(last_name_encrypted),
          bvn = VALUES(bvn),
          bvn_encrypted = VALUES(bvn_encrypted),
          country = VALUES(country),
          country_encrypted = VALUES(country_encrypted),
          status = 'pending',
          metadata = VALUES(metadata),
          metadata_encrypted = VALUES(metadata_encrypted)
      `,
      [
        ownerId,
        profilePayload.first_name,
        profilePayload.first_name_encrypted,
        profilePayload.last_name,
        profilePayload.last_name_encrypted,
        profilePayload.bvn,
        profilePayload.bvn_encrypted,
        profilePayload.country,
        profilePayload.country_encrypted,
        profilePayload.metadata,
        profilePayload.metadata_encrypted
      ]
    );

    const profile = (await db.query('SELECT * FROM kyc_profiles WHERE owner_id = ?', [ownerId]))[0];
    await bus.publish(EVENT_NAMES.KYC_SUBMITTED, {
      owner_id: ownerId,
      profile_id: profile.id
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: ownerId,
      action: 'compliance.kyc_submitted',
      resourceType: 'kyc_profile',
      resourceId: profile.id,
      details: {
        owner_id: ownerId,
        has_bvn: Boolean(req.body.bvn),
        metadata_keys: Object.keys(sanitizeJsonObject(req.body.metadata || {})).slice(0, 20)
      },
      req
    });

    return res.status(201).json({ kyc_profile: serializeKycProfile(profile, encryptionSecret) });
  }));

  app.post('/compliance/kyb', requireInternal, validate([
    allowBodyFields(['store_id', 'business_name', 'registration_number', 'country', 'metadata']),
    body('store_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    commonRules.plainText('business_name', 150),
    commonRules.optionalPlainText('registration_number', 120),
    commonRules.optionalPlainText('country', 120),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    if (req.authContext.actorType !== 'platform_user') {
      throw createHttpError(403, 'Only platform users can submit KYB.', null, { expose: true });
    }

    const ownerId = Number(req.authContext.userId);
    if (!ownerId) {
      throw createHttpError(400, 'Authenticated owner context is required.', null, { expose: true });
    }

    const profilePayload = buildKybRecordPayload(req.body, encryptionSecret);
    await db.execute(
      `
        INSERT INTO kyb_profiles (
          owner_id, store_id, business_name, business_name_encrypted, registration_number,
          registration_number_encrypted, country, country_encrypted, status, metadata, metadata_encrypted
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON DUPLICATE KEY UPDATE
          store_id = VALUES(store_id),
          business_name = VALUES(business_name),
          business_name_encrypted = VALUES(business_name_encrypted),
          registration_number = VALUES(registration_number),
          registration_number_encrypted = VALUES(registration_number_encrypted),
          country = VALUES(country),
          country_encrypted = VALUES(country_encrypted),
          status = 'pending',
          metadata = VALUES(metadata),
          metadata_encrypted = VALUES(metadata_encrypted)
      `,
      [
        ownerId,
        req.body.store_id || null,
        profilePayload.business_name,
        profilePayload.business_name_encrypted,
        profilePayload.registration_number,
        profilePayload.registration_number_encrypted,
        profilePayload.country,
        profilePayload.country_encrypted,
        profilePayload.metadata,
        profilePayload.metadata_encrypted
      ]
    );

    const profile = (await db.query('SELECT * FROM kyb_profiles WHERE owner_id = ?', [ownerId]))[0];
    await bus.publish(EVENT_NAMES.KYB_SUBMITTED, {
      owner_id: ownerId,
      store_id: profile.store_id,
      profile_id: profile.id
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: ownerId,
      action: 'compliance.kyb_submitted',
      resourceType: 'kyb_profile',
      resourceId: profile.id,
      storeId: profile.store_id || null,
      details: {
        owner_id: ownerId,
        store_id: profile.store_id || null,
        has_registration_number: Boolean(req.body.registration_number),
        metadata_keys: Object.keys(sanitizeJsonObject(req.body.metadata || {})).slice(0, 20)
      },
      req
    });

    return res.status(201).json({ kyb_profile: serializeKybProfile(profile, encryptionSecret) });
  }));

  app.post('/compliance/documents', requireInternal, validate([
    allowBodyFields(['store_id', 'profile_type', 'profile_id', 'document_type', 'file_url']),
    body('store_id').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
    body('profile_type').isIn(['kyc', 'kyb']),
    body('profile_id').isInt({ min: 1 }).toInt(),
    commonRules.plainText('document_type', 120),
    body('file_url').customSanitizer((value) => sanitizePlainText(value, { maxLength: 255 })).notEmpty().withMessage('file_url is required.')
  ]), asyncHandler(async (req, res) => {
    if (req.authContext.actorType !== 'platform_user') {
      throw createHttpError(403, 'Only platform users can upload compliance documents.', null, { expose: true });
    }

    const ownerId = Number(req.authContext.userId);
    if (!ownerId) {
      throw createHttpError(400, 'Authenticated owner context is required.', null, { expose: true });
    }

    const profile = await getProfileByType(db, req.body.profile_type, req.body.profile_id);
    assertProfileOwnership(profile, ownerId);
    if (req.body.profile_type === 'kyb' && String(profile.store_id || '') !== String(req.body.store_id || profile.store_id || '')) {
      throw createHttpError(409, 'The selected KYB profile does not match the provided store.', null, { expose: true });
    }

    const documentPayload = buildDocumentRecordPayload(req.body, encryptionSecret);
    const result = await db.execute(
      `
        INSERT INTO compliance_documents (
          owner_id, store_id, profile_type, profile_id, document_type, file_url, file_url_encrypted, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded')
      `,
      [
        ownerId,
        profile.store_id || req.body.store_id || null,
        req.body.profile_type,
        req.body.profile_id,
        req.body.document_type,
        documentPayload.file_url,
        documentPayload.file_url_encrypted
      ]
    );

    const rows = await db.query('SELECT * FROM compliance_documents WHERE id = ?', [result.insertId]);
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: ownerId,
      action: 'compliance.document_uploaded',
      resourceType: 'compliance_document',
      resourceId: result.insertId,
      storeId: profile.store_id || req.body.store_id || null,
      details: {
        owner_id: ownerId,
        profile_type: req.body.profile_type,
        profile_id: req.body.profile_id,
        document_type: req.body.document_type
      },
      req
    });

    return res.status(201).json({ document: serializeComplianceDocument(rows[0], encryptionSecret) });
  }));

  app.get('/compliance/me', requireInternal, validate([
    allowQueryFields(['include_sensitive']),
    query('include_sensitive').optional().isString()
  ]), asyncHandler(async (req, res) => {
    if (req.authContext.actorType !== 'platform_user') {
      throw createHttpError(403, 'Only platform users can access compliance profiles.', null, { expose: true });
    }

    const ownerId = Number(req.authContext.userId);
    if (!ownerId) {
      throw createHttpError(400, 'Authenticated owner context is required.', null, { expose: true });
    }

    const includeSensitive = assertSensitiveViewAccess(req);
    const kycProfile = (await db.query('SELECT * FROM kyc_profiles WHERE owner_id = ?', [ownerId]))[0] || null;
    const kybProfile = (await db.query('SELECT * FROM kyb_profiles WHERE owner_id = ?', [ownerId]))[0] || null;
    const documents = await db.query('SELECT * FROM compliance_documents WHERE owner_id = ? ORDER BY created_at DESC', [ownerId]);
    const reviews = await db.query('SELECT * FROM compliance_reviews WHERE owner_id = ? ORDER BY created_at DESC', [ownerId]);

    if (includeSensitive) {
      await createAuditLog(db, {
        actorType: req.authContext.actorType || 'platform_user',
        actorId: req.authContext.userId || null,
        action: 'compliance.sensitive_viewed',
        resourceType: 'compliance_profile',
        resourceId: ownerId,
        details: {
          scope: 'self',
          owner_id: ownerId
        },
        req
      });
    }

    return res.json({
      kyc_profile: serializeKycProfile(kycProfile, encryptionSecret, { includeSensitive }),
      kyb_profile: serializeKybProfile(kybProfile, encryptionSecret, { includeSensitive }),
      documents: documents.map((row) => serializeComplianceDocument(row, encryptionSecret, { includeSensitive })),
      reviews: reviews.map(serializeComplianceReview)
    });
  }));

  app.get('/compliance/submissions', requireInternal, validate([
    allowQueryFields(['owner_id', 'include_sensitive']),
    query('owner_id').optional().isInt({ min: 1 }).toInt(),
    query('include_sensitive').optional().isString()
  ]), asyncHandler(async (req, res) => {
    if (req.authContext.actorType !== 'platform_user') {
      throw createHttpError(403, 'Only platform users can access compliance submissions.', null, { expose: true });
    }

    const actorRole = req.authContext.actorRole;
    const ownerId = Number(req.authContext.userId);
    const includeSensitive = assertSensitiveViewAccess(req);
    const canViewAll = allowedReviewRoles.includes(actorRole);
    if (!canViewAll && !ownerId) {
      throw createHttpError(400, 'Authenticated owner context is required.', null, { expose: true });
    }

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
    const documents = await db.query(
      `SELECT * FROM compliance_documents ${whereClause} ORDER BY updated_at DESC, id DESC`,
      values
    );
    const reviews = effectiveOwnerId
      ? await db.query('SELECT * FROM compliance_reviews WHERE owner_id = ? ORDER BY created_at DESC', [effectiveOwnerId])
      : [];

    if (includeSensitive) {
      await createAuditLog(db, {
        actorType: req.authContext.actorType || 'platform_user',
        actorId: req.authContext.userId || null,
        action: 'compliance.sensitive_viewed',
        resourceType: 'compliance_submission',
        resourceId: effectiveOwnerId || null,
        details: {
          scope: canViewAll ? 'review_queue' : 'self',
          owner_id: effectiveOwnerId || null
        },
        req
      });
    }

    return res.json({
      kyc_profiles: kycProfiles.map((row) => serializeKycProfile(row, encryptionSecret, { includeSensitive })),
      kyb_profiles: kybProfiles.map((row) => serializeKybProfile(row, encryptionSecret, { includeSensitive })),
      documents: documents.map((row) => serializeComplianceDocument(row, encryptionSecret, { includeSensitive })),
      reviews: reviews.map(serializeComplianceReview)
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
    const targetProfile = await getProfileByType(db, req.body.target_type, req.body.target_id);
    if (!targetProfile) {
      throw createHttpError(404, 'Compliance profile not found.', null, { expose: true });
    }

    if (String(targetProfile.owner_id || '') !== String(req.body.owner_id || '')) {
      throw createHttpError(409, 'The selected compliance profile does not match the owner in the review payload.', null, { expose: true });
    }

    if (req.body.target_type === 'kyb' && String(targetProfile.store_id || '') !== String(req.body.store_id || targetProfile.store_id || '')) {
      throw createHttpError(409, 'The selected KYB profile does not match the store in the review payload.', null, { expose: true });
    }

    if (req.body.target_type === 'kyc' && req.body.store_id) {
      throw createHttpError(409, 'KYC reviews cannot be attached to a store-specific payload.', null, { expose: true });
    }

    await db.execute(`UPDATE ${targetTable} SET status = ? WHERE id = ?`, [status, req.body.target_id]);
    const result = await db.execute(
      `
        INSERT INTO compliance_reviews (owner_id, store_id, target_type, target_id, reviewer_user_id, reviewer_role, status, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        targetProfile.owner_id,
        targetProfile.store_id || null,
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
      owner_id: targetProfile.owner_id,
      store_id: targetProfile.store_id || null,
      target_type: req.body.target_type,
      target_id: req.body.target_id,
      status
    });
    await createAuditLog(db, {
      actorType: req.authContext.actorType || 'platform_user',
      actorId: req.authContext.userId || null,
      action: 'compliance.review_recorded',
      resourceType: 'compliance_review',
      resourceId: result.insertId,
      storeId: targetProfile.store_id || null,
      details: {
        owner_id: targetProfile.owner_id,
        target_type: req.body.target_type,
        target_id: req.body.target_id,
        status
      },
      req
    });

    return res.status(201).json({ review: serializeComplianceReview(review) });
  }));
};

module.exports = {
  registerRoutes
};
