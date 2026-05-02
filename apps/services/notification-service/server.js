const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');
const { registerConsumers } = require('./src/consumers');

startService({
  appRoot: __dirname,
  serviceName: 'notification-service',
  defaultPort: 4112,
  defaultDatabase: 'notifications_db',
  schemaStatements,
  registerRoutes,
  registerConsumers
});
