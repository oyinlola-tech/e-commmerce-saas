const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS stores (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(150) NOT NULL,
      subdomain VARCHAR(120) NOT NULL,
      custom_domain VARCHAR(190) NULL,
      logo_url VARCHAR(255) NULL,
      theme_color VARCHAR(20) NULL,
      store_type VARCHAR(50) NOT NULL,
      template_key VARCHAR(50) NOT NULL,
      font_preset VARCHAR(50) NOT NULL,
      support_email VARCHAR(190) NULL,
      contact_phone VARCHAR(50) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      ssl_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_stores_subdomain (subdomain),
      UNIQUE KEY uq_stores_custom_domain (custom_domain),
      KEY idx_stores_owner_id (owner_id)
    )
  `
];

module.exports = {
  schemaStatements
};
