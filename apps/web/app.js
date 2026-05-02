const http = require('http');
const { listenWithErrorHandler } = require('../../packages/shared');
const { createApp } = require('./src/create-app');

const { app, context } = createApp(__dirname);
const server = http.createServer(app);

listenWithErrorHandler({
  server,
  port: context.PORT,
  logger: context.logger,
  serviceName: 'web-app',
  displayName: 'Web app',
  envVarName: 'WEB_PORT',
  onListening: () => {
    context.logger.info('Aisle web listening', {
      port: context.PORT,
      rootDomain: context.ROOT_DOMAIN
    });
  }
});
