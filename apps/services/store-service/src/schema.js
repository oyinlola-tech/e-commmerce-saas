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
      KEY idx_stores_owner_id (owner_id),
      KEY idx_stores_custom_domain_lookup (custom_domain),
      KEY idx_stores_subdomain_lookup (subdomain)
    )
  `,
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN shipping_origin_country VARCHAR(120) NULL AFTER contact_phone
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN shipping_flat_rate DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER shipping_origin_country
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN domestic_shipping_rate DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER shipping_flat_rate
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN international_shipping_rate DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER domestic_shipping_rate
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN free_shipping_threshold DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER international_shipping_rate
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER free_shipping_threshold
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN tax_label VARCHAR(80) NULL AFTER tax_rate
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE stores
      ADD COLUMN tax_apply_to_shipping TINYINT(1) NOT NULL DEFAULT 0 AFTER tax_label
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  }
];

module.exports = {
  schemaStatements
};
