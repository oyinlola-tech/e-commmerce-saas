const FX_API_BASE = String(process.env.FX_RATES_API_BASE || 'https://api.frankfurter.dev/v1').trim();
const REQUEST_TIMEOUT_MS = Number(process.env.EXTERNAL_API_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS || 5000);
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const ratesCache = new Map();

const normalizeCurrencyCode = (value = '') => {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
};

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'aisle-billing-service/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`FX request failed with ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const getRatesForBase = async (baseCurrency) => {
  const normalizedBase = normalizeCurrencyCode(baseCurrency) || 'USD';
  const cached = ratesCache.get(normalizedBase);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const payload = await fetchJson(`${FX_API_BASE}/latest?base=${encodeURIComponent(normalizedBase)}`);
  const value = {
    base: normalizedBase,
    rates: payload?.rates && typeof payload.rates === 'object' ? payload.rates : {},
    date: payload?.date || null
  };

  ratesCache.set(normalizedBase, {
    value,
    expiresAt: Date.now() + FX_CACHE_TTL_MS
  });

  return value;
};

const roundAmount = (amount) => {
  return Number(Number(amount || 0).toFixed(2));
};

const convertAmount = async (amount, fromCurrency, toCurrency) => {
  const baseCurrency = normalizeCurrencyCode(fromCurrency) || 'USD';
  const targetCurrency = normalizeCurrencyCode(toCurrency) || baseCurrency;
  const safeAmount = Number(amount || 0);

  if (baseCurrency === targetCurrency) {
    return {
      amount: roundAmount(safeAmount),
      currency: targetCurrency,
      exchangeRate: 1,
      rateDate: null
    };
  }

  const payload = await getRatesForBase(baseCurrency);
  const exchangeRate = Number(payload.rates[targetCurrency] || 0);
  if (!exchangeRate) {
    return {
      amount: roundAmount(safeAmount),
      currency: baseCurrency,
      exchangeRate: 1,
      rateDate: payload.date || null
    };
  }

  return {
    amount: roundAmount(safeAmount * exchangeRate),
    currency: targetCurrency,
    exchangeRate,
    rateDate: payload.date || null
  };
};

module.exports = {
  normalizeCurrencyCode,
  convertAmount
};
