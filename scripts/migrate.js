const path = require('path');
const {
  createServiceConfig,
  createLogger,
  bootstrapDatabase
} = require('../packages/shared');
const {
  SERVICE_MIGRATION_TARGETS,
  runMigrations
} = require('../database/migrations');

const TARGET_CONFIGS = {
  'billing-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/billing-service'),
    defaultPort: 4109,
    defaultDatabase: 'billing_db',
    schemaModulePath: '../apps/services/billing-service/src/schema'
  },
  'cart-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/cart-service'),
    defaultPort: 4106,
    defaultDatabase: 'carts_db',
    schemaModulePath: '../apps/services/cart-service/src/schema'
  },
  'compliance-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/compliance-service'),
    defaultPort: 4103,
    defaultDatabase: 'compliance_db',
    schemaModulePath: '../apps/services/compliance-service/src/schema'
  },
  'customer-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/customer-service'),
    defaultPort: 4104,
    defaultDatabase: 'customers_db',
    schemaModulePath: '../apps/services/customer-service/src/schema'
  },
  'notification-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/notification-service'),
    defaultPort: 4112,
    defaultDatabase: 'notifications_db',
    schemaModulePath: '../apps/services/notification-service/src/schema'
  },
  'order-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/order-service'),
    defaultPort: 4107,
    defaultDatabase: 'orders_db',
    schemaModulePath: '../apps/services/order-service/src/schema'
  },
  'payment-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/payment-service'),
    defaultPort: 4108,
    defaultDatabase: 'payments_db',
    schemaModulePath: '../apps/services/payment-service/src/schema'
  },
  'product-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/product-service'),
    defaultPort: 4105,
    defaultDatabase: 'products_db',
    schemaModulePath: '../apps/services/product-service/src/schema'
  },
  'store-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/store-service'),
    defaultPort: 4102,
    defaultDatabase: 'stores_db',
    schemaModulePath: '../apps/services/store-service/src/schema'
  },
  'user-service': {
    appRoot: path.resolve(__dirname, '..', 'apps/services/user-service'),
    defaultPort: 4101,
    defaultDatabase: 'users_db',
    schemaModulePath: '../apps/services/user-service/src/schema'
  }
};

const parseArgs = (argv = []) => {
  const isDown = argv.includes('--down');
  const listOnly = argv.includes('--list');
  const targetArg = argv.find((arg) => arg.startsWith('--target=') || arg.startsWith('--service='));
  const targetNames = targetArg
    ? targetArg.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean)
    : [...SERVICE_MIGRATION_TARGETS];

  return {
    isDown,
    listOnly,
    targetNames
  };
};

const loadSchemaStatements = (schemaModulePath) => {
  const loaded = require(schemaModulePath);
  return Array.isArray(loaded?.schemaStatements) ? loaded.schemaStatements : [];
};

const connectTargetDatabase = async (targetName, logger) => {
  const targetConfig = TARGET_CONFIGS[targetName];
  if (!targetConfig) {
    throw new Error(`Unknown migration target: ${targetName}`);
  }

  const serviceConfig = createServiceConfig({
    appRoot: targetConfig.appRoot,
    serviceName: targetName,
    defaultPort: targetConfig.defaultPort,
    defaultDatabase: targetConfig.defaultDatabase
  });

  return bootstrapDatabase({
    databaseUrl: serviceConfig.databaseUrl,
    readDatabaseUrls: serviceConfig.databaseReadUrls,
    statements: loadSchemaStatements(targetConfig.schemaModulePath),
    logger,
    poolConfig: {
      min: serviceConfig.databasePoolMin,
      max: serviceConfig.databasePoolMax,
      idleTimeoutMs: serviceConfig.databaseIdleTimeoutMs,
      acquireTimeoutMs: serviceConfig.databaseAcquireTimeoutMs
    },
    retryConfig: {
      retries: serviceConfig.databaseConnectRetries,
      delayMs: serviceConfig.databaseRetryDelayMs
    }
  });
};

const main = async () => {
  const logger = createLogger('migrations');
  const { isDown, listOnly, targetNames } = parseArgs(process.argv.slice(2));

  if (listOnly) {
    SERVICE_MIGRATION_TARGETS.forEach((targetName) => {
      process.stdout.write(`${targetName}\n`);
    });
    return;
  }

  const unknownTargets = targetNames.filter((targetName) => !TARGET_CONFIGS[targetName]);
  if (unknownTargets.length) {
    throw new Error(`Unknown migration target(s): ${unknownTargets.join(', ')}`);
  }

  for (const targetName of targetNames) {
    logger.info('migration_target_started', {
      targetName,
      direction: isDown ? 'down' : 'up'
    });

    const db = await connectTargetDatabase(targetName, logger);
    try {
      await runMigrations({
        db,
        down: isDown,
        targetName,
        logger
      });
    } finally {
      await db.close();
    }

    logger.info('migration_target_completed', {
      targetName,
      direction: isDown ? 'down' : 'up'
    });
  }
};

main().catch((error) => {
  const logger = createLogger('migrations');
  logger.error('migration_command_failed', {
    error: error.message
  });
  process.exit(1);
});
