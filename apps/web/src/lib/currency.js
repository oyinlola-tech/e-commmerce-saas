const env = require('./load-env');
const { SUPPORTED_PLATFORM_CURRENCIES } = require('../../../../packages/shared');

const geoCache = new Map();
const ratesCache = new Map();

const GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PLATFORM_CURRENCIES = SUPPORTED_PLATFORM_CURRENCIES;

const normalizeCurrencyCode = (value = '') => {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
};

const uniqueList = (items = []) => {
  return Array.from(new Set(items.filter(Boolean)));
};

const stripIpDecorators = (value = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  const forwardedValue = trimmed.split(',')[0].trim();
  const unwrapped = forwardedValue.startsWith('::ffff:')
    ? forwardedValue.slice(7)
    : forwardedValue;

  if (unwrapped.includes(':') && unwrapped.includes('.')) {
    return unwrapped.slice(0, unwrapped.lastIndexOf(':'));
  }

  return unwrapped;
};

const isPrivateIp = (value = '') => {
  const ip = stripIpDecorators(value);
  return ip === '::1'
    || ip === '127.0.0.1'
    || ip === '0.0.0.0'
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    || ip.startsWith('fc')
    || ip.startsWith('fd')
    || ip.startsWith('fe80:');
};

const extractClientIp = (req) => {
  const headersToCheck = [
    'cf-connecting-ip',
    'x-forwarded-for',
    'x-real-ip',
    'fastly-client-ip',
    'x-client-ip'
  ];

  for (const header of headersToCheck) {
    const value = req.headers[header];
    if (value) {
      return stripIpDecorators(value);
    }
  }

  return stripIpDecorators(req.ip || req.socket?.remoteAddress || '');
};

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || env.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'aisle-commerce-currency/1.0',
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const getGeoCache = (ip) => {
  const cached = geoCache.get(ip);
  if (!cached || cached.expiresAt <= Date.now()) {
    geoCache.delete(ip);
    return null;
  }

  return cached.value;
};

const setGeoCache = (ip, value) => {
  geoCache.set(ip, {
    value,
    expiresAt: Date.now() + GEO_CACHE_TTL_MS
  });
};

const resolveLocale = (req, geoData) => {
  const geoLanguage = String(geoData?.languages || '')
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean);

  if (geoLanguage) {
    return geoLanguage;
  }

  const headerLanguage = String(req.headers['accept-language'] || '')
    .split(',')
    .map((entry) => entry.trim().split(';')[0])
    .find(Boolean);

  return headerLanguage || 'en-US';
};

const getCurrencyLabel = (currencyCode, locale = 'en-US') => {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'currency' });
    const label = displayNames.of(currencyCode);
    return label && label !== currencyCode
      ? `${label} (${currencyCode})`
      : currencyCode;
  } catch {
    return currencyCode;
  }
};

const getStoreBaseCurrency = (store) => {
  const storeCurrencies = Array.isArray(store?.currencies) ? store.currencies : [];
  return normalizeCurrencyCode(store?.default_currency)
    || normalizeCurrencyCode(storeCurrencies[0])
    || 'USD';
};

const getCurrencyCookieName = (store) => {
  return store?.id ? `currency_${store.id}` : 'currency_platform';
};

const getSupportedCurrencies = (store, detectedCurrency) => {
  const storeCurrencies = Array.isArray(store?.currencies) && store.currencies.length
    ? store.currencies
    : (store ? [] : DEFAULT_PLATFORM_CURRENCIES);
  return uniqueList([
    getStoreBaseCurrency(store),
    ...storeCurrencies.map(normalizeCurrencyCode),
    normalizeCurrencyCode(detectedCurrency)
  ].filter(Boolean));
};

const getRatesForBase = async (baseCurrency) => {
  const normalizedBase = normalizeCurrencyCode(baseCurrency) || 'USD';
  const cached = ratesCache.get(normalizedBase);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = `${env.fxApiBase}/latest?base=${encodeURIComponent(normalizedBase)}`;
  const payload = await fetchJson(url);
  const rates = payload && payload.rates && typeof payload.rates === 'object'
    ? payload.rates
    : {};

  const value = {
    base: normalizedBase,
    date: payload?.date || null,
    rates
  };

  ratesCache.set(normalizedBase, {
    value,
    expiresAt: Date.now() + FX_CACHE_TTL_MS
  });

  return value;
};

