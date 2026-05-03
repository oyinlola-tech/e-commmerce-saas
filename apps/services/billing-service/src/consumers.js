const {
  EVENT_NAMES,
  EVENT_QUEUE_NAMES,
  PLATFORM_ROLES,
  requestJson
} = require('../../../../packages/shared');
const {
  normalizePlanCode,
  getPeriodEnd
} = require('./plans');
const {
  getResolvedPlanPrice
} = require('./plan-settings');
const {
  getSubscriptionById,
  applyTrialAuthorizationSuccess,
  applyTrialAuthorizationFailure,
  applyInvoicePaymentSuccess,
  applyInvoicePaymentFailure,
  buildServiceHeaders
} = require('./routes');

const BILLING_SCHEDULER_INTERVAL_MS = Number(process.env.BILLING_SCHEDULER_INTERVAL_MS || 5 * 60 * 1000);

const logBillingEvent = async (db, data) => {
  await db.execute(
    `
      INSERT INTO billing_events (owner_id, subscription_id, invoice_id, event_type, reference, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      data.owner_id || null,
      data.subscription_id || null,
      data.invoice_id || null,
      data.event_type,
      data.reference || null,
      JSON.stringify(data.payload || {})
    ]
  );
};

const publishSubscriptionChanged = async (bus, subscription) => {
  if (!subscription) {
    return;
  }

  await bus.publish(EVENT_NAMES.SUBSCRIPTION_CHANGED, {
    owner_id: subscription.owner_id,
    plan: normalizePlanCode(subscription.plan),
    status: subscription.status
  });
};

const createPlaceholderSubscription = async (db, ownerId) => {
  const launchPlan = await getResolvedPlanPrice(db, 'launch', 'monthly');
  await db.execute(
    `
      INSERT INTO subscriptions (
        owner_id, plan, status, billing_cycle, currency, plan_amount, trial_ends_at, current_period_end
      )
      VALUES (?, ?, 'pending_payment_method', ?, ?, ?, NULL, NULL)
      ON DUPLICATE KEY UPDATE
        plan = IF(status IN ('active', 'trialing'), plan, VALUES(plan)),
        billing_cycle = IF(status IN ('active', 'trialing'), billing_cycle, VALUES(billing_cycle)),
        currency = IF(status IN ('active', 'trialing'), currency, VALUES(currency)),
        plan_amount = IF(status IN ('active', 'trialing'), plan_amount, VALUES(plan_amount))
    `,
    [
      ownerId,
      launchPlan.code,
      launchPlan.billing_cycle,
      launchPlan.currency,
      launchPlan.amount
    ]
  );
};

const getInvoiceById = async (db, invoiceId) => {
  return (await db.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]))[0] || null;
};

const getInvoiceByReference = async (db, reference) => {
  return (await db.query(
    'SELECT * FROM invoices WHERE payment_reference = ? ORDER BY id DESC LIMIT 1',
    [reference]
  ))[0] || null;
};

const ensureChargeInvoice = async (db, subscription, stage, periodStart) => {
  const existingInvoice = (await db.query(
    'SELECT * FROM invoices WHERE subscription_id = ? AND period_start = ? ORDER BY id DESC LIMIT 1',
    [subscription.id, periodStart]
  ))[0] || null;
  const periodEnd = getPeriodEnd(subscription.billing_cycle, new Date(periodStart));
  const metadata = JSON.stringify({
    plan: normalizePlanCode(subscription.plan),
    billing_cycle: subscription.billing_cycle,
    owner_id: subscription.owner_id,
    stage
  });
  const description = `${normalizePlanCode(subscription.plan)} ${subscription.billing_cycle} subscription`;

  if (existingInvoice && ['paid', 'pending'].includes(String(existingInvoice.status || '').toLowerCase())) {
    return existingInvoice;
  }

  if (existingInvoice) {
    await db.execute(
      `
        UPDATE invoices
        SET amount = ?, currency = ?, provider = ?, status = 'pending', payment_reference = NULL, provider_reference = NULL,
            description = ?, period_end = ?, paid_at = NULL, failed_at = NULL, metadata = ?
        WHERE id = ?
      `,
      [
        Number(subscription.plan_amount || 0),
        subscription.currency,
        subscription.provider || 'paystack',
        description,
        periodEnd,
        metadata,
        existingInvoice.id
      ]
    );

    return getInvoiceById(db, existingInvoice.id);
  }

  const result = await db.execute(
    `
      INSERT INTO invoices (
        owner_id, subscription_id, amount, currency, provider, status, payment_reference, provider_reference,
        description, period_start, period_end, metadata
      ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?, ?)
    `,
    [
      subscription.owner_id,
      subscription.id,
      Number(subscription.plan_amount || 0),
      subscription.currency,
      subscription.provider || 'paystack',
      description,
      periodStart,
      periodEnd,
      metadata
    ]
  );

  return getInvoiceById(db, result.insertId);
};

const chargeDueSubscription = async ({ db, bus, config, subscription, logger }) => {
  if (!subscription?.id || !subscription.authorization_code || !subscription.authorization_reusable) {
    return;
  }

  const normalizedStatus = String(subscription.status || '').toLowerCase();
  if (normalizedStatus === 'active' && subscription.cancel_at_period_end && subscription.current_period_end && new Date(subscription.current_period_end) <= new Date()) {
    await db.execute(
      'UPDATE subscriptions SET status = ?, cancelled_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['cancelled', subscription.id]
    );
    const cancelledSubscription = await getSubscriptionById(db, subscription.id);
    await publishSubscriptionChanged(bus, cancelledSubscription);
    return;
  }

  if (!['trialing', 'active'].includes(normalizedStatus)) {
    return;
  }

  const periodStart = normalizedStatus === 'trialing'
    ? new Date(subscription.trial_ends_at)
    : new Date(subscription.current_period_end);
  const stage = normalizedStatus === 'trialing'
    ? 'trial_completion_charge'
    : 'renewal_charge';
  const invoice = await ensureChargeInvoice(db, subscription, stage, periodStart);

  if (!invoice || String(invoice.status || '').toLowerCase() === 'pending' && invoice.payment_reference) {
    return;
  }

  const chargeResponse = await requestJson(`${config.serviceUrls.payment}/payments/charge-authorization`, {
    method: 'POST',
    headers: buildServiceHeaders({
      requestId: `billing-scheduler-${Date.now()}`,
      ownerId: subscription.owner_id,
      actorRole: PLATFORM_ROLES.STORE_OWNER,
      config
    }),
    body: {
      provider: subscription.provider || 'paystack',
      owner_id: subscription.owner_id,
      amount: Number(subscription.plan_amount || 0),
      currency: subscription.currency,
      email: subscription.authorization_email || subscription.billing_email,
      authorization_code: subscription.authorization_code,
      payment_scope: 'subscription',
      entity_type: 'invoice',
      entity_id: String(invoice.id),
      metadata: {
        invoice_id: invoice.id,
        subscription_id: subscription.id,
        plan: normalizePlanCode(subscription.plan),
        billing_cycle: subscription.billing_cycle,
        stage
      }
    },
    timeoutMs: config.requestTimeoutMs
  });
  const payment = chargeResponse?.payment || null;
  if (!payment?.reference) {
    return;
  }

  await db.execute('UPDATE invoices SET payment_reference = ? WHERE id = ?', [payment.reference, invoice.id]);
  await db.execute('UPDATE subscriptions SET payment_reference = ? WHERE id = ?', [payment.reference, subscription.id]);

  const freshInvoice = await getInvoiceById(db, invoice.id);
  if (payment.status === 'success') {
    const updatedSubscription = await applyInvoicePaymentSuccess(db, freshInvoice, subscription, {
      reference: payment.reference,
      provider: payment.provider
    });
    await publishSubscriptionChanged(bus, updatedSubscription);
    logger.info('Processed scheduled subscription charge', {
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      reference: payment.reference
    });
    return;
  }

  if (payment.status === 'failed') {
    const updatedSubscription = await applyInvoicePaymentFailure(db, freshInvoice, subscription, {
      reference: payment.reference,
      provider: payment.provider
    });
    await publishSubscriptionChanged(bus, updatedSubscription);
  }
};

const registerConsumers = async ({ bus, db, logger, config }) => {
  await bus.subscribe({
    queueName: EVENT_QUEUE_NAMES.BILLING_SERVICE_USER_REGISTERED,
    events: [EVENT_NAMES.USER_REGISTERED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      if (data.role !== PLATFORM_ROLES.STORE_OWNER) {
        return;
      }

      const ownerId = Number(data.user_id);
      if (!ownerId) {
        return;
      }

      await createPlaceholderSubscription(db, ownerId);
      logger.info('Provisioned pending subscription placeholder from USER_REGISTERED event', {
        ownerId
      });
    }
  });

  await bus.subscribe({
    queueName: EVENT_QUEUE_NAMES.BILLING_SERVICE_SUBSCRIPTION_PAYMENTS,
    events: [EVENT_NAMES.PAYMENT_SUCCEEDED, EVENT_NAMES.PAYMENT_FAILED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const reference = String(data.reference || '').trim();
      if (!reference) {
        return;
      }

      if (data.entity_type === 'subscription' && data.entity_id) {
        const subscription = await getSubscriptionById(db, Number(data.entity_id));
        if (!subscription) {
          return;
        }

        await logBillingEvent(db, {
          owner_id: subscription.owner_id,
          subscription_id: subscription.id,
          event_type: payload.event,
          reference,
          payload: data
        });

        const updatedSubscription = payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED
          ? await applyTrialAuthorizationSuccess(db, subscription, data)
          : await applyTrialAuthorizationFailure(db, subscription, data);
        await publishSubscriptionChanged(bus, updatedSubscription);
        return;
      }

      const invoice = data.entity_type === 'invoice' && data.entity_id
        ? await getInvoiceById(db, Number(data.entity_id))
        : await getInvoiceByReference(db, reference);
      if (!invoice) {
        return;
      }

      const subscription = await getSubscriptionById(db, invoice.subscription_id);
      await logBillingEvent(db, {
        owner_id: invoice.owner_id,
        subscription_id: invoice.subscription_id,
        invoice_id: invoice.id,
        event_type: payload.event,
        reference,
        payload: data
      });

      const updatedSubscription = payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED
        ? await applyInvoicePaymentSuccess(db, invoice, subscription, data)
        : await applyInvoicePaymentFailure(db, invoice, subscription, data);

      if (updatedSubscription) {
        await publishSubscriptionChanged(bus, updatedSubscription);
      }
    }
  });

  let schedulerActive = false;
  const runScheduler = async () => {
    if (schedulerActive) {
      return;
    }

    schedulerActive = true;
    try {
      const dueSubscriptions = await db.query(
        `
          SELECT *
          FROM subscriptions
          WHERE provider = 'paystack'
            AND authorization_reusable = 1
            AND (
              (status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at <= CURRENT_TIMESTAMP)
              OR
              (status = 'active' AND current_period_end IS NOT NULL AND current_period_end <= CURRENT_TIMESTAMP)
            )
          ORDER BY COALESCE(current_period_end, trial_ends_at) ASC
        `
      );

      for (const subscription of dueSubscriptions) {
        try {
          await chargeDueSubscription({
            db,
            bus,
            config,
            subscription,
            logger
          });
        } catch (error) {
          logger.error('Scheduled subscription charge failed', {
            subscriptionId: subscription.id,
            error
          });
        }
      }
    } finally {
      schedulerActive = false;
    }
  };

  const interval = globalThis.setInterval(() => {
    void runScheduler();
  }, BILLING_SCHEDULER_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  await runScheduler();
};

module.exports = {
  registerConsumers
};
