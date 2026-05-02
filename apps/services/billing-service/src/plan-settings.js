const {
  DEFAULT_CURRENCY,
  PLAN_ALIASES,
  normalizePlanCode,
  getBillingPlans: getDefaultBillingPlans,
  getBillingPlan: getDefaultBillingPlan
} = require('./plans');

const toPlanAmount = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Number(parsed.toFixed(2))
    : Number(fallback || 0);
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

const mergePlanWithSettings = (plan, settings = null) => {
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    code: normalizePlanCode(plan.code),
    currency: settings?.currency || plan.currency || DEFAULT_CURRENCY,
    monthly_amount: toPlanAmount(settings?.monthly_amount, plan.monthly_amount),
    yearly_amount: toPlanAmount(settings?.yearly_amount, plan.yearly_amount),
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
    ? toPlanAmount(plan.yearly_amount, plan.yearly_amount)
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
  const monthlyAmount = toPlanAmount(payload.monthly_amount, defaultPlan?.monthly_amount || 0);
  const yearlyAmount = toPlanAmount(payload.yearly_amount, defaultPlan?.yearly_amount || 0);

  await db.execute(
    `
      INSERT INTO billing_plan_settings (plan_code, currency, monthly_amount, yearly_amount)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        currency = VALUES(currency),
        monthly_amount = VALUES(monthly_amount),
        yearly_amount = VALUES(yearly_amount)
    `,
    [
      normalizedCode,
      DEFAULT_CURRENCY,
      monthlyAmount,
      yearlyAmount
    ]
  );

  return getResolvedBillingPlan(db, normalizedCode);
};

module.exports = {
  isKnownPlanCode,
  getKnownPlanCodes,
  getStoragePlanCodes,
  getResolvedBillingPlans,
  getResolvedBillingPlan,
  getResolvedPlanPrice,
  upsertPlanSettings
};
