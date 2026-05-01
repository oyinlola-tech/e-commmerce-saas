const formatEntry = (serviceName, level, message, meta) => {
  return JSON.stringify({
    service: serviceName,
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta || {})
  });
};

const createLogger = (serviceName) => {
  const write = (level, message, meta) => {
    const line = formatEntry(serviceName, level, message, meta);
    if (level === 'error') {
      console.error(line);
      return;
    }

    console.log(line);
  };

  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    debug: (message, meta) => write('debug', message, meta)
  };
};

module.exports = {
  createLogger
};
