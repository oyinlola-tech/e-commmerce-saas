const crypto = require('crypto');
const env = require('./load-env');
const {
  normalizeHostname,
  isPlatformHost,
  resolveSafeRedirect,
  isSecureRequest
} = require('../../../../packages/shared');

const VISITOR_COOKIE_NAME = 'aisle_visitor_id';

const buildCookieOptions = (req, overrides = {}) => {
  return {
    httpOnly: true,
    secure: Boolean(env.cookieSecure),
    sameSite: env.cookieSameSite,
    signed: true,
    path: '/',
    domain: env.cookieDomain || undefined,
    ...overrides
  };
};

const setSignedCookie = (req, res, name, value, overrides = {}) => {
  if (env.isProduction && !isSecureRequest(req)) {
    return;
  }

  res.cookie(name, value, buildCookieOptions(req, overrides));
};

const clearSignedCookie = (req, res, name, overrides = {}) => {
  res.clearCookie(name, buildCookieOptions(req, overrides));
};

const readSignedCookie = (req, name) => {
  return req.signedCookies?.[name] || req.cookies?.[name] || null;
};

const ensureVisitorId = (req, res) => {
  req.signedCookies = req.signedCookies || {};
  let visitorId = readSignedCookie(req, VISITOR_COOKIE_NAME);
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    setSignedCookie(req, res, VISITOR_COOKIE_NAME, visitorId, {
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    req.signedCookies[VISITOR_COOKIE_NAME] = visitorId;
  }

  return visitorId;
};

const getRequestBaseUrl = (req) => {
  const protocol = isSecureRequest(req) || env.isProduction
    ? 'https'
    : 'http';
  const hostname = normalizeHostname(req.hostname || req.headers.host || env.rootDomain) || env.rootDomain;
  const port = protocol === 'http' && hostname === 'localhost'
    ? `:${env.port}`
    : '';

  return `${protocol}://${hostname}${port}`;
};

const getAllowedRedirectHosts = (store = null) => {
  const hosts = [
    env.rootDomain,
    `www.${env.rootDomain}`,
    'localhost',
    '127.0.0.1'
  ];

  if (store?.subdomain) {
    hosts.push(`${store.subdomain}.${env.rootDomain}`);
  }

  if (store?.custom_domain) {
    hosts.push(store.custom_domain);
  }

  return hosts;
};

const safeRedirect = (req, target, fallback = '/', store = null, options = {}) => {
  return resolveSafeRedirect(target, {
    fallback,
    baseUrl: getRequestBaseUrl(req),
    allowedHosts: getAllowedRedirectHosts(store),
    preferRelative: options.preferRelative !== false,
    allowRelative: options.allowRelative !== false
  });
};

const isPlatformRequestHost = (hostname) => {
  return isPlatformHost(hostname, env.rootDomain);
};

module.exports = {
  VISITOR_COOKIE_NAME,
  buildCookieOptions,
  setSignedCookie,
  clearSignedCookie,
  readSignedCookie,
  ensureVisitorId,
  safeRedirect,
  isPlatformRequestHost,
  getRequestBaseUrl
};
