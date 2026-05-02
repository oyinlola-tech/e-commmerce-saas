const {
  DEFAULT_CURRENCY,
  DEFAULT_YEARLY_DISCOUNT_PERCENTAGE,
  PLAN_ALIASES,
  normalizePlanCode,
  getBillingPlans: getDefaultBillingPlans,
  getBillingPlan: getDefaultBillingPlan,
  clampDiscountPercentage,
  calculateYearlyAmount,
  deriveYearlyDiscountPercentage
} = require('./plans');
const { normalizeCurrencyCode } = require('./currency');

const toPlanAmount = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Number(parsed.toFixed(2))
    : Number(fallback || 0);
};

const parseMonthlyOverrides = (value = null) => {
  if (!value) {
    return {};
  }

  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return Object.entries(parsed).reduce((accumulator, [currencyCode, amount]) => {
    const normalizedCurrency = normalizeCurrencyCode(currencyCode);
    const normalizedAmount = toPlanAmount(amount, 0);

    if (!normalizedCurrency || normalizedAmount <= 0) {
      return accumulator;
    }

    accumulator[normalizedCurrency] = normalizedAmount;
    return accumulator;
  }, {});
};

const buildMonthlyPriceMap = (plan = {}) => {
  const baseCurrency = normalizeCurrencyCode(plan.currency) || DEFAULT_CURRENCY;
  const baseMonthlyAmount = toPlanAmount(plan.monthly_amount, 0);
  const monthlyOverrides = parseMonthlyOverrides(plan.monthly_overrides);

  return Object.entries({
    [baseCurrency]: baseMonthlyAmount,
    ...monthlyOverrides
  }).reduce((accumulator, [currencyCode, amount]) => {
    const normalizedAmount = toPlanAmount(amount, 0);
    if (normalizedAmount <= 0) {
      return accumulator;
    }

    accumulator[currencyCode] = normalizedAmount;
    return accumulator;
  }, {});
};

const getConfiguredPlanCurrencies = (plan = {}) => {
  return Object.keys(buildMonthlyPriceMap(plan));
};

const getResolvedMonthlyAmountForCurrency = (plan = {}, currencyCode = '') => {
  const normalizedCurrency = normalizeCurrencyCode(currencyCode);
  if (!normalizedCurrency) {
    return null;
  }

  const priceMap = buildMonthlyPriceMap(plan);
  if (!Object.prototype.hasOwnProperty.call(priceMap, normalizedCurrency)) {
    return null;
  }

  return toPlanAmount(priceMap[normalizedCurrency], 0);
};

const getKnownPlanCodes = () => {
  return getDefaultBillingPlans().map((plan) => normalizePlanCode(plan.code));
};

const isKnownPlanCode = (planCode) => {
  return getKnownPlanCodes().includes(normalizePlanCode(planCode));
};

const getStoragePlanCodes = (planCode) => {
  const normalized = normalizePlanCode(planCode);
  const aliases = Object.entries(PLAN_ALIASES)
    .filter(([, targetCode]) => normalizePlanCode(targetCode) === normalized)
    .map(([aliasCode]) => normalizePlanCode(aliasCode));

  return Array.from(new Set([normalized, ...aliases].filter(Boolean)));
};

const resolveYearlyDiscountPercentage = (plan, settings = null, monthlyAmount = 0) => {
  const defaultDiscount = deriveYearlyDiscountPercentage(
    plan?.monthly_amount,
    plan?.yearly_amount,
    plan?.yearly_discount_percentage || DEFAULT_YEARLY_DISCOUNT_PERCENTAGE
  );

  if (settings?.yearly_discount_percentage !== undefined && settings?.yearly_discount_percentage !== null) {
    return clampDiscountPercentage(settings.yearly_discount_percentage, defaultDiscount);
  }

  if (settings?.yearly_amount !== undefined && settings?.yearly_amount !== null) {
    return deriveYearlyDiscountPercentage(monthlyAmount, settings.yearly_amount, defaultDiscount);
  }

  return clampDiscountPercentage(plan?.yearly_discount_percentage, defaultDiscount);
};

const mergePlanWithSettings = (plan, settings = null) => {
  if (!plan) {
    return null;
  }

  const currency = normalizeCurrencyCode(settings?.currency) || plan.currency || DEFAULT_CURRENCY;
  const monthlyAmount = toPlanAmount(settings?.monthly_amount, plan.monthly_amount);
  const monthlyOverrides = parseMonthlyOverrides(settings?.monthly_overrides);
  const yearlyDiscountPercentage = resolveYearlyDiscountPercentage(plan, settings, monthlyAmount);

  return {
    ...plan,
    code: normalizePlanCode(plan.code),
    currency,
    monthly_amount: monthlyAmount,
    yearly_amount: calculateYearlyAmount(monthlyAmount, yearlyDiscountPercentage),
    yearly_discount_percentage: yearlyDiscountPercentage,
    monthly_overrides: monthlyOverrides,
    configured_currencies: getConfiguredPlanCurrencies({
      currency,
      monthly_amount: monthlyAmount,
      monthly_overrides: monthlyOverrides
    }),
    updated_from_default: Boolean(settings),
    settings_updated_at: settings?.updated_at || null
  };
};

