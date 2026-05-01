const { createApp } = require('./src/create-app');

const { app, context } = createApp(__dirname);

app.listen(context.PORT, () => {
  context.logger.info('Aisle web listening', {
    port: context.PORT,
    rootDomain: context.ROOT_DOMAIN
  });
});
