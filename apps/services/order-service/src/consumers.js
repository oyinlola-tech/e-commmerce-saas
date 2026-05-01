const {
  EVENT_NAMES,
  buildSignedInternalHeaders,
  requestJson
} = require('../../../../packages/shared');
const {
  hydrateOrder
} = require('./routes');

const registerConsumers = async ({ bus, db, config, logger }) => {
  await bus.subscribe({
    queueName: 'order-service.payments',
    events: [EVENT_NAMES.PAYMENT_SUCCEEDED, EVENT_NAMES.PAYMENT_FAILED],
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

      const headers = buildSignedInternalHeaders({
        requestId: `event-${orderId}`,
        storeId: order.store_id,
        actorType: 'platform_user',
        actorRole: 'platform_owner',
        secret: config.internalSharedSecret
      });

      if (payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED) {
        await db.execute(
          'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
          ['paid', 'confirmed', orderId]
        );
        if (order.reservation_id) {
          await requestJson(`${config.serviceUrls.product}/inventory/reservations/${order.reservation_id}/commit`, {
            method: 'POST',
            headers,
            timeoutMs: config.requestTimeoutMs
          });
        }
        await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
          order_id: orderId,
          store_id: order.store_id,
          status: 'confirmed'
        });
        return;
      }

      await db.execute(
        'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
        ['failed', 'payment_failed', orderId]
      );
      if (order.reservation_id) {
        await requestJson(`${config.serviceUrls.product}/inventory/reservations/${order.reservation_id}/release`, {
          method: 'POST',
          headers,
          timeoutMs: config.requestTimeoutMs
        });
      }
      await bus.publish(EVENT_NAMES.ORDER_STATUS_CHANGED, {
        order_id: orderId,
        store_id: order.store_id,
        status: 'payment_failed'
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
