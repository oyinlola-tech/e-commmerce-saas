const { startService } = require('../../../packages/shared');
const { schemaStatements } = require('./src/schema');
const { registerRoutes } = require('./src/routes');

startService({
  appRoot: __dirname,
  serviceName: 'compliance-service',
  defaultPort: 4103,
  defaultDatabase: 'compliance_db',
  schemaStatements,
  registerRoutes
});
