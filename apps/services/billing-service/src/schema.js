const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS billing_plan_settings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      plan_code VARCHAR(50) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      monthly_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      yearly_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_billing_plan_settings_plan_code (plan_code)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      plan VARCHAR(50) NOT NULL DEFAULT 'launch',
      status VARCHAR(40) NOT NULL DEFAULT 'trialing',
      billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
      currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
      plan_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      billing_email VARCHAR(190) NULL,
      provider VARCHAR(40) NULL,
      payment_reference VARCHAR(191) NULL,
      authorization_code VARCHAR(191) NULL,
      authorization_email VARCHAR(190) NULL,
      authorization_signature VARCHAR(191) NULL,
      authorization_payload JSON NULL,
      authorization_reusable TINYINT(1) NOT NULL DEFAULT 0,
      authorization_verified_at DATETIME NULL,
      started_at DATETIME NULL,
      cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
      cancelled_at DATETIME NULL,
      trial_ends_at DATETIME NULL,
      current_period_end DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_subscriptions_owner_id (owner_id),
      KEY idx_subscriptions_status (status),
      KEY idx_subscriptions_payment_reference (payment_reference)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS invoices (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      subscription_id BIGINT UNSIGNED NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
      provider VARCHAR(40) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'draft',
      payment_reference VARCHAR(191) NULL,
      provider_reference VARCHAR(191) NULL,
      description VARCHAR(191) NULL,
      period_start DATETIME NULL,
      period_end DATETIME NULL,
      paid_at DATETIME NULL,
      failed_at DATETIME NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_invoices_owner_id (owner_id),
      KEY idx_invoices_subscription_id (subscription_id),
      KEY idx_invoices_status (status),
      KEY idx_invoices_payment_reference (payment_reference)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS billing_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NULL,
      subscription_id BIGINT UNSIGNED NULL,
      invoice_id BIGINT UNSIGNED NULL,
      event_type VARCHAR(80) NOT NULL,
      reference VARCHAR(191) NULL,
      payload JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_billing_events_owner_id (owner_id),
      KEY idx_billing_events_invoice_id (invoice_id),
      KEY idx_billing_events_reference (reference)
    )
  `
];

module.exports = {
  schemaStatements
};