const getGeoData = async (req) => {
  const ipAddress = extractClientIp(req);
  if (!ipAddress || isPrivateIp(ipAddress)) {
    return null;
  }

  const cached = getGeoCache(ipAddress);
  if (cached) {
    return cached;
  }

  try {
    const url = `${env.geoApiBase}/${encodeURIComponent(ipAddress)}/json/`;
    const payload = await fetchJson(url);
    const resolved = payload && payload.error
      ? null
      : {
          ip: ipAddress,
          city: payload?.city || '',
          countryCode: String(payload?.country_code || payload?.country || '').toUpperCase(),
          countryName: payload?.country_name || '',
          currency: normalizeCurrencyCode(payload?.currency),
          languages: payload?.languages || '',
          timezone: payload?.timezone || ''
        };

    if (resolved) {
      setGeoCache(ipAddress, resolved);
    }

    return resolved;
  } catch {
    return null;
  }
};

const buildCurrencyContext = async (req, store = null) => {
  const baseCurrency = getStoreBaseCurrency(store);
  const cookieName = getCurrencyCookieName(store);
  const savedCurrency = normalizeCurrencyCode(
    req.signedCookies?.[cookieName]
    || req.cookies?.[cookieName]
    || req.signedCookies?.preferred_currency
    || req.cookies?.preferred_currency
  );
  const geoData = savedCurrency ? null : await getGeoData(req);
  const locale = resolveLocale(req, geoData);
  const candidateCurrencies = getSupportedCurrencies(store, geoData?.currency);
  let ratePayload = null;

  if (candidateCurrencies.some((code) => code !== baseCurrency)) {
    try {
      ratePayload = await getRatesForBase(baseCurrency);
    } catch {
      ratePayload = null;
    }
  }

  const supportedCurrencies = candidateCurrencies.filter((code) => {
    return code === baseCurrency || !ratePayload || Number(ratePayload.rates[code] || 0) > 0;
  });

  const options = supportedCurrencies.map((code) => ({
    code,
    label: getCurrencyLabel(code, locale)
  }));

  let source = 'store-default';
  let selectedCurrency = baseCurrency;

  if (savedCurrency && supportedCurrencies.includes(savedCurrency)) {
    selectedCurrency = savedCurrency;
    source = 'cookie';
  } else if (geoData?.currency && supportedCurrencies.includes(geoData.currency)) {
    selectedCurrency = geoData.currency;
    source = 'geoip';
  }

  let exchangeRate = 1;
  let rateDate = null;

  if (selectedCurrency !== baseCurrency) {
    try {
      const activeRates = ratePayload || await getRatesForBase(baseCurrency);
      const nextRate = Number(activeRates.rates[selectedCurrency] || 0);
      if (!nextRate) {
        selectedCurrency = baseCurrency;
        source = 'store-default';
      } else {
        exchangeRate = nextRate;
        rateDate = activeRates.date;
      }
    } catch {
      selectedCurrency = baseCurrency;
      source = 'store-default';
    }
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: selectedCurrency
  });

  const convertAmount = (amount = 0) => {
    const safeAmount = Number(amount || 0);
    return safeAmount * exchangeRate;
  };

  return {
    baseCurrency,
    selectedCurrency,
    cookieName,
    locale,
    exchangeRate,
    rateDate,
    source,
    options,
    geoData,
    formatAmount: (amount = 0) => formatter.format(convertAmount(amount)),
    convertAmount,
    shouldPersistSelection: source === 'geoip' && savedCurrency !== selectedCurrency,
    client: {
      baseCurrency,
      selectedCurrency,
      locale,
      exchangeRate,
      options,
      source
    }
  };
};

module.exports = {
  buildCurrencyContext,
  getCurrencyCookieName,
  getStoreBaseCurrency,
  normalizeCurrencyCode
};
