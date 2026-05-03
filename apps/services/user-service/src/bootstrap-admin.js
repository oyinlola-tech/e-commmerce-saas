const DEFAULT_PLATFORM_ADMIN_NAME = 'Platform Admin';
const DEFAULT_PLATFORM_ADMIN_PASSWORD = 'ChangeMe123!';
const DEFAULT_PLATFORM_ADMIN_EMAIL = 'platform-admin@example.com';
const NON_PRODUCTION_PLATFORM_ADMIN_EMAILS = new Set([
  DEFAULT_PLATFORM_ADMIN_EMAIL,
  'admin@localhost'
]);

const sanitizeName = (value = '') => {
  return String(value || '').trim().slice(0, 120) || DEFAULT_PLATFORM_ADMIN_NAME;
};

const normalizeEmail = (value = '') => {
  return String(value || '').trim().toLowerCase();
};

const isLikelyEmailAddress = (value = '') => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
};

const getEmailDomain = (value = '') => {
  const normalized = normalizeEmail(value);
  const [, domain = ''] = normalized.split('@');
  return String(domain || '').trim().toLowerCase();
};

const isPlaceholderPlatformAdminEmail = (value = '') => {
  const normalized = normalizeEmail(value);
  if (!normalized) {
    return true;
  }

  return NON_PRODUCTION_PLATFORM_ADMIN_EMAILS.has(normalized)
    || ['example.com', 'localhost'].includes(getEmailDomain(normalized));
};

const isDefaultPlatformAdminPassword = (value = '') => {
  return String(value || '') === DEFAULT_PLATFORM_ADMIN_PASSWORD;
};

const buildBootstrapAdminEmail = (rootDomain = '') => {
  const normalizedRootDomain = String(rootDomain || '').trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normalizedRootDomain)) {
    return `admin@${normalizedRootDomain}`;
  }

  return DEFAULT_PLATFORM_ADMIN_EMAIL;
};

const resolveBootstrapAdminConfig = ({ env = process.env, rootDomain = '', isProduction = false } = {}) => {
  const configuredName = sanitizeName(env.PLATFORM_ADMIN_NAME || DEFAULT_PLATFORM_ADMIN_NAME);
  const requestedEmail = normalizeEmail(env.PLATFORM_ADMIN_EMAIL || '');
  const fallbackEmail = buildBootstrapAdminEmail(rootDomain);
  const configuredPassword = String(env.PLATFORM_ADMIN_PASSWORD || DEFAULT_PLATFORM_ADMIN_PASSWORD);

  if (configuredPassword.length < 8) {
    throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 8 characters long.');
  }

  if (isProduction) {
    if (!requestedEmail || !isLikelyEmailAddress(requestedEmail) || isPlaceholderPlatformAdminEmail(requestedEmail)) {
      throw new Error('PLATFORM_ADMIN_EMAIL must be explicitly set to a real, non-placeholder email in production.');
    }

    if (isDefaultPlatformAdminPassword(configuredPassword)) {
      throw new Error('PLATFORM_ADMIN_PASSWORD must be changed from the development default in production.');
    }
  }

  const configuredEmail = isLikelyEmailAddress(requestedEmail)
    ? requestedEmail
    : fallbackEmail;

  if (!isLikelyEmailAddress(configuredEmail)) {
    throw new Error('PLATFORM_ADMIN_EMAIL must resolve to a valid email address for platform admin bootstrap.');
  }

  return {
    configuredName,
    requestedEmail,
    configuredEmail,
    configuredPassword
  };
};

module.exports = {
  DEFAULT_PLATFORM_ADMIN_NAME,
  DEFAULT_PLATFORM_ADMIN_PASSWORD,
  DEFAULT_PLATFORM_ADMIN_EMAIL,
  isLikelyEmailAddress,
  isPlaceholderPlatformAdminEmail,
  isDefaultPlatformAdminPassword,
  buildBootstrapAdminEmail,
  resolveBootstrapAdminConfig
};
