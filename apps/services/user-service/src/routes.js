const crypto = require('crypto');
const { body } = require('express-validator');
const {
  hashPassword,
  comparePassword,
  signPlatformToken,
  requireInternalRequest,
  buildSignedInternalHeaders,
  requestJson,
  EVENT_NAMES,
  PLATFORM_ROLES,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  commonRules,
  sanitizeEmail,
  sanitizePlainText
} = require('../../../../packages/shared');

const allowedRoles = Object.values(PLATFORM_ROLES);
const PASSWORD_RESET_OTP_TTL_MINUTES = Math.max(5, Number(process.env.PASSWORD_RESET_OTP_TTL_MINUTES || 15));
const PLATFORM_ADMIN_BOOTSTRAP_KEY = 'platform-admin-env';
const DEFAULT_PLATFORM_ADMIN_NAME = 'Platform Admin';
const DEFAULT_PLATFORM_ADMIN_PASSWORD = 'ChangeMe123!';
const DEFAULT_PLATFORM_ADMIN_EMAIL = 'platform-admin@example.com';

const sanitizeUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
};

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const normalizeEmail = (value = '') => {
  return sanitizeEmail(value || '');
};

const normalizeStatus = (value = '') => {
  return String(value || '').trim().toLowerCase();
};

const isLikelyEmailAddress = (value = '') => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
};

const buildBootstrapAdminEmail = (rootDomain = '') => {
  const normalizedRootDomain = String(rootDomain || '').trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normalizedRootDomain)) {
    return `admin@${normalizedRootDomain}`;
  }

  return DEFAULT_PLATFORM_ADMIN_EMAIL;
};

const buildGenericPasswordResetResponse = () => ({
  status: 'accepted',
  message: 'If that account exists, an OTP has been sent to the email address.'
});

const generateOtp = () => {
  return String(crypto.randomInt(100000, 1000000));
};

const getOtpExpiryDate = () => {
  return new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000);
};

const sendPasswordResetOtpEmail = async (config, requestId, payload = {}) => {
  try {
    await requestJson(`${config.serviceUrls.notification}/emails/send`, {
      method: 'POST',
      headers: buildSignedInternalHeaders({
        requestId: requestId || crypto.randomUUID(),
        actorType: 'service',
        actorRole: 'system',
        secret: config.internalSharedSecret
      }),
      body: {
        to: normalizeEmail(payload.email),
        template_key: 'platform.password_reset_otp',
        template_data: {
          name: sanitizePlainText(payload.name || 'there', { maxLength: 120 }) || 'there',
          otp: String(payload.otp || '').trim(),
          expires_in_minutes: PASSWORD_RESET_OTP_TTL_MINUTES
        },
        metadata: {
          kind: 'password_reset_otp',
          audience: 'platform_user'
        }
      },
      timeoutMs: config.requestTimeoutMs
    });
  } catch (error) {
    const upstreamMessage = typeof error?.payload === 'object' && error?.payload?.error
      ? error.payload.error
      : error.message;
    throw createHttpError(Number(error.status) || 503, upstreamMessage || 'Unable to send password reset email right now.', null, {
      expose: true
    });
  }
};

