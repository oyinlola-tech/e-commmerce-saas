const DEFAULT_CURRENCY = String(process.env.SUBSCRIPTION_DEFAULT_CURRENCY || 'NGN').trim().toUpperCase();

const DEFAULT_PLANS = {
  basic: {
    code: 'basic',
    name: 'Basic',
    description: 'Launch one storefront with the core commerce stack.',
    monthly_amount: 19000,
    yearly_amount: 190000,
    currency: DEFAULT_CURRENCY,
    trial_eligible: true,
    features: [
      'One active store',
      'Core catalog and checkout',
      'Email support'
    ]
  },
  growth: {
    code: 'growth',
    name: 'Growth',
    description: 'Scale into multi-market operations with stronger support.',
    monthly_amount: 49000,
    yearly_amount: 490000,
    currency: DEFAULT_CURRENCY,
    trial_eligible: false,
    features: [
      'Up to five active stores',
      'Priority support',
      'Advanced analytics'
    ]
  },
  scale: {
    code: 'scale',
    name: 'Scale',
    description: 'Enterprise-ready support, operations, and flexibility.',
    monthly_amount: 99000,
    yearly_amount: 990000,
    currency: DEFAULT_CURRENCY,
    trial_eligible: false,
    features: [
      'Unlimited stores',
      'Dedicated support lane',
      'Custom onboarding'
    ]
  }
};

const getBillingPlans = () => {
  return Object.values(DEFAULT_PLANS);
};

const getBillingPlan = (planCode) => {
  return DEFAULT_PLANS[String(planCode || '').trim().toLowerCase()] || null;
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
  getBillingPlans,
  getBillingPlan,
  getPlanPrice,
  getPeriodEnd
};
