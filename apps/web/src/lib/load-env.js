const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.join(__dirname, '..', '..');

const normalizeEnvironment = (value = '') => {
  return String(value).toLowerCase() === 'production' ? 'production' : 'development';
};

const environment = normalizeEnvironment(process.env.NODE_ENV || 'development');

[
  `.env.${environment}.local`,
  `.env.${environment}`,
  '.env.local',
  '.env'
].forEach((filename) => {
  const targetPath = path.join(rootDir, filename);
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

module.exports = {
  environment,
  isProduction: environment === 'production',
  isDevelopment: environment !== 'production',
  port: Number(process.env.PORT || 3000),
  rootDomain: process.env.APP_ROOT_DOMAIN || 'localhost',
  stateSeedOnBoot: asBoolean(process.env.STATE_SEED_ON_BOOT, false),
  geoApiBase: process.env.IP_GEOLOCATION_API_BASE || 'https://ipapi.co',
  fxApiBase: process.env.FX_RATES_API_BASE || 'https://api.frankfurter.dev/v1',
  requestTimeoutMs: Number(process.env.EXTERNAL_API_TIMEOUT_MS || 2500)
};
