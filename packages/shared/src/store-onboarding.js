const {
  sanitizeEmail,
  sanitizePlainText
} = require('./sanitization');

const ONBOARDING_STEP_SEQUENCE = [
  'initial',
  'store_details',
  'domain_setup',
  'product_creation',
  'payment_config',
  'launch',
  'completed'
];

const VALID_TASK_STEPS = new Set(ONBOARDING_STEP_SEQUENCE.filter((step) => step !== 'completed'));

const normalizeTaskKey = (value = '') => {
  return sanitizePlainText(value, { maxLength: 100 })
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 100);
};

const normalizeEstimateMinutes = (value = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(60, Math.round(parsed));
};

const normalizeOnboardingTask = (task = {}) => {
  if (!task || typeof task !== 'object') {
    return null;
  }

  const key = normalizeTaskKey(task.key || '');
  if (!key) {
    return null;
  }

  const step = VALID_TASK_STEPS.has(task.step)
    ? task.step
    : 'initial';
  const title = sanitizePlainText(task.title || '', { maxLength: 255 }) || key;
  const action = sanitizePlainText(task.action || '', { maxLength: 80 });
  const href = sanitizePlainText(task.href || '', { maxLength: 255 });

  return {
    key,
    title,
    description: sanitizePlainText(task.description || '', { maxLength: 1000 }) || null,
    step,
    complete: Boolean(task.complete),
    required: task.required !== false,
    action: action || null,
    href: href || null,
    estimate_minutes: normalizeEstimateMinutes(task.estimate_minutes || 0)
  };
};

const isPaidOrder = (order = {}) => {
  const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
  const orderStatus = String(order.status || '').trim().toLowerCase();

  return paymentStatus === 'paid'
    || ['confirmed', 'shipped', 'delivered'].includes(orderStatus);
};

const buildStoreOnboardingTasks = ({
  store = null,
  products = [],
  orders = [],
  paymentProviderConfigs = {},
  entitlements = null
} = {}) => {
  const providerEntries = Object.values(paymentProviderConfigs || {});
  const hasActiveGateway = providerEntries.some((entry) => String(entry?.status || '').trim().toLowerCase() === 'active');
  const publishedProducts = products.filter((entry) => String(entry.status || '').trim().toLowerCase() === 'published');
  const hasStoreIdentity = Boolean(
    sanitizePlainText(store?.name || '', { maxLength: 150 })
    && sanitizeEmail(store?.support_email || '')
    && sanitizePlainText(store?.fulfillment_sla || '', { maxLength: 120 })
  );
  const hasCustomDomainCapability = Boolean(entitlements?.capabilities?.custom_domain);
  const hasCustomDomain = Boolean(sanitizePlainText(store?.custom_domain || '', { maxLength: 190 }));
  const hasPaidOrder = orders.some((entry) => isPaidOrder(entry));
  const tasks = [
    {
      key: 'identity',
      title: 'Add store identity and support details',
      description: 'Customers should see a real support email, fulfillment promise, and branded storefront before launch.',
      step: 'store_details',
      complete: hasStoreIdentity,
      required: true,
      action: 'Open settings',
      href: '/admin/settings',
      estimate_minutes: 1
    },
    (hasCustomDomainCapability || hasCustomDomain)
      ? {
          key: 'domain',
          title: 'Connect a custom domain',
          description: 'A branded domain is optional for launch, but it improves trust and makes the storefront easier to share.',
          step: 'domain_setup',
          complete: hasCustomDomain,
          required: false,
          action: hasCustomDomain ? 'Review domain' : 'Set up domain',
          href: '/admin/domain',
          estimate_minutes: 2
        }
      : null,
    {
      key: 'catalog',
      title: 'Publish the first product',
      description: 'A store cannot reach its first sale until at least one product is live on the storefront.',
      step: 'product_creation',
      complete: publishedProducts.length > 0,
      required: true,
      action: 'Add product',
      href: '/admin/products/new',
      estimate_minutes: 1
    },
    {
      key: 'payments',
      title: 'Activate Paystack or Flutterwave',
      description: 'Hosted checkout should be connected before shoppers reach the payment step.',
      step: 'payment_config',
      complete: hasActiveGateway,
      required: true,
      action: 'Connect payments',
      href: '/admin/settings',
      estimate_minutes: 1
    },
    {
      key: 'launch',
      title: 'Get the first paid order',
      description: 'The final milestone is a verified payment that moves an order from pending into confirmed.',
      step: 'launch',
      complete: hasPaidOrder,
      required: true,
      action: 'Review orders',
      href: '/admin/orders',
      estimate_minutes: 1
    }
  ];

  return tasks
    .map((task) => normalizeOnboardingTask(task))
    .filter(Boolean);
};

const buildOnboardingProgress = (tasks = []) => {
  const normalizedTasks = tasks
    .map((task) => normalizeOnboardingTask(task))
    .filter(Boolean);

  if (!normalizedTasks.length) {
    return {
      current_step: 'initial',
      completed: false,
      total_tasks: 0,
      completed_tasks: 0,
      required_tasks: 0,
      completed_required_tasks: 0,
      remaining_required_tasks: 0,
      next_task_key: null,
      next_task_title: null,
      next_action: null,
      next_href: null,
      estimated_minutes_remaining: 0
    };
  }

  const requiredTasks = normalizedTasks.filter((task) => task.required);
  const incompleteRequiredTasks = requiredTasks.filter((task) => !task.complete);
  const incompleteTasks = normalizedTasks.filter((task) => !task.complete);
  const nextTask = incompleteRequiredTasks[0] || incompleteTasks[0] || null;
  const currentStep = incompleteRequiredTasks.length
    ? incompleteRequiredTasks[0].step
    : (nextTask ? nextTask.step : 'completed');

  return {
    current_step: currentStep,
    completed: currentStep === 'completed',
    total_tasks: normalizedTasks.length,
    completed_tasks: normalizedTasks.filter((task) => task.complete).length,
    required_tasks: requiredTasks.length,
    completed_required_tasks: requiredTasks.filter((task) => task.complete).length,
    remaining_required_tasks: incompleteRequiredTasks.length,
    next_task_key: nextTask?.key || null,
    next_task_title: nextTask?.title || null,
    next_action: nextTask?.action || null,
    next_href: nextTask?.href || null,
    estimated_minutes_remaining: incompleteRequiredTasks.reduce((sum, task) => sum + Number(task.estimate_minutes || 0), 0)
  };
};

module.exports = {
  ONBOARDING_STEP_SEQUENCE,
  normalizeOnboardingTask,
  buildStoreOnboardingTasks,
  buildOnboardingProgress
};
