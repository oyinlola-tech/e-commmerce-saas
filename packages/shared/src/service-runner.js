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
    statements: schemaStatements,
    logger
  });
  const bus = await createEventBus(config, logger);
  const app = createBaseApp({ serviceName, logger });
  const server = http.createServer(app);
  const context = {
    app,
    server,
    config,
    db,
    bus,
    logger,
    serviceName
  };

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1 AS ok');
      return res.json({
        service: serviceName,
        status: 'ok',
        database: 'ok',
        rabbitmq: bus.connected ? 'connected' : 'noop'
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

  server.listen(config.port, () => {
    logger.info('Service listening', {
      port: config.port,
      serviceName
    });
  });

  const shutdown = async () => {
    logger.info('Shutting down service');
    await bus.close();
    await db.pool.end();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return context;
};

module.exports = {
  startService
};
