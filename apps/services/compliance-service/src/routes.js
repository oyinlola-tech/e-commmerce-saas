const {
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES
} = require('../../../../packages/shared');

const allowedReviewRoles = [PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT];

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.post('/compliance/kyc', requireInternal, async (req, res) => {
    try {
      if (req.authContext.actorType !== 'platform_user') {
        return res.status(403).json({ error: 'Only platform users can submit KYC.' });
      }

      const ownerId = Number(req.authContext.userId);
      const firstName = String(req.body.first_name || '').trim();
      const lastName = String(req.body.last_name || '').trim();
      if (!ownerId || !firstName || !lastName) {
        return res.status(400).json({ error: 'first_name and last_name are required.' });
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
          firstName,
          lastName,
          req.body.bvn || null,
          req.body.country || null,
          JSON.stringify(req.body.metadata || {})
        ]
      );

      const profile = (await db.query('SELECT * FROM kyc_profiles WHERE owner_id = ?', [ownerId]))[0];
      await bus.publish(EVENT_NAMES.KYC_SUBMITTED, {
        owner_id: ownerId,
        profile_id: profile.id
      });

      return res.status(201).json({ kyc_profile: profile });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/compliance/kyb', requireInternal, async (req, res) => {
    try {
      const ownerId = Number(req.authContext.userId);
      const businessName = String(req.body.business_name || '').trim();
      if (!ownerId || !businessName) {
        return res.status(400).json({ error: 'business_name is required.' });
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
          businessName,
          req.body.registration_number || null,
          req.body.country || null,
          JSON.stringify(req.body.metadata || {})
        ]
      );

      const profile = (await db.query('SELECT * FROM kyb_profiles WHERE owner_id = ?', [ownerId]))[0];
      await bus.publish(EVENT_NAMES.KYB_SUBMITTED, {
        owner_id: ownerId,
        store_id: profile.store_id,
        profile_id: profile.id
      });

      return res.status(201).json({ kyb_profile: profile });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/compliance/documents', requireInternal, async (req, res) => {
    try {
      const ownerId = Number(req.authContext.userId);
      const profileType = String(req.body.profile_type || '').trim().toLowerCase();
      const profileId = Number(req.body.profile_id);
      const documentType = String(req.body.document_type || '').trim();
      const fileUrl = String(req.body.file_url || '').trim();

      if (!ownerId || !profileId || !documentType || !fileUrl || !['kyc', 'kyb'].includes(profileType)) {
        return res.status(400).json({ error: 'profile_type, profile_id, document_type, and file_url are required.' });
      }

      const result = await db.execute(
        `
          INSERT INTO compliance_documents (owner_id, store_id, profile_type, profile_id, document_type, file_url, status)
          VALUES (?, ?, ?, ?, ?, ?, 'uploaded')
        `,
        [ownerId, req.body.store_id || null, profileType, profileId, documentType, fileUrl]
      );
      const rows = await db.query('SELECT * FROM compliance_documents WHERE id = ?', [result.insertId]);
      return res.status(201).json({ document: rows[0] });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/compliance/me', requireInternal, async (req, res) => {
    try {
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
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/compliance/submissions', requireInternal, async (req, res) => {
    try {
      const actorRole = req.authContext.actorRole;
      const ownerId = Number(req.authContext.userId);

      const canViewAll = allowedReviewRoles.includes(actorRole);
      const ownerFilter = canViewAll && req.query.owner_id ? Number(req.query.owner_id) : ownerId;

      const kycProfiles = await db.query(
        `SELECT * FROM kyc_profiles ${canViewAll || ownerFilter ? 'WHERE owner_id = ?' : ''} ORDER BY updated_at DESC`,
        canViewAll && !req.query.owner_id ? [] : [ownerFilter]
      );
      const kybProfiles = await db.query(
        `SELECT * FROM kyb_profiles ${canViewAll || ownerFilter ? 'WHERE owner_id = ?' : ''} ORDER BY updated_at DESC`,
        canViewAll && !req.query.owner_id ? [] : [ownerFilter]
      );

      return res.json({
        kyc_profiles: kycProfiles,
        kyb_profiles: kybProfiles
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/compliance/reviews', requireInternal, async (req, res) => {
    try {
      if (!allowedReviewRoles.includes(req.authContext.actorRole)) {
        return res.status(403).json({ error: 'Only platform owners and support agents can review compliance records.' });
      }

      const targetType = String(req.body.target_type || '').trim().toLowerCase();
      const targetId = Number(req.body.target_id);
      const status = String(req.body.status || '').trim().toLowerCase();
      const ownerId = Number(req.body.owner_id);
      const storeId = req.body.store_id || null;
      const note = String(req.body.note || '').trim();

      if (!['kyc', 'kyb'].includes(targetType) || !targetId || !status || !ownerId) {
        return res.status(400).json({ error: 'target_type, target_id, owner_id, and status are required.' });
      }

      const targetTable = targetType === 'kyc' ? 'kyc_profiles' : 'kyb_profiles';
      await db.execute(`UPDATE ${targetTable} SET status = ? WHERE id = ?`, [status, targetId]);
      const result = await db.execute(
        `
          INSERT INTO compliance_reviews (owner_id, store_id, target_type, target_id, reviewer_user_id, reviewer_role, status, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [ownerId, storeId, targetType, targetId, req.authContext.userId, req.authContext.actorRole, status, note || null]
      );
      const review = (await db.query('SELECT * FROM compliance_reviews WHERE id = ?', [result.insertId]))[0];

      await bus.publish(EVENT_NAMES.COMPLIANCE_STATUS_CHANGED, {
        owner_id: ownerId,
        store_id: storeId,
        target_type: targetType,
        target_id: targetId,
        status
      });

      return res.status(201).json({ review });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  registerRoutes
};
