const http = require('http');
const {
  createServiceConfig
} = require('./env');
const {
  createLogger
} = require('./logger');
const {
  bootstrapDatabase
} = require('./database');
const {
  createEventBus
} = require('./events');
const {
  createBaseApp
} = require('./express');
const {
  createCache
} = require('./cache');
const {
  errorHandler,
  notFoundHandler
} = require('./errors');

const startService = async ({
  appRoot,
  serviceName,
  defaultPort,
  defaultDatabase,
  schemaStatements,
  registerRoutes,
  registerConsumers,
  setupSockets
}) => {
  const config = createServiceConfig({
    appRoot,
    serviceName,
    defaultPort,
    defaultDatabase
  });
  const logger = createLogger(serviceName);
  const db = await bootstrapDatabase({
    databaseUrl: config.databaseUrl,
    readDatabaseUrls: config.databaseReadUrls,
    statements: schemaStatements,
    logger,
    poolConfig: {
      min: config.databasePoolMin,
      max: config.databasePoolMax,
      idleTimeoutMs: config.databaseIdleTimeoutMs,
      acquireTimeoutMs: config.databaseAcquireTimeoutMs
    },
    retryConfig: {
      retries: config.databaseConnectRetries,
      delayMs: config.databaseRetryDelayMs
    }
  });
  const bus = await createEventBus(config, logger);
  const cache = await createCache(config, logger);
  const app = createBaseApp({ serviceName, logger });
  const server = http.createServer(app);
  const context = {
    app,
    server,
    config,
    db,
    bus,
    cache,
    logger,
    serviceName
  };

  app.get('/health', async (req, res) => {
    try {
      const database = await db.healthCheck();
      const cacheStatus = await cache.healthCheck();
      return res.json({
        service: serviceName,
        status: 'ok',
        database,
        rabbitmq: bus.connected ? 'connected' : 'noop',
        cache: cacheStatus
      });
    } catch (error) {
      return res.status(500).json({
        service: serviceName,
        status: 'error',
        error: error.message
      });
    }
  });

  await registerRoutes(context);

  if (typeof setupSockets === 'function') {
    context.realtime = await setupSockets(context);
  }

  if (typeof registerConsumers === 'function') {
    await registerConsumers(context);
  }

  app.use(notFoundHandler);
  app.use(errorHandler({
    logger,
    isProduction: config.isProduction,
    serviceName
  }));

  server.listen(config.port, () => {
    logger.info('Service listening', {
      port: config.port,
      serviceName
    });
  });

  const shutdown = async () => {
    logger.info('Shutting down service');
    server.close(async () => {
      await Promise.allSettled([
        bus.close(),
        cache.close(),
        db.close()
      ]);
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return context;
};

module.exports = {
  startService
};
