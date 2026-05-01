const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const normalizeEnvironment = (value = '') => {
  return String(value).trim().toLowerCase() === 'production' ? 'production' : 'development';
};

const hasWorkspaceRoot = (directory) => {
  const packageJsonPath = path.join(directory, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const contents = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return Array.isArray(contents.workspaces);
  } catch (error) {
    return false;
  }
};

const findWorkspaceRoot = (startDirectory) => {
  let cursor = path.resolve(startDirectory);

  while (cursor && cursor !== path.dirname(cursor)) {
    if (hasWorkspaceRoot(cursor) || fs.existsSync(path.join(cursor, '.git'))) {
      return cursor;
    }
    cursor = path.dirname(cursor);
  }

  return path.resolve(startDirectory);
};

const loadEnvFiles = (appRoot) => {
  const workspaceRoot = findWorkspaceRoot(appRoot);
  const environment = normalizeEnvironment(process.env.NODE_ENV || 'development');
  const candidates = [
    path.join(workspaceRoot, '.env'),
    path.join(workspaceRoot, `.env.${environment}`),
    path.join(workspaceRoot, `.env.${environment}.local`),
    path.join(appRoot, '.env'),
    path.join(appRoot, `.env.${environment}`),
    path.join(appRoot, `.env.${environment}.local`)
  ];

  candidates.forEach((targetPath) => {
    if (fs.existsSync(targetPath)) {
      dotenv.config({ path: targetPath, override: false, quiet: true });
    }
  });

  return {
    workspaceRoot,
    environment
  };
};

const createServiceConfig = ({
  appRoot,
  serviceName,
  defaultPort,
  defaultDatabase
}) => {
  const { workspaceRoot, environment } = loadEnvFiles(appRoot);

  return {
    appRoot,
    workspaceRoot,
    environment,
    isProduction: environment === 'production',
    serviceName,
    port: Number(process.env.PORT || defaultPort),
    databaseUrl: process.env.DATABASE_URL || `mysql://root:password@127.0.0.1:3306/${defaultDatabase}`,
    jwtSecret: process.env.JWT_SECRET || 'aisle-jwt-secret',
    internalSharedSecret: process.env.INTERNAL_SHARED_SECRET || 'aisle-internal-secret',
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://127.0.0.1:5672',
    redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    rootDomain: process.env.PLATFORM_ROOT_DOMAIN || 'aislecommerce.com',
    eventExchange: process.env.EVENT_EXCHANGE || 'aisle.events',
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
    webAppUrl: process.env.WEB_APP_URL || 'http://127.0.0.1:3000',
    gatewayUrl: process.env.GATEWAY_URL || 'http://127.0.0.1:4000',
    serviceUrls: {
      user: process.env.USER_SERVICE_URL || 'http://127.0.0.1:4101',
      store: process.env.STORE_SERVICE_URL || 'http://127.0.0.1:4102',
      compliance: process.env.COMPLIANCE_SERVICE_URL || 'http://127.0.0.1:4103',
      customer: process.env.CUSTOMER_SERVICE_URL || 'http://127.0.0.1:4104',
      product: process.env.PRODUCT_SERVICE_URL || 'http://127.0.0.1:4105',
      cart: process.env.CART_SERVICE_URL || 'http://127.0.0.1:4106',
      order: process.env.ORDER_SERVICE_URL || 'http://127.0.0.1:4107',
      payment: process.env.PAYMENT_SERVICE_URL || 'http://127.0.0.1:4108',
      billing: process.env.BILLING_SERVICE_URL || 'http://127.0.0.1:4109',
      support: process.env.SUPPORT_SERVICE_URL || 'http://127.0.0.1:4110',
      chat: process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:4111',
      notification: process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:4112'
    }
  };
};

module.exports = {
  normalizeEnvironment,
  loadEnvFiles,
  findWorkspaceRoot,
  createServiceConfig
};
