const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');

startService({
  appRoot: __dirname,
  serviceName: 'product-service',
  defaultPort: 4105,
  defaultDatabase: 'products_db',
  schemaStatements,
  registerRoutes
});
