const { body } = require('express-validator');
const {
  hashPassword,
  comparePassword,
  signPlatformToken,
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  commonRules
} = require('../../../../packages/shared');

const allowedRoles = Object.values(PLATFORM_ROLES);

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

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.post('/auth/register', validate([
    allowBodyFields(['name', 'email', 'password', 'role']),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password(),
    body('role').optional().isIn(allowedRoles)
  ]), asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const requestedRole = String(req.body.role || PLATFORM_ROLES.STORE_OWNER).trim().toLowerCase();
    const role = allowedRoles.includes(requestedRole) ? requestedRole : PLATFORM_ROLES.STORE_OWNER;

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

    if (user.role === PLATFORM_ROLES.STORE_OWNER) {
      await bus.publish(EVENT_NAMES.USER_REGISTERED, {
        user_id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      });
    }

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
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = (await db.query('SELECT * FROM platform_users WHERE email = ?', [email]))[0];

    if (!user) {
      throw createHttpError(401, 'Invalid email or password.', null, { expose: true });
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
    const email = String(req.body.email || '').trim().toLowerCase();
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
