const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS customers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NULL,
      addresses JSON NULL,
      metadata JSON NULL,
      marketing_email_subscribed TINYINT(1) NOT NULL DEFAULT 1,
      marketing_email_subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      marketing_email_unsubscribed_at DATETIME NULL,
      password_reset_otp_hash VARCHAR(255) NULL,
      password_reset_otp_expires_at DATETIME NULL,
      password_reset_requested_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_customers_store_email (store_id, email),
      KEY idx_customers_store_id (store_id),
      KEY idx_customers_email (email)
    )
  `
  ,
  {
    sql: `
      ALTER TABLE customers
      ADD COLUMN marketing_email_subscribed TINYINT(1) NOT NULL DEFAULT 1 AFTER metadata
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE customers
      ADD COLUMN marketing_email_subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER marketing_email_subscribed
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE customers
      ADD COLUMN marketing_email_unsubscribed_at DATETIME NULL AFTER marketing_email_subscribed_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  }
];

module.exports = {
  schemaStatements
};