const getPlanSettingsMap = async (db) => {
  const rows = await db.query('SELECT * FROM billing_plan_settings ORDER BY updated_at DESC, created_at DESC');
  const map = new Map();

  rows.forEach((row) => {
    const normalizedCode = normalizePlanCode(row.plan_code);
    if (!normalizedCode || map.has(normalizedCode)) {
      return;
    }

    map.set(normalizedCode, row);
  });

  return map;
};

const getResolvedBillingPlans = async (db) => {
  const defaults = getDefaultBillingPlans();
  const settingsMap = await getPlanSettingsMap(db);

  return defaults.map((plan) => mergePlanWithSettings(plan, settingsMap.get(normalizePlanCode(plan.code)) || null));
};

const getResolvedBillingPlan = async (db, planCode) => {
  const normalizedCode = normalizePlanCode(planCode);
  const defaultPlan = getDefaultBillingPlan(normalizedCode);
  if (!defaultPlan) {
    return null;
  }

  const settingsMap = await getPlanSettingsMap(db);
  return mergePlanWithSettings(defaultPlan, settingsMap.get(normalizedCode) || null);
};

const getResolvedPlanPrice = async (db, planCode, billingCycle) => {
  const plan = await getResolvedBillingPlan(db, planCode);
  if (!plan) {
    return null;
  }

  const cycle = String(billingCycle || 'monthly').trim().toLowerCase();
  const amount = cycle === 'yearly'
    ? calculateYearlyAmount(plan.monthly_amount, plan.yearly_discount_percentage)
    : toPlanAmount(plan.monthly_amount, plan.monthly_amount);

  return {
    ...plan,
    billing_cycle: cycle,
    amount
  };
};

const upsertPlanSettings = async (db, payload = {}) => {
  const normalizedCode = normalizePlanCode(payload.plan || payload.plan_code);
  if (!isKnownPlanCode(normalizedCode)) {
    return null;
  }

  const defaultPlan = getDefaultBillingPlan(normalizedCode);
  const currentPlan = await getResolvedBillingPlan(db, normalizedCode);
  const selectedCurrency = normalizeCurrencyCode(payload.currency) || DEFAULT_CURRENCY;
  const submittedMonthlyAmount = toPlanAmount(payload.monthly_amount, defaultPlan?.monthly_amount || 0);
  const baseMonthlyAmount = selectedCurrency === DEFAULT_CURRENCY
    ? submittedMonthlyAmount
    : toPlanAmount(currentPlan?.monthly_amount, defaultPlan?.monthly_amount || 0);
  const monthlyOverrides = {
    ...parseMonthlyOverrides(currentPlan?.monthly_overrides)
  };

  if (selectedCurrency === DEFAULT_CURRENCY) {
    delete monthlyOverrides[DEFAULT_CURRENCY];
  } else {
    monthlyOverrides[selectedCurrency] = submittedMonthlyAmount;
  }

  const yearlyDiscountPercentage = clampDiscountPercentage(
    payload.yearly_discount_percentage,
    currentPlan?.yearly_discount_percentage
      || defaultPlan?.yearly_discount_percentage
      || DEFAULT_YEARLY_DISCOUNT_PERCENTAGE
  );
  const yearlyAmount = calculateYearlyAmount(baseMonthlyAmount, yearlyDiscountPercentage);

  await db.execute(
    `
      INSERT INTO billing_plan_settings (
        plan_code, currency, monthly_amount, yearly_amount, monthly_overrides, yearly_discount_percentage
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        currency = VALUES(currency),
        monthly_amount = VALUES(monthly_amount),
        yearly_amount = VALUES(yearly_amount),
        monthly_overrides = VALUES(monthly_overrides),
        yearly_discount_percentage = VALUES(yearly_discount_percentage)
    `,
    [
      normalizedCode,
      DEFAULT_CURRENCY,
      baseMonthlyAmount,
      yearlyAmount,
      JSON.stringify(monthlyOverrides),
      yearlyDiscountPercentage
    ]
  );

  return getResolvedBillingPlan(db, normalizedCode);
};

module.exports = {
  isKnownPlanCode,
  getKnownPlanCodes,
  getStoragePlanCodes,
  getConfiguredPlanCurrencies,
  getResolvedMonthlyAmountForCurrency,
  getResolvedBillingPlans,
  getResolvedBillingPlan,
  getResolvedPlanPrice,
  upsertPlanSettings
};
