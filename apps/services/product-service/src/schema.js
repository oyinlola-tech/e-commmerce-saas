const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS products (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(180) NOT NULL,
      slug VARCHAR(180) NOT NULL,
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
      KEY idx_products_store_status (store_id, status)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'reserved',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS inventory_reservation_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      reservation_id VARCHAR(64) NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_inventory_reservation_items_reservation_id (reservation_id)
    )
  `
];

module.exports = {
  schemaStatements
};
