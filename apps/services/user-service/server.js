const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');

startService({
  appRoot: __dirname,
  serviceName: 'user-service',
  defaultPort: 4101,
  defaultDatabase: 'users_db',
  schemaStatements,
  registerRoutes
});
