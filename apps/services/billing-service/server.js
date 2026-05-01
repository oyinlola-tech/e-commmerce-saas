const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');
const { registerConsumers } = require('./src/consumers');

startService({
  appRoot: __dirname,
  serviceName: 'billing-service',
  defaultPort: 4109,
  defaultDatabase: 'billing_db',
  schemaStatements,
  registerRoutes,
  registerConsumers
});
