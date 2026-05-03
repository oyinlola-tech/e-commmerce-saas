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
  `
    CREATE TABLE IF NOT EXISTS payment_webhooks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(40) NOT NULL,
      reference VARCHAR(191) NULL,
      payload JSON NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'received',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_payment_webhooks_reference (reference)
    )
  `
];

module.exports = {
  schemaStatements
};
