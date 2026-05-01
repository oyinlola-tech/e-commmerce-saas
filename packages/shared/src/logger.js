const LOG_LEVELS = {
  error: 10,
  warn: 20,
  info: 30,
  debug: 40
};

const normalizeLevel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized)
    ? normalized
    : 'info';
};

const activeLevel = normalizeLevel(process.env.LOG_LEVEL || 'info');

const serializeError = (error) => {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    status: error.status,
    code: error.code
  };
};

const normalizeMeta = (value) => {
  if (!value) {
    return {};
  }

  if (value instanceof Error) {
    return { error: serializeError(value) };
  }

  if (Array.isArray(value)) {
    return {
      items: value.map((entry) => normalizeMeta(entry))
    };
  }

  if (typeof value !== 'object') {
    return { value };
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    accumulator[key] = entry instanceof Error ? serializeError(entry) : entry;
    return accumulator;
  }, {});
};

const shouldLog = (level) => {
  return LOG_LEVELS[level] <= LOG_LEVELS[activeLevel];
};

const writeLog = (serviceName, bindings, level, message, meta) => {
  if (!shouldLog(level)) {
    return;
  }

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: serviceName,
    level,
    message,
    ...bindings,
    ...normalizeMeta(meta)
  });

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
};

const createLogger = (serviceName, bindings = {}) => {
  const logger = {
    child(childBindings = {}) {
      return createLogger(serviceName, {
        ...bindings,
        ...normalizeMeta(childBindings)
      });
    },
    info(message, meta) {
      writeLog(serviceName, bindings, 'info', message, meta);
    },
    warn(message, meta) {
      writeLog(serviceName, bindings, 'warn', message, meta);
    },
    error(message, meta) {
      writeLog(serviceName, bindings, 'error', message, meta);
    },
    debug(message, meta) {
      writeLog(serviceName, bindings, 'debug', message, meta);
    }
  };

  return logger;
};

module.exports = {
  createLogger,
  serializeError
};
