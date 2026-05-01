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
  `
];

module.exports = {
  schemaStatements
};
