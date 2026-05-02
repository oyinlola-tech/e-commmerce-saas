const LAST_UPDATED = 'May 2, 2026';

const normalizeText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createSection = (id, title, options = {}) => {
  return {
    id,
    title,
    summary: options.summary || '',
    paragraphs: Array.isArray(options.paragraphs) ? options.paragraphs : [],
    bullets: Array.isArray(options.bullets) ? options.bullets : []
  };
};

const buildOwnerTermsPage = ({ brand = {} } = {}) => {
  const platformName = normalizeText(brand.platformName, 'Aisle');
  const supportEmail = normalizeText(brand.supportEmail, 'support@aisle.so');

  return {
    kind: 'terms',
    audienceLabel: 'Store owner level',
    badge: 'Merchant Terms',
    title: `${platformName} Merchant Terms & Conditions`,
    metaTitle: `${platformName} Merchant Terms & Conditions`,
    metaDescription: `Detailed platform terms for store owners using ${platformName}, including account duties, billing, data handling, acceptable use, and service protections.`,
    lastUpdated: LAST_UPDATED,
    noticeLabel: 'Important',
    notice: `${platformName} uses this page as a production-ready baseline for merchant-facing platform terms. It is designed to reflect common ecommerce, billing, and privacy expectations, but you should still review it with counsel for your entity name, jurisdiction, tax setup, and regulated workflows before launch.`,
    highlights: [
      {
        title: 'Transparent billing rules',
        body: 'Trials, authorizations, subscription fees, invoice handling, failed payments, and cancellation timing are described up front so merchants are not surprised later.'
      },
      {
        title: 'Clear data roles',
        body: `${platformName} explains when it acts as the platform operator and when a merchant remains responsible for store content, customer notices, and lawful business practices.`
      },
      {
        title: 'Operational safeguards',
        body: 'The terms reserve the right to prevent abuse, protect the service, suspend risky activity, and preserve evidence needed for fraud, security, or legal review.'
      }
    ],
    factsTitle: 'Quick view',
    facts: [
      { label: 'Applies to', value: 'Store owners, invited staff, and anyone acting for a merchant account' },
      { label: 'Billing model', value: 'Subscription, trial, invoice, and auto-renewal rules where enabled' },
      { label: 'Support contact', value: supportEmail },
      { label: 'Update method', value: 'Posted revisions plus product or email notice for material changes when appropriate' }
    ],
    tocTitle: 'Contents',
    sections: [
      createSection('scope', 'Scope and acceptance', {
        summary: `These terms govern a merchant's access to and use of ${platformName}, including the owner workspace, store administration tools, hosted storefront features, connected communications, and related support interactions.`,
        paragraphs: [
          `By creating an account, inviting teammates, creating a store, connecting a payment provider, or otherwise using ${platformName}, you agree to these terms and any policies or product notices that are expressly incorporated into them.`,
          'If you use the service on behalf of a business, you represent that you have authority to bind that business and to accept responsibility for the acts, omissions, and instructions of the people who use the account under your authority.'
        ]
      }),
      createSection('eligibility', 'Eligibility, authority, and account security', {
        summary: 'Merchant accounts are intended for lawful business use by people who can enter into binding agreements and operate a store responsibly.',
        bullets: [
          'You must provide accurate registration, billing, tax, and contact details and keep them current.',
          'You are responsible for maintaining the confidentiality of passwords, OTP codes, API credentials, and access tokens issued for your account.',
          'You must promptly notify the platform if you suspect unauthorized access, credential leakage, fraud, or abuse.',
          'You are responsible for the actions of employees, contractors, agents, or invited collaborators who use your account or store resources.'
        ]
      }),
      createSection('billing', 'Plans, trials, invoices, and renewals', {
        summary: 'Paid features may be offered on a trial, monthly, yearly, invoice-backed, or other subscription basis depending on the plan and market.',
        paragraphs: [
          'Trial access may require a card authorization or payment method verification before the trial starts. Unless the checkout flow says otherwise, that step is used to confirm billing readiness rather than to change the substance of these terms.',
          'Subscriptions renew automatically at the end of each billing period unless you cancel in time for the change to take effect before renewal. Downgrades, upgrades, proration, discounts, taxes, refunds, and credits are handled according to the pricing flow or invoice then in effect.',
          'Published fees generally do not include bank charges, foreign-exchange costs, withholding obligations, VAT, GST, sales tax, or similar assessments unless the checkout or invoice expressly says they are included.'
        ],
        bullets: [
          'Failed charges may result in retried billing, account restrictions, suspended store operations, or eventual termination if not resolved.',
          'Invoice or receipt emails are informational records and do not by themselves waive collection rights, audit rights, or dispute rights.',
          'You remain responsible for all accrued charges up to the effective date of cancellation or termination.'
        ]
      }),
      createSection('merchant-duties', 'Merchant responsibilities and store operations', {
        summary: 'You remain responsible for the business decisions made through your storefront and for the promises you make to customers.',
        bullets: [
          'Set accurate product details, pricing, fulfillment timelines, inventory status, and support contacts.',
          'Maintain legally required store-facing policies such as shipping, returns, refunds, tax disclosures, and customer support procedures that apply to your products and markets.',
          'Ensure products, offers, claims, discounts, and content are lawful, non-misleading, and not infringing on third-party rights.',
          'Use the service only for legitimate commerce and operational workflows, not for deceptive campaigns, credential theft, malware distribution, or unlawful trade.'
        ]
      }),
      createSection('customer-data', 'Customer data roles and privacy duties', {
        summary: `In the normal hosted-storefront model, the merchant decides what products to sell, what customer data to collect in the storefront, and how the merchant-customer relationship is managed. ${platformName} provides hosted tools, service infrastructure, and support functions around that relationship.`,
        paragraphs: [
          'Because those roles may differ by jurisdiction and workflow, merchants must publish accurate customer-facing privacy and commerce notices for their stores and must only use customer data in ways allowed by law and by the representations made to customers.',
          `${platformName} may process customer-related data to host the storefront, operate accounts, route service communications, secure the platform, investigate abuse, and support merchant operations, but the merchant remains responsible for the products sold, the store's public-facing commitments, and any optional marketing or customer-data practices the merchant controls.`
        ]
      }),
      createSection('acceptable-use', 'Acceptable use and prohibited conduct', {
        summary: 'The platform may not be used in ways that create security risk, legal exposure, payment abuse, or harm to customers, the platform, or other merchants.',
        bullets: [
          'Do not use the platform to distribute malware, interfere with service availability, scrape protected data, reverse engineer restricted components, or bypass access controls.',
          'Do not sell prohibited goods, counterfeit items, stolen property, or goods/services that violate sanctions, payments rules, intellectual-property rights, or consumer-protection laws.',
          'Do not use false identity details, fabricate support records, manipulate chargebacks, or route transactions to conceal the true nature of the business.',
          'Do not upload content that is defamatory, unlawful, invasive of privacy, discriminatory, abusive, or otherwise harmful.'
        ]
      }),
      createSection('third-parties', 'Third-party services, domains, and payment providers', {
        summary: 'Parts of the service may rely on domain registrars, cloud vendors, payment providers, analytics tools, communications vendors, or other third parties.',
        paragraphs: [
          'Those providers may have their own eligibility rules, security requirements, service levels, and legal terms. When you connect them to your store, you are responsible for reviewing and complying with those third-party terms and for keeping your credentials and payment-provider settings accurate.',
          `${platformName} is not responsible for outages, holds, chargebacks, payment declines, reserves, sanctions, or account actions taken independently by a connected third party, although the platform may surface related notices or take protective measures inside the product.`
        ]
      }),
      createSection('availability', 'Availability, support, and product changes', {
        summary: `The service may evolve over time, and ${platformName} may improve, replace, restrict, or retire features in a way that supports reliability, compliance, and product integrity.`,
        bullets: [
          'Maintenance windows, patches, capacity controls, fraud reviews, and emergency interventions may affect availability from time to time.',
          'Beta, preview, early-access, or experimental features may be changed or withdrawn with limited notice and may have reduced support commitments.',
          'Support channels and response targets may vary by plan, region, incident type, and account standing.'
        ]
      }),
      createSection('ip', 'Intellectual property and licenses', {
        summary: `The platform and its core software, templates, designs, documentation, and service marks remain the property of ${platformName} or its licensors.`,
        paragraphs: [
          'You retain ownership of the content you upload or submit for your store, subject to the rights needed for the platform to host, secure, display, cache, transmit, back up, and otherwise operate that content as part of the service.',
          `You receive a limited, non-exclusive, revocable, non-transferable right to use ${platformName} during the valid subscription term and only in accordance with these terms and your plan limits.`
        ]
      }),
      createSection('suspension', 'Suspension, termination, and effect of exit', {
        summary: 'The platform may limit or suspend access when it reasonably believes doing so is necessary to protect customers, the platform, payments integrity, security, or legal compliance.',
        bullets: [
          'Suspension may occur for non-payment, security incidents, repeated policy violations, credible fraud indicators, legal process, or material risk to other users or service providers.',
          'On termination, access rights end, but billing obligations, payment disputes, legal claims, audit trails, and records needed for security, fraud, tax, accounting, or regulatory reasons may continue.',
          'You should export any merchant data you need before the account closes, subject to normal product capabilities and lawful retention restrictions.'
        ]
      }),
      createSection('liability', 'Disclaimers, limitation of liability, and indemnity', {
        summary: `Except where the law does not allow it, ${platformName} provides the service on an "as available" basis without promising uninterrupted operation, perfect suitability for every business model, or error-free integrations with every third party.`,
        paragraphs: [
          'Nothing in these terms excludes liability that cannot lawfully be excluded, such as liability for fraud, willful misconduct, or other non-waivable rights under applicable law.',
          'To the extent permitted by law, the merchant agrees to defend and indemnify the platform and its personnel against claims arising from the merchant’s products, customer-facing promises, unlawful content, misuse of the service, or violation of law or third-party rights.'
        ]
      }),
      createSection('changes', 'Changes, notices, and dispute handling', {
        summary: 'Material changes to these terms may be posted on the site, surfaced in-product, or sent by email or other account contact method when appropriate.',
        paragraphs: [
          'If a change is material, the platform may specify the effective date in the notice. Continued use after the effective date means the updated terms apply, except where law requires a different method of assent or notice.',
          'These terms are intended to work alongside mandatory consumer, commercial, privacy, and payment laws. If a local law gives you rights that cannot be waived, those rights continue to apply.'
        ],
        bullets: [
          `Questions about these terms, billing, trust, or privacy can be sent to ${supportEmail}.`,
          'Formal legal notices should include the account email, store name if applicable, the issue in dispute, and sufficient detail for verification and response.'
        ]
      })
    ]
  };
};

