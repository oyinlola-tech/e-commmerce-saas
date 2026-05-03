const DEFAULT_CURRENCY = 'USD';
const TRIAL_DAYS = 7;
const TRIAL_AUTHORIZATION_BASE_AMOUNT = Number(process.env.SUBSCRIPTION_TRIAL_AUTH_AMOUNT_USD || 1);
const DEFAULT_YEARLY_DISCOUNT_PERCENTAGE = 20;
const PLAN_ALIASES = {
  basic: 'launch',
  growth: 'scale'
};
const createEntitlements = ({ limits = {}, capabilities = {} } = {}) => ({
  limits: {
    stores: limits.stores ?? null,
    products: limits.products ?? null
  },
  capabilities: {
    custom_domain: Boolean(capabilities.custom_domain),
    analytics: Boolean(capabilities.analytics),
    automated_marketing: Boolean(capabilities.automated_marketing),
    priority_support: Boolean(capabilities.priority_support),
    api_access: Boolean(capabilities.api_access),
    dedicated_support: Boolean(capabilities.dedicated_support)
  }
});

const roundPlanAmount = (value) => {
  return Number(Number(value || 0).toFixed(2));
};

const clampDiscountPercentage = (value, fallback = DEFAULT_YEARLY_DISCOUNT_PERCENTAGE) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return roundPlanAmount(fallback);
  }

  return roundPlanAmount(Math.min(100, Math.max(0, parsed)));
};

const calculateYearlyAmount = (monthlyAmount, yearlyDiscountPercentage = DEFAULT_YEARLY_DISCOUNT_PERCENTAGE) => {
  const safeMonthlyAmount = roundPlanAmount(monthlyAmount);
  const annualBase = safeMonthlyAmount * 12;
  const safeDiscount = clampDiscountPercentage(yearlyDiscountPercentage);
  return roundPlanAmount(annualBase * (1 - (safeDiscount / 100)));
};

const deriveYearlyDiscountPercentage = (monthlyAmount, yearlyAmount, fallback = DEFAULT_YEARLY_DISCOUNT_PERCENTAGE) => {
  const safeMonthlyAmount = roundPlanAmount(monthlyAmount);
  const safeYearlyAmount = roundPlanAmount(yearlyAmount);
  const annualBase = safeMonthlyAmount * 12;

  if (annualBase <= 0 || safeYearlyAmount <= 0) {
    return clampDiscountPercentage(fallback);
  }

  return clampDiscountPercentage((1 - (safeYearlyAmount / annualBase)) * 100, fallback);
};

const DEFAULT_PLANS = {
  launch: {
    code: 'launch',
    name: 'Launch',
    description: 'For teams launching one polished storefront with the core Aisle stack.',
    monthly_amount: 10,
    yearly_amount: calculateYearlyAmount(10, DEFAULT_YEARLY_DISCOUNT_PERCENTAGE),
    yearly_discount_percentage: DEFAULT_YEARLY_DISCOUNT_PERCENTAGE,
    currency: DEFAULT_CURRENCY,
    trial_eligible: true,
    features: [
      'One live storefront',
      'Owner workspace',
      'Domain management',
      'Email support'
    ],
    entitlements: createEntitlements({
      limits: {
        stores: 1,
        products: 100
      },
      capabilities: {
        custom_domain: true,
        analytics: false,
        automated_marketing: false,
        priority_support: false,
        api_access: false,
        dedicated_support: false
      }
    })
  },
  scale: {
    code: 'scale',
    name: 'Scale',
    description: 'For operators growing across stores, teams, and more complex workflows.',
    monthly_amount: 40,
    yearly_amount: calculateYearlyAmount(40, DEFAULT_YEARLY_DISCOUNT_PERCENTAGE),
    yearly_discount_percentage: DEFAULT_YEARLY_DISCOUNT_PERCENTAGE,
    currency: DEFAULT_CURRENCY,
    trial_eligible: true,
    features: [
      'Up to five active stores',
      'Priority support',
      'Advanced analytics',
      'Operational flexibility'
    ],
    entitlements: createEntitlements({
      limits: {
        stores: 5,
        products: 1000
      },
      capabilities: {
        custom_domain: true,
        analytics: true,
        automated_marketing: true,
        priority_support: true,
        api_access: false,
        dedicated_support: false
      }
    })
  },
  enterprise: {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'For larger teams that need higher-touch rollout, support, and controls.',
    monthly_amount: 100,
    yearly_amount: calculateYearlyAmount(100, DEFAULT_YEARLY_DISCOUNT_PERCENTAGE),
    yearly_discount_percentage: DEFAULT_YEARLY_DISCOUNT_PERCENTAGE,
    currency: DEFAULT_CURRENCY,
    trial_eligible: true,
    features: [
      'Unlimited storefronts',
      'Custom onboarding',
      'Dedicated support lane',
      'Implementation planning'
    ],
    entitlements: createEntitlements({
      limits: {
        stores: null,
        products: null
      },
      capabilities: {
        custom_domain: true,
        analytics: true,
        automated_marketing: true,
        priority_support: true,
        api_access: true,
        dedicated_support: true
      }
    })
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
  DEFAULT_YEARLY_DISCOUNT_PERCENTAGE,
  PLAN_ALIASES,
  createEntitlements,
  roundPlanAmount,
  clampDiscountPercentage,
  calculateYearlyAmount,
  deriveYearlyDiscountPercentage,
  normalizePlanCode,
  getBillingPlans,
  getBillingPlan,
  getPlanPrice,
  getPeriodEnd
};
