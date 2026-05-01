-- Aisle Commerce SaaS: security and performance support migration
-- Run these statements in the relevant service databases if your environment was created
-- before the current schema defaults were applied.

ALTER TABLE stores
  ADD COLUMN logo_url VARCHAR(255) NULL AFTER custom_domain;

CREATE INDEX idx_stores_domain_lookup ON stores (custom_domain);
CREATE INDEX idx_stores_subdomain_lookup ON stores (subdomain);
CREATE INDEX idx_products_store_slug_lookup ON products (store_id, slug);
CREATE INDEX idx_products_store_status ON products (store_id, status);
CREATE INDEX idx_orders_store_customer ON orders (store_id, customer_id);
CREATE INDEX idx_orders_customer_id ON orders (customer_id);
CREATE INDEX idx_carts_session_id ON carts (session_id);
