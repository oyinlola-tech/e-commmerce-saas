const { body, param, query } = require('express-validator');

const createValidations = (context, helpers) => {
  const {
    allowBodyFields,
    allowQueryFields,
    validate,
    commonRules,
    normalizeCurrencyCode,
    normalizeHostname,
    sanitizePlainText,
    sanitizeSlug,
    sanitizeUrl
  } = context;
  const {
    catalogSortOptions,
    safeDecodeURIComponent
  } = helpers;
  const allowedManualOrderStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'payment_failed', 'refund_pending', 'refunded'];

  const currencyValidation = [
    allowBodyFields(['code', 'returnTo', 'scope', '_csrf']),
    body('code').custom((value) => Boolean(normalizeCurrencyCode(value))).withMessage('Select a valid currency code.'),
    body('returnTo').optional().isString().isLength({ max: 2000 }),
    body('scope').optional().isIn(['store', 'platform'])
  ];

  const customerRegisterValidation = [
    allowBodyFields(['name', 'email', 'password', 'confirmPassword', 'returnTo', '_csrf']),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password(),
    body('returnTo').optional().isString().isLength({ max: 2000 }),
    body('confirmPassword')
      .isString()
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match.')
  ];

  const ownerSignupValidation = [
    allowBodyFields([
      'name',
      'email',
      'password',
      'confirmPassword',
      'store_name',
      'store_subdomain',
      'store_type',
      'template_key',
      'template_picker',
      'theme_color',
      'font_preset',
      '_csrf'
    ]),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password(),
    body('confirmPassword')
      .isString()
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match.'),
    body('store_name').optional().trim().isLength({ max: 150 }),
    body('store_subdomain').optional().customSanitizer((value) => sanitizeSlug(value).slice(0, 120)),
    body('store_type').optional().trim().isLength({ max: 50 }),
    body('template_key').optional().trim().isLength({ max: 50 }),
    body('template_picker').optional().trim().isLength({ max: 50 }),
    body('theme_color').optional().matches(/^#[0-9a-f]{6}$/i).withMessage('Use a valid hex colour.'),
    body('font_preset').optional().trim().isLength({ max: 50 })
  ];

  const ownerLoginValidation = [
    allowBodyFields(['email', 'password', 'returnTo', '_csrf']),
    commonRules.email(),
    body('returnTo').optional().isString().isLength({ max: 2000 }),
    body('password').isString().notEmpty().withMessage('Password is required.')
  ];

  const passwordResetRequestValidation = [
    allowBodyFields(['email', 'returnTo', '_csrf']),
    commonRules.email(),
    body('returnTo').optional().isString().isLength({ max: 2000 })
  ];

  const passwordResetConfirmValidation = [
    allowBodyFields(['email', 'otp', 'password', 'confirmPassword', 'returnTo', '_csrf']),
    commonRules.email(),
    body('otp')
      .isString()
      .trim()
      .isLength({ min: 4, max: 12 })
      .withMessage('Enter the OTP that was sent to your email.'),
    commonRules.password(),
    body('returnTo').optional().isString().isLength({ max: 2000 }),
    body('confirmPassword')
      .isString()
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match.')
  ];

  const subscriptionCheckoutValidation = [
    allowBodyFields(['plan', 'billing_cycle', '_csrf']),
    body('plan').isIn(['launch', 'scale', 'enterprise']),
    body('billing_cycle').optional().isIn(['monthly', 'yearly'])
  ];

  const adminBillingPlanValidation = [
    allowBodyFields(['plan', 'currency', 'monthly_amount', 'yearly_discount_percentage', '_csrf']),
    body('plan').isIn(['launch', 'scale', 'enterprise']),
    body('currency')
      .optional()
      .custom((value) => Boolean(normalizeCurrencyCode(value)))
      .withMessage('Choose a valid billing currency.'),
    body('monthly_amount')
      .isFloat({ min: 0.01, max: 1000000 })
      .withMessage('Monthly fee must be greater than zero.')
      .toFloat(),
    body('yearly_discount_percentage')
      .isFloat({ min: 0, max: 95 })
      .withMessage('Yearly discount must be between 0 and 95 percent.')
      .toFloat()
  ];

  const storeCreationValidation = [
    allowBodyFields(['name', 'subdomain', 'store_type', 'template_key', 'template_picker', 'theme_color', 'font_preset', '_csrf']),
    commonRules.name('name', 150),
    body('subdomain').customSanitizer((value) => sanitizeSlug(value).slice(0, 120)).notEmpty().withMessage('Subdomain is required.'),
    body('store_type').optional().trim().isLength({ max: 50 }),
    body('template_key').optional().trim().isLength({ max: 50 }),
    body('template_picker').optional().trim().isLength({ max: 50 }),
    body('theme_color').optional().matches(/^#[0-9a-f]{6}$/i).withMessage('Use a valid hex colour.'),
    body('font_preset').optional().trim().isLength({ max: 50 })
  ];

  const storeSettingsValidation = [
    allowBodyFields([
      'name',
      'tagline',
      'description',
      'store_type',
      'template_key',
      'template_picker',
      'font_preset',
      'theme_color',
      'support_email',
      'contact_phone',
      'fulfillment_sla',
      'return_window_days',
      'shipping_origin_country',
      'shipping_flat_rate',
      'domestic_shipping_rate',
      'international_shipping_rate',
      'free_shipping_threshold',
      'tax_rate',
      'tax_label',
      'tax_apply_to_shipping',
      'seo_title',
      'seo_description',
      'seo_keywords',
      'announcement_text',
      'hero_eyebrow',
      'hero_title',
      'hero_description',
      'hero_support',
      'primary_cta_text',
      'secondary_cta_text',
      'featured_collection_title',
      'featured_collection_description',
      'footer_blurb',
      'paystack_public_key',
      'paystack_secret_key',
      'paystack_status',
      'flutterwave_public_key',
      'flutterwave_secret_key',
      'flutterwave_webhook_secret_hash',
      'flutterwave_status',
      '_csrf'
    ]),
    commonRules.name('name', 150),
    body('tagline').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 180 })),
    body('description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 1500 })),
    body('store_type').optional().trim().isLength({ max: 50 }),
    body('template_key').optional().trim().isLength({ max: 50 }),
    body('font_preset').optional().trim().isLength({ max: 50 }),
    body('theme_color').optional().matches(/^#[0-9a-f]{6}$/i).withMessage('Use a valid hex colour.'),
    body('support_email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid support email.'),
    body('contact_phone').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 50 })),
    body('fulfillment_sla').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('return_window_days').optional().isInt({ min: 1, max: 365 }).toInt(),
    body('shipping_origin_country').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('shipping_flat_rate').optional({ values: 'falsy' }).isFloat({ min: 0, max: 1000000 }).toFloat(),
    body('domestic_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0, max: 1000000 }).toFloat(),
    body('international_shipping_rate').optional({ values: 'falsy' }).isFloat({ min: 0, max: 1000000 }).toFloat(),
    body('free_shipping_threshold').optional({ values: 'falsy' }).isFloat({ min: 0, max: 1000000 }).toFloat(),
    body('tax_rate').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).toFloat(),
    body('tax_label').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 80 })),
    body('tax_apply_to_shipping').optional().isIn(['0', '1', 'true', 'false', 'on']).withMessage('Choose whether tax should apply to shipping.'),
    body('seo_title').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('seo_description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 320 })),
    body('seo_keywords').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 255 })),
    body('announcement_text').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 180 })),
    body('hero_eyebrow').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 80 })),
    body('hero_title').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 180 })),
    body('hero_description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 500 })),
    body('hero_support').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 160 })),
    body('primary_cta_text').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 50 })),
    body('secondary_cta_text').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 50 })),
    body('featured_collection_title').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 160 })),
    body('featured_collection_description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 320 })),
    body('footer_blurb').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 400 })),
    body('paystack_public_key').optional().isString(),
    body('paystack_secret_key').optional().isString(),
    body('paystack_status').optional().isString(),
    body('flutterwave_public_key').optional().isString(),
    body('flutterwave_secret_key').optional().isString(),
    body('flutterwave_webhook_secret_hash').optional().isString(),
    body('flutterwave_status').optional().isString()
  ];

  const domainValidation = [
    allowBodyFields(['custom_domain', '_csrf']),
    body('custom_domain').optional().custom((value) => {
      return !value || Boolean(normalizeHostname(value));
    }).withMessage('Enter a valid hostname such as store.example.com.')
  ];

  const productValidation = [
    allowBodyFields([
      'name',
      'category',
      'sku',
      'description',
      'highlights',
      'price',
      'compare_at_price',
      'discount_type',
      'discount_value',
      'promotion_type',
      'discount_label',
      'discount_starts_at',
      'discount_ends_at',
      'inventory',
      'featured',
      'image',
      'gallery',
      'status',
      '_csrf'
    ]),
    commonRules.name('name', 180),
    body('category').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('sku').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 3000 })),
    body('highlights').optional().isString(),
    body('price').isFloat({ min: 0 }).withMessage('Price must be zero or greater.').toFloat(),
    body('compare_at_price').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Compare-at price must be zero or greater.').toFloat(),
    body('discount_type').optional().isIn(['none', 'amount', 'percentage']).withMessage('Choose a valid discount type.'),
    body('discount_value').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Discount value must be zero or greater.').toFloat(),
    body('promotion_type').optional().isIn(['none', 'discount', 'flash_sale']).withMessage('Choose a valid promotion type.'),
    body('discount_label').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
    body('discount_starts_at').optional({ values: 'falsy' }).isISO8601().withMessage('Use a valid discount start date and time.'),
    body('discount_ends_at').optional({ values: 'falsy' }).isISO8601().withMessage('Use a valid discount end date and time.'),
    body('inventory').isInt({ min: 0, max: 1000000 }).withMessage('Inventory must be zero or greater.').toInt(),
    body('image').optional({ values: 'falsy' }).customSanitizer((value) => sanitizeUrl(value)),
    body('gallery').optional().isString()
  ];

  const couponValidation = [
    allowBodyFields([
      'code',
      'description',
      'discount_type',
      'discount_value',
      'minimum_order_amount',
      'starts_at',
      'ends_at',
      'usage_limit',
      'is_active',
      '_csrf'
    ]),
    body('code')
      .trim()
      .notEmpty()
      .isLength({ max: 80 })
      .withMessage('Coupon code is required.'),
    body('description').optional().customSanitizer((value) => sanitizePlainText(value, { maxLength: 190 })),
    body('discount_type').isIn(['amount', 'percentage']).withMessage('Choose a valid coupon discount type.'),
    body('discount_value').isFloat({ min: 0.01 }).withMessage('Discount value must be greater than zero.').toFloat(),
    body('minimum_order_amount').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Minimum order amount must be zero or greater.').toFloat(),
    body('starts_at').optional({ values: 'falsy' }).isISO8601().withMessage('Use a valid coupon start date and time.'),
    body('ends_at').optional({ values: 'falsy' }).isISO8601().withMessage('Use a valid coupon end date and time.'),
    body('usage_limit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Usage limit must be a whole number greater than zero.').toInt(),
    body('is_active').optional().isIn(['0', '1', 'true', 'false', 'on']).withMessage('Choose whether the coupon is active.')
  ];

  const cartCouponValidation = [
    allowBodyFields(['coupon_code', '_csrf']),
    body('coupon_code')
      .trim()
      .notEmpty()
      .isLength({ max: 80 })
      .withMessage('Enter a coupon code.')
  ];

  const orderStatusValidation = [
    allowBodyFields(['status', '_csrf']),
    body('status').trim().isIn(allowedManualOrderStatuses).withMessage('Choose a valid order status.')
  ];

  const checkoutValidation = [
    allowBodyFields([
      'name',
      'address',
      'city',
      'country',
      'postal_code',
      'provider',
      '_csrf'
    ]),
    commonRules.name('name', 120),
    body('address').customSanitizer((value) => sanitizePlainText(value, { maxLength: 190 })).notEmpty().withMessage('Address is required.'),
    body('city').customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })).notEmpty().withMessage('City is required.'),
    body('country').customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })).notEmpty().withMessage('Country is required.'),
    body('postal_code').customSanitizer((value) => sanitizePlainText(value, { maxLength: 30 })).notEmpty().withMessage('Postal code is required.'),
    body('provider').trim().isIn(['paystack', 'flutterwave']).withMessage('Choose Paystack or Flutterwave.')
  ];

  const cartMutationValidation = (requiresQuantity = false) => validate([
    allowBodyFields(['productId', 'quantity']),
    body('productId').isString().notEmpty().withMessage('productId is required.'),
    ...(requiresQuantity
      ? [body('quantity').isInt({ min: 0, max: 999 }).withMessage('quantity must be between 0 and 999.').toInt()]
      : [body('quantity').optional().isInt({ min: 1, max: 999 }).withMessage('quantity must be between 1 and 999.').toInt()])
  ]);

  const productIdentifierValidation = param('productId')
    .trim()
    .notEmpty()
    .isLength({ max: 120 })
    .withMessage('productId is required.')
    .customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 }));

  const catalogQueryValidation = validate([
    allowQueryFields(['category', 'search', 'sort', 'tag']),
    query('category').optional().customSanitizer((value) => sanitizePlainText(safeDecodeURIComponent(value), { maxLength: 120 })),
    commonRules.querySearch('search'),
    commonRules.queryEnum('sort', catalogSortOptions),
    query('tag').optional().customSanitizer((value) => sanitizePlainText(safeDecodeURIComponent(value), { maxLength: 120 }))
  ]);

  return {
    currencyValidation,
    customerRegisterValidation,
    ownerSignupValidation,
    ownerLoginValidation,
    passwordResetRequestValidation,
    passwordResetConfirmValidation,
    subscriptionCheckoutValidation,
    adminBillingPlanValidation,
    storeCreationValidation,
    storeSettingsValidation,
    domainValidation,
    productValidation,
    couponValidation,
    cartCouponValidation,
    orderStatusValidation,
    checkoutValidation,
    cartMutationValidation,
    productIdentifierValidation,
    catalogQueryValidation
  };
};

module.exports = {
  createValidations
};
