const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const normalizeEnvironment = (value = '') => {
  return String(value).trim().toLowerCase() === 'production' ? 'production' : 'development';
};

const asBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'undefined' || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const asNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asList = (value = '') => {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const getEnv = (name, fallback, { requiredInProduction = false, environment = 'development' } = {}) => {
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    return value;
  }

  if (requiredInProduction && environment === 'production') {
    throw new Error(`${name} must be set in production.`);
  }

  return fallback;
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
  const isProduction = environment === 'production';

  return {
    appRoot,
    workspaceRoot,
    environment,
    isProduction,
    serviceName,
    port: asNumber(process.env.PORT, defaultPort),
    databaseUrl: getEnv('DATABASE_URL', `mysql://root:password@127.0.0.1:3306/${defaultDatabase}`),
    databaseReadUrls: asList(process.env.DATABASE_READ_URLS),
    databasePoolMin: asNumber(process.env.DB_POOL_MIN, 2),
    databasePoolMax: asNumber(process.env.DB_POOL_MAX, 12),
    databaseIdleTimeoutMs: asNumber(process.env.DB_IDLE_TIMEOUT_MS, 60 * 1000),
    databaseAcquireTimeoutMs: asNumber(process.env.DB_ACQUIRE_TIMEOUT_MS, 10 * 1000),
    databaseConnectRetries: asNumber(process.env.DB_CONNECT_RETRIES, 5),
    databaseRetryDelayMs: asNumber(process.env.DB_CONNECT_RETRY_DELAY_MS, 1000),
    jwtSecret: getEnv('JWT_SECRET', 'aisle-jwt-secret', {
      requiredInProduction: true,
      environment
    }),
    jwtAccessTtl: getEnv('JWT_ACCESS_TTL', '1h'),
    internalSharedSecret: getEnv('INTERNAL_SHARED_SECRET', 'aisle-internal-secret', {
      requiredInProduction: true,
      environment
    }),
    rabbitmqUrl: getEnv('RABBITMQ_URL', 'amqp://127.0.0.1:5672'),
    redisUrl: getEnv('REDIS_URL', 'redis://127.0.0.1:6379'),
    disableRedis: asBoolean(process.env.DISABLE_REDIS, false),
    rootDomain: getEnv('PLATFORM_ROOT_DOMAIN', 'aislecommerce.com'),
    eventExchange: getEnv('EVENT_EXCHANGE', 'aisle.events'),
    requestTimeoutMs: asNumber(process.env.REQUEST_TIMEOUT_MS, 5000),
    webAppUrl: getEnv('WEB_APP_URL', 'http://127.0.0.1:3000'),
    gatewayUrl: getEnv('GATEWAY_URL', 'http://127.0.0.1:4000'),
    cookieSecure: asBoolean(process.env.COOKIE_SECURE, isProduction),
    cookieDomain: process.env.COOKIE_DOMAIN || '',
    cookieSameSite: getEnv('COOKIE_SAMESITE', 'strict'),
    redisPrefix: getEnv('REDIS_PREFIX', `aisle:${serviceName}`),
    internalRequestMaxAgeMs: asNumber(process.env.INTERNAL_REQUEST_MAX_AGE_MS, 5 * 60 * 1000),
    internalRequestNonceTtlMs: asNumber(process.env.INTERNAL_REQUEST_NONCE_TTL_MS, 5 * 60 * 1000),
    pageCacheTtlSeconds: asNumber(process.env.PAGE_CACHE_TTL_SECONDS, 60),
    staticAssetCacheSeconds: asNumber(process.env.STATIC_ASSET_CACHE_SECONDS, 60 * 60),
    serviceUrls: {
      user: getEnv('USER_SERVICE_URL', 'http://127.0.0.1:4101'),
      store: getEnv('STORE_SERVICE_URL', 'http://127.0.0.1:4102'),
      compliance: getEnv('COMPLIANCE_SERVICE_URL', 'http://127.0.0.1:4103'),
      customer: getEnv('CUSTOMER_SERVICE_URL', 'http://127.0.0.1:4104'),
      product: getEnv('PRODUCT_SERVICE_URL', 'http://127.0.0.1:4105'),
      cart: getEnv('CART_SERVICE_URL', 'http://127.0.0.1:4106'),
      order: getEnv('ORDER_SERVICE_URL', 'http://127.0.0.1:4107'),
      payment: getEnv('PAYMENT_SERVICE_URL', 'http://127.0.0.1:4108'),
      billing: getEnv('BILLING_SERVICE_URL', 'http://127.0.0.1:4109'),
      support: getEnv('SUPPORT_SERVICE_URL', 'http://127.0.0.1:4110'),
      chat: getEnv('CHAT_SERVICE_URL', 'http://127.0.0.1:4111'),
      notification: getEnv('NOTIFICATION_SERVICE_URL', 'http://127.0.0.1:4112')
    }
  };
};

module.exports = {
  asBoolean,
  asNumber,
  asList,
  normalizeEnvironment,
  loadEnvFiles,
  findWorkspaceRoot,
  createServiceConfig
};
