const {
  verifyAndRecordPayment,
  recordPaymentVerificationFailure,
  processStoredWebhookRecord
} = require('./routes');

const PAYMENT_RECONCILIATION_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS || 2 * 60 * 1000)
);
const PAYMENT_RECONCILIATION_BATCH_SIZE = Math.max(
  1,
  Number(process.env.PAYMENT_RECONCILIATION_BATCH_SIZE || 50)
);
const WEBHOOK_REPLAY_BATCH_SIZE = Math.max(
  1,
  Number(process.env.PAYMENT_WEBHOOK_REPLAY_BATCH_SIZE || 50)
);

const listDueWebhookReplays = async (db) => {
  return db.query(
    `
      SELECT *
      FROM payment_webhooks
      WHERE processed_at IS NULL
        AND dead_lettered_at IS NULL
        AND status IN ('received', 'pending_retry', 'payment_not_found')
        AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
      ORDER BY COALESCE(next_retry_at, created_at) ASC, id ASC
      LIMIT ?
    `,
    [WEBHOOK_REPLAY_BATCH_SIZE]
  );
};

const listDuePaymentReconciliations = async (db) => {
  return db.query(
    `
      SELECT *
      FROM payments
      WHERE status = 'pending'
        AND reference IS NOT NULL
        AND next_reconciliation_at IS NOT NULL
        AND next_reconciliation_at <= CURRENT_TIMESTAMP
      ORDER BY next_reconciliation_at ASC, id ASC
      LIMIT ?
    `,
    [PAYMENT_RECONCILIATION_BATCH_SIZE]
  );
};

const replayWebhook = async ({ db, bus, config, logger, webhookRecord }) => {
  const result = await processStoredWebhookRecord({
    db,
    bus,
    config,
    webhookRecord
  });

  logger.info('Processed queued payment webhook replay', {
    webhookId: webhookRecord.id,
    provider: webhookRecord.provider,
    reference: webhookRecord.reference,
    status: result?.status || webhookRecord.status
  });
};

const reconcilePayment = async ({ db, bus, config, logger, payment }) => {
  try {
    const updatedPayment = await verifyAndRecordPayment({
      db,
      bus,
      config,
      payment
    });

    logger.info('Reconciled pending payment', {
      paymentId: payment.id,
      reference: payment.reference,
      status: updatedPayment?.status || payment.status
    });
  } catch (error) {
    await recordPaymentVerificationFailure(db, payment, error);
    logger.error('Pending payment reconciliation failed', {
      paymentId: payment.id,
      reference: payment.reference,
      error: error.message
    });
  }
};

const registerConsumers = async ({ bus, db, config, logger }) => {
  let schedulerActive = false;

  const runScheduler = async () => {
    if (schedulerActive) {
      return;
    }

    schedulerActive = true;
    try {
      const queuedWebhooks = await listDueWebhookReplays(db);
      for (const webhookRecord of queuedWebhooks) {
        try {
          await replayWebhook({
            db,
            bus,
            config,
            logger,
            webhookRecord
          });
        } catch (error) {
          logger.error('Queued payment webhook replay failed', {
            webhookId: webhookRecord.id,
            reference: webhookRecord.reference,
            error: error.message
          });
        }
      }

      const pendingPayments = await listDuePaymentReconciliations(db);
      for (const payment of pendingPayments) {
        await reconcilePayment({
          db,
          bus,
          config,
          logger,
          payment
        });
      }
    } finally {
      schedulerActive = false;
    }
  };

  const interval = globalThis.setInterval(() => {
    void runScheduler();
  }, PAYMENT_RECONCILIATION_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  await runScheduler();
};

module.exports = {
  registerConsumers
};
