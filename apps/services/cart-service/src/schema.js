const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS carts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      customer_id BIGINT UNSIGNED NULL,
      session_id VARCHAR(120) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_carts_store_customer (store_id, customer_id),
      KEY idx_carts_store_session (store_id, session_id),
      KEY idx_carts_customer_id (customer_id),
      KEY idx_carts_session_id (session_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS cart_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      cart_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      price_at_time DECIMAL(12,2) NOT NULL DEFAULT 0,
      title_snapshot VARCHAR(180) NULL,
      image_snapshot VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cart_items_cart_product (cart_id, product_id),
      KEY idx_cart_items_cart_id (cart_id),
      KEY idx_cart_items_product_id (product_id)
    )
  `
];

module.exports = {
  schemaStatements
};
