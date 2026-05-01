const { body, query, param } = require('express-validator');
const {
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES,
  buildSignedInternalHeaders,
  requestJson,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  sanitizeEmail
} = require('../../../../packages/shared');
const {
  DEFAULT_CURRENCY,
  getBillingPlans,
  getBillingPlan,
  getPlanPrice,
  getPeriodEnd
} = require('./plans');

const TRIAL_DAYS = 14;

const createTrialDates = () => {
  const now = new Date();
  const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const currentPeriodEnd = getPeriodEnd('monthly', now);
  return {
    trialEnds,
    currentPeriodEnd
  };
};

const isSubscriptionAllowed = (subscription) => {
  return subscription && ['trialing', 'active'].includes(String(subscription.status || '').toLowerCase());
};

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const serializeSubscription = (subscription) => {
  if (!subscription) {
    return null;
  }

  return {
    ...subscription,
    plan_amount: Number(subscription.plan_amount || 0),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end)
  };
};

const serializeInvoice = (invoice) => {
  if (!invoice) {
    return null;
  }

  return {
    ...invoice,
    amount: Number(invoice.amount || 0),
    metadata: invoice.metadata ? JSON.parse(invoice.metadata) : {}
  };
};

const resolveOwnerId = (req) => {
  if ([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(req.authContext.actorRole) && req.body.owner_id) {
    return Number(req.body.owner_id);
  }

  return Number(req.authContext.userId || req.body.owner_id);
};

const getOwnerSubscription = async (db, ownerId) => {
  return (await db.query('SELECT * FROM subscriptions WHERE owner_id = ?', [ownerId]))[0] || null;
};

const getLatestInvoice = async (db, ownerId) => {
  return (await db.query(
    'SELECT * FROM invoices WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1',
    [ownerId]
  ))[0] || null;
};

const getOwnerInvoices = async (db, ownerId) => {
  return db.query(
    'SELECT * FROM invoices WHERE owner_id = ? ORDER BY created_at DESC',
    [ownerId]
  );
};

const buildPaymentHeaders = (req, config) => {
  return buildSignedInternalHeaders({
    requestId: req.requestId,
    userId: req.authContext.userId,
    actorRole: req.authContext.actorRole,
    actorType: 'platform_user',
    secret: config.internalSharedSecret
  });
};

const createOrUpdateSubscription = async (db, ownerId, pricing, payload = {}, existingSubscription = null) => {
  const nextStatus = existingSubscription
    ? (['active', 'trialing'].includes(existingSubscription.status) ? existingSubscription.status : 'pending_payment')
    : 'pending_payment';

  await db.execute(
    `
      INSERT INTO subscriptions (
        owner_id, plan, status, billing_cycle, currency, plan_amount, billing_email, provider, payment_reference,
        started_at, cancel_at_period_end, cancelled_at, trial_ends_at, current_period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
      ON DUPLICATE KEY UPDATE
        plan = VALUES(plan),
        status = VALUES(status),
        billing_cycle = VALUES(billing_cycle),
        currency = VALUES(currency),
        plan_amount = VALUES(plan_amount),
        billing_email = VALUES(billing_email),
        provider = VALUES(provider),
        payment_reference = VALUES(payment_reference),
        cancel_at_period_end = 0,
        cancelled_at = NULL,
        trial_ends_at = IF(status = 'trialing', VALUES(trial_ends_at), trial_ends_at),
        current_period_end = VALUES(current_period_end)
    `,
    [
      ownerId,
      pricing.code,
      nextStatus,
      pricing.billing_cycle,
      pricing.currency,
      pricing.amount,
      payload.email || existingSubscription?.billing_email || null,
      payload.provider || existingSubscription?.provider || null,
      existingSubscription?.payment_reference || null,
      existingSubscription?.started_at || null,
      existingSubscription?.trial_ends_at || null,
      existingSubscription?.current_period_end || null
    ]
  );

  return getOwnerSubscription(db, ownerId);
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.get('/plans', asyncHandler(async (req, res) => {
    return res.json({
      plans: getBillingPlans()
    });
  }));

  app.get('/subscriptions/me', requireInternal, asyncHandler(async (req, res) => {
    const ownerId = Number(req.authContext.userId);
    const subscription = await getOwnerSubscription(db, ownerId);
    const latestInvoice = await getLatestInvoice(db, ownerId);
    return res.json({
      subscription: serializeSubscription(subscription),
      latest_invoice: serializeInvoice(latestInvoice)
    });
  }));

  app.get('/subscriptions/invoices', requireInternal, asyncHandler(async (req, res) => {
    const ownerId = Number(req.authContext.userId);
    const invoices = await getOwnerInvoices(db, ownerId);
    return res.json({
      invoices: invoices.map(serializeInvoice)
    });
  }));

  app.post('/subscriptions/checkout-session', requireInternal, validate([
    allowBodyFields(['plan', 'billing_cycle', 'provider', 'currency', 'email']),
    body('plan').isString().notEmpty(),
    body('billing_cycle').isIn(['monthly', 'yearly']),
    body('provider').optional().isIn(['paystack', 'flutterwave']),
    body('currency').optional().isLength({ min: 3, max: 3 }),
    body('email').optional().isEmail().customSanitizer((value) => sanitizeEmail(value))
  ]), asyncHandler(async (req, res) => {
    const ownerId = resolveOwnerId(req);
    if (!ownerId) {
      throw createHttpError(400, 'owner_id is required.', null, { expose: true });
    }

    const pricing = getPlanPrice(req.body.plan, req.body.billing_cycle);
    if (!pricing) {
      throw createHttpError(400, 'Unsupported subscription plan.', null, { expose: true });
    }

    const existingSubscription = await getOwnerSubscription(db, ownerId);
    const subscription = await createOrUpdateSubscription(db, ownerId, pricing, req.body, existingSubscription);
    const periodStart = subscription.current_period_end && new Date(subscription.current_period_end) > new Date()
      ? new Date(subscription.current_period_end)
      : new Date();
    const periodEnd = getPeriodEnd(pricing.billing_cycle, periodStart);

    const invoiceResult = await db.execute(
      `
        INSERT INTO invoices (
          owner_id, subscription_id, amount, currency, provider, status, payment_reference, provider_reference,
          description, period_start, period_end, metadata
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?, ?)
      `,
      [
        ownerId,
        subscription.id,
        pricing.amount,
        req.body.currency || pricing.currency || DEFAULT_CURRENCY,
        req.body.provider || 'paystack',
        `${pricing.name} ${pricing.billing_cycle} subscription`,
        periodStart,
        periodEnd,
        JSON.stringify({
          plan: pricing.code,
          billing_cycle: pricing.billing_cycle,
          owner_id: ownerId
        })
      ]
    );
    const invoice = (await db.query('SELECT * FROM invoices WHERE id = ?', [invoiceResult.insertId]))[0];

    const paymentSession = await requestJson(`${config.serviceUrls.payment}/payments/create-checkout-session`, {
      method: 'POST',
      headers: buildPaymentHeaders(req, config),
      body: {
        owner_id: ownerId,
        amount: pricing.amount,
        currency: req.body.currency || pricing.currency || DEFAULT_CURRENCY,
        provider: req.body.provider || 'paystack',
        email: req.body.email || subscription.billing_email || null,
        payment_scope: 'subscription',
        entity_type: 'invoice',
        entity_id: String(invoice.id),
        metadata: {
          invoice_id: invoice.id,
          subscription_id: subscription.id,
          plan: pricing.code,
          billing_cycle: pricing.billing_cycle
        }
      },
      timeoutMs: config.requestTimeoutMs
    });

    await db.execute(
      'UPDATE invoices SET payment_reference = ? WHERE id = ?',
      [paymentSession.payment.reference, invoice.id]
    );
    await db.execute(
      'UPDATE subscriptions SET payment_reference = ?, billing_email = ?, provider = ?, currency = ?, plan_amount = ? WHERE id = ?',
      [
        paymentSession.payment.reference,
        req.body.email || subscription.billing_email || null,
        req.body.provider || 'paystack',
        req.body.currency || pricing.currency || DEFAULT_CURRENCY,
        pricing.amount,
        subscription.id
      ]
    );

    const freshSubscription = await getOwnerSubscription(db, ownerId);
    const freshInvoice = (await db.query('SELECT * FROM invoices WHERE id = ?', [invoice.id]))[0];

    return res.status(201).json({
      subscription: serializeSubscription(freshSubscription),
      invoice: serializeInvoice(freshInvoice),
      payment: paymentSession.payment,
      providers: paymentSession.providers
    });
  }));

  app.post('/subscriptions', requireInternal, validate([
    allowBodyFields(['owner_id', 'plan', 'status', 'billing_cycle']),
    body('plan').optional().isString(),
    body('status').optional().isString(),
    body('billing_cycle').optional().isIn(['monthly', 'yearly'])
  ]), asyncHandler(async (req, res) => {
    const ownerId = Number(req.body.owner_id || req.authContext.userId);
    const planCode = String(req.body.plan || 'basic').trim().toLowerCase();
    const plan = getBillingPlan(planCode);
    if (!plan) {
      throw createHttpError(400, 'Unsupported subscription plan.', null, { expose: true });
    }

    const billingCycle = String(req.body.billing_cycle || 'monthly').trim().toLowerCase();
    const pricing = getPlanPrice(planCode, billingCycle);
    const { trialEnds, currentPeriodEnd } = createTrialDates();

    await db.execute(
      `
        INSERT INTO subscriptions (
          owner_id, plan, status, billing_cycle, currency, plan_amount, trial_ends_at, current_period_end
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          plan = VALUES(plan),
          status = VALUES(status),
          billing_cycle = VALUES(billing_cycle),
          currency = VALUES(currency),
          plan_amount = VALUES(plan_amount),
          trial_ends_at = VALUES(trial_ends_at),
          current_period_end = VALUES(current_period_end)
      `,
      [
        ownerId,
        plan.code,
        String(req.body.status || 'active').trim().toLowerCase(),
        billingCycle,
        pricing.currency,
        pricing.amount,
        trialEnds,
        currentPeriodEnd
      ]
    );

    const subscription = await getOwnerSubscription(db, ownerId);
    await bus.publish(EVENT_NAMES.SUBSCRIPTION_CHANGED, {
      owner_id: ownerId,
      plan: subscription.plan,
      status: subscription.status
    });

    return res.status(201).json({ subscription: serializeSubscription(subscription) });
  }));

  app.post('/subscriptions/cancel', requireInternal, validate([
    allowBodyFields([])
  ]), asyncHandler(async (req, res) => {
    const ownerId = Number(req.authContext.userId);
    const subscription = await getOwnerSubscription(db, ownerId);
    if (!subscription) {
      throw createHttpError(404, 'Subscription not found.', null, { expose: true });
    }

    const activeLike = ['active', 'trialing'].includes(String(subscription.status || '').toLowerCase());
    if (activeLike) {
      await db.execute(
        'UPDATE subscriptions SET cancel_at_period_end = 1, cancelled_at = NULL WHERE owner_id = ?',
        [ownerId]
      );
    } else {
      await db.execute(
        'UPDATE subscriptions SET status = ?, cancel_at_period_end = 0, cancelled_at = CURRENT_TIMESTAMP WHERE owner_id = ?',
        ['cancelled', ownerId]
      );
    }

    const updatedSubscription = await getOwnerSubscription(db, ownerId);
    await bus.publish(EVENT_NAMES.SUBSCRIPTION_CHANGED, {
      owner_id: ownerId,
      status: updatedSubscription?.status || 'cancelled',
      plan: updatedSubscription?.plan || null
    });

    return res.json({ subscription: serializeSubscription(updatedSubscription) });
  }));

  app.get('/internal/subscriptions/check', requireInternal, validate([
    query('owner_id').optional().isInt({ min: 1 }).toInt()
  ]), asyncHandler(async (req, res) => {
    const ownerId = Number(req.query.owner_id || req.authContext.userId);
    const subscription = await getOwnerSubscription(db, ownerId);
    return res.json({
      allowed: isSubscriptionAllowed(subscription),
      subscription: serializeSubscription(subscription)
    });
  }));

  app.get('/subscriptions/:ownerId', requireInternal, validate([
    param('ownerId').isInt({ min: 1 }).toInt()
  ]), asyncHandler(async (req, res) => {
    if (![PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(req.authContext.actorRole)) {
      throw createHttpError(403, 'Only platform staff can inspect another owner subscription.', null, { expose: true });
    }

    const ownerId = Number(req.params.ownerId);
    const subscription = await getOwnerSubscription(db, ownerId);
    const latestInvoice = await getLatestInvoice(db, ownerId);
    return res.json({
      subscription: serializeSubscription(subscription),
      latest_invoice: serializeInvoice(latestInvoice)
    });
  }));
};

module.exports = {
  registerRoutes,
  isSubscriptionAllowed,
  createTrialDates
};
