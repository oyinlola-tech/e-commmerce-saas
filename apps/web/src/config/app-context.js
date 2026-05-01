const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { doubleCsrf } = require('csrf-csrf');
const env = require('../lib/load-env');
const {
  storeTypes,
  storeTemplates,
  fontPresets,
  getStoreTheme
} = require('../lib/store-themes');
const {
  buildCurrencyContext,
  normalizeCurrencyCode
} = require('../lib/currency');
const {
  brand,
  mergeProductPresentation,
  mergeStorePresentation,
  removeProductContent,
  upsertProductContent,
  upsertStoreContent
} = require('../lib/presentation-state');
const backend = require('../lib/backend');
const {
  buildCookieOptions,
  createLogger,
  buildSignedInternalHeaders,
  normalizeHostname,
  isSecureRequest,
  sanitizePlainText,
  sanitizeEmail,
  sanitizeSlug,
  sanitizeUrl,
  requestJson,
  validate,
  allowBodyFields,
  allowQueryFields,
  PLATFORM_ROLES,
  commonRules,
  createHttpError
} = require('../../../../packages/shared');
const { logoUpload, ensureLogoUploadDir, saveLogoFile } = require('../lib/uploads');
const { handleFormValidation } = require('../lib/validation');
const {
  setSignedCookie,
  clearSignedCookie,
  readSignedCookie,
  ensureVisitorId,
  safeRedirect,
  isPlatformRequestHost
} = require('../lib/security');

const createAppContext = (appRoot) => {
  const logger = createLogger('web-app');
  const PORT = env.port;
  const ROOT_DOMAIN = env.rootDomain;
  const publicDir = path.join(appRoot, 'public');
  const viewsDir = path.join(appRoot, 'views');
  const logoDir = env.logoUploadDir;
  const appStylesPath = path.join(publicDir, 'styles', 'app.css');
  const themeStylesPath = path.join(publicDir, 'styles', 'theme.css');
  const themeAssetVersion = [appStylesPath, themeStylesPath]
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.statSync(filePath).mtimeMs)
    .reduce((latestVersion, fileTimestamp) => Math.max(latestVersion, fileTimestamp), 1)
    .toString();
  const isLocalRoot = ROOT_DOMAIN === 'localhost' || ROOT_DOMAIN === '127.0.0.1';
  const customerCookieName = (storeId) => `customer_${storeId}`;
  const orderCookieName = (storeId) => `last_order_${storeId}`;
  const wishlistCookieName = (storeId) => `wishlist_${storeId}`;
  const recentlyViewedCookieName = (storeId) => `recently_viewed_${storeId}`;
  const catalogSortOptions = ['featured', 'newest', 'price-low', 'price-high', 'name'];
  const storePaymentProviders = ['paystack', 'flutterwave'];
  const systemAdminUser = {
    name: 'Aisle',
    email: brand.supportEmail || 'support@aisle.so',
    role: 'Platform operations'
  };

  ensureLogoUploadDir().catch((error) => {
    logger.error('logo_directory_init_failed', { error });
  });

  const { generateCsrfToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
    getSecret: () => env.csrfSecret,
    cookieName: 'aisle.x-csrf-token',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.cookieSecure,
      path: '/'
    },
    size: 64,
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getSessionIdentifier: (req) => {
      return readSignedCookie(req, 'aisle_visitor_id') || req.ip || 'anonymous';
    },
    getCsrfTokenFromRequest: (req) => {
      return req.body?._csrf || req.headers['x-csrf-token'] || req.headers['csrf-token'];
    }
  });

  const pageRateLimiter = rateLimit({
    windowMs: env.rateLimitWindowMs,
    limit: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });

  const authRateLimiter = rateLimit({
    windowMs: env.authRateLimitWindowMs,
    limit: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });

  const authPageRateLimiter = rateLimit({
    windowMs: env.authPageRateLimitWindowMs,
    limit: env.authPageRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });

  const mutationRateLimiter = rateLimit({
    windowMs: env.mutationRateLimitWindowMs,
    limit: env.mutationRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });

  return {
    crypto,
    fs,
    path,
    compression,
    cookieParser,
    expressLayouts,
    helmet,
    env,
    logger,
    PORT,
    ROOT_DOMAIN,
    appRoot,
    publicDir,
    viewsDir,
    logoDir,
    themeAssetVersion,
    isLocalRoot,
    customerCookieName,
    orderCookieName,
    wishlistCookieName,
    recentlyViewedCookieName,
    catalogSortOptions,
    storePaymentProviders,
    systemAdminUser,
    generateCsrfToken,
    doubleCsrfProtection,
    invalidCsrfTokenError,
    pageRateLimiter,
    authRateLimiter,
    authPageRateLimiter,
    mutationRateLimiter,
    storeTypes,
    storeTemplates,
    fontPresets,
    getStoreTheme,
    buildCurrencyContext,
    normalizeCurrencyCode,
    brand,
    mergeProductPresentation,
    mergeStorePresentation,
    removeProductContent,
    upsertProductContent,
    upsertStoreContent,
    logoUpload,
    saveLogoFile,
    handleFormValidation,
    setSignedCookie,
    clearSignedCookie,
    readSignedCookie,
    ensureVisitorId,
    safeRedirect,
    isPlatformRequestHost,
    buildCookieOptions,
    buildSignedInternalHeaders,
    normalizeHostname,
    isSecureRequest,
    sanitizePlainText,
    sanitizeEmail,
    sanitizeSlug,
    sanitizeUrl,
    requestJson,
    validate,
    allowBodyFields,
    allowQueryFields,
    PLATFORM_ROLES,
    commonRules,
    createHttpError,
    ...backend
  };
};

module.exports = {
  createAppContext
};
