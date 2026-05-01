const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { normalizeHostname } = require('./security');

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

const hasEnvValue = (value) => {
  return value !== undefined && value !== null && value !== '';
};

const toEnvPrefix = (value = '') => {
  // Fixed: Use non-backtracking approach to prevent ReDoS attacks
  const normalized = String(value || '').trim().toUpperCase();
  
  // Replace non-alphanumeric characters with underscores
  let result = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if ((char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9')) {
      result += char;
    } else {
      result += '_';
    }
  }
  
  // Remove leading underscores
  let start = 0;
  while (start < result.length && result[start] === '_') {
    start++;
  }
  
  // Remove trailing underscores
  let end = result.length;
  while (end > start && result[end - 1] === '_') {
    end--;
  }
  
  return result.slice(start, end);
};

const getScopedEnvValue = (prefix, name) => {
  if (prefix) {
    const scopedName = `${prefix}_${name}`;
    if (hasEnvValue(process.env[scopedName])) {
      return process.env[scopedName];
    }
  }

  return hasEnvValue(process.env[name])
    ? process.env[name]
    : undefined;
};

const getEnv = (name, fallback, { requiredInProduction = false, environment = 'development' } = {}) => {
  const value = process.env[name];
  if (hasEnvValue(value)) {
    return value;
  }

  if (requiredInProduction && environment === 'production') {
    throw new Error(`${name} must be set in production.`);
  }

  return fallback;
};

const getScopedEnv = (prefix, name, fallback, { requiredInProduction = false, environment = 'development' } = {}) => {
  const value = getScopedEnvValue(prefix, name);
  if (value !== undefined) {
    return value;
  }

  if (requiredInProduction && environment === 'production') {
    const displayName = prefix ? `${prefix}_${name}` : name;
    throw new Error(`${displayName} must be set in production.`);
  }

  return fallback;
};

const getScopedSecretEnv = (prefix, name, { environment }) => {
  const value = getScopedEnvValue(prefix, name);
  if (value !== undefined) {
    return value;
  }

  if (environment === 'production') {
    const displayName = prefix ? `${prefix}_${name}` : name;
    throw new Error(`${displayName} must be set in production.`);
  }

  return crypto.randomBytes(32).toString('hex');
};

const normalizeSameSite = (value = 'lax') => {
  const normalized = String(value || 'lax').trim().toLowerCase();
  return ['lax', 'strict', 'none'].includes(normalized)
    ? normalized
    : 'lax';
};

