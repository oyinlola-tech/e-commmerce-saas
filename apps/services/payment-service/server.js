const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');

startService({
  appRoot: __dirname,
  serviceName: 'payment-service',
  defaultPort: 4108,
  defaultDatabase: 'payments_db',
  schemaStatements,
  registerRoutes
});
