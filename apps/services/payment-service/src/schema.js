const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS payments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id BIGINT UNSIGNED NULL,
      store_id BIGINT UNSIGNED NULL,
      owner_id BIGINT UNSIGNED NULL,
      customer_id BIGINT UNSIGNED NULL,
      payment_scope VARCHAR(40) NOT NULL DEFAULT 'storefront',
      entity_type VARCHAR(60) NULL,
      entity_id VARCHAR(191) NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
      provider VARCHAR(40) NOT NULL DEFAULT 'paystack',
      reference VARCHAR(191) NOT NULL,
      provider_session_id VARCHAR(191) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payments_reference (reference),
      KEY idx_payments_order_id (order_id),
      KEY idx_payments_store_id (store_id),
      KEY idx_payments_owner_id (owner_id),
      KEY idx_payments_scope (payment_scope),
      KEY idx_payments_entity (entity_type, entity_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS payment_provider_configs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      provider VARCHAR(40) NOT NULL,
      public_key VARCHAR(255) NULL,
      secret_key_encrypted TEXT NULL,
      webhook_secret_hash_encrypted TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'inactive',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payment_provider_configs_store_provider (store_id, provider),
      KEY idx_payment_provider_configs_store_id (store_id)
    )
  `,
  `
    ALTER TABLE payment_provider_configs
    ADD COLUMN IF NOT EXISTS webhook_secret_hash_encrypted TEXT NULL
  `,
  {
    sql: `
      ALTER TABLE payments
      ADD COLUMN verified_at DATETIME NULL AFTER updated_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payments
      ADD COLUMN verification_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER verified_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payments
      ADD COLUMN next_reconciliation_at DATETIME NULL AFTER verification_attempts
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payments
      ADD COLUMN last_reconciliation_error VARCHAR(500) NULL AFTER next_reconciliation_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payments
      ADD INDEX idx_payments_reconciliation (status, next_reconciliation_at)
    `,
    ignoreErrorCodes: ['ER_DUP_KEYNAME']
  },
  `
    CREATE TABLE IF NOT EXISTS payment_webhooks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(40) NOT NULL,
      payment_id BIGINT UNSIGNED NULL,
      reference VARCHAR(191) NULL,
      event_type VARCHAR(120) NULL,
      idempotency_key VARCHAR(191) NULL,
      payload JSON NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'received',
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      last_error VARCHAR(500) NULL,
      next_retry_at DATETIME NULL,
      processed_at DATETIME NULL,
      dead_lettered_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_payment_webhooks_reference (reference),
      KEY idx_payment_webhooks_payment_id (payment_id),
      KEY idx_payment_webhooks_retry (status, next_retry_at),
      UNIQUE KEY uq_payment_webhooks_idempotency_key (idempotency_key)
    )
  `,
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN payment_id BIGINT UNSIGNED NULL AFTER provider
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN event_type VARCHAR(120) NULL AFTER reference
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN idempotency_key VARCHAR(191) NULL AFTER event_type
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER status
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN last_error VARCHAR(500) NULL AFTER attempts
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN next_retry_at DATETIME NULL AFTER last_error
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN processed_at DATETIME NULL AFTER next_retry_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN dead_lettered_at DATETIME NULL AFTER processed_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD UNIQUE KEY uq_payment_webhooks_idempotency_key (idempotency_key)
    `,
    ignoreErrorCodes: ['ER_DUP_KEYNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD INDEX idx_payment_webhooks_payment_id (payment_id)
    `,
    ignoreErrorCodes: ['ER_DUP_KEYNAME']
  },
  {
    sql: `
      ALTER TABLE payment_webhooks
      ADD INDEX idx_payment_webhooks_retry (status, next_retry_at)
    `,
    ignoreErrorCodes: ['ER_DUP_KEYNAME']
  }
];

module.exports = {
  schemaStatements
};
