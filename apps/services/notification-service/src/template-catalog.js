const TEMPLATE_STATUS = {
  IMPLEMENTED: 'implemented',
  PLANNED: 'planned'
};

const EMAIL_TEMPLATE_CATALOG = [
  {
    key: 'platform.password_reset_otp',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'auth',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'OTP email for platform user password reset requests.',
    trigger: 'POST /auth/password-reset/request in user-service',
    required_data: ['name', 'otp', 'expires_in_minutes']
  },
  {
    key: 'platform.owner_welcome',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'lifecycle',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Welcome email after a new store owner registers.',
    trigger: 'USER_REGISTERED event',
    required_data: ['name']
  },
  {
    key: 'platform.owner_email_verification_otp',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'auth',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'OTP email to verify a store owner email address.',
    trigger: 'Future owner verification flow',
    required_data: ['name', 'otp', 'expires_in_minutes']
  },
  {
    key: 'platform.owner_login_alert',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'security',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Alert when a store owner signs in from an unfamiliar device or location.',
    trigger: 'Future suspicious login detection',
    required_data: ['name', 'ip_address', 'device', 'location', 'signed_in_at']
  },
  {
    key: 'platform.store_created',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'store',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Confirmation that a new store was created successfully.',
    trigger: 'STORE_CREATED event',
    required_data: ['name', 'store_name', 'store_url']
  },
  {
    key: 'platform.subscription_trial_started',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Confirms that the free trial has started after card authorization succeeds.',
    trigger: 'Subscription verification success in billing-service',
    required_data: ['name', 'plan_name', 'trial_ends_at']
  },
  {
    key: 'platform.subscription_trial_ending',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Reminder before a free trial ends and billing starts.',
    trigger: 'Scheduled check against subscriptions.trial_ends_at',
    required_data: ['name', 'plan_name', 'trial_ends_at', 'amount', 'currency']
  },
  {
    key: 'platform.subscription_trial_ended',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Notifies an owner that the trial ended.',
    trigger: 'Trial expiry workflow',
    required_data: ['name', 'status']
  },
  {
    key: 'platform.subscription_invoice_created',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Sends the owner a new subscription invoice.',
    trigger: 'Invoice creation in billing-service',
    required_data: ['name', 'invoice_id', 'amount', 'currency']
  },
  {
    key: 'platform.subscription_invoice_paid',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Receipt after a subscription invoice payment succeeds.',
    trigger: 'PAYMENT_SUCCEEDED for invoice entities',
    required_data: ['name', 'invoice_id', 'amount', 'currency', 'paid_at']
  },
  {
    key: 'platform.subscription_payment_failed',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Failed subscription payment warning.',
    trigger: 'PAYMENT_FAILED for invoice or subscription entities',
    required_data: ['name', 'amount', 'currency']
  },
  {
    key: 'platform.subscription_renewed',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Confirms the subscription renewed successfully.',
    trigger: 'Renewal confirmation workflow',
    required_data: ['name', 'plan_name', 'current_period_end']
  },
  {
    key: 'platform.subscription_cancellation_scheduled',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Confirms that cancellation is scheduled for period end.',
    trigger: 'POST /subscriptions/cancel when cancel_at_period_end is set',
    required_data: ['name', 'current_period_end']
  },
  {
    key: 'platform.subscription_cancelled',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Confirms that a subscription is fully cancelled.',
    trigger: 'POST /subscriptions/cancel when status becomes cancelled',
    required_data: ['name']
  },
  {
    key: 'platform.compliance_status_changed',
    audience: 'platform_user',
    brand_mode: 'platform',
    category: 'compliance',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Communicates KYC or KYB approval, rejection, or a request for more information.',
    trigger: 'COMPLIANCE_STATUS_CHANGED event',
    required_data: ['name', 'status', 'target_type']
  },
  {
    key: 'store.customer_password_reset_otp',
    audience: 'customer',
    brand_mode: 'store',
    category: 'auth',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'OTP email for storefront customer password reset requests.',
    trigger: 'POST /customers/password-reset/request in customer-service',
    required_data: ['name', 'otp', 'expires_in_minutes']
  },
  {
    key: 'store.customer_welcome',
    audience: 'customer',
    brand_mode: 'store',
    category: 'lifecycle',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Welcome email after a customer registers.',
    trigger: 'CUSTOMER_REGISTERED event',
    required_data: ['name']
  },
  {
    key: 'store.customer_email_verification_otp',
    audience: 'customer',
    brand_mode: 'store',
    category: 'auth',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'OTP email to verify a customer email address.',
    trigger: 'Future storefront verification flow',
    required_data: ['name', 'otp', 'expires_in_minutes']
  },
  {
    key: 'store.customer_login_alert',
    audience: 'customer',
    brand_mode: 'store',
    category: 'security',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Alert when a customer account is accessed from an unfamiliar device or location.',
    trigger: 'Future suspicious login detection',
    required_data: ['name', 'ip_address', 'device', 'location', 'signed_in_at']
  },
  {
    key: 'store.owner_order_pending',
    audience: 'platform_user',
    brand_mode: 'store',
    category: 'orders',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Alerts store owners and support inboxes when a new order is created and payment is still pending.',
    trigger: 'ORDER_CREATED event',
    required_data: ['order_id', 'amount', 'currency', 'items', 'customer']
  },
  {
    key: 'store.owner_order_paid',
    audience: 'platform_user',
    brand_mode: 'store',
    category: 'payments',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Alerts store owners and support inboxes when an order payment succeeds.',
    trigger: 'PAYMENT_SUCCEEDED for order entities',
    required_data: ['order_id', 'amount', 'currency', 'paid_at', 'customer']
  },
  {
    key: 'store.owner_order_payment_failed',
    audience: 'platform_user',
    brand_mode: 'store',
    category: 'payments',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Alerts store owners and support inboxes when an order payment fails.',
    trigger: 'PAYMENT_FAILED for order entities',
    required_data: ['order_id', 'amount', 'currency', 'customer']
  },
  {
    key: 'store.owner_order_status_changed',
    audience: 'platform_user',
    brand_mode: 'store',
    category: 'orders',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Alerts store owners and support inboxes when an order moves to a new non-payment fulfillment status.',
    trigger: 'ORDER_STATUS_CHANGED event',
    required_data: ['order_id', 'status', 'customer']
  },
  {
    key: 'store.order_confirmation',
    audience: 'customer',
    brand_mode: 'store',
    category: 'orders',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Confirms that an order was created and received.',
    trigger: 'ORDER_CREATED event',
    required_data: ['name', 'order_id', 'amount', 'currency', 'items']
  },
  {
    key: 'store.payment_receipt',
    audience: 'customer',
    brand_mode: 'store',
    category: 'payments',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Receipt for a successful storefront payment.',
    trigger: 'PAYMENT_SUCCEEDED for order entities',
    required_data: ['name', 'order_id', 'amount', 'currency']
  },
  {
    key: 'store.payment_failed',
    audience: 'customer',
    brand_mode: 'store',
    category: 'payments',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Payment failure email for checkout attempts.',
    trigger: 'PAYMENT_FAILED for order entities',
    required_data: ['name', 'order_id', 'amount', 'currency']
  },
  {
    key: 'store.invoice_issued',
    audience: 'customer',
    brand_mode: 'store',
    category: 'billing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Invoice email for B2B or manual invoice orders.',
    trigger: 'Future invoice workflow',
    required_data: ['name', 'invoice_id', 'amount', 'currency']
  },
  {
    key: 'store.order_status_processing',
    audience: 'customer',
    brand_mode: 'store',
    category: 'orders',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Order is being prepared or processed.',
    trigger: 'ORDER_STATUS_CHANGED event',
    required_data: ['name', 'order_id', 'status']
  },
  {
    key: 'store.order_status_shipped',
    audience: 'customer',
    brand_mode: 'store',
    category: 'orders',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Order shipped notification with tracking details.',
    trigger: 'Future shipped status workflow',
    required_data: ['name', 'order_id']
  },
  {
    key: 'store.order_status_delivered',
    audience: 'customer',
    brand_mode: 'store',
    category: 'orders',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Delivery confirmation email.',
    trigger: 'Future delivered status workflow',
    required_data: ['name', 'order_id']
  },
  {
    key: 'store.order_cancelled',
    audience: 'customer',
    brand_mode: 'store',
    category: 'orders',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Order cancellation email.',
    trigger: 'Future cancelled status workflow',
    required_data: ['name', 'order_id']
  },
  {
    key: 'store.refund_issued',
    audience: 'customer',
    brand_mode: 'store',
    category: 'payments',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Confirms that a refund has been issued.',
    trigger: 'Future refund workflow',
    required_data: ['name', 'order_id', 'amount', 'currency']
  },
  {
    key: 'store.abandoned_cart_reminder',
    audience: 'customer',
    brand_mode: 'store',
    category: 'retention',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Reminder to complete a checkout that was started but not finished.',
    trigger: 'Future cart recovery workflow',
    required_data: ['name', 'cart_url', 'items']
  },
  {
    key: 'store.monthly_product_marketing',
    audience: 'customer',
    brand_mode: 'store',
    category: 'marketing',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Monthly branded product roundup featuring the latest store arrivals.',
    trigger: 'Monthly marketing scheduler for subscribed customers',
    required_data: ['name', 'products', 'catalog_url', 'unsubscribe_url']
  },
  {
    key: 'store.wishlist_back_in_stock',
    audience: 'customer',
    brand_mode: 'store',
    category: 'retention',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Notifies a customer when a saved item returns to stock.',
    trigger: 'Future inventory alert workflow',
    required_data: ['name', 'product_name', 'product_url']
  },
  {
    key: 'store.wishlist_price_drop',
    audience: 'customer',
    brand_mode: 'store',
    category: 'retention',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Notifies a customer when a saved item price drops.',
    trigger: 'Future merchandising alert workflow',
    required_data: ['name', 'product_name', 'product_url', 'new_price', 'currency']
  },
  {
    key: 'store.review_request',
    audience: 'customer',
    brand_mode: 'store',
    category: 'retention',
    status: TEMPLATE_STATUS.IMPLEMENTED,
    description: 'Asks a customer to review a delivered order or product.',
    trigger: 'Post-delivery follow-up workflow',
    required_data: ['name', 'order_id', 'review_url']
  }
];

const EMAIL_TEMPLATE_INDEX = new Map(
  EMAIL_TEMPLATE_CATALOG.map((template) => [template.key, template])
);

const getEmailTemplateDefinition = (templateKey = '') => {
  return EMAIL_TEMPLATE_INDEX.get(String(templateKey || '').trim()) || null;
};

const listEmailTemplates = () => {
  return EMAIL_TEMPLATE_CATALOG.slice();
};

module.exports = {
  TEMPLATE_STATUS,
  EMAIL_TEMPLATE_CATALOG,
  getEmailTemplateDefinition,
  listEmailTemplates
};
