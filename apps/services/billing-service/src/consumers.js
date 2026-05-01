const {
  EVENT_NAMES,
  PLATFORM_ROLES
} = require('../../../../packages/shared');
const {
  createTrialDates
} = require('./routes');

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

const registerConsumers = async ({ bus, db, logger }) => {
  await bus.subscribe({
    queueName: 'billing-service.user-registered',
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

      const { trialEnds, currentPeriodEnd } = createTrialDates();
      await db.execute(
        `
          INSERT INTO subscriptions (
            owner_id, plan, status, billing_cycle, currency, plan_amount, trial_ends_at, current_period_end
          )
          VALUES (?, 'basic', 'trialing', 'monthly', 'NGN', 0, ?, ?)
          ON DUPLICATE KEY UPDATE
            plan = 'basic',
            status = IF(status = 'cancelled', 'cancelled', 'trialing'),
            billing_cycle = 'monthly',
            currency = 'NGN',
            plan_amount = 0,
            trial_ends_at = VALUES(trial_ends_at),
            current_period_end = VALUES(current_period_end)
        `,
        [ownerId, trialEnds, currentPeriodEnd]
      );

      logger.info('Provisioned trial subscription from USER_REGISTERED event', {
        ownerId
      });
    }
  });

  await bus.subscribe({
    queueName: 'billing-service.subscription-payments',
    events: [EVENT_NAMES.PAYMENT_SUCCEEDED, EVENT_NAMES.PAYMENT_FAILED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const reference = String(data.reference || '').trim();
      if (!reference) {
        return;
      }

      const invoice = (await db.query(
        'SELECT * FROM invoices WHERE payment_reference = ? ORDER BY id DESC LIMIT 1',
        [reference]
      ))[0];
      if (!invoice) {
        return;
      }

      const subscription = (await db.query(
        'SELECT * FROM subscriptions WHERE id = ?',
        [invoice.subscription_id]
      ))[0] || null;
      const metadata = invoice.metadata ? JSON.parse(invoice.metadata) : {};

      await logBillingEvent(db, {
        owner_id: invoice.owner_id,
        subscription_id: invoice.subscription_id,
        invoice_id: invoice.id,
        event_type: payload.event,
        reference,
        payload: data
      });

      if (payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED) {
        await db.execute(
          'UPDATE invoices SET status = ?, provider_reference = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['paid', reference, invoice.id]
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
            metadata.plan || subscription?.plan || 'basic',
            metadata.billing_cycle || subscription?.billing_cycle || 'monthly',
            invoice.currency,
            Number(invoice.amount || 0),
            data.provider || subscription?.provider || 'paystack',
            reference,
            invoice.period_end,
            invoice.subscription_id
          ]
        );

        const updatedSubscription = (await db.query(
          'SELECT * FROM subscriptions WHERE id = ?',
          [invoice.subscription_id]
        ))[0];

        await bus.publish(EVENT_NAMES.SUBSCRIPTION_CHANGED, {
          owner_id: invoice.owner_id,
          plan: updatedSubscription.plan,
          status: updatedSubscription.status
        });
        return;
      }

      await db.execute(
        'UPDATE invoices SET status = ?, provider_reference = ?, failed_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['failed', reference, invoice.id]
      );

      if (subscription && subscription.status !== 'trialing') {
        await db.execute(
          'UPDATE subscriptions SET status = ? WHERE id = ?',
          ['past_due', subscription.id]
        );
      }
    }
  });
};

module.exports = {
  registerConsumers
};
