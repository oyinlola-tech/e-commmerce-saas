const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { normalizeHostname } = require('../../../../packages/shared');

const appRoot = path.join(__dirname, '..', '..');
const workspaceRoot = path.resolve(__dirname, '..', '..', '..', '..');

const normalizeEnvironment = (value = '') => {
  return String(value).toLowerCase() === 'production' ? 'production' : 'development';
};

const environment = normalizeEnvironment(process.env.NODE_ENV || 'development');

[
  path.join(workspaceRoot, `.env.${environment}.local`),
  path.join(workspaceRoot, `.env.${environment}`),
  path.join(workspaceRoot, '.env.local'),
  path.join(workspaceRoot, '.env'),
  path.join(appRoot, `.env.${environment}.local`),
  path.join(appRoot, `.env.${environment}`),
  path.join(appRoot, '.env.local'),
  path.join(appRoot, '.env')
].forEach((targetPath) => {
  if (fs.existsSync(targetPath)) {
    dotenv.config({ path: targetPath, override: false, quiet: true });
  }
});

const asBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'undefined') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const asNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const WEB_ENV_PREFIXES = ['WEB_APP', 'WEB'];

const getScopedValue = (name, fallback = undefined) => {
  for (const prefix of WEB_ENV_PREFIXES) {
    const scopedName = `${prefix}_${name}`;
    const value = process.env[scopedName];
    if (value !== undefined && value !== '') {
      return value;
    }
  }

  const globalValue = process.env[name];
  if (globalValue !== undefined && globalValue !== '') {
    return globalValue;
  }

  return fallback;
};

const normalizeSameSite = (value = 'lax') => {
  const normalized = String(value || 'lax').trim().toLowerCase();
  return ['lax', 'strict', 'none'].includes(normalized)
    ? normalized
    : 'lax';
};

const getSecret = (name) => {
  const value = getScopedValue(name);
  if (value) {
    return value;
  }

  if (environment === 'production') {
    throw new Error(`${name} must be set in production.`);
  }

  return crypto.randomBytes(32).toString('hex');
};

const rootDomain = normalizeHostname(
  getScopedValue('PLATFORM_ROOT_DOMAIN')
  || getScopedValue('APP_ROOT_DOMAIN')
  || 'localhost'
);

if (!rootDomain) {
  throw new Error('PLATFORM_ROOT_DOMAIN or APP_ROOT_DOMAIN must be a valid hostname.');
}

module.exports = {
  appRoot,
  workspaceRoot,
  environment,
  isProduction: environment === 'production',
  isDevelopment: environment !== 'production',
  port: asNumber(getScopedValue('PORT', 3000), 3000),
  rootDomain,
  stateSeedOnBoot: asBoolean(getScopedValue('STATE_SEED_ON_BOOT'), false),
  jwtSecret: getScopedValue('JWT_SECRET') || getSecret('JWT_SECRET'),
  jwtAccessTtl: getScopedValue('JWT_ACCESS_TTL', '1h'),
  internalSharedSecret: getScopedValue('INTERNAL_SHARED_SECRET') || getSecret('INTERNAL_SHARED_SECRET'),
  cookieSecret: getSecret('COOKIE_SECRET'),
  csrfSecret: getSecret('CSRF_SECRET'),
  cookieSecure: asBoolean(getScopedValue('COOKIE_SECURE'), environment === 'production'),
  cookieDomain: getScopedValue('COOKIE_DOMAIN', ''),
  cookieSameSite: normalizeSameSite(getScopedValue('COOKIE_SAMESITE', 'lax')),
  geoApiBase: getScopedValue('IP_GEOLOCATION_API_BASE', 'https://ipapi.co'),
  fxApiBase: getScopedValue('FX_RATES_API_BASE', 'https://api.frankfurter.dev/v1'),
  requestTimeoutMs: asNumber(getScopedValue('EXTERNAL_API_TIMEOUT_MS', 2500), 2500),
  backendRequestTimeoutMs: asNumber(getScopedValue('BACKEND_REQUEST_TIMEOUT_MS', getScopedValue('REQUEST_TIMEOUT_MS', 5000)), 5000),
  staticAssetCacheSeconds: asNumber(getScopedValue('STATIC_ASSET_CACHE_SECONDS', 3600), 3600),
  rateLimitWindowMs: asNumber(getScopedValue('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), 15 * 60 * 1000),
  rateLimitMax: asNumber(getScopedValue('RATE_LIMIT_MAX', 300), 300),
  authRateLimitWindowMs: asNumber(getScopedValue('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), 15 * 60 * 1000),
  authRateLimitMax: asNumber(getScopedValue('AUTH_RATE_LIMIT_MAX', 8), 8),
  authPageRateLimitWindowMs: asNumber(getScopedValue('AUTH_PAGE_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), 15 * 60 * 1000),
  authPageRateLimitMax: asNumber(getScopedValue('AUTH_PAGE_RATE_LIMIT_MAX', 30), 30),
  mutationRateLimitWindowMs: asNumber(getScopedValue('MUTATION_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), 15 * 60 * 1000),
  mutationRateLimitMax: asNumber(getScopedValue('MUTATION_RATE_LIMIT_MAX', 90), 90),
  logoUploadDir: getScopedValue('STORE_LOGO_UPLOAD_DIR')
    ? path.resolve(getScopedValue('STORE_LOGO_UPLOAD_DIR'))
    : path.join(workspaceRoot, 'uploads', 'logos'),
  serviceUrls: {
    user: getScopedValue('USER_SERVICE_URL', 'http://127.0.0.1:4101'),
    store: getScopedValue('STORE_SERVICE_URL', 'http://127.0.0.1:4102'),
    customer: getScopedValue('CUSTOMER_SERVICE_URL', 'http://127.0.0.1:4104'),
    product: getScopedValue('PRODUCT_SERVICE_URL', 'http://127.0.0.1:4105'),
    cart: getScopedValue('CART_SERVICE_URL', 'http://127.0.0.1:4106'),
    order: getScopedValue('ORDER_SERVICE_URL', 'http://127.0.0.1:4107'),
    billing: getScopedValue('BILLING_SERVICE_URL', 'http://127.0.0.1:4109')
  }
};
