const http = require('http');
const rateLimit = require('express-rate-limit');
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
  createRedisRateLimitStore
} = require('./rate-limit');
const {
  errorHandler,
  notFoundHandler
} = require('./errors');

const buildRateLimitKey = (req) => {
  const scopedIdentity = [
    req.headers['x-store-id'] || '',
    req.headers['x-user-id'] || '',
    req.headers['x-customer-id'] || '',
    req.headers['x-forwarded-host'] || ''
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(':');

  return scopedIdentity || req.ip;
};

const createServiceRateLimiter = ({ windowMs, limit, store }) => {
  const options = {
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: buildRateLimitKey
  };

  if (store) {
    options.store = store;
  }

  return rateLimit(options);
};

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
  const app = createBaseApp({
    serviceName,
    logger,
    trustProxy: 1
  });
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

  const globalRateLimitStore = cache.redis
    ? createRedisRateLimitStore({
      redis: cache.redis,
      prefix: `${config.redisPrefix}:ratelimit:global`,
      windowMs: config.rateLimitWindowMs
    })
    : null;
  const mutationRateLimitStore = cache.redis
    ? createRedisRateLimitStore({
      redis: cache.redis,
      prefix: `${config.redisPrefix}:ratelimit:mutation`,
      windowMs: config.mutationRateLimitWindowMs
    })
    : null;
  const globalRateLimiter = createServiceRateLimiter({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    store: globalRateLimitStore
  });
  const mutationRateLimiter = createServiceRateLimiter({
    windowMs: config.mutationRateLimitWindowMs,
    limit: config.mutationRateLimitMax,
    store: mutationRateLimitStore
  });

  app.use(globalRateLimiter);
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    return mutationRateLimiter(req, res, next);
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

  let shutdownPromise = null;
  const shutdown = (signal = 'unknown') => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      let exitCode = 0;

      try {
        logger.info('Shutting down service', {
          signal,
          serviceName
        });
        await new Promise((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }

          server.close(() => resolve());
        });
        await Promise.allSettled([
          bus.close(),
          cache.close(),
          db.close()
        ]);
      } catch (error) {
        exitCode = 1;
        logger.error('Service shutdown failed', {
          signal,
          serviceName,
          error
        });
      } finally {
        process.exit(exitCode);
      }
    })();

    return shutdownPromise;
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  return context;
};

module.exports = {
  startService
};
