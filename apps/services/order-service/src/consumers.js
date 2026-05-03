const {
  EVENT_NAMES,
  PLATFORM_ROLES,
  buildSignedInternalHeaders,
  requestJson
} = require('../../../../packages/shared');
const {
  hydrateOrder,
  applyPaymentOutcomeToOrder
} = require('./routes');

const ORDER_PAYMENT_RECONCILIATION_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.ORDER_PAYMENT_RECONCILIATION_INTERVAL_MS || 3 * 60 * 1000)
);
const ORDER_PAYMENT_RECONCILIATION_BATCH_SIZE = Math.max(
  1,
  Number(process.env.ORDER_PAYMENT_RECONCILIATION_BATCH_SIZE || 50)
);

const listPendingPaymentOrders = async (db) => {
  return db.query(
    `
      SELECT id, store_id, payment_reference
      FROM orders
      WHERE payment_reference IS NOT NULL
        AND payment_status = 'pending'
        AND created_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 MINUTE)
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `,
    [ORDER_PAYMENT_RECONCILIATION_BATCH_SIZE]
  );
};

const buildSystemHeaders = ({ config, storeId, requestId }) => {
  return buildSignedInternalHeaders({
    requestId,
    storeId,
    actorRole: PLATFORM_ROLES.PLATFORM_OWNER,
    actorType: 'platform_user',
    secret: config.internalSharedSecret
  });
};

const reconcilePendingOrderPayment = async ({ db, bus, config, logger, orderRow }) => {
  const order = await hydrateOrder(db, orderRow.id, orderRow.store_id);
  if (!order || String(order.payment_status || '').toLowerCase() !== 'pending') {
    return;
  }

  const requestId = `order-reconcile-${order.id}-${Date.now()}`;
  const verification = await requestJson(
    `${config.serviceUrls.payment}/payments/verify/${encodeURIComponent(order.payment_reference)}`,
    {
      method: 'GET',
      headers: buildSystemHeaders({
        config,
        storeId: order.store_id,
        requestId
      }),
      timeoutMs: config.requestTimeoutMs
    }
  );
  const payment = verification?.payment || null;
  if (!payment) {
    return;
  }

  const updatedOrder = await applyPaymentOutcomeToOrder({
    db,
    bus,
    config,
    order,
    payment
  });

  logger.info('Reconciled pending order payment state', {
    orderId: order.id,
    paymentReference: order.payment_reference,
    paymentStatus: payment.status,
    orderStatus: updatedOrder?.status || order.status
  });
};

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

  let schedulerActive = false;
  const runScheduler = async () => {
    if (schedulerActive) {
      return;
    }

    schedulerActive = true;
    try {
      const pendingOrders = await listPendingPaymentOrders(db);
      for (const orderRow of pendingOrders) {
        try {
          await reconcilePendingOrderPayment({
            db,
            bus,
            config,
            logger,
            orderRow
          });
        } catch (error) {
          logger.error('Pending order payment reconciliation failed', {
            orderId: orderRow.id,
            paymentReference: orderRow.payment_reference,
            error: error.message
          });
        }
      }
    } finally {
      schedulerActive = false;
    }
  };

  const interval = globalThis.setInterval(() => {
    void runScheduler();
  }, ORDER_PAYMENT_RECONCILIATION_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  await runScheduler();
};

module.exports = {
  registerConsumers
};
