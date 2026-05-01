const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');

startService({
  appRoot: __dirname,
  serviceName: 'store-service',
  defaultPort: 4102,
  defaultDatabase: 'stores_db',
  schemaStatements,
  registerRoutes
});
