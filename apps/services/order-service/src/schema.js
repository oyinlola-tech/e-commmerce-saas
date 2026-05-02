const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      customer_id BIGINT UNSIGNED NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      payment_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      reservation_id VARCHAR(64) NULL,
      payment_reference VARCHAR(191) NULL,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
      shipping_address JSON NULL,
      customer_snapshot JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_orders_store_customer (store_id, customer_id),
      KEY idx_orders_store_status (store_id, status),
      KEY idx_orders_store_created (store_id, created_at),
      KEY idx_orders_customer_id (customer_id)
    )
  `,
  {
    sql: `
      ALTER TABLE orders
      ADD COLUMN discount_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER subtotal
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE orders
      ADD COLUMN coupon_code VARCHAR(80) NULL AFTER currency
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  {
    sql: `
      ALTER TABLE orders
      ADD COLUMN coupon_snapshot JSON NULL AFTER coupon_code
    `,
    ignoreErrorCodes: ['ER_DUP_FIELDNAME']
  },
  `
    CREATE TABLE IF NOT EXISTS order_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(180) NOT NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      quantity INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_order_items_order_id (order_id),
      KEY idx_order_items_product_id (product_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS coupons (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      code VARCHAR(80) NOT NULL,
      description VARCHAR(190) NULL,
      discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
      discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
      minimum_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      starts_at DATETIME NULL,
      ends_at DATETIME NULL,
      usage_limit INT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_coupons_store_code (store_id, code),
      KEY idx_coupons_store_active (store_id, is_active),
      KEY idx_coupons_store_window (store_id, starts_at, ends_at)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      coupon_id BIGINT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED NOT NULL,
      store_id BIGINT UNSIGNED NOT NULL,
      customer_id BIGINT UNSIGNED NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      discount_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_coupon_redemptions_coupon_order (coupon_id, order_id),
      KEY idx_coupon_redemptions_coupon_status (coupon_id, status),
      KEY idx_coupon_redemptions_order_id (order_id),
      KEY idx_coupon_redemptions_store_status (store_id, status)
    )
  `
];

module.exports = {
  schemaStatements
};