const buildOwnerPrivacyPage = ({ brand = {} } = {}) => {
  const platformName = normalizeText(brand.platformName, 'Aisle');
  const supportEmail = normalizeText(brand.supportEmail, 'support@aisle.so');

  return {
    kind: 'privacy',
    audienceLabel: 'Store owner level',
    badge: 'Merchant Privacy',
    title: `${platformName} Merchant Privacy Notice`,
    metaTitle: `${platformName} Merchant Privacy Notice`,
    metaDescription: `Detailed privacy notice for merchants using ${platformName}, covering account data, store operations data, billing data, security logs, sharing, retention, and rights.`,
    lastUpdated: LAST_UPDATED,
    noticeLabel: 'Transparency',
    notice: `${platformName} uses this privacy notice to explain what merchant-facing data is collected, why it is used, how long it is retained, who receives it, and what rights may be available. It is written as a layered notice so the high-level commitments are visible quickly and the detailed sections remain easy to access.`,
    highlights: [
      {
        title: 'Operational data only',
        body: 'The notice focuses on account, store, billing, security, and support information needed to run the platform and maintain a trustworthy merchant environment.'
      },
      {
        title: 'Customer-data role clarity',
        body: 'It distinguishes merchant-account information from storefront customer data and explains when the platform hosts or processes customer-related records for the merchant.'
      },
      {
        title: 'Retention and rights',
        body: 'It explains the criteria used to keep records and the kinds of access, correction, deletion, objection, portability, or complaint rights that may apply.'
      }
    ],
    factsTitle: 'Quick view',
    facts: [
      { label: 'Data categories', value: 'Account, store setup, billing, support, usage, and security records' },
      { label: 'Primary purposes', value: 'Service delivery, fraud prevention, support, billing, and compliance' },
      { label: 'Retention approach', value: 'Keep data only while needed for operations, law, security, or legitimate recordkeeping' },
      { label: 'Privacy contact', value: supportEmail }
    ],
    tocTitle: 'Contents',
    sections: [
      createSection('who-we-are', 'Who this notice covers', {
        summary: `This notice applies to personal data handled by ${platformName} about store owners, invited merchant staff, prospective merchants, billing contacts, support contacts, and other people interacting with the platform in a merchant or business context.`,
        paragraphs: [
          'It does not replace a merchant’s own customer-facing privacy notice. Merchants remain responsible for notices they show to customers in their storefronts and for the lawfulness of the merchant-controlled processing they perform.'
        ]
      }),
      createSection('categories', 'What data we collect', {
        summary: 'The categories of personal data collected depend on how you use the service and what workflows you enable.',
        bullets: [
          'Identity and account data such as name, email address, role, login credentials, and verification or password-reset details.',
          'Store-operation data such as store names, domains, logos, support contacts, configuration preferences, product or content setup actions, and administrative settings.',
          'Billing and finance data such as plan selection, invoices, payment references, billing-cycle status, and records of payment success or failure.',
          'Support and communications data such as messages, attachments, feedback, issue history, and operational notices.',
          'Usage and security data such as device/browser signals, IP address, session activity, audit logs, suspicious-login indicators, and abuse-prevention records.'
        ]
      }),
      createSection('sources', 'Where data comes from', {
        summary: 'Data may come directly from the merchant, from invited team members, from customer-support interactions, from connected providers, or from platform-generated logs.',
        paragraphs: [
          'Examples include account sign-up forms, store-creation flows, billing checkout, domain setup, support tickets, webhook or payment-provider callbacks, operational event logs, and internal security telemetry.'
        ]
      }),
      createSection('purposes', 'Why we use merchant data', {
        summary: `Merchant data is used to operate ${platformName}, authenticate users, keep the platform secure, support billing, deliver service notices, and improve reliability.`,
        bullets: [
          'Create and manage accounts, stores, roles, and access permissions.',
          'Authenticate sessions, send OTP or security notices, and monitor for fraud, abuse, or misuse.',
          'Run subscription billing, generate invoices, reconcile payments, and maintain financial records.',
          'Provide customer support, incident response, operational troubleshooting, and product communications.',
          'Meet legal, accounting, tax, audit, sanctions-screening, or regulatory obligations where they apply.',
          'Understand aggregate product usage trends so the service can be maintained and improved.'
        ]
      }),
      createSection('customer-role', 'How customer-related data is handled in the merchant environment', {
        summary: `When a merchant uses ${platformName} to run a storefront, the merchant normally decides what customer-facing workflows to enable, what products are offered, and what customer communications are sent as part of the merchant-customer relationship.`,
        paragraphs: [
          `${platformName} may host, secure, transmit, or support customer-related data in order to operate the storefront, order flow, customer account, payment status notifications, or support tooling.`,
          'Merchants remain responsible for the legal basis, notice, retention choices, and downstream uses they control. The platform may also use limited customer-related operational data where necessary to protect the service, investigate incidents, satisfy lawful requests, or prevent fraud.'
        ]
      }),
      createSection('sharing', 'Who we share data with', {
        summary: 'Personal data may be shared with service providers or counterparties only where reasonably necessary for business operations, legal compliance, support, or security.',
        bullets: [
          'Infrastructure, hosting, storage, monitoring, and communications providers.',
          'Payment processors, invoicing tools, and financial-service partners involved in subscription billing or verification.',
          'Professional advisers, auditors, insurers, or corporate counterparties where needed for legitimate business administration.',
          'Law enforcement, regulators, courts, or other parties when required by law, legal process, or urgent safety or security need.',
          'A buyer, investor, successor, or restructuring counterparty if the business or service is reorganized, subject to appropriate confidentiality and transition safeguards.'
        ]
      }),
      createSection('cookies', 'Cookies, sessions, and product telemetry', {
        summary: 'The platform uses technical tools to remember sessions, protect forms, apply preferences, and understand service reliability.',
        paragraphs: [
          'Examples may include authentication cookies, CSRF protection tokens, security checks, rate-limit signals, account-preference storage, and operational analytics that help detect bugs, abuse, or degraded service.',
          'If optional analytics, marketing, or third-party integrations are added later, the platform should update its notice and consent flows where required by law.'
        ]
      }),
      createSection('retention', 'How long we keep data', {
        summary: 'Retention depends on the role of the data and the legal or operational reasons for keeping it.',
        paragraphs: [
          'Merchant-account and store-administration data is generally retained while the account is active and for a reasonable period afterward to support reactivation, dispute resolution, audit trails, fraud review, and legal compliance.',
          'Billing, invoice, tax, accounting, security, and abuse-prevention records may be kept longer where necessary to satisfy law, enforce contractual rights, investigate incidents, or defend claims.',
          'When data is no longer needed, it should be deleted, anonymized, or securely archived according to the platform’s operational and legal obligations.'
        ]
      }),
      createSection('transfers', 'International transfers', {
        summary: 'Because service infrastructure, support operations, merchants, and providers may operate across borders, personal data may be processed in countries other than the one where it was collected.',
        paragraphs: [
          'When cross-border processing occurs, the platform should use appropriate legal, technical, and organizational safeguards suited to the sensitivity of the data and the type of transfer.'
        ]
      }),
      createSection('security', 'Security and incident handling', {
        summary: 'No system can promise absolute security, but the platform uses measures designed to reduce unauthorized access, misuse, alteration, and loss.',
        bullets: [
          'Access controls, authentication, separation of duties, monitoring, and logging where appropriate.',
          'Security reviews, abuse detection, incident response, and vendor oversight appropriate to the service and risk profile.',
          'Reasonable steps to ensure personnel and providers handle data consistently with their responsibilities.'
        ]
      }),
      createSection('rights', 'Rights and choices', {
        summary: 'Depending on the laws that apply to you, you may have rights to request access, correction, deletion, restriction, objection, portability, withdrawal of consent where consent is used, or review of certain complaint outcomes.',
        paragraphs: [
          `Requests can be sent to ${supportEmail}. The platform may need to verify identity, clarify scope, balance competing legal obligations, and retain some data where the law or legitimate safety, fraud, billing, or recordkeeping needs require it.`,
          'If you are unhappy with a privacy outcome, you may also have the right to complain to a relevant supervisory authority or regulator in the place where you live or do business.'
        ]
      }),
      createSection('children', 'Children and sensitive data', {
        summary: 'The merchant platform is intended for business users and is not designed as a service for children to independently register merchant accounts.',
        paragraphs: [
          'Merchants should avoid uploading or processing sensitive personal data in the platform unless it is genuinely necessary and lawful for the business workflow. If the platform later supports special-category or regulated data use cases, the relevant notices and controls should be updated before rollout.'
        ]
      }),
      createSection('updates', 'Changes to this notice', {
        summary: 'This notice may change as the service, data flows, or legal obligations change.',
        paragraphs: [
          'If the platform starts using data for a materially different purpose, it should update the notice before the new processing begins and provide additional notice where required.'
        ],
        bullets: [
          `Questions, privacy requests, or complaints can be sent to ${supportEmail}.`
        ]
      })
    ]
  };
};

