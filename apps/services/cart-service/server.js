const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');

startService({
  appRoot: __dirname,
  serviceName: 'cart-service',
  defaultPort: 4106,
  defaultDatabase: 'carts_db',
  schemaStatements,
  registerRoutes
});
