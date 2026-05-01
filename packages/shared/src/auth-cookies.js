const { isSecureRequest } = require('./security');

const parseDurationMs = (value, fallbackMs) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallbackMs;
  }

  const direct = Number(normalized);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = normalized.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
};

const buildCookieOptions = (config, overrides = {}) => {
  return {
    httpOnly: true,
    secure: Boolean(config.cookieSecure),
    sameSite: config.cookieSameSite || 'lax',
    path: '/',
    domain: config.cookieDomain || undefined,
    ...overrides
  };
};

const resolveCookieArgs = (arg1, arg2, arg3, arg4) => {
  if (arg4 !== undefined) {
    return {
      req: arg1,
      res: arg2,
      token: arg3,
      config: arg4
    };
  }

  return {
    req: null,
    res: arg1,
    token: arg2,
    config: arg3
  };
};

const canWriteSecureCookie = (req, config) => {
  if (!config?.isProduction) {
    return true;
  }

  return req ? isSecureRequest(req) : false;
};

const setPlatformTokenCookie = (arg1, arg2, arg3, arg4) => {
  const { req, res, token, config } = resolveCookieArgs(arg1, arg2, arg3, arg4);
  if (!canWriteSecureCookie(req, config)) {
    return;
  }

  res.cookie('platform_token', token, buildCookieOptions(config, {
    maxAge: parseDurationMs(config.jwtAccessTtl, 60 * 60 * 1000)
  }));
};

const setCustomerTokenCookie = (arg1, arg2, arg3, arg4) => {
  const { req, res, token, config } = resolveCookieArgs(arg1, arg2, arg3, arg4);
  if (!canWriteSecureCookie(req, config)) {
    return;
  }

  res.cookie('customer_token', token, buildCookieOptions(config, {
    maxAge: parseDurationMs(config.jwtAccessTtl, 60 * 60 * 1000)
  }));
};

const resolveClearArgs = (arg1, arg2, arg3) => {
  if (arg3 !== undefined) {
    return {
      req: arg1,
      res: arg2,
      config: arg3
    };
  }

  return {
    req: null,
    res: arg1,
    config: arg2
  };
};

const clearAuthCookies = (arg1, arg2, arg3) => {
  const { res, config } = resolveClearArgs(arg1, arg2, arg3);
  const options = buildCookieOptions(config, { maxAge: 0 });
  res.clearCookie('platform_token', options);
  res.clearCookie('customer_token', options);
};

module.exports = {
  buildCookieOptions,
  setPlatformTokenCookie,
  setCustomerTokenCookie,
  clearAuthCookies,
  parseDurationMs
};
