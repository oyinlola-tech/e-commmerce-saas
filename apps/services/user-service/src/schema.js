const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS platform_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(40) NOT NULL DEFAULT 'store_owner',
      bootstrap_key VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      password_reset_otp_hash VARCHAR(255) NULL,
      password_reset_otp_expires_at DATETIME NULL,
      password_reset_requested_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_platform_users_bootstrap_key (bootstrap_key),
      UNIQUE KEY uq_platform_users_email (email),
      KEY idx_platform_users_email (email)
    )
  `
];

module.exports = {
  schemaStatements
};