const hasWorkspaceRoot = (directory) => {
  const packageJsonPath = path.join(directory, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const contents = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return Array.isArray(contents.workspaces);
  } catch {
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

const buildDatabaseUrlFromParts = ({ prefix, defaultDatabase }) => {
  const hasScopedDatabaseParts = [
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
    'DATABASE_NAME',
    'DATABASE_CHARSET',
    'DATABASE_TIMEZONE',
    'DATABASE_CONNECT_TIMEOUT_MS'
  ].some((name) => getScopedEnvValue(prefix, name) !== undefined);

  if (!hasScopedDatabaseParts) {
    return null;
  }

  const host = getScopedEnv(prefix, 'DATABASE_HOST', '127.0.0.1');
  const port = asNumber(getScopedEnv(prefix, 'DATABASE_PORT', 3306), 3306);
  const user = getScopedEnv(prefix, 'DATABASE_USER', 'root');
  const password = getScopedEnv(prefix, 'DATABASE_PASSWORD', 'password');
  const database = getScopedEnv(prefix, 'DATABASE_NAME', defaultDatabase);
  const charset = getScopedEnvValue(prefix, 'DATABASE_CHARSET');
  const timezone = getScopedEnvValue(prefix, 'DATABASE_TIMEZONE');
  const connectTimeoutMs = getScopedEnvValue(prefix, 'DATABASE_CONNECT_TIMEOUT_MS');
  const url = new URL(`mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`);

  if (charset) {
    url.searchParams.set('charset', charset);
  }

  if (timezone) {
    url.searchParams.set('timezone', timezone);
  }

  if (connectTimeoutMs) {
    url.searchParams.set('connectTimeout', String(asNumber(connectTimeoutMs, 10000)));
  }

  return url.toString();
};

const createServiceConfig = ({
  appRoot,
  serviceName,
  defaultPort,
  defaultDatabase
}) => {
  const { workspaceRoot, environment } = loadEnvFiles(appRoot);
  const isProduction = environment === 'production';
  const servicePrefix = toEnvPrefix(serviceName);
  const rootDomain = normalizeHostname(getEnv('PLATFORM_ROOT_DOMAIN', 'aislecommerce.com'));
  const databaseUrl = getScopedEnvValue(servicePrefix, 'DATABASE_URL')
    || buildDatabaseUrlFromParts({
      prefix: servicePrefix,
      defaultDatabase
    })
    || getEnv('DATABASE_URL', `mysql://root:password@127.0.0.1:3306/${defaultDatabase}`);

  if (!rootDomain) {
    throw new Error('PLATFORM_ROOT_DOMAIN must be a valid hostname.');
  }

  return {
    appRoot,
    workspaceRoot,
    environment,
    isProduction,
    serviceName,
    serviceEnvPrefix: servicePrefix,
    port: asNumber(getScopedEnv(servicePrefix, 'PORT', defaultPort), defaultPort),
    databaseUrl,
    databaseReadUrls: asList(getScopedEnv(servicePrefix, 'DATABASE_READ_URLS', '')),
    databasePoolMin: asNumber(getScopedEnv(servicePrefix, 'DB_POOL_MIN', 2), 2),
    databasePoolMax: asNumber(getScopedEnv(servicePrefix, 'DB_POOL_MAX', 12), 12),
    databaseIdleTimeoutMs: asNumber(getScopedEnv(servicePrefix, 'DB_IDLE_TIMEOUT_MS', 60 * 1000), 60 * 1000),
    databaseAcquireTimeoutMs: asNumber(getScopedEnv(servicePrefix, 'DB_ACQUIRE_TIMEOUT_MS', 10 * 1000), 10 * 1000),
    databaseConnectRetries: asNumber(getScopedEnv(servicePrefix, 'DB_CONNECT_RETRIES', 5), 5),
    databaseRetryDelayMs: asNumber(getScopedEnv(servicePrefix, 'DB_CONNECT_RETRY_DELAY_MS', 1000), 1000),
    jwtSecret: getScopedSecretEnv(servicePrefix, 'JWT_SECRET', { environment }),
    jwtAccessTtl: getScopedEnv(servicePrefix, 'JWT_ACCESS_TTL', '1h'),
    internalSharedSecret: getScopedSecretEnv(servicePrefix, 'INTERNAL_SHARED_SECRET', { environment }),
    rabbitmqUrl: getEnv('RABBITMQ_URL', 'amqp://127.0.0.1:5672'),
    redisUrl: getEnv('REDIS_URL', 'redis://127.0.0.1:6379'),
    disableRedis: asBoolean(process.env.DISABLE_REDIS, false),
    rootDomain,
    eventExchange: getEnv('EVENT_EXCHANGE', 'aisle.events'),
    requestTimeoutMs: asNumber(getScopedEnv(servicePrefix, 'REQUEST_TIMEOUT_MS', getEnv('REQUEST_TIMEOUT_MS', 5000)), 5000),
    webAppUrl: getEnv('WEB_APP_URL', 'http://127.0.0.1:3000'),
    gatewayUrl: getEnv('GATEWAY_URL', 'http://127.0.0.1:4000'),
    cookieSecure: asBoolean(process.env.COOKIE_SECURE, isProduction),
    cookieDomain: process.env.COOKIE_DOMAIN || '',
    cookieSameSite: normalizeSameSite(getEnv('COOKIE_SAMESITE', 'lax')),
    redisPrefix: getScopedEnv(servicePrefix, 'REDIS_PREFIX', `aisle:${serviceName}`),
    internalRequestMaxAgeMs: asNumber(getScopedEnv(servicePrefix, 'INTERNAL_REQUEST_MAX_AGE_MS', getEnv('INTERNAL_REQUEST_MAX_AGE_MS', 5 * 60 * 1000)), 5 * 60 * 1000),
    internalRequestNonceTtlMs: asNumber(getScopedEnv(servicePrefix, 'INTERNAL_REQUEST_NONCE_TTL_MS', getEnv('INTERNAL_REQUEST_NONCE_TTL_MS', 5 * 60 * 1000)), 5 * 60 * 1000),
    pageCacheTtlSeconds: asNumber(getScopedEnv(servicePrefix, 'PAGE_CACHE_TTL_SECONDS', getEnv('PAGE_CACHE_TTL_SECONDS', 60)), 60),
    staticAssetCacheSeconds: asNumber(getScopedEnv(servicePrefix, 'STATIC_ASSET_CACHE_SECONDS', getEnv('STATIC_ASSET_CACHE_SECONDS', 60 * 60)), 60 * 60),
    rateLimitWindowMs: asNumber(getScopedEnv(servicePrefix, 'RATE_LIMIT_WINDOW_MS', 60 * 1000), 60 * 1000),
    rateLimitMax: asNumber(getScopedEnv(servicePrefix, 'RATE_LIMIT_MAX', 120), 120),
    authRateLimitWindowMs: asNumber(getScopedEnv(servicePrefix, 'AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), 15 * 60 * 1000),
    authRateLimitMax: asNumber(getScopedEnv(servicePrefix, 'AUTH_RATE_LIMIT_MAX', 10), 10),
    mutationRateLimitWindowMs: asNumber(getScopedEnv(servicePrefix, 'MUTATION_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000), 10 * 60 * 1000),
    mutationRateLimitMax: asNumber(getScopedEnv(servicePrefix, 'MUTATION_RATE_LIMIT_MAX', 60), 60),
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
  toEnvPrefix,
  createServiceConfig
};