const upsertBootstrappedPlatformAdmin = async ({ db, logger, config }) => {
  const configuredName = sanitizePlainText(process.env.PLATFORM_ADMIN_NAME || DEFAULT_PLATFORM_ADMIN_NAME, {
    maxLength: 120
  }) || DEFAULT_PLATFORM_ADMIN_NAME;
  const requestedEmail = normalizeEmail(process.env.PLATFORM_ADMIN_EMAIL || '');
  const fallbackEmail = buildBootstrapAdminEmail(config.rootDomain);
  const configuredEmail = isLikelyEmailAddress(requestedEmail)
    ? requestedEmail
    : fallbackEmail;
  const configuredPassword = String(process.env.PLATFORM_ADMIN_PASSWORD || DEFAULT_PLATFORM_ADMIN_PASSWORD);

  if (!isLikelyEmailAddress(configuredEmail)) {
    throw new Error('PLATFORM_ADMIN_EMAIL must resolve to a valid email address for platform admin bootstrap.');
  }

  if (configuredPassword.length < 8) {
    throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 8 characters long.');
  }

  if (requestedEmail && !isLikelyEmailAddress(requestedEmail)) {
    logger.warn('PLATFORM_ADMIN_EMAIL is not a usable login email; falling back to a safe bootstrap email.', {
      requestedEmail,
      fallbackEmail: configuredEmail
    });
  }

  const existingBootstrapUser = (await db.query(
    'SELECT * FROM platform_users WHERE bootstrap_key = ? LIMIT 1',
    [PLATFORM_ADMIN_BOOTSTRAP_KEY]
  ))[0] || null;
  const existingEmailUser = (await db.query(
    'SELECT * FROM platform_users WHERE email = ? LIMIT 1',
    [configuredEmail]
  ))[0] || null;

  if (
    existingBootstrapUser
    && existingEmailUser
    && String(existingBootstrapUser.id) !== String(existingEmailUser.id)
  ) {
    throw new Error(`PLATFORM_ADMIN_EMAIL ${configuredEmail} is already assigned to a different platform user.`);
  }

  const targetUser = existingBootstrapUser || existingEmailUser;
  const passwordHash = await hashPassword(configuredPassword);

  if (targetUser) {
    await db.execute(
      `
        UPDATE platform_users
        SET name = ?, email = ?, password_hash = ?, role = ?, status = ?, bootstrap_key = ?
        WHERE id = ?
      `,
      [
        configuredName,
        configuredEmail,
        passwordHash,
        PLATFORM_ROLES.PLATFORM_OWNER,
        'active',
        PLATFORM_ADMIN_BOOTSTRAP_KEY,
        targetUser.id
      ]
    );

    logger.info('Bootstrapped platform admin user', {
      userId: targetUser.id,
      email: configuredEmail
    });
    return;
  }

  const result = await db.execute(
    `
      INSERT INTO platform_users (name, email, password_hash, role, bootstrap_key, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      configuredName,
      configuredEmail,
      passwordHash,
      PLATFORM_ROLES.PLATFORM_OWNER,
      PLATFORM_ADMIN_BOOTSTRAP_KEY,
      'active'
    ]
  );

  logger.info('Created bootstrapped platform admin user', {
    userId: result.insertId,
    email: configuredEmail
  });
};

const registerRoutes = async ({ app, db, bus, config, logger }) => {
  const requireInternal = buildRequireInternal(config);
  await upsertBootstrappedPlatformAdmin({ db, logger, config });

  app.post('/auth/register', validate([
    allowBodyFields(['name', 'email', 'password']),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password()
  ]), asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const role = PLATFORM_ROLES.STORE_OWNER;

    const existing = await db.query('SELECT id FROM platform_users WHERE email = ?', [email]);
    if (existing.length) {
      throw createHttpError(409, 'A platform user with this email already exists.', null, { expose: true });
    }

    const passwordHash = await hashPassword(password);
    const result = await db.execute(
      'INSERT INTO platform_users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
      [name, email, passwordHash, role, 'active']
    );
    const user = (await db.query('SELECT * FROM platform_users WHERE id = ?', [result.insertId]))[0];
    const token = signPlatformToken(user, config.jwtSecret, config.jwtAccessTtl);

    await bus.publish(EVENT_NAMES.USER_REGISTERED, {
      user_id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });

    return res.status(201).json({
      token,
      user: sanitizeUser(user)
    });
  }));

  app.post('/auth/login', validate([
    allowBodyFields(['email', 'password']),
    commonRules.email(),
    body('password').isString().notEmpty().withMessage('Password is required.')
  ]), asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = (await db.query('SELECT * FROM platform_users WHERE email = ?', [email]))[0];

    if (!user) {
      throw createHttpError(401, 'Invalid email or password.', null, { expose: true });
    }

    if (normalizeStatus(user.status) !== 'active') {
      throw createHttpError(403, 'This account is not active.', null, { expose: true });
    }

    const passwordMatches = await comparePassword(password, user.password_hash);
    if (!passwordMatches) {
      throw createHttpError(401, 'Invalid email or password.', null, { expose: true });
    }

    return res.json({
      token: signPlatformToken(user, config.jwtSecret, config.jwtAccessTtl),
      user: sanitizeUser(user)
    });
  }));

  app.post('/auth/password-reset/request', validate([
    allowBodyFields(['email']),
    commonRules.email()
  ]), asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const user = (await db.query('SELECT * FROM platform_users WHERE email = ? LIMIT 1', [email]))[0] || null;

    if (!user || normalizeStatus(user.status) !== 'active') {
      return res.json(buildGenericPasswordResetResponse());
    }

    const otp = generateOtp();
    const otpHash = await hashPassword(otp);
    const expiresAt = getOtpExpiryDate();

    await db.execute(
      `
        UPDATE platform_users
        SET password_reset_otp_hash = ?, password_reset_otp_expires_at = ?, password_reset_requested_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        otpHash,
        expiresAt,
        user.id
      ]
    );

    await sendPasswordResetOtpEmail(config, req.requestId, {
      email: user.email,
      name: user.name,
      otp
    });

    return res.json(buildGenericPasswordResetResponse());
  }));

  app.post('/auth/password-reset/confirm', validate([
    allowBodyFields(['email', 'otp', 'password']),
    commonRules.email(),
    body('otp')
      .isString()
      .trim()
      .isLength({ min: 4, max: 12 })
      .withMessage('Enter the OTP that was sent to your email.'),
    commonRules.password()
  ]), asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const password = String(req.body.password || '');
    const user = (await db.query('SELECT * FROM platform_users WHERE email = ? LIMIT 1', [email]))[0] || null;

    if (!user || !user.password_reset_otp_hash || !user.password_reset_otp_expires_at) {
      throw createHttpError(401, 'Invalid or expired OTP.', null, { expose: true });
    }

    if (normalizeStatus(user.status) !== 'active') {
      throw createHttpError(403, 'This account is not active.', null, { expose: true });
    }

    const expiresAt = new Date(user.password_reset_otp_expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await db.execute(
        `
          UPDATE platform_users
          SET password_reset_otp_hash = NULL, password_reset_otp_expires_at = NULL, password_reset_requested_at = NULL
          WHERE id = ?
        `,
        [user.id]
      );
      throw createHttpError(401, 'Invalid or expired OTP.', null, { expose: true });
    }

    const otpMatches = await comparePassword(otp, user.password_reset_otp_hash);
    if (!otpMatches) {
      throw createHttpError(401, 'Invalid or expired OTP.', null, { expose: true });
    }

    const passwordHash = await hashPassword(password);
    await db.execute(
      `
        UPDATE platform_users
        SET password_hash = ?, password_reset_otp_hash = NULL, password_reset_otp_expires_at = NULL, password_reset_requested_at = NULL
        WHERE id = ?
      `,
      [
        passwordHash,
        user.id
      ]
    );

    return res.json({
      status: 'ok'
    });
  }));

  app.get('/auth/me', requireInternal, asyncHandler(async (req, res) => {
    if (!req.authContext.userId) {
      throw createHttpError(401, 'No authenticated platform user.', null, { expose: true });
    }

    const user = (await db.query('SELECT * FROM platform_users WHERE id = ?', [req.authContext.userId]))[0];
    if (!user) {
      throw createHttpError(404, 'Platform user not found.', null, { expose: true });
    }

    return res.json({
      user: sanitizeUser(user)
    });
  }));

  app.post('/users', requireInternal, validate([
    allowBodyFields(['name', 'email', 'password', 'role']),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password(),
    body('role').isIn(allowedRoles)
  ]), asyncHandler(async (req, res) => {
    if (req.authContext.actorRole !== PLATFORM_ROLES.PLATFORM_OWNER) {
      throw createHttpError(403, 'Only platform owners can create backoffice users.', null, { expose: true });
    }

    const role = String(req.body.role || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    const existing = await db.query('SELECT id FROM platform_users WHERE email = ?', [email]);
    if (existing.length) {
      throw createHttpError(409, 'A platform user with this email already exists.', null, { expose: true });
    }

    const passwordHash = await hashPassword(password);
    const result = await db.execute(
      'INSERT INTO platform_users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
      [name, email, passwordHash, role, 'active']
    );
    const user = (await db.query('SELECT * FROM platform_users WHERE id = ?', [result.insertId]))[0];
    return res.status(201).json({
      user: sanitizeUser(user)
    });
  }));

  app.get('/users', requireInternal, asyncHandler(async (req, res) => {
    if (![PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(req.authContext.actorRole)) {
      throw createHttpError(403, 'You do not have access to the platform user directory.', null, { expose: true });
    }

    const users = await db.query('SELECT * FROM platform_users ORDER BY created_at DESC');
    return res.json({
      users: users.map(sanitizeUser)
    });
  }));
};

module.exports = {
  registerRoutes
};
