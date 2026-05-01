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

const normalizeSameSite = (value = 'lax') => {
  const normalized = String(value || 'lax').trim().toLowerCase();
  return ['lax', 'strict', 'none'].includes(normalized)
    ? normalized
    : 'lax';
};

const getSecret = (name) => {
  const value = process.env[name];
  if (value) {
    return value;
  }

  return crypto.randomBytes(32).toString('hex');
};

const rootDomain = normalizeHostname(
  process.env.PLATFORM_ROOT_DOMAIN
  || process.env.APP_ROOT_DOMAIN
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
  port: Number(process.env.PORT || 3000),
  rootDomain,
  stateSeedOnBoot: asBoolean(process.env.STATE_SEED_ON_BOOT, false),
  jwtSecret: process.env.JWT_SECRET || getSecret('JWT_SECRET'),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '1h',
  internalSharedSecret: process.env.INTERNAL_SHARED_SECRET || getSecret('INTERNAL_SHARED_SECRET'),
  cookieSecret: getSecret('COOKIE_SECRET'),
  csrfSecret: getSecret('CSRF_SECRET'),
  cookieSecure: asBoolean(process.env.COOKIE_SECURE, environment === 'production'),
  cookieDomain: process.env.COOKIE_DOMAIN || '',
  cookieSameSite: normalizeSameSite(process.env.COOKIE_SAMESITE || 'lax'),
  geoApiBase: process.env.IP_GEOLOCATION_API_BASE || 'https://ipapi.co',
  fxApiBase: process.env.FX_RATES_API_BASE || 'https://api.frankfurter.dev/v1',
  requestTimeoutMs: Number(process.env.EXTERNAL_API_TIMEOUT_MS || 2500),
  backendRequestTimeoutMs: Number(process.env.BACKEND_REQUEST_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS || 5000),
  staticAssetCacheSeconds: Number(process.env.STATIC_ASSET_CACHE_SECONDS || 3600),
  logoUploadDir: process.env.STORE_LOGO_UPLOAD_DIR
    ? path.resolve(process.env.STORE_LOGO_UPLOAD_DIR)
    : path.join(workspaceRoot, 'uploads', 'logos'),
  serviceUrls: {
    user: process.env.USER_SERVICE_URL || 'http://127.0.0.1:4101',
    store: process.env.STORE_SERVICE_URL || 'http://127.0.0.1:4102',
    customer: process.env.CUSTOMER_SERVICE_URL || 'http://127.0.0.1:4104',
    product: process.env.PRODUCT_SERVICE_URL || 'http://127.0.0.1:4105',
    cart: process.env.CART_SERVICE_URL || 'http://127.0.0.1:4106',
    order: process.env.ORDER_SERVICE_URL || 'http://127.0.0.1:4107',
    billing: process.env.BILLING_SERVICE_URL || 'http://127.0.0.1:4109'
  }
};
