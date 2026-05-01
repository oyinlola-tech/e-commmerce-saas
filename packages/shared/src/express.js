const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');

const createBaseApp = ({
  serviceName,
  logger,
  trustProxy = true,
  enableCompression = false,
  bodyLimit = '2mb'
}) => {
  const app = express();

  app.set('trust proxy', trustProxy);
  app.use(helmet());
  if (enableCompression) {
    const compression = require('compression');
    app.use(compression());
  }
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const startedAt = process.hrtime.bigint();
    req.log = logger.child({
      requestId,
      method: req.method,
      path: req.originalUrl
    });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      req.log.info('request_completed', {
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ip: req.ip
      });
    });

    next();
  });

  return app;
};

const parsePagination = (query = {}) => {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
  return {
    page,
    limit,
    offset: (page - 1) * limit
  };
};

module.exports = {
  createBaseApp,
  parsePagination
};
