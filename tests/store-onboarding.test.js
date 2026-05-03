const {
  buildStoreOnboardingTasks,
  buildOnboardingProgress
} = require('../packages/shared/src/store-onboarding');

describe('store onboarding helpers', () => {
  test('includes the custom domain step only when available on the plan or already configured', () => {
    const withoutCapability = buildStoreOnboardingTasks({
      store: {
        name: 'Aisle Studio',
        support_email: 'support@example.com',
        fulfillment_sla: 'Ships in 24 hours'
      },
      entitlements: {
        capabilities: {}
      }
    });
    const withCapability = buildStoreOnboardingTasks({
      store: {
        name: 'Aisle Studio',
        support_email: 'support@example.com',
        fulfillment_sla: 'Ships in 24 hours'
      },
      entitlements: {
        capabilities: {
          custom_domain: true
        }
      }
    });

    expect(withoutCapability.some((task) => task.key === 'domain')).toBe(false);
    expect(withCapability.some((task) => task.key === 'domain')).toBe(true);
  });

  test('derives the next required step from incomplete launch tasks', () => {
    const tasks = buildStoreOnboardingTasks({
      store: {
        name: 'Aisle Studio',
        support_email: 'support@example.com',
        fulfillment_sla: 'Ships in 24 hours'
      },
      products: [
        { status: 'published' }
      ],
      paymentProviderConfigs: {
        paystack: { status: 'inactive' }
      }
    });
    const progress = buildOnboardingProgress(tasks);

    expect(progress.current_step).toBe('payment_config');
    expect(progress.next_task_key).toBe('payments');
    expect(progress.remaining_required_tasks).toBeGreaterThan(0);
  });

  test('marks onboarding complete after identity, catalog, payment, and first sale are all done', () => {
    const tasks = buildStoreOnboardingTasks({
      store: {
        name: 'Aisle Studio',
        support_email: 'support@example.com',
        fulfillment_sla: 'Ships in 24 hours',
        custom_domain: 'shop.example.com'
      },
      products: [
        { status: 'published' }
      ],
      orders: [
        { payment_status: 'paid', status: 'confirmed' }
      ],
      paymentProviderConfigs: {
        paystack: { status: 'active' }
      },
      entitlements: {
        capabilities: {
          custom_domain: true
        }
      }
    });
    const progress = buildOnboardingProgress(tasks);

    expect(progress.completed).toBe(true);
    expect(progress.current_step).toBe('completed');
    expect(progress.remaining_required_tasks).toBe(0);
  });
});
