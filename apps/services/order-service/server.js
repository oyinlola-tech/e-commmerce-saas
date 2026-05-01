const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');
const { registerConsumers } = require('./src/consumers');

startService({
  appRoot: __dirname,
  serviceName: 'order-service',
  defaultPort: 4107,
  defaultDatabase: 'orders_db',
  schemaStatements,
  registerRoutes,
  registerConsumers
});
