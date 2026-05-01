const { randomUUID } = require('crypto');
const {
  requireInternalRequest,
  encryptText,
  decryptText,
  EVENT_NAMES,
  PAYMENT_PROVIDERS
} = require('../../../../packages/shared');

const buildProviderPayloads = ({ amount, currency, reference, storeId, configs, gatewayUrl }) => {
  return PAYMENT_PROVIDERS.map((provider) => {
    const config = configs.find((entry) => entry.provider === provider);
    return {
      provider,
      inline: true,
      public_key: config?.public_key || null,
      checkout_url: `${gatewayUrl}/payments/mock/${provider}/${reference}?store_id=${storeId}&amount=${amount}&currency=${currency}`
    };
  });
};

const registerRoutes = async ({ app, db, bus, config }) => {
  const requireInternal = requireInternalRequest(config.internalSharedSecret);

  app.post('/payments/create-checkout-session', requireInternal, async (req, res) => {
    try {
      const reference = `pay_${randomUUID()}`;
      const provider = String(req.body.provider || 'paystack').trim().toLowerCase();
      const amount = Number(req.body.amount || 0);
      const storeId = Number(req.body.store_id || req.authContext.storeId);
      const customerId = req.body.customer_id || req.authContext.customerId || null;
      const currency = String(req.body.currency || 'NGN').trim().toUpperCase();

      const configs = await db.query('SELECT * FROM payment_provider_configs WHERE store_id = ?', [storeId]);
      const result = await db.execute(
        `
          INSERT INTO payments (order_id, store_id, customer_id, amount, currency, provider, reference, provider_session_id, status, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `,
        [
          req.body.order_id,
          storeId,
          customerId,
          amount,
          currency,
          provider,
          reference,
          `${provider}_${randomUUID()}`,
          JSON.stringify({ email: req.body.email || null })
        ]
      );
      const payment = (await db.query('SELECT * FROM payments WHERE id = ?', [result.insertId]))[0];

      return res.status(201).json({
        payment: {
          id: payment.id,
          order_id: payment.order_id,
          reference: payment.reference,
          amount: Number(payment.amount),
          currency: payment.currency,
          status: payment.status
        },
        providers: buildProviderPayloads({
          amount,
          currency,
          reference,
          storeId,
          configs,
          gatewayUrl: config.gatewayUrl
        })
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/payments/config', requireInternal, async (req, res) => {
    try {
      const rows = await db.query('SELECT * FROM payment_provider_configs WHERE store_id = ?', [req.authContext.storeId]);
      return res.json({
        configs: rows.map((row) => ({
          id: row.id,
          store_id: row.store_id,
          provider: row.provider,
          public_key: row.public_key,
          status: row.status,
          has_secret_key: Boolean(row.secret_key_encrypted)
        }))
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/payments/config', requireInternal, async (req, res) => {
    try {
      const storeId = Number(req.authContext.storeId);
      const provider = String(req.body.provider || '').trim().toLowerCase();
      if (!PAYMENT_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: 'Unsupported payment provider.' });
      }

      await db.execute(
        `
          INSERT INTO payment_provider_configs (store_id, provider, public_key, secret_key_encrypted, status)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            public_key = VALUES(public_key),
            secret_key_encrypted = VALUES(secret_key_encrypted),
            status = VALUES(status)
        `,
        [
          storeId,
          provider,
          req.body.public_key || null,
          req.body.secret_key ? encryptText(req.body.secret_key, config.internalSharedSecret) : null,
          req.body.status || 'active'
        ]
      );

      const rows = await db.query('SELECT * FROM payment_provider_configs WHERE store_id = ? AND provider = ?', [storeId, provider]);
      return res.status(201).json({
        config: {
          ...rows[0],
          secret_key_encrypted: undefined,
          secret_key_preview: rows[0].secret_key_encrypted ? decryptText(rows[0].secret_key_encrypted, config.internalSharedSecret).slice(0, 6) : null
        }
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/payments/webhooks/:provider', async (req, res) => {
    try {
      const provider = String(req.params.provider || '').trim().toLowerCase();
      const reference = String(req.body.reference || req.body.data?.reference || '').trim();
      const status = String(req.body.status || req.body.data?.status || 'received').trim().toLowerCase();

      await db.execute(
        'INSERT INTO payment_webhooks (provider, reference, payload, status) VALUES (?, ?, ?, ?)',
        [provider, reference || null, JSON.stringify(req.body || {}), status]
      );

      if (reference) {
        await db.execute('UPDATE payments SET status = ? WHERE reference = ?', [status, reference]);
        const payment = (await db.query('SELECT * FROM payments WHERE reference = ?', [reference]))[0];
        if (payment) {
          await bus.publish(
            status === 'success' || status === 'successful' ? EVENT_NAMES.PAYMENT_SUCCEEDED : EVENT_NAMES.PAYMENT_FAILED,
            {
              payment_id: payment.id,
              order_id: payment.order_id,
              store_id: payment.store_id,
              reference: payment.reference,
              provider
            }
          );
        }
      }

      return res.json({ received: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/payments/mock/:provider/:reference', async (req, res) => {
    req.params.provider = req.params.provider;
    req.body.reference = req.params.reference;
    req.body.status = req.query.status || 'success';
    return app._router.handle(req, res, () => undefined);
  });
};

module.exports = {
  registerRoutes
};
