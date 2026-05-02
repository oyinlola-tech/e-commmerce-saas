const buildListenHint = ({ error, port, envVarName }) => {
  if (error?.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Stop the existing process or set ${envVarName} to a different value.`;
  }

  if (error?.code === 'EACCES') {
    return `Access to port ${port} was denied. Try a different ${envVarName} value or run with the required permissions.`;
  }

  return null;
};

const listenWithErrorHandler = ({
  server,
  port,
  logger,
  serviceName,
  displayName = 'Service',
  envVarName = 'PORT',
  onListening
}) => {
  let startupComplete = false;

  server.once('listening', () => {
    startupComplete = true;

    if (typeof onListening === 'function') {
      onListening();
    }
  });

  server.on('error', (error) => {
    if (!startupComplete) {
      const hint = buildListenHint({
        error,
        port,
        envVarName
      });

      logger.error(`${displayName} failed to start`, {
        serviceName,
        port,
        envVarName,
        ...(hint ? { hint } : {}),
        error
      });
      process.exitCode = 1;
      process.nextTick(() => process.exit(1));
      return;
    }

    logger.error(`${displayName} server error`, {
      serviceName,
      port,
      error
    });
  });

  server.listen(port);
};

module.exports = {
  listenWithErrorHandler
};