const buildCustomerTermsPage = ({ store = {}, brand = {} } = {}) => {
  const storeName = normalizeText(store.name, 'This store');
  const platformName = normalizeText(brand.platformName, 'Aisle');
  const supportEmail = normalizeText(store.support_email, brand.supportEmail || 'support@example.com');
  const supportPhone = normalizeText(store.contact_phone, 'Support phone available from the store on request');
  const returnWindowDays = normalizeNumber(store.return_window_days, 30);

  return {
    kind: 'terms',
    audienceLabel: 'Final customer level',
    badge: 'Storefront Terms',
    title: `${storeName} Terms & Conditions`,
    metaTitle: `${storeName} Terms & Conditions`,
    metaDescription: `Detailed storefront terms for customers shopping with ${storeName}, including orders, pricing, payments, shipping, returns, fraud checks, and customer protections.`,
    lastUpdated: LAST_UPDATED,
    noticeLabel: 'Customer protection',
    notice: `${storeName} uses this page to explain how orders, payments, fulfillment, refunds, reviews, and support are handled on this storefront. Nothing in these terms limits any non-waivable consumer rights that apply where you live.`,
    highlights: [
      {
        title: 'Clear checkout rules',
        body: 'The terms explain how prices, taxes, shipping charges, payment authorization, and order confirmation are handled before and after checkout.'
      },
      {
        title: 'Returns and support visibility',
        body: `The storefront states a baseline ${returnWindowDays}-day return window on eligible orders and points customers to real support channels instead of hiding post-purchase contact details.`
      },
      {
        title: 'Honest platform role',
        body: `${storeName} operates the storefront, while ${platformName} provides the hosted commerce infrastructure behind it.`
      }
    ],
    factsTitle: 'Quick view',
    facts: [
      { label: 'Store operator', value: storeName },
      { label: 'Support email', value: supportEmail },
      { label: 'Support phone', value: supportPhone },
      { label: 'Returns window', value: `${returnWindowDays}-day returns on eligible orders unless a product page or local law requires otherwise` }
    ],
    tocTitle: 'Contents',
    sections: [
      createSection('operator', 'Who you are buying from', {
        summary: `${storeName} is the seller or storefront operator for the products and offers displayed on this site. ${platformName} helps provide the storefront technology, account flows, and operational infrastructure.`,
        paragraphs: [
          `When you place an order, your purchase relationship is primarily with ${storeName}. ${platformName} is not the merchant of record unless the checkout, invoice, or payment flow explicitly says otherwise.`,
          'Support, order handling, fulfillment decisions, product claims, and store-specific promises are controlled by the store operator, although the platform may assist with service reliability, security, and infrastructure notices.'
        ]
      }),
      createSection('account', 'Accounts, eligibility, and order information', {
        summary: 'You may be asked to create an account or provide accurate contact and delivery details before using some storefront features or placing an order.',
        bullets: [
          'You must provide truthful name, email, delivery, and payment information and keep it up to date.',
          'You are responsible for activity that occurs under your account unless you report unauthorized access promptly.',
          'The store may limit or cancel accounts or orders connected to fraud, abuse, repeated failed payments, or misuse of promotions.'
        ]
      }),
      createSection('products', 'Product listings, availability, and pricing', {
        summary: 'The store aims to describe products, availability, variants, and prices accurately, but catalog details can still change before the order is accepted.',
        paragraphs: [
          'Images, colors, packaging, dimensions, and other merchandising details may vary slightly depending on device displays, production updates, or supplier changes. Product pages and checkout screens should be treated as the latest operational source of truth.',
          'A listed product can become unavailable, be subject to quantity limits, or require the store to correct an obvious pricing or content error before shipment.'
        ]
      }),
      createSection('checkout', 'Checkout, taxes, payment, and fraud screening', {
        summary: 'Prices, shipping charges, discounts, and applicable taxes should be shown at or before checkout, subject to the rules of the order destination and payment method.',
        bullets: [
          'Submitting an order request does not guarantee acceptance; the store may need to review payment status, stock levels, address quality, or fraud indicators first.',
          'Payment providers may place authorizations, validations, or security checks on your card or wallet before settlement.',
          'The store may refuse, hold, or cancel a transaction where there is suspected fraud, sanctions risk, pricing error, misuse of a promotion, or inability to complete delivery.'
        ]
      }),
      createSection('fulfillment', 'Shipping, delivery, and order status', {
        summary: 'Delivery windows are estimates unless the store explicitly promises a guaranteed service level.',
        paragraphs: [
          'Shipping times can be affected by stock availability, carrier capacity, customs, weather, address issues, payment review, or other operational factors outside the store’s direct control.',
          'Order-status emails, shipment notices, and delivery updates are service communications intended to keep you informed. They do not change your legal rights or the store’s obligations under applicable consumer law.'
        ]
      }),
      createSection('returns', 'Returns, cancellations, refunds, and non-returnable items', {
        summary: `Eligible orders generally follow the store's stated ${returnWindowDays}-day return window unless a shorter or longer period is clearly disclosed for a specific product or required by law.`,
        paragraphs: [
          'Some items may be non-returnable or may require special handling because of hygiene, perishability, customization, hazardous materials, digital delivery, final-sale status, or other lawful restrictions clearly disclosed before purchase.',
          'Approved refunds are typically returned to the original payment method unless the store and customer agree to a lawful alternative. Original shipping charges, customs duties, or restocking fees may be treated separately when allowed by law and clearly disclosed.'
        ],
        bullets: [
          `For order help, return questions, or cancellation support, contact ${supportEmail}.`,
          'Nothing in this section limits any statutory cooling-off, warranty, or mandatory refund rights that local law gives you.'
        ]
      }),
      createSection('promotions', 'Discounts, credits, and promotional misuse', {
        summary: 'Promo codes, store credits, gifts, and campaigns may have separate eligibility rules, expiry dates, minimum spend thresholds, or one-time-use restrictions.',
        bullets: [
          'Promotions may not be combined unless the offer says otherwise.',
          'The store may cancel or adjust orders where a promotion was applied through abuse, technical manipulation, resale misuse, or breach of the stated offer rules.',
          'If a promotion creates a pricing conflict because of a clear technical error, the store may correct or cancel the affected order before fulfillment.'
        ]
      }),
      createSection('content', 'Reviews, feedback, and user submissions', {
        summary: 'If you submit reviews, photos, testimonials, questions, or other content, you must have the right to share it and it must not be unlawful or misleading.',
        paragraphs: [
          'By submitting customer content through the storefront, you allow the store and its service providers to host, display, moderate, reproduce, and use that content to operate the storefront and support merchandising, support, and trust features.',
          'The store may remove content that is abusive, fraudulent, infringing, off-topic, or inconsistent with store rules or legal obligations.'
        ]
      }),
      createSection('acceptable-use', 'Acceptable use and order abuse', {
        summary: 'You may not use the storefront in a way that harms other customers, the store, or the supporting platform infrastructure.',
        bullets: [
          'Do not interfere with the site, scrape restricted data, bypass checkout or security controls, or test cards or accounts without authorization.',
          'Do not place fraudulent orders, impersonate another person, exploit support channels, or attempt chargeback abuse.',
          'Do not upload malware, unlawful material, or content that violates intellectual-property, privacy, or publicity rights.'
        ]
      }),
      createSection('liability', 'Disclaimers and limits', {
        summary: 'The storefront is intended to provide a reliable shopping experience, but there may still be interruptions, carrier delays, stock variances, or third-party payment issues.',
        paragraphs: [
          'To the extent the law allows, the store disclaims implied warranties not expressly given and limits indirect or consequential losses that are too remote from the purchase relationship.',
          'Nothing in these terms limits liability that cannot be limited by law, including non-waivable consumer protections, fraud, or other mandatory rights.'
        ]
      }),
      createSection('changes', 'Changes, local rights, and contact', {
        summary: 'The store may update these terms as products, fulfillment methods, legal obligations, or support processes change.',
        paragraphs: [
          'The version posted at the time of your purchase generally governs that order, unless a later change is required by law or expressly accepted by you.',
          'If a local law gives you rights that are broader than these terms, the local law prevails to that extent.'
        ],
        bullets: [
          `Support email: ${supportEmail}`,
          `Support phone: ${supportPhone}`,
          `Storefront technology support is provided on ${platformName}, but purchase questions should still be directed to ${storeName} first.`
        ]
      })
    ]
  };
};

