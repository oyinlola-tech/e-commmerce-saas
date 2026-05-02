const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS products (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(180) NOT NULL,
      slug VARCHAR(180) NOT NULL,
      category VARCHAR(120) NULL,
      description TEXT NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      compare_at_price DECIMAL(12,2) NULL,
      sku VARCHAR(120) NULL,
      inventory_count INT NOT NULL DEFAULT 0,
      reserved_count INT NOT NULL DEFAULT 0,
      images JSON NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'draft',
      deleted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_products_store_slug (store_id, slug),
      UNIQUE KEY uq_products_store_sku (store_id, sku),
      KEY idx_products_store_status (store_id, status),
      KEY idx_products_store_slug_lookup (store_id, slug),
      KEY idx_products_store_created (store_id, created_at),
      KEY idx_products_category (category)
    )
  `,
  {
    sql: `
      ALTER TABLE products
      ADD COLUMN base_price DECIMAL(12,2) NULL AFTER price
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE products
      ADD COLUMN promotion_type VARCHAR(20) NOT NULL DEFAULT 'none' AFTER compare_at_price
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE products
      ADD COLUMN discount_type VARCHAR(20) NOT NULL DEFAULT 'none' AFTER promotion_type
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE products
      ADD COLUMN discount_value DECIMAL(12,2) NULL DEFAULT NULL AFTER discount_type
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE products
      ADD COLUMN discount_label VARCHAR(120) NULL AFTER discount_value
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE products
      ADD COLUMN discount_starts_at DATETIME NULL AFTER discount_label
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE products
      ADD COLUMN discount_ends_at DATETIME NULL AFTER discount_starts_at
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  `
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'reserved',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_inventory_reservations_store_id (store_id),
      KEY idx_inventory_reservations_order_id (order_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS inventory_reservation_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      reservation_id VARCHAR(64) NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_inventory_reservation_items_reservation_id (reservation_id),
      KEY idx_inventory_reservation_items_product_id (product_id)
    )
  `
];

module.exports = {
  schemaStatements
};
