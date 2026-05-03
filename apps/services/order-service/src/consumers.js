const {
  EVENT_NAMES
} = require('../../../../packages/shared');
const {
  hydrateOrder,
  applyPaymentOutcomeToOrder
} = require('./routes');

const registerConsumers = async ({ bus, db, config, logger }) => {
  await bus.subscribe({
    queueName: 'order-service.payments',
    events: [EVENT_NAMES.PAYMENT_SUCCEEDED, EVENT_NAMES.PAYMENT_FAILED, EVENT_NAMES.PAYMENT_REFUNDED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const orderId = Number(data.order_id);
      if (!orderId) {
        return;
      }

      const order = await hydrateOrder(db, orderId);
      if (!order) {
        return;
      }

      const payment = {
        status: payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED
          ? 'success'
          : payload.event === EVENT_NAMES.PAYMENT_REFUNDED
            ? 'refunded'
            : 'failed'
      };

      await applyPaymentOutcomeToOrder({
        db,
        bus,
        config,
        order,
        payment
      });

      logger.info('Processed payment outcome for order', {
        orderId,
        event: payload.event
      });
    }
  });
};

module.exports = {
  registerConsumers
};
