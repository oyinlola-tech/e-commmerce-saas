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
];

module.exports = {
  schemaStatements
};
