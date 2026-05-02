const { body, query, param } = require('express-validator');
const {
  requireInternalRequest,
  EVENT_NAMES,
  PLATFORM_ROLES,
  SUPPORTED_PLATFORM_CURRENCIES,
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
  TRIAL_DAYS,
  TRIAL_AUTHORIZATION_BASE_AMOUNT,
  calculateYearlyAmount,
  normalizePlanCode
} = require('./plans');
const {
  getKnownPlanCodes,
  getConfiguredPlanCurrencies,
  getStoragePlanCodes,
  getResolvedBillingPlans,
  getResolvedBillingPlan,
  getResolvedMonthlyAmountForCurrency,
  upsertPlanSettings
} = require('./plan-settings');
const {
  normalizeCurrencyCode,
  convertAmount
} = require('./currency');

const SUPPORTED_BILLING_CURRENCIES = Array.from(new Set([
  DEFAULT_CURRENCY,
  ...SUPPORTED_PLATFORM_CURRENCIES
]));

const createTrialDates = (baseDate = new Date()) => {
  const now = baseDate instanceof Date ? baseDate : new Date(baseDate);
  const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return {
    trialEnds,
    currentPeriodEnd: trialEnds
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

const parseJsonField = (value) => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const serializeSubscription = (subscription) => {
  if (!subscription) {
    return null;
  }

  return {
    ...subscription,
    plan: normalizePlanCode(subscription.plan || 'launch'),
    plan_amount: Number(subscription.plan_amount || 0),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    authorization_reusable: Boolean(subscription.authorization_reusable),
    authorization_payload: parseJsonField(subscription.authorization_payload)
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

const getSubscriptionById = async (db, subscriptionId) => {
  return (await db.query('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]))[0] || null;
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

const buildServiceHeaders = ({ requestId, ownerId, actorRole, config }) => {
  return buildSignedInternalHeaders({
    requestId,
    userId: ownerId,
    actorRole: actorRole || PLATFORM_ROLES.STORE_OWNER,
    actorType: 'platform_user',
    secret: config.internalSharedSecret
  });
};

const serializeAdminPlan = (plan) => {
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    code: normalizePlanCode(plan.code),
    monthly_amount: Number(plan.monthly_amount || 0),
    yearly_amount: Number(plan.yearly_amount || 0),
    yearly_discount_percentage: Number(plan.yearly_discount_percentage || 0),
    monthly_overrides: plan.monthly_overrides && typeof plan.monthly_overrides === 'object'
      ? plan.monthly_overrides
      : {}
  };
};

const ensurePlatformStaffAccess = (req) => {
  if (![PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(req.authContext.actorRole)) {
    throw createHttpError(403, 'Only platform staff can manage subscription pricing.', null, { expose: true });
  }
};

const ensurePlatformOwnerAccess = (req) => {
  if (req.authContext.actorRole !== PLATFORM_ROLES.PLATFORM_OWNER) {
    throw createHttpError(403, 'Only platform owners can update subscription pricing.', null, { expose: true });
  }
};

const buildPlanPricingPreview = async (plan, currency) => {
  if (!plan) {
    return null;
  }

  const baseCurrency = normalizeCurrencyCode(plan.currency) || DEFAULT_CURRENCY;
  const requestedCurrency = normalizeCurrencyCode(currency) || baseCurrency;
  const configuredMonthlyAmount = getResolvedMonthlyAmountForCurrency(plan, requestedCurrency);

  if (configuredMonthlyAmount !== null) {
    return {
      code: normalizePlanCode(plan.code),
      currency: requestedCurrency,
      base_currency: baseCurrency,
      monthly_amount: configuredMonthlyAmount,
      yearly_amount: calculateYearlyAmount(configuredMonthlyAmount, plan.yearly_discount_percentage),
      yearly_discount_percentage: Number(plan.yearly_discount_percentage || 0),
      pricing_source: requestedCurrency === baseCurrency ? 'base' : 'configured',
      exchange_rate: requestedCurrency === baseCurrency ? 1 : null,
      rate_date: null
    };
  }

  const conversion = await convertAmount(plan.monthly_amount, baseCurrency, requestedCurrency);
  const convertedMonthlyAmount = Number(conversion.amount || 0);

  return {
    code: normalizePlanCode(plan.code),
    currency: conversion.currency,
    base_currency: baseCurrency,
    monthly_amount: convertedMonthlyAmount,
    yearly_amount: calculateYearlyAmount(convertedMonthlyAmount, plan.yearly_discount_percentage),
    yearly_discount_percentage: Number(plan.yearly_discount_percentage || 0),
    pricing_source: conversion.currency === baseCurrency ? 'base' : 'fx',
    exchange_rate: conversion.exchangeRate,
    rate_date: conversion.rateDate
  };
};

const buildNormalizedPricing = async (db, planCode, billingCycle, currency) => {
  const resolvedPlan = await getResolvedBillingPlan(db, planCode);
  if (!resolvedPlan) {
    return null;
  }

  const cycle = String(billingCycle || 'monthly').trim().toLowerCase();
  const pricingPreview = await buildPlanPricingPreview(resolvedPlan, currency);
  const baseCurrency = normalizeCurrencyCode(resolvedPlan.currency) || DEFAULT_CURRENCY;
  const baseMonthlyAmount = Number(resolvedPlan.monthly_amount || 0);

  return {
    ...resolvedPlan,
    ...pricingPreview,
    billing_cycle: cycle,
    amount: cycle === 'yearly'
      ? pricingPreview.yearly_amount
      : pricingPreview.monthly_amount,
    base_amount: cycle === 'yearly'
      ? calculateYearlyAmount(baseMonthlyAmount, resolvedPlan.yearly_discount_percentage)
      : baseMonthlyAmount,
    base_currency: baseCurrency
  };
};

const getTrialAuthorizationAmount = async (currency) => {
  return convertAmount(TRIAL_AUTHORIZATION_BASE_AMOUNT, DEFAULT_CURRENCY, currency || DEFAULT_CURRENCY);
};

const synchronizePlanPricingAcrossSubscriptions = async (db, planCode) => {
  const normalizedCode = normalizePlanCode(planCode);
  const storageCodes = getStoragePlanCodes(normalizedCode);
  if (!storageCodes.length) {
    return {
      subscriptions_updated: 0,
      invoices_updated: 0
    };
  }

  const placeholders = storageCodes.map(() => '?').join(', ');
  const subscriptions = await db.query(
    `
      SELECT id, billing_cycle, currency
      FROM subscriptions
      WHERE LOWER(plan) IN (${placeholders})
    `,
    storageCodes
  );

  for (const subscription of subscriptions) {
    const pricing = await buildNormalizedPricing(
      db,
      normalizedCode,
      subscription.billing_cycle || 'monthly',
      subscription.currency || DEFAULT_CURRENCY
    );

    if (!pricing) {
      continue;
    }

    await db.execute(
      'UPDATE subscriptions SET plan = ?, currency = ?, plan_amount = ? WHERE id = ?',
      [
        normalizedCode,
        pricing.currency,
        pricing.amount,
        subscription.id
      ]
    );
  }

  const invoiceUpdateResult = await db.execute(
    `
      UPDATE invoices AS i
      INNER JOIN subscriptions AS s ON s.id = i.subscription_id
      SET i.amount = s.plan_amount,
          i.currency = s.currency,
          i.description = CONCAT(LOWER(s.plan), ' ', s.billing_cycle, ' subscription')
      WHERE LOWER(s.plan) IN (${placeholders})
        AND i.status IN ('draft', 'pending')
        AND i.payment_reference IS NULL
    `,
    storageCodes
  );

  return {
    subscriptions_updated: subscriptions.length,
    invoices_updated: Number(invoiceUpdateResult?.affectedRows || 0)
  };
};

const createOrUpdateSubscription = async (db, ownerId, pricing, payload = {}, existingSubscription = null) => {
  const existingStatus = String(existingSubscription?.status || '').toLowerCase();
  const nextStatus = ['active', 'trialing'].includes(existingStatus)
    ? existingStatus
    : 'pending_payment_method';

  await db.execute(
    `
      INSERT INTO subscriptions (
        owner_id, plan, status, billing_cycle, currency, plan_amount, billing_email, provider, payment_reference,
        authorization_code, authorization_email, authorization_signature, authorization_payload, authorization_reusable,
        authorization_verified_at, started_at, cancel_at_period_end, cancelled_at, trial_ends_at, current_period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
      ON DUPLICATE KEY UPDATE
        plan = VALUES(plan),
        status = VALUES(status),
        billing_cycle = VALUES(billing_cycle),
        currency = VALUES(currency),
        plan_amount = VALUES(plan_amount),
        billing_email = VALUES(billing_email),
        provider = VALUES(provider),
        payment_reference = VALUES(payment_reference),
        cancel_at_period_end = IF(VALUES(status) IN ('trialing', 'active'), 0, cancel_at_period_end),
        cancelled_at = IF(VALUES(status) IN ('trialing', 'active'), NULL, cancelled_at),
        trial_ends_at = IF(VALUES(status) = 'pending_payment_method', NULL, trial_ends_at),
        current_period_end = IF(VALUES(status) = 'pending_payment_method', NULL, current_period_end)
    `,
    [
      ownerId,
      pricing.code,
      nextStatus,
      pricing.billing_cycle,
      pricing.currency,
      pricing.amount,
      payload.email || existingSubscription?.billing_email || null,
      payload.provider || existingSubscription?.provider || 'paystack',
      existingSubscription?.payment_reference || null,
      existingSubscription?.authorization_code || null,
      existingSubscription?.authorization_email || null,
      existingSubscription?.authorization_signature || null,
      existingSubscription?.authorization_payload || null,
      Number(existingSubscription?.authorization_reusable || 0),
      existingSubscription?.authorization_verified_at || null,
      existingSubscription?.started_at || null,
      existingSubscription?.trial_ends_at || null,
      existingSubscription?.current_period_end || null
    ]
  );

  return getOwnerSubscription(db, ownerId);
};

const applyTrialAuthorizationFailure = async (db, subscription, paymentData = {}) => {
  if (!subscription?.id) {
    return null;
  }

  await db.execute(
    `
      UPDATE subscriptions
      SET status = 'pending_payment_method',
          payment_reference = ?,
          billing_email = ?,
          provider = ?,
          trial_ends_at = NULL,
          current_period_end = NULL
      WHERE id = ?
    `,
    [
      paymentData.reference || subscription.payment_reference || null,
      paymentData.metadata?.email || subscription.billing_email || null,
      paymentData.provider || subscription.provider || 'paystack',
      subscription.id
    ]
  );

  return getSubscriptionById(db, subscription.id);
};

const applyTrialAuthorizationSuccess = async (db, subscription, paymentData = {}, options = {}) => {
  if (!subscription?.id) {
    return null;
  }

  const authorization = paymentData.authorization || paymentData.metadata?.authorization || {};
  const hasReusableAuthorization = authorization.authorization_code && authorization.reusable !== false;
  if (!hasReusableAuthorization) {
    return applyTrialAuthorizationFailure(db, subscription, paymentData);
  }

  const now = options.now || new Date();
  const existingTrialEnd = subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
  const existingCurrentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  const { trialEnds, currentPeriodEnd } = existingTrialEnd
    ? {
        trialEnds: existingTrialEnd,
        currentPeriodEnd: existingCurrentPeriodEnd || existingTrialEnd
      }
    : createTrialDates(now);

  await db.execute(
    `
      UPDATE subscriptions
      SET status = 'trialing',
          plan = ?,
          billing_cycle = ?,
          currency = ?,
          plan_amount = ?,
          billing_email = ?,
          provider = ?,
          payment_reference = ?,
          authorization_code = ?,
          authorization_email = ?,
          authorization_signature = ?,
          authorization_payload = ?,
          authorization_reusable = 1,
          authorization_verified_at = CURRENT_TIMESTAMP,
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          trial_ends_at = ?,
          current_period_end = ?,
          cancel_at_period_end = 0,
          cancelled_at = NULL
      WHERE id = ?
    `,
    [
      normalizePlanCode(paymentData.metadata?.plan || subscription.plan || 'launch'),
      String(paymentData.metadata?.billing_cycle || subscription.billing_cycle || 'monthly').trim().toLowerCase(),
      normalizeCurrencyCode(paymentData.metadata?.plan_currency || paymentData.currency || subscription.currency || DEFAULT_CURRENCY) || DEFAULT_CURRENCY,
      Number(paymentData.metadata?.plan_amount || subscription.plan_amount || 0),
      paymentData.metadata?.email || subscription.billing_email || null,
      paymentData.provider || subscription.provider || 'paystack',
      paymentData.reference || subscription.payment_reference || null,
      authorization.authorization_code,
      authorization.authorization_email || paymentData.metadata?.email || subscription.billing_email || null,
      authorization.signature || null,
      JSON.stringify(authorization),
      trialEnds,
      currentPeriodEnd,
      subscription.id
    ]
  );

  return getSubscriptionById(db, subscription.id);
};

const applyInvoicePaymentSuccess = async (db, invoice, subscription, paymentData = {}) => {
  if (!invoice?.id || !subscription?.id) {
    return null;
  }

  const metadata = invoice.metadata ? JSON.parse(invoice.metadata) : {};
  await db.execute(
    'UPDATE invoices SET status = ?, provider_reference = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['paid', paymentData.reference || invoice.payment_reference || null, invoice.id]
  );

  await db.execute(
    `
      UPDATE subscriptions
      SET status = 'active',
          plan = ?,
          billing_cycle = ?,
          currency = ?,
          plan_amount = ?,
          provider = ?,
          payment_reference = ?,
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          current_period_end = ?,
          trial_ends_at = NULL,
          cancel_at_period_end = 0,
          cancelled_at = NULL
      WHERE id = ?
    `,
    [
      normalizePlanCode(metadata.plan || subscription.plan || 'launch'),
      metadata.billing_cycle || subscription.billing_cycle || 'monthly',
      invoice.currency,
      Number(invoice.amount || 0),
      paymentData.provider || subscription.provider || 'paystack',
      paymentData.reference || invoice.payment_reference || null,
      invoice.period_end,
      subscription.id
    ]
  );

  return getSubscriptionById(db, subscription.id);
};

const applyInvoicePaymentFailure = async (db, invoice, subscription, paymentData = {}) => {
  if (!invoice?.id) {
    return null;
  }

  await db.execute(
    'UPDATE invoices SET status = ?, provider_reference = ?, failed_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['failed', paymentData.reference || invoice.payment_reference || null, invoice.id]
  );

  if (subscription?.id && subscription.status !== 'trialing') {
    await db.execute(
      'UPDATE subscriptions SET status = ? WHERE id = ?',
      ['past_due', subscription.id]
    );
  }

  return subscription?.id ? getSubscriptionById(db, subscription.id) : null;
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.get('/plans', validate([
    query('currency').optional().isLength({ min: 3, max: 3 })
  ]), asyncHandler(async (req, res) => {
    const requestedCurrency = normalizeCurrencyCode(req.query.currency) || DEFAULT_CURRENCY;
    const trialAuthorizationAmount = await getTrialAuthorizationAmount(requestedCurrency);
    const plans = await Promise.all((await getResolvedBillingPlans(db)).map(async (plan) => {
      const preview = await buildPlanPricingPreview(plan, requestedCurrency);

      return {
        ...plan,
        code: normalizePlanCode(plan.code),
        currency: preview.currency,
        base_currency: preview.base_currency,
        monthly_amount: preview.monthly_amount,
        yearly_amount: preview.yearly_amount,
        yearly_discount_percentage: preview.yearly_discount_percentage,
        pricing_source: preview.pricing_source,
        trial_days: TRIAL_DAYS,
        trial_authorization_amount: trialAuthorizationAmount.amount,
        trial_authorization_currency: trialAuthorizationAmount.currency
      };
    }));

    return res.json({
      plans
    });
  }));

  app.get('/admin/plans', requireInternal, asyncHandler(async (req, res) => {
    ensurePlatformStaffAccess(req);

    const plans = await Promise.all((await getResolvedBillingPlans(db)).map(async (plan) => {
      const pricingEntries = await Promise.all(SUPPORTED_BILLING_CURRENCIES.map(async (currencyCode) => {
        const pricing = await buildPlanPricingPreview(plan, currencyCode);
        return [currencyCode, pricing];
      }));

      return {
        ...serializeAdminPlan(plan),
        configured_currencies: getConfiguredPlanCurrencies(plan),
        pricing_by_currency: Object.fromEntries(pricingEntries)
      };
    }));

    return res.json({
      plans,
      supported_currencies: SUPPORTED_BILLING_CURRENCIES,
      trial_days: TRIAL_DAYS,
      trial_authorization_amount: Number(TRIAL_AUTHORIZATION_BASE_AMOUNT || 0),
      trial_authorization_currency: DEFAULT_CURRENCY
    });
  }));

  app.post('/admin/plans', requireInternal, validate([
    allowBodyFields(['plan', 'currency', 'monthly_amount', 'yearly_discount_percentage']),
    body('plan')
      .isString()
      .custom((value) => getKnownPlanCodes().includes(normalizePlanCode(value)))
      .withMessage('Unsupported billing plan.'),
    body('currency')
      .optional()
      .isLength({ min: 3, max: 3 })
      .withMessage('Choose a valid currency code.'),
    body('monthly_amount')
      .isFloat({ min: 0.01, max: 1000000 })
      .withMessage('Monthly amount must be greater than zero.')
      .toFloat(),
    body('yearly_discount_percentage')
      .isFloat({ min: 0, max: 95 })
      .withMessage('Yearly discount must be between 0 and 95 percent.')
      .toFloat()
  ]), asyncHandler(async (req, res) => {
    ensurePlatformOwnerAccess(req);

    const normalizedCode = normalizePlanCode(req.body.plan);
    const plan = await upsertPlanSettings(db, {
      plan: normalizedCode,
      currency: req.body.currency,
      monthly_amount: req.body.monthly_amount,
      yearly_discount_percentage: req.body.yearly_discount_percentage
    });

    if (!plan) {
      throw createHttpError(400, 'Unsupported billing plan.', null, { expose: true });
    }

    const syncResult = await synchronizePlanPricingAcrossSubscriptions(db, normalizedCode);

    return res.status(201).json({
      plan: serializeAdminPlan(plan),
      ...syncResult
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
    allowBodyFields(['plan', 'billing_cycle', 'provider', 'currency', 'email', 'callback_url']),
    body('plan').isString().notEmpty(),
    body('billing_cycle').isIn(['monthly', 'yearly']),
    body('provider').optional().isIn(['paystack']),
    body('currency').optional().isLength({ min: 3, max: 3 }),
    body('email').optional().isEmail().customSanitizer((value) => sanitizeEmail(value)),
    body('callback_url').optional().isString().isLength({ max: 2000 })
  ]), asyncHandler(async (req, res) => {
    const ownerId = resolveOwnerId(req);
    if (!ownerId) {
      throw createHttpError(400, 'owner_id is required.', null, { expose: true });
    }

    const pricing = await buildNormalizedPricing(db, req.body.plan, req.body.billing_cycle, req.body.currency);
    if (!pricing) {
      throw createHttpError(400, 'Unsupported subscription plan.', null, { expose: true });
    }

    const provider = String(req.body.provider || 'paystack').trim().toLowerCase();
    if (provider !== 'paystack') {
      throw createHttpError(400, 'Paystack is required for subscription trials.', null, { expose: true });
    }

    const existingSubscription = await getOwnerSubscription(db, ownerId);
    const subscription = await createOrUpdateSubscription(db, ownerId, pricing, req.body, existingSubscription);
    const authorizationAmount = await getTrialAuthorizationAmount(pricing.currency);
    const paymentSession = await requestJson(`${config.serviceUrls.payment}/payments/create-checkout-session`, {
      method: 'POST',
      headers: buildPaymentHeaders(req, config),
      body: {
        owner_id: ownerId,
        amount: authorizationAmount.amount,
        currency: authorizationAmount.currency,
        provider,
        email: req.body.email || subscription.billing_email || null,
        payment_scope: 'subscription',
        entity_type: 'subscription',
        entity_id: String(subscription.id),
        callback_url: req.body.callback_url || null,
        metadata: {
          subscription_id: subscription.id,
          plan: pricing.code,
          billing_cycle: pricing.billing_cycle,
          plan_amount: pricing.amount,
          plan_currency: pricing.currency,
          base_plan_amount: pricing.base_amount,
          base_plan_currency: pricing.base_currency,
          stage: 'trial_authorization',
          trial_days: TRIAL_DAYS,
          auto_refund_on_success: true
        }
      },
      timeoutMs: config.requestTimeoutMs
    });

    await db.execute(
      `
        UPDATE subscriptions
        SET payment_reference = ?, billing_email = ?, provider = ?, currency = ?, plan_amount = ?
        WHERE id = ?
      `,
      [
        paymentSession.payment.reference,
        req.body.email || subscription.billing_email || null,
        provider,
        pricing.currency,
        pricing.amount,
        subscription.id
      ]
    );

    const freshSubscription = await getOwnerSubscription(db, ownerId);

    return res.status(201).json({
      subscription: serializeSubscription(freshSubscription),
      payment: paymentSession.payment,
      providers: paymentSession.providers,
      trial_authorization_amount: authorizationAmount.amount,
      trial_authorization_currency: authorizationAmount.currency
    });
  }));

  app.post('/subscriptions/verify-checkout', requireInternal, validate([
    allowBodyFields(['reference']),
    body('reference').isString().notEmpty().isLength({ max: 191 })
  ]), asyncHandler(async (req, res) => {
    const ownerId = Number(req.authContext.userId);
    const verification = await requestJson(
      `${config.serviceUrls.payment}/payments/verify/${encodeURIComponent(req.body.reference)}`,
      {
        method: 'GET',
        headers: buildPaymentHeaders(req, config),
        timeoutMs: config.requestTimeoutMs
      }
    );

    const payment = verification?.payment || null;
    let subscription = null;

    if (payment?.entity_type === 'subscription' && payment.entity_id) {
      const targetSubscription = await getSubscriptionById(db, Number(payment.entity_id));
      if (targetSubscription) {
        if (payment.status === 'success') {
          subscription = await applyTrialAuthorizationSuccess(db, targetSubscription, {
            reference: payment.reference,
            provider: payment.provider,
            currency: payment.currency,
            metadata: payment.metadata || {},
            authorization: payment.metadata?.authorization || null
          });
        } else if (payment.status === 'failed') {
          subscription = await applyTrialAuthorizationFailure(db, targetSubscription, {
            reference: payment.reference,
            provider: payment.provider,
            metadata: payment.metadata || {}
          });
        }
      }
    }

    if (!subscription) {
      subscription = await getOwnerSubscription(db, ownerId);
    }

    return res.json({
      subscription: serializeSubscription(subscription),
      payment
    });
  }));

  app.post('/subscriptions', requireInternal, validate([
    allowBodyFields(['owner_id', 'plan', 'status', 'billing_cycle', 'currency']),
    body('plan').optional().isString(),
    body('status').optional().isString(),
    body('billing_cycle').optional().isIn(['monthly', 'yearly']),
    body('currency').optional().isLength({ min: 3, max: 3 })
  ]), asyncHandler(async (req, res) => {
    const ownerId = Number(req.body.owner_id || req.authContext.userId);
    const planCode = normalizePlanCode(req.body.plan || 'launch');
    const plan = await getResolvedBillingPlan(db, planCode);
    if (!plan) {
      throw createHttpError(400, 'Unsupported subscription plan.', null, { expose: true });
    }

    const billingCycle = String(req.body.billing_cycle || 'monthly').trim().toLowerCase();
    const pricing = await buildNormalizedPricing(db, planCode, billingCycle, req.body.currency || DEFAULT_CURRENCY);

    await db.execute(
      `
        INSERT INTO subscriptions (
          owner_id, plan, status, billing_cycle, currency, plan_amount, trial_ends_at, current_period_end
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
        ON DUPLICATE KEY UPDATE
          plan = VALUES(plan),
          status = VALUES(status),
          billing_cycle = VALUES(billing_cycle),
          currency = VALUES(currency),
          plan_amount = VALUES(plan_amount)
      `,
      [
        ownerId,
        plan.code,
        String(req.body.status || 'active').trim().toLowerCase(),
        billingCycle,
        pricing.currency,
        pricing.amount
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
      owner_id: updatedSubscription?.owner_id || ownerId,
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
  createTrialDates,
  buildNormalizedPricing,
  getTrialAuthorizationAmount,
  getOwnerSubscription,
  getSubscriptionById,
  applyTrialAuthorizationSuccess,
  applyTrialAuthorizationFailure,
  applyInvoicePaymentSuccess,
  applyInvoicePaymentFailure,
  buildServiceHeaders
};
