const { serializeError } = require('./logger');

const createHttpError = (status, message, details = null, options = {}) => {
  const error = new Error(message || 'Request failed.');
  error.status = Number(status || 500);
  error.expose = Boolean(options.expose || error.status < 500);
  error.details = details;
  error.code = options.code || null;
  error.cause = options.cause;
  return error;
};

const sanitizeError = (error, isProduction) => {
  const status = Number(error.status || 500);
  const message = status >= 500 && isProduction
    ? 'An unexpected error occurred.'
    : (error.expose === false && isProduction
      ? 'Request failed.'
      : error.message || 'Request failed.');

  return {
    error: message,
    details: error.details || undefined,
    ...(isProduction ? {} : { debug: serializeError(error) })
  };
};

const asyncHandler = (handler) => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

const notFoundHandler = (req, res, next) => {
  next(createHttpError(404, 'Route not found.', null, { expose: true }));
};

const errorHandler = ({ logger, isProduction, serviceName }) => {
  return (error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const status = Number(error.status || 500);
    logger.error('request_failed', {
      serviceName,
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status,
      error
    });

    return res.status(status).json(sanitizeError(error, isProduction));
  };
};

module.exports = {
  createHttpError,
  sanitizeError,
  asyncHandler,
  notFoundHandler,
  errorHandler
};
