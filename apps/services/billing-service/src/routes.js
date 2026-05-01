const {
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES
} = require('../../../../packages/shared');

const createTrialDates = () => {
  const now = new Date();
  const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    trialEnds,
    currentPeriodEnd
  };
};

const isSubscriptionAllowed = (subscription) => {
  return subscription && ['trialing', 'active'].includes(String(subscription.status || '').toLowerCase());
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.get('/subscriptions/me', requireInternal, async (req, res) => {
    try {
      const rows = await db.query('SELECT * FROM subscriptions WHERE owner_id = ?', [req.authContext.userId]);
      return res.json({
        subscription: rows[0] || null
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/subscriptions', requireInternal, async (req, res) => {
    try {
      const ownerId = Number(req.body.owner_id || req.authContext.userId);
      const plan = String(req.body.plan || 'basic').trim().toLowerCase();
      const status = String(req.body.status || 'active').trim().toLowerCase();
      const { trialEnds, currentPeriodEnd } = createTrialDates();

      await db.execute(
        `
          INSERT INTO subscriptions (owner_id, plan, status, trial_ends_at, current_period_end)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            plan = VALUES(plan),
            status = VALUES(status),
            trial_ends_at = VALUES(trial_ends_at),
            current_period_end = VALUES(current_period_end)
        `,
        [ownerId, plan, status, trialEnds, currentPeriodEnd]
      );

      const subscription = (await db.query('SELECT * FROM subscriptions WHERE owner_id = ?', [ownerId]))[0];
      await bus.publish(EVENT_NAMES.SUBSCRIPTION_CHANGED, {
        owner_id: ownerId,
        plan: subscription.plan,
        status: subscription.status
      });

      return res.status(201).json({ subscription });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/subscriptions/cancel', requireInternal, async (req, res) => {
    try {
      const ownerId = Number(req.authContext.userId);
      await db.execute('UPDATE subscriptions SET status = ? WHERE owner_id = ?', ['cancelled', ownerId]);
      const subscription = (await db.query('SELECT * FROM subscriptions WHERE owner_id = ?', [ownerId]))[0] || null;

      await bus.publish(EVENT_NAMES.SUBSCRIPTION_CHANGED, {
        owner_id: ownerId,
        status: 'cancelled',
        plan: subscription?.plan || null
      });

      return res.json({ subscription });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/internal/subscriptions/check', requireInternal, async (req, res) => {
    try {
      const ownerId = Number(req.query.owner_id || req.authContext.userId);
      const subscription = (await db.query('SELECT * FROM subscriptions WHERE owner_id = ?', [ownerId]))[0] || null;
      return res.json({
        allowed: isSubscriptionAllowed(subscription),
        subscription
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/subscriptions/:ownerId', requireInternal, async (req, res) => {
    try {
      if (![PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(req.authContext.actorRole)) {
        return res.status(403).json({ error: 'Only platform staff can inspect another owner subscription.' });
      }

      const subscription = (await db.query('SELECT * FROM subscriptions WHERE owner_id = ?', [req.params.ownerId]))[0] || null;
      return res.json({ subscription });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  registerRoutes,
  isSubscriptionAllowed,
  createTrialDates
};
