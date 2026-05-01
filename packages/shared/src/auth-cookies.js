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
    sameSite: config.cookieSameSite || 'strict',
    path: '/',
    domain: config.cookieDomain || undefined,
    ...overrides
  };
};

const setPlatformTokenCookie = (res, token, config) => {
  res.cookie('platform_token', token, buildCookieOptions(config, {
    maxAge: parseDurationMs(config.jwtAccessTtl, 60 * 60 * 1000)
  }));
};

const setCustomerTokenCookie = (res, token, config) => {
  res.cookie('customer_token', token, buildCookieOptions(config, {
    maxAge: parseDurationMs(config.jwtAccessTtl, 60 * 60 * 1000)
  }));
};

const clearAuthCookies = (res, config) => {
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
