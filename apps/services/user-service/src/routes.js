const {
  hashPassword,
  comparePassword,
  signPlatformToken,
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES
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

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.post('/auth/register', async (req, res) => {
    try {
      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const requestedRole = String(req.body.role || PLATFORM_ROLES.STORE_OWNER).trim().toLowerCase();
      const role = allowedRoles.includes(requestedRole) ? requestedRole : PLATFORM_ROLES.STORE_OWNER;

      if (!name || !email || password.length < 8) {
        return res.status(400).json({
          error: 'Name, email, and a password of at least 8 characters are required.'
        });
      }

      const existing = await db.query('SELECT id FROM platform_users WHERE email = ?', [email]);
      if (existing.length) {
        return res.status(409).json({ error: 'A platform user with this email already exists.' });
      }

      const passwordHash = await hashPassword(password);
      const result = await db.execute(
        'INSERT INTO platform_users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
        [name, email, passwordHash, role, 'active']
      );
      const created = await db.query('SELECT * FROM platform_users WHERE id = ?', [result.insertId]);
      const user = created[0];
      const token = signPlatformToken(user, config.jwtSecret);

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
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/auth/login', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const rows = await db.query('SELECT * FROM platform_users WHERE email = ?', [email]);
      const user = rows[0];

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const passwordMatches = await comparePassword(password, user.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const token = signPlatformToken(user, config.jwtSecret);
      return res.json({
        token,
        user: sanitizeUser(user)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/auth/me', requireInternal, async (req, res) => {
    try {
      if (!req.authContext.userId) {
        return res.status(401).json({ error: 'No authenticated platform user.' });
      }

      const rows = await db.query('SELECT * FROM platform_users WHERE id = ?', [req.authContext.userId]);
      const user = rows[0];
      if (!user) {
        return res.status(404).json({ error: 'Platform user not found.' });
      }

      return res.json({
        user: sanitizeUser(user)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/users', requireInternal, async (req, res) => {
    try {
      if (req.authContext.actorRole !== PLATFORM_ROLES.PLATFORM_OWNER) {
        return res.status(403).json({ error: 'Only platform owners can create backoffice users.' });
      }

      const role = String(req.body.role || '').trim().toLowerCase();
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Unsupported platform role.' });
      }

      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      if (!name || !email || password.length < 8) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
      }

      const existing = await db.query('SELECT id FROM platform_users WHERE email = ?', [email]);
      if (existing.length) {
        return res.status(409).json({ error: 'A platform user with this email already exists.' });
      }

      const passwordHash = await hashPassword(password);
      const result = await db.execute(
        'INSERT INTO platform_users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
        [name, email, passwordHash, role, 'active']
      );
      const created = await db.query('SELECT * FROM platform_users WHERE id = ?', [result.insertId]);
      return res.status(201).json({
        user: sanitizeUser(created[0])
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/users', requireInternal, async (req, res) => {
    try {
      if (![PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(req.authContext.actorRole)) {
        return res.status(403).json({ error: 'You do not have access to the platform user directory.' });
      }

      const users = await db.query('SELECT * FROM platform_users ORDER BY created_at DESC');
      return res.json({
        users: users.map(sanitizeUser)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  registerRoutes
};
