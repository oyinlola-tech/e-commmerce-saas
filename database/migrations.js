/**
 * Database Migrations
 *
 * This repo stores data in per-service databases, so migrations are scoped to
 * the services that own the affected tables instead of assuming one shared DB.
 */

const SERVICE_MIGRATION_TARGETS = [
  'billing-service',
  'cart-service',
  'compliance-service',
  'customer-service',
  'notification-service',
  'order-service',
  'payment-service',
  'product-service',
  'store-service',
  'user-service'
];

const executeIgnoring = async (db, sql, ignoreErrorCodes = []) => {
  try {
    await db.query(sql);
  } catch (error) {
    if (ignoreErrorCodes.includes(error.code)) {
      return;
    }

    throw error;
  }
};

const executeStatements = async (db, statements = []) => {
  for (const statement of statements) {
    if (typeof statement === 'string') {
      await db.query(statement);
      continue;
    }

    await executeIgnoring(
      db,
      statement.sql,
      Array.isArray(statement.ignoreErrorCodes) ? statement.ignoreErrorCodes : []
    );
  }
};

const migrations = [
  {
    id: '001_create_audit_logs',
    targets: SERVICE_MIGRATION_TARGETS,
    up: async ({ db }) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          actor_type VARCHAR(50) NOT NULL,
          actor_id BIGINT UNSIGNED NULL,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(50) NULL,
          resource_id BIGINT UNSIGNED NULL,
          store_id BIGINT UNSIGNED NULL,
          details JSON NULL,
          ip_address VARCHAR(45) NULL,
          user_agent VARCHAR(500) NULL,
          status ENUM('success', 'failure') NOT NULL DEFAULT 'success',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_audit_logs_actor (actor_id, actor_type, created_at),
          KEY idx_audit_logs_resource (resource_type, resource_id),
          KEY idx_audit_logs_store (store_id, action, created_at),
          KEY idx_audit_logs_action (action, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async ({ db }) => {
      await db.query('DROP TABLE IF EXISTS audit_logs');
    }
  },
  {
    id: '002_create_onboarding_tables',
    targets: ['store-service'],
    up: async ({ db }) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS store_onboarding_states (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          store_id BIGINT UNSIGNED NOT NULL,
          current_step ENUM(
            'initial',
            'store_details',
            'domain_setup',
            'product_creation',
            'payment_config',
            'launch',
            'completed'
          ) NOT NULL DEFAULT 'initial',
          step_metadata JSON NULL,
          completed_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_store_onboarding_states_store_id (store_id),
          KEY idx_store_onboarding_states_step (current_step)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS onboarding_tasks (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          store_id BIGINT UNSIGNED NOT NULL,
          task_key VARCHAR(100) NOT NULL,
          task_title VARCHAR(255) NOT NULL,
          task_description TEXT NULL,
          task_step ENUM(
            'initial',
            'store_details',
            'domain_setup',
            'product_creation',
            'payment_config',
            'launch'
          ) NOT NULL,
          is_complete TINYINT(1) NOT NULL DEFAULT 0,
          required TINYINT(1) NOT NULL DEFAULT 0,
          completed_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_onboarding_tasks_store_key (store_id, task_key),
          KEY idx_onboarding_tasks_status (store_id, is_complete, required)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async ({ db }) => {
      await db.query('DROP TABLE IF EXISTS onboarding_tasks');
      await db.query('DROP TABLE IF EXISTS store_onboarding_states');
    }
  },
  {
    id: '003_create_product_categories_and_reviews',
    targets: ['product-service'],
    up: async ({ db }) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_categories (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          store_id BIGINT UNSIGNED NOT NULL,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL,
          description TEXT NULL,
          image_url VARCHAR(500) NULL,
          display_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_product_categories_store_slug (store_id, slug),
          KEY idx_product_categories_active (store_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await executeStatements(db, [
        {
          sql: `
            ALTER TABLE products
            ADD COLUMN category_id BIGINT UNSIGNED NULL AFTER category
          `,
          ignoreErrorCodes: ['ER_DUP_FIELDNAME']
        },
        {
          sql: `
            ALTER TABLE products
            ADD COLUMN review_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER category_id
          `,
          ignoreErrorCodes: ['ER_DUP_FIELDNAME']
        },
        {
          sql: `
            ALTER TABLE products
            ADD COLUMN average_rating DECIMAL(3,2) NULL AFTER review_count
          `,
          ignoreErrorCodes: ['ER_DUP_FIELDNAME']
        },
        {
          sql: `
            ALTER TABLE products
            ADD COLUMN view_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER average_rating
          `,
          ignoreErrorCodes: ['ER_DUP_FIELDNAME']
        },
        {
          sql: `
            ALTER TABLE products
            ADD FULLTEXT INDEX ft_products_search (title, description)
          `,
          ignoreErrorCodes: ['ER_DUP_KEYNAME']
        },
        {
          sql: `
            ALTER TABLE products
            ADD INDEX idx_products_category_lookup (store_id, category_id, status)
          `,
          ignoreErrorCodes: ['ER_DUP_KEYNAME']
        }
      ]);

      await db.query(`
        CREATE TABLE IF NOT EXISTS product_reviews (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          product_id BIGINT UNSIGNED NOT NULL,
          store_id BIGINT UNSIGNED NOT NULL,
          customer_id BIGINT UNSIGNED NOT NULL,
          order_item_id BIGINT UNSIGNED NULL,
          rating TINYINT UNSIGNED NOT NULL,
          title VARCHAR(255) NULL,
          body TEXT NULL,
          verified_purchase TINYINT(1) NOT NULL DEFAULT 0,
          is_approved TINYINT(1) NOT NULL DEFAULT 0,
          helpful_count INT UNSIGNED NOT NULL DEFAULT 0,
          unhelpful_count INT UNSIGNED NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_product_reviews_product_approved (product_id, is_approved, created_at),
          KEY idx_product_reviews_store_approved (store_id, is_approved, created_at),
          KEY idx_product_reviews_rating (product_id, rating)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async ({ db }) => {
      await db.query('DROP TABLE IF EXISTS product_reviews');
      await executeStatements(db, [
        {
          sql: 'ALTER TABLE products DROP INDEX ft_products_search',
          ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
        },
        {
          sql: 'ALTER TABLE products DROP INDEX idx_products_category_lookup',
          ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
        },
        {
          sql: 'ALTER TABLE products DROP COLUMN view_count',
          ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
        },
        {
          sql: 'ALTER TABLE products DROP COLUMN average_rating',
          ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
        },
        {
          sql: 'ALTER TABLE products DROP COLUMN review_count',
          ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
        },
        {
          sql: 'ALTER TABLE products DROP COLUMN category_id',
          ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
        }
      ]);
      await db.query('DROP TABLE IF EXISTS product_categories');
    }
  },
  {
    id: '004_create_collections_tables',
    targets: ['product-service'],
    up: async ({ db }) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_collections (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          store_id BIGINT UNSIGNED NOT NULL,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL,
          description TEXT NULL,
          image_url VARCHAR(500) NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          display_order INT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_product_collections_store_slug (store_id, slug),
          KEY idx_product_collections_active (store_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS collection_products (
          collection_id BIGINT UNSIGNED NOT NULL,
          product_id BIGINT UNSIGNED NOT NULL,
          display_order INT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (collection_id, product_id),
          KEY idx_collection_products_product (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
    down: async ({ db }) => {
      await db.query('DROP TABLE IF EXISTS collection_products');
      await db.query('DROP TABLE IF EXISTS product_collections');
    }
  },
  {
    id: '005_create_email_tracking_tables',
    targets: ['notification-service', 'cart-service'],
    up: async ({ db, targetName }) => {
      if (targetName === 'notification-service') {
        await db.query(`
          CREATE TABLE IF NOT EXISTS emails_sent (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            cart_id BIGINT UNSIGNED NULL,
            order_id BIGINT UNSIGNED NULL,
            customer_id BIGINT UNSIGNED NULL,
            store_id BIGINT UNSIGNED NULL,
            template_key VARCHAR(100) NOT NULL,
            recipient VARCHAR(255) NOT NULL,
            subject VARCHAR(255) NULL,
            status ENUM('sent', 'bounced', 'complained') NOT NULL DEFAULT 'sent',
            metadata JSON NULL,
            sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_emails_sent_customer (customer_id, template_key),
            KEY idx_emails_sent_store (store_id, sent_at),
            KEY idx_emails_sent_status (status, sent_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
      }

      if (targetName === 'cart-service') {
        await executeStatements(db, [
          {
            sql: `
              ALTER TABLE carts
              ADD COLUMN abandoned_email_sent_at DATETIME NULL AFTER updated_at
            `,
            ignoreErrorCodes: ['ER_DUP_FIELDNAME']
          },
          {
            sql: `
              ALTER TABLE carts
              ADD COLUMN recovery_token VARCHAR(500) NULL AFTER abandoned_email_sent_at
            `,
            ignoreErrorCodes: ['ER_DUP_FIELDNAME']
          },
          {
            sql: `
              ALTER TABLE carts
              ADD INDEX idx_carts_abandoned (updated_at, abandoned_email_sent_at)
            `,
            ignoreErrorCodes: ['ER_DUP_KEYNAME']
          }
        ]);
      }
    },
    down: async ({ db, targetName }) => {
      if (targetName === 'notification-service') {
        await db.query('DROP TABLE IF EXISTS emails_sent');
      }

      if (targetName === 'cart-service') {
        await executeStatements(db, [
          {
            sql: 'ALTER TABLE carts DROP INDEX idx_carts_abandoned',
            ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
          },
          {
            sql: 'ALTER TABLE carts DROP COLUMN recovery_token',
            ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
          },
          {
            sql: 'ALTER TABLE carts DROP COLUMN abandoned_email_sent_at',
            ignoreErrorCodes: ['ER_CANT_DROP_FIELD_OR_KEY']
          }
        ]);
      }
    }
  }
];

const resolveRunOptions = (dbOrOptions, down = false) => {
  if (dbOrOptions && typeof dbOrOptions === 'object' && dbOrOptions.db) {
    return {
      db: dbOrOptions.db,
      down: Boolean(dbOrOptions.down),
      targetName: dbOrOptions.targetName || 'default',
      logger: dbOrOptions.logger || console
    };
  }

  return {
    db: dbOrOptions,
    down: Boolean(down),
    targetName: 'default',
    logger: console
  };
};

/**
 * Run migrations for a single service target.
 * @param {object|any} dbOrOptions - Database handle or options object
 * @param {boolean} down - Legacy rollback flag when passing db directly
 */
const runMigrations = async (dbOrOptions, down = false) => {
  const options = resolveRunOptions(dbOrOptions, down);
  const direction = options.down ? 'down' : 'up';
  const method = options.down ? 'down' : 'up';
  const applicableMigrations = migrations.filter((migration) => {
    if (!Array.isArray(migration.targets) || !migration.targets.length) {
      return true;
    }

    return options.targetName === 'default' || migration.targets.includes(options.targetName);
  });

  options.logger?.info?.('migration_run_started', {
    direction,
    targetName: options.targetName,
    total: applicableMigrations.length
  });

  for (const migration of applicableMigrations) {
    try {
      options.logger?.info?.('migration_started', {
        direction,
        targetName: options.targetName,
        migrationId: migration.id
      });
      await migration[method]({
        db: options.db,
        targetName: options.targetName,
        logger: options.logger
      });
      options.logger?.info?.('migration_completed', {
        direction,
        targetName: options.targetName,
        migrationId: migration.id
      });
    } catch (error) {
      options.logger?.error?.('migration_failed', {
        direction,
        targetName: options.targetName,
        migrationId: migration.id,
        error: error.message
      });
      if (!options.down) {
        throw error;
      }
    }
  }

  options.logger?.info?.('migration_run_completed', {
    direction,
    targetName: options.targetName,
    total: applicableMigrations.length
  });
};

module.exports = {
  SERVICE_MIGRATION_TARGETS,
  migrations,
  runMigrations
};
