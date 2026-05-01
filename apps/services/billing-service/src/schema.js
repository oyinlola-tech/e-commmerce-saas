const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      plan VARCHAR(50) NOT NULL DEFAULT 'basic',
      status VARCHAR(40) NOT NULL DEFAULT 'trialing',
      trial_ends_at DATETIME NULL,
      current_period_end DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_subscriptions_owner_id (owner_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS invoices (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      subscription_id BIGINT UNSIGNED NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
      status VARCHAR(40) NOT NULL DEFAULT 'draft',
      provider_reference VARCHAR(191) NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_invoices_owner_id (owner_id)
    )
  `
];

module.exports = {
  schemaStatements
};
