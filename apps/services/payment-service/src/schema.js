const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS payments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id BIGINT UNSIGNED NOT NULL,
      store_id BIGINT UNSIGNED NOT NULL,
      customer_id BIGINT UNSIGNED NULL,
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
      KEY idx_payments_order_id (order_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS payment_provider_configs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      provider VARCHAR(40) NOT NULL,
      public_key VARCHAR(255) NULL,
      secret_key_encrypted TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'inactive',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payment_provider_configs_store_provider (store_id, provider)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS payment_webhooks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(40) NOT NULL,
      reference VARCHAR(191) NULL,
      payload JSON NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'received',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `
];

module.exports = {
  schemaStatements
};
