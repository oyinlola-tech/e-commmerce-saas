const DEFAULT_CURRENCY = 'USD';
const TRIAL_DAYS = 7;
const TRIAL_AUTHORIZATION_BASE_AMOUNT = Number(process.env.SUBSCRIPTION_TRIAL_AUTH_AMOUNT_USD || 1);
const PLAN_ALIASES = {
  basic: 'launch',
  growth: 'scale'
};

const DEFAULT_PLANS = {
  launch: {
    code: 'launch',
    name: 'Launch',
    description: 'For teams launching one polished storefront with the core Aisle stack.',
    monthly_amount: 10,
    yearly_amount: 96,
    currency: DEFAULT_CURRENCY,
    trial_eligible: true,
    features: [
      'One live storefront',
      'Owner workspace',
      'Domain management',
      'Email support'
    ]
  },
  scale: {
    code: 'scale',
    name: 'Scale',
    description: 'For operators growing across stores, teams, and more complex workflows.',
    monthly_amount: 40,
    yearly_amount: 384,
    currency: DEFAULT_CURRENCY,
    trial_eligible: true,
    features: [
      'Up to five active stores',
      'Priority support',
      'Advanced analytics',
      'Operational flexibility'
    ]
  },
  enterprise: {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'For larger teams that need higher-touch rollout, support, and controls.',
    monthly_amount: 100,
    yearly_amount: 960,
    currency: DEFAULT_CURRENCY,
    trial_eligible: true,
    features: [
      'Unlimited storefronts',
      'Custom onboarding',
      'Dedicated support lane',
      'Implementation planning'
    ]
  }
};

const normalizePlanCode = (planCode = '') => {
  const normalized = String(planCode || '').trim().toLowerCase();
  return PLAN_ALIASES[normalized] || normalized;
};

const getBillingPlans = () => {
  return Object.values(DEFAULT_PLANS);
};

const getBillingPlan = (planCode) => {
  return DEFAULT_PLANS[normalizePlanCode(planCode)] || null;
};

const getPlanPrice = (planCode, billingCycle) => {
  const plan = getBillingPlan(planCode);
  if (!plan) {
    return null;
  }

  const cycle = String(billingCycle || 'monthly').trim().toLowerCase();
  const amount = cycle === 'yearly' ? plan.yearly_amount : plan.monthly_amount;
  return {
    ...plan,
    code: normalizePlanCode(plan.code),
    billing_cycle: cycle,
    amount
  };
};

const addDays = (baseDate, days) => {
  return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
};

const getPeriodEnd = (billingCycle, startDate = new Date()) => {
  const cycle = String(billingCycle || 'monthly').trim().toLowerCase();
  return cycle === 'yearly'
    ? addDays(startDate, 365)
    : addDays(startDate, 30);
};

module.exports = {
  DEFAULT_CURRENCY,
  TRIAL_DAYS,
  TRIAL_AUTHORIZATION_BASE_AMOUNT,
  PLAN_ALIASES,
  normalizePlanCode,
  getBillingPlans,
  getBillingPlan,
  getPlanPrice,
  getPeriodEnd
};
