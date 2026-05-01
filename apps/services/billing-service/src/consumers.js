const {
  EVENT_NAMES,
  PLATFORM_ROLES
} = require('../../../../packages/shared');
const {
  createTrialDates
} = require('./routes');

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
          INSERT INTO subscriptions (owner_id, plan, status, trial_ends_at, current_period_end)
          VALUES (?, 'basic', 'trialing', ?, ?)
          ON DUPLICATE KEY UPDATE
            plan = 'basic',
            status = IF(status = 'cancelled', 'cancelled', 'trialing'),
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
};

module.exports = {
  registerConsumers
};