const buildCustomerPrivacyPage = ({ store = {}, brand = {} } = {}) => {
  const storeName = normalizeText(store.name, 'This store');
  const platformName = normalizeText(brand.platformName, 'Aisle');
  const supportEmail = normalizeText(store.support_email, brand.supportEmail || 'support@example.com');
  const supportPhone = normalizeText(store.contact_phone, 'Support phone available from the store on request');
  const returnWindowDays = normalizeNumber(store.return_window_days, 30);

  return {
    kind: 'privacy',
    audienceLabel: 'Final customer level',
    badge: 'Storefront Privacy',
    title: `${storeName} Privacy Notice`,
    metaTitle: `${storeName} Privacy Notice`,
    metaDescription: `Detailed storefront privacy notice for ${storeName}, covering customer accounts, orders, payments, cookies, support records, data sharing, retention, and privacy rights.`,
    lastUpdated: LAST_UPDATED,
    noticeLabel: 'Your data',
    notice: `${storeName} uses this notice to explain what customer information is collected through this storefront, why it is collected, how it is shared, how long it is kept, and what choices may be available to you. ${platformName} provides the hosted storefront infrastructure, but this notice is written for the customer-facing shopping experience.`,
    highlights: [
      {
        title: 'Checkout and account clarity',
        body: 'The notice explains what customer information is needed for account creation, cart recovery, order processing, support, and payment-related service messages.'
      },
      {
        title: 'Honest sharing disclosures',
        body: 'It identifies likely recipients such as payment processors, delivery providers, communications vendors, and the platform infrastructure used to run the storefront.'
      },
      {
        title: 'Rights and retention',
        body: `It explains that data is kept only as long as needed for account use, fulfillment, returns, chargebacks, the store's stated ${returnWindowDays}-day return window, legal retention, and abuse prevention.`
      }
    ],
    factsTitle: 'Quick view',
    facts: [
      { label: 'Store operator', value: storeName },
      { label: 'Support email', value: supportEmail },
      { label: 'Support phone', value: supportPhone },
      { label: 'Platform layer', value: `${platformName} helps operate the storefront infrastructure and related service workflows` }
    ],
    tocTitle: 'Contents',
    sections: [
      createSection('scope', 'Who this notice covers', {
        summary: `This notice applies to people who browse, register, add products to cart, place orders, save wishlist items, receive storefront emails, or contact ${storeName} through this storefront.`,
        paragraphs: [
          `${storeName} is generally responsible for the customer relationship, while ${platformName} helps provide technical infrastructure, account tools, security features, and operational support around the storefront.`
        ]
      }),
      createSection('collected', 'What information we collect', {
        summary: 'The data collected depends on what you do in the storefront and what options you choose to use.',
        bullets: [
          'Identity and contact details such as name, email address, phone number, and delivery or billing information.',
          'Account data such as password hash, sign-in records, reset or OTP requests, and saved account preferences.',
          'Order and payment-related data such as cart contents, order history, shipping instructions, payment status, and transaction references.',
          'Support and communications data such as messages, reviews, issue history, and fulfillment follow-up records.',
          'Technical and usage data such as session identifiers, device/browser information, IP address, currency preference, wishlist items, recently viewed products, and security logs.'
        ]
      }),
      createSection('sources', 'Where the information comes from', {
        summary: 'Most information comes directly from you, but some may also come from payment processors, shipping partners, account activity, and automated storefront logs.',
        paragraphs: [
          'For example, the store may receive payment-status information from a payment provider, delivery updates from a carrier or fulfillment partner, or security signals from fraud-prevention and authentication workflows.'
        ]
      }),
      createSection('use', 'Why we use customer information', {
        summary: 'Customer information is used to operate the storefront, fulfill orders, provide support, and protect the shopping experience.',
        bullets: [
          'Create and manage customer accounts, carts, wishlists, orders, and post-purchase status updates.',
          'Process payments, confirm transactions, detect fraud, and respond to chargebacks or payment disputes.',
          'Arrange shipping, delivery, returns, refunds, and customer service follow-up.',
          'Send service emails such as order confirmations, receipts, payment warnings, password resets, login alerts, and support replies.',
          'Improve storefront performance, troubleshoot issues, prevent abuse, and maintain a secure environment.',
          'Send marketing or re-engagement messages only where the store has a lawful basis to do so, such as consent or another permitted relationship under applicable law.'
        ]
      }),
      createSection('sharing', 'Who we share information with', {
        summary: 'Customer information may be shared with parties that help run the storefront or complete your transaction.',
        bullets: [
          'Payment processors and related financial-service providers to authorize, validate, settle, and reconcile payments.',
          'Shipping, logistics, fulfillment, warehouse, or returns partners needed to deliver or recover products.',
          'Communications, hosting, monitoring, and support providers that help operate the storefront and send service messages.',
          `${platformName}, as the storefront infrastructure provider, for hosting, security, order-status workflows, and service reliability.`,
          'Courts, regulators, law enforcement, or professional advisers where disclosure is required by law or reasonably necessary to protect rights, safety, or security.'
        ]
      }),
      createSection('payments', 'Payments, fraud checks, and processor notices', {
        summary: 'Payment-card or wallet details are typically handled by a payment processor rather than stored in full by the storefront itself.',
        paragraphs: [
          'The store and its providers may receive payment references, partial card metadata, status updates, fraud indicators, and refund records needed to complete the transaction and handle disputes.',
          'Payment processors may also apply their own fraud, sanctions, or security review rules under their own privacy notices and legal obligations.'
        ]
      }),
      createSection('cookies', 'Cookies, local storage, and similar tools', {
        summary: 'The storefront uses technical storage and cookies to keep the experience working and to remember customer choices.',
        bullets: [
          'Authentication cookies or tokens help keep you signed in securely.',
          'Cart and checkout storage helps remember products you selected.',
          'Wishlist, recently viewed, and currency-preference storage helps the storefront preserve your choices across visits.',
          'Security and form-protection tools help prevent abuse, bot traffic, and unauthorized requests.'
        ],
        paragraphs: [
          'If optional analytics, advertising, or third-party tracking tools are introduced later, the storefront should update this notice and any related consent flows where the law requires it.'
        ]
      }),
      createSection('retention', 'How long we keep customer information', {
        summary: 'Retention depends on whether the information is needed for an active account, an in-flight order, a refund or return, fraud review, legal compliance, or business recordkeeping.',
        paragraphs: [
          `Order, payment, and support records may be kept through the return, refund, and dispute window and for a further period where needed for tax, accounting, chargeback, warranty, fraud, or legal reasons.`,
          'Wishlist, cart, session, and browsing-preference data may be retained for shorter operational periods, while account and order history may remain longer to support reorders, support continuity, or statutory recordkeeping.',
          'When the data is no longer needed, it should be deleted, anonymized, or securely archived.'
        ]
      }),
      createSection('transfers', 'International transfers', {
        summary: 'Storefront data may be processed in countries other than the one where you live because stores, service providers, support operations, and infrastructure may operate internationally.',
        paragraphs: [
          'When cross-border processing happens, appropriate contractual, technical, and organizational safeguards should be used based on the type of data and the applicable legal framework.'
        ]
      }),
      createSection('security', 'Security', {
        summary: 'Reasonable technical and organizational measures are used to reduce the risk of unauthorized access, misuse, loss, or alteration.',
        bullets: [
          'Authentication controls, signed requests, monitoring, logging, and access management where appropriate.',
          'Vendor and provider controls consistent with the service model and risk level.',
          'Incident response and abuse-review processes intended to protect customers, the store, and the platform.'
        ],
        paragraphs: [
          'No online service can guarantee absolute security, and you should also help protect your account by using a strong password, safeguarding OTP codes, and reporting suspicious activity quickly.'
        ]
      }),
      createSection('rights', 'Your rights and choices', {
        summary: 'Depending on where you live, you may have rights to access, correct, delete, export, restrict, or object to certain processing, or to withdraw consent where consent is the basis used.',
        paragraphs: [
          `Requests can be sent to ${supportEmail}. The store may need to verify your identity and may keep some information where it is still required for orders, refunds, fraud prevention, legal compliance, or recordkeeping.`,
          'You may also opt out of marketing messages where the law gives you that choice. Service emails about your account, order, payment, or security may still be sent because they are part of operating the storefront.'
        ]
      }),
      createSection('children', 'Children', {
        summary: 'This storefront is not intentionally designed to collect personal information from children without the involvement required by applicable law.',
        paragraphs: [
          'If you believe a child has provided personal information inappropriately, contact the store using the support details on this page so the issue can be reviewed.'
        ]
      }),
      createSection('contact', 'Contact and complaints', {
        summary: 'Questions about this notice, orders, returns, or privacy requests should be directed to the store first.',
        bullets: [
          `Store support email: ${supportEmail}`,
          `Store support phone: ${supportPhone}`,
          `Standard eligible return window currently displayed by the storefront: ${returnWindowDays} days`,
          `If the store cannot resolve a privacy concern, you may also have the right to complain to a relevant data-protection or consumer regulator, depending on where you live.`
        ]
      })
    ]
  };
};

module.exports = {
  buildOwnerTermsPage,
  buildOwnerPrivacyPage,
  buildCustomerTermsPage,
  buildCustomerPrivacyPage
};
