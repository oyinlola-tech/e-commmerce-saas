/**
 * Database Migrations
 * Run via: npm run migrate (or implement in bootstrap)
 * 
 * These migrations add:
 * 1. Audit logging tables
 * 2. Store onboarding state machine
 * 3. Product reviews system
 * 4. Product categories
 */

const migrations = [
  {
    id: '001_create_audit_logs',
    up: async (db) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          actor_type VARCHAR(50) NOT NULL,
          actor_id INT,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(50),
          resource_id INT,
          store_id INT,
          details JSON,
          ip_address VARCHAR(45),
          user_agent VARCHAR(500),
          status ENUM('success', 'failure') DEFAULT 'success',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_actor (actor_id, actor_type, created_at),
          INDEX idx_resource (resource_type, resource_id),
          INDEX idx_store (store_id, action, created_at),
          INDEX idx_action (action, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async (db) => {
      await db.query('DROP TABLE IF EXISTS audit_logs');
    }
  },

  {
    id: '002_create_onboarding_tables',
    up: async (db) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS store_onboarding_states (
          id INT PRIMARY KEY AUTO_INCREMENT,
          store_id INT NOT NULL UNIQUE,
          current_step ENUM('initial', 'store_details', 'domain_setup', 'product_creation', 'payment_config', 'launch', 'completed') NOT NULL DEFAULT 'initial',
          step_metadata JSON,
          completed_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
          INDEX idx_status (current_step)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS onboarding_tasks (
          id INT PRIMARY KEY AUTO_INCREMENT,
          store_id INT NOT NULL,
          task_key VARCHAR(100) NOT NULL,
          task_title VARCHAR(255) NOT NULL,
          task_description TEXT,
          task_step ENUM('initial', 'store_details', 'domain_setup', 'product_creation', 'payment_config', 'launch') NOT NULL,
          is_complete BOOLEAN DEFAULT FALSE,
          required BOOLEAN DEFAULT FALSE,
          completed_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_store_task (store_id, task_key),
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
          INDEX idx_status (store_id, is_complete, required)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async (db) => {
      await db.query('DROP TABLE IF EXISTS onboarding_tasks');
      await db.query('DROP TABLE IF EXISTS store_onboarding_states');
    }
  },

  {
    id: '003_create_product_categories_and_reviews',
    up: async (db) => {
      // Categories
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_categories (
          id INT PRIMARY KEY AUTO_INCREMENT,
          store_id INT NOT NULL,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL,
          description TEXT,
          image_url VARCHAR(500),
          display_order INT DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_store_slug (store_id, slug),
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
          INDEX idx_active (store_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // Add category_id to products if not exists
      await db.query(`
        ALTER TABLE products 
        ADD COLUMN IF NOT EXISTS category_id INT,
        ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3, 2),
        ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0,
        ADD FULLTEXT INDEX IF NOT EXISTS ft_search (name, description),
        ADD FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL,
        ADD INDEX idx_category (store_id, category_id, is_published)
      `);

      // Reviews
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_reviews (
          id INT PRIMARY KEY AUTO_INCREMENT,
          product_id INT NOT NULL,
          store_id INT NOT NULL,
          customer_id INT NOT NULL,
          order_item_id INT,
          rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
          title VARCHAR(255),
          body TEXT,
          verified_purchase BOOLEAN DEFAULT FALSE,
          is_approved BOOLEAN DEFAULT FALSE,
          helpful_count INT DEFAULT 0,
          unhelpful_count INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
          INDEX idx_product_approved (product_id, is_approved, created_at DESC),
          INDEX idx_store_approved (store_id, is_approved, created_at DESC),
          INDEX idx_rating (product_id, rating)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async (db) => {
      await db.query('DROP TABLE IF EXISTS product_reviews');
      await db.query(`
        ALTER TABLE products 
        DROP FOREIGN KEY IF EXISTS products_ibfk_category,
        DROP COLUMN IF EXISTS category_id,
        DROP COLUMN IF EXISTS review_count,
        DROP COLUMN IF EXISTS average_rating,
        DROP COLUMN IF EXISTS view_count,
        DROP INDEX IF EXISTS ft_search,
        DROP INDEX IF EXISTS idx_category
      `);
      await db.query('DROP TABLE IF EXISTS product_categories');
    }
  },

  {
    id: '004_create_collections_tables',
    up: async (db) => {
      // Collections (curated product groups)
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_collections (
          id INT PRIMARY KEY AUTO_INCREMENT,
          store_id INT NOT NULL,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL,
          description TEXT,
          image_url VARCHAR(500),
          is_active BOOLEAN DEFAULT TRUE,
          display_order INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_store_slug (store_id, slug),
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
          INDEX idx_active (store_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS collection_products (
          collection_id INT NOT NULL,
          product_id INT NOT NULL,
          display_order INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (collection_id, product_id),
          FOREIGN KEY (collection_id) REFERENCES product_collections(id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          INDEX idx_product (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async (db) => {
      await db.query('DROP TABLE IF EXISTS collection_products');
      await db.query('DROP TABLE IF EXISTS product_collections');
    }
  },

  {
    id: '005_create_email_tracking_tables',
    up: async (db) => {
      // Email send tracking
      await db.query(`
        CREATE TABLE IF NOT EXISTS emails_sent (
          id INT PRIMARY KEY AUTO_INCREMENT,
          cart_id INT,
          order_id INT,
          customer_id INT,
          store_id INT,
          template_key VARCHAR(100) NOT NULL,
          recipient VARCHAR(255) NOT NULL,
          subject VARCHAR(255),
          status ENUM('sent', 'bounced', 'complained') DEFAULT 'sent',
          metadata JSON,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_customer (customer_id, template_key),
          INDEX idx_store (store_id, sent_at DESC),
          INDEX idx_status (status, sent_at DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // Abandoned carts
      await db.query(`
        ALTER TABLE carts 
        ADD COLUMN IF NOT EXISTS abandoned_email_sent_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS recovery_token VARCHAR(500),
        ADD INDEX IF NOT EXISTS idx_abandoned (updated_at, abandoned_email_sent_at)
      `);
    },
    down: async (db) => {
      await db.query('DROP TABLE IF EXISTS emails_sent');
      await db.query(`
        ALTER TABLE carts 
        DROP COLUMN IF EXISTS abandoned_email_sent_at,
        DROP COLUMN IF EXISTS recovery_token,
        DROP INDEX IF EXISTS idx_abandoned
      `);
    }
  }
];

/**
 * Run migrations
 * @param {object} db - Database connection
 * @param {boolean} down - Whether to rollback (default: false for up)
 */
const runMigrations = async (db, down = false) => {
  const direction = down ? 'down' : 'up';
  const method = down ? 'down' : 'up';

  console.log(`Running ${direction} migrations...`);

  for (const migration of migrations) {
    try {
      console.log(`  ${direction}: ${migration.id}`);
      await migration[method](db);
    } catch (error) {
      console.error(`  FAILED: ${migration.id}`, error.message);
      if (!down) throw error; // Stop on up error, continue on down
    }
  }

  console.log(`✓ All ${direction} migrations completed`);
};

module.exports = {
  migrations,
  runMigrations
};
