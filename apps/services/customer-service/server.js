const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');

startService({
  appRoot: __dirname,
  serviceName: 'customer-service',
  defaultPort: 4104,
  defaultDatabase: 'customers_db',
  schemaStatements,
  registerRoutes
});
