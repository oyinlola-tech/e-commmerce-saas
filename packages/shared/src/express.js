const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const createBaseApp = ({ serviceName, logger }) => {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });
  app.use(morgan('dev', {
    stream: {
      write: (message) => logger.info('http_request', {
        request: message.trim(),
        serviceName
      })
    }
  }));

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
