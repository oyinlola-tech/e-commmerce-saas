const pino = require('pino');

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
const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const serializeError = (error) => {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    ...(error.details ? { details: error.details } : {}),
    ...(!isProduction && error.stack ? { stack: error.stack } : {})
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

const rootLogger = pino({
  level: activeLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'message',
  base: null,
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});

const wrapLogger = (instance) => {
  return {
    child(childBindings = {}) {
      return wrapLogger(instance.child(normalizeMeta(childBindings)));
    },
    info(message, meta) {
      return meta === undefined
        ? instance.info(message)
        : instance.info(normalizeMeta(meta), message);
    },
    warn(message, meta) {
      return meta === undefined
        ? instance.warn(message)
        : instance.warn(normalizeMeta(meta), message);
    },
    error(message, meta) {
      return meta === undefined
        ? instance.error(message)
        : instance.error(normalizeMeta(meta), message);
    },
    debug(message, meta) {
      return meta === undefined
        ? instance.debug(message)
        : instance.debug(normalizeMeta(meta), message);
    }
  };
};

const createLogger = (serviceName, bindings = {}) => {
  return wrapLogger(rootLogger.child({
    service: serviceName,
    ...normalizeMeta(bindings)
  }));
};

module.exports = {
  createLogger,
  serializeError
};
