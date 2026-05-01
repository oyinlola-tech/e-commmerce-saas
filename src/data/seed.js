const daysAgo = (days, hours = 10) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hours, 0, 0, 0);
  return date.toISOString();
};

const hoursAgo = (hours) => {
  const date = new Date();
  date.setTime(date.getTime() - hours * 60 * 60 * 1000);
  return date.toISOString();
};

module.exports = {
  brand: {
    name: 'Aisle',
    platformName: 'Aisle Commerce Cloud',
    shortDescription: 'Enterprise storefront infrastructure for globally ambitious retail teams.',
    supportEmail: 'support@aislecommerce.com',
    website: 'www.aislecommerce.com',
    headquarters: 'London, United Kingdom',
    marketsServed: ['North America', 'Europe', 'Middle East', 'Africa'],
    color: '#0F766E'
  },
  platformUser: {
    id: 'owner_1',
    name: 'Doris King',
    email: 'doris@aislecommerce.com',
    role: 'Platform Owner'
  },
  systemAdminUser: {
    id: 'sysadmin_1',
    name: 'Samuel Chen',
    email: 'control@aislecommerce.com',
    role: 'Global Platform Admin'
  },
  stores: [
    {
      id: 'store_aisle',
      owner_id: 'owner_1',
      name: 'Aisle',
      subdomain: 'aisle',
      custom_domain: 'www.aisle-store.com',
      logo: '',
      theme_color: '#0F766E',
      ssl_status: 'issued',
      tagline: 'Cross-border essentials for modern homes, studios, and teams.',
      description: 'Aisle is a design-led retail brand serving customers across North America, Europe, and Africa with premium daily-use products and dependable fulfillment.',
      support_email: 'support@aisle-store.com',
      contact_phone: '+44 20 7946 0821',
      fulfillment_sla: 'Orders placed before 16:00 UTC ship the same day.',
      return_window_days: 30,
      timezone: 'Europe/London',
      markets: ['United States', 'United Kingdom', 'Germany', 'Nigeria', 'United Arab Emirates'],
      currencies: ['USD', 'GBP', 'EUR', 'NGN'],
      launch_status: 'live',
      operational_status: 'healthy',
      health_score: 96,
      conversion_rate: 4.2,
      monthly_revenue: 124860,
      monthly_orders: 862,
      average_order_value: 144.85,
      support_backlog: 3
    },
    {
      id: 'store_verde',
      owner_id: 'owner_2',
      name: 'Verde Atelier',
      subdomain: 'verde-atelier',
      custom_domain: 'shop.verdeatelier.com',
      logo: '',
      theme_color: '#1D4ED8',
      ssl_status: 'issued',
      tagline: 'Seasonless pieces for hospitality, gifting, and elevated everyday use.',
      description: 'Verde Atelier runs limited-edition home and table collections with localized merchandising for Europe and the Gulf.',
      support_email: 'support@verdeatelier.com',
      contact_phone: '+971 4 313 9912',
      fulfillment_sla: 'Ships within 24 to 48 hours from Dubai and Berlin hubs.',
      return_window_days: 21,
      timezone: 'Asia/Dubai',
      markets: ['United Arab Emirates', 'Saudi Arabia', 'Germany', 'France'],
      currencies: ['AED', 'EUR', 'USD'],
      launch_status: 'live',
      operational_status: 'watch',
      health_score: 88,
      conversion_rate: 3.7,
      monthly_revenue: 94820,
      monthly_orders: 523,
      average_order_value: 181.3,
      support_backlog: 5
    },
    {
      id: 'store_northstar',
      owner_id: 'owner_3',
      name: 'Northstar Supply',
      subdomain: 'northstar-supply',
      custom_domain: '',
      logo: '',
      theme_color: '#B45309',
      ssl_status: 'issued',
      tagline: 'Reliable B2B replenishment for offices, hospitality groups, and regional operators.',
      description: 'Northstar Supply focuses on operational commerce with catalog controls, account-based ordering, and rolling procurement cycles.',
      support_email: 'ops@northstarsupply.com',
      contact_phone: '+1 415 555 0192',
      fulfillment_sla: 'Bulk orders are confirmed within four business hours.',
      return_window_days: 14,
      timezone: 'America/Los_Angeles',
      markets: ['United States', 'Canada'],
      currencies: ['USD', 'CAD'],
      launch_status: 'pilot',
      operational_status: 'attention',
      health_score: 81,
      conversion_rate: 2.9,
      monthly_revenue: 61240,
      monthly_orders: 211,
      average_order_value: 290.24,
      support_backlog: 7
    }
  ],
  customers: [
    {
      id: 'customer_aisle_1',
      store_id: 'store_aisle',
      name: 'Amara Bello',
      email: 'amara.bello@example.com',
      address: '17 Marina Road',
      city: 'Lagos',
      country: 'Nigeria',
      postal_code: '100001',
      segment: 'VIP',
      lifetime_value: 1128,
      orders_count: 6
    },
    {
      id: 'customer_aisle_2',
      store_id: 'store_aisle',
      name: 'Marcus Reed',
      email: 'marcus.reed@example.com',
      address: '33 Rivington Street',
      city: 'London',
      country: 'United Kingdom',
      postal_code: 'EC2A 3QQ',
      segment: 'Returning',
      lifetime_value: 486,
      orders_count: 3
    },
    {
      id: 'customer_aisle_3',
      store_id: 'store_aisle',
      name: 'Noah Alvarez',
      email: 'noah.alvarez@example.com',
      address: '1080 Valencia Street',
      city: 'San Francisco',
      country: 'United States',
      postal_code: '94110',
      segment: 'New',
      lifetime_value: 152,
      orders_count: 1
    },
    {
      id: 'customer_verde_1',
      store_id: 'store_verde',
      name: 'Layla Al Mansoori',
      email: 'layla.almansoori@example.com',
      address: 'Crescent Tower, Jumeirah Lake Towers',
      city: 'Dubai',
      country: 'United Arab Emirates',
      postal_code: '00000',
      segment: 'VIP',
      lifetime_value: 1435,
      orders_count: 8
    },
    {
      id: 'customer_northstar_1',
      store_id: 'store_northstar',
      name: 'Ethan Walker',
      email: 'ethan.walker@example.com',
      address: '240 Howard Street',
      city: 'San Francisco',
      country: 'United States',
      postal_code: '94105',
      segment: 'Account',
      lifetime_value: 4320,
      orders_count: 12
    }
  ],
  products: [
    {
      id: 'prod_aisle_1',
      store_id: 'store_aisle',
      name: 'Atlas Carryall',
      slug: 'atlas-carryall',
      category: 'Travel',
      price: 145,
      compare_at_price: 168,
      image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1200&q=80'
      ],
      description: 'A weather-ready carryall with structured compartments, discreet security pockets, and a silhouette refined enough for both short-haul travel and the workweek.',
      highlights: [
        'Recycled shell with water-resistant treatment',
        'Padded laptop sleeve for devices up to 16 inches',
        'Trolley sleeve and quick-access passport pocket'
      ],
      inventory: 52,
      sku: 'AIS-ATLAS-145',
      status: 'Published',
      featured: true
    },
    {
      id: 'prod_aisle_2',
      store_id: 'store_aisle',
      name: 'Meridian Lamp',
      slug: 'meridian-lamp',
      category: 'Home',
      price: 118,
      compare_at_price: 132,
      image: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1484101403633-562f891dc89a?auto=format&fit=crop&w=1200&q=80'
      ],
      description: 'A soft-glow desk and bedside lamp designed to elevate focus hours, evening rituals, and hospitality spaces without visual clutter.',
      highlights: [
        'Warm diffusion tuned for low-glare environments',
        'Powder-coated aluminum body',
        'Universal voltage adapter included'
      ],
      inventory: 31,
      sku: 'AIS-MERIDIAN-118',
      status: 'Published',
      featured: true
    },
    {
      id: 'prod_aisle_3',
      store_id: 'store_aisle',
      name: 'Relay Sleeve',
      slug: 'relay-sleeve',
      category: 'Tech',
      price: 64,
      compare_at_price: null,
      image: 'https://images.unsplash.com/photo-1517336714739-489689fd1ca8?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1517336714739-489689fd1ca8?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80'
      ],
      description: 'Slim impact protection for laptops and tablets, finished with magnetic closure and a soft-lined interior for everyday carry.',
      highlights: [
        'Fleece-lined interior',
        'Cable pocket with magnetic tab',
        'Designed for hybrid teams on the move'
      ],
      inventory: 86,
      sku: 'AIS-RELAY-064',
      status: 'Published',
      featured: true
    },
    {
      id: 'prod_aisle_4',
      store_id: 'store_aisle',
      name: 'Field Journal Set',
      slug: 'field-journal-set',
      category: 'Stationery',
      price: 34,
      compare_at_price: 40,
      image: 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=1200&q=80'
      ],
      description: 'A premium trio of ruled, grid, and blank notebooks produced for teams that still think best with paper at hand.',
      highlights: [
        'Three formats in one boxed set',
        'Fountain-pen-friendly 100 gsm stock',
        'Thread-bound spine for flat lay writing'
      ],
      inventory: 112,
      sku: 'AIS-FIELD-034',
      status: 'Published',
      featured: false
    },
    {
      id: 'prod_aisle_5',
      store_id: 'store_aisle',
      name: 'Drift Espresso Set',
      slug: 'drift-espresso-set',
      category: 'Kitchen',
      price: 72,
      compare_at_price: 88,
      image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=1200&q=80'
      ],
      description: 'A four-piece espresso set built for boutique hospitality and the home ritualist who values tactile detail and long-term durability.',
      highlights: [
        'Stoneware with matte glaze finish',
        'Dishwasher-safe and hospitality ready',
        'Gift-boxed for premium delivery'
      ],
      inventory: 24,
      sku: 'AIS-DRIFT-072',
      status: 'Published',
      featured: true
    },
    {
      id: 'prod_aisle_6',
      store_id: 'store_aisle',
      name: 'Lumen Bottle',
      slug: 'lumen-bottle',
      category: 'Wellness',
      price: 39,
      compare_at_price: null,
      image: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=1200&q=80'
      ],
      description: 'Vacuum-insulated hydration for commuter routines, training sessions, and long desk days where temperature retention matters.',
      highlights: [
        'Keeps drinks cold for 24 hours',
        'Powder coat finish with soft-grip cap',
        'Fits standard vehicle and bag pockets'
      ],
      inventory: 9,
      sku: 'AIS-LUMEN-039',
      status: 'Draft',
      featured: false
    },
    {
      id: 'prod_verde_1',
      store_id: 'store_verde',
      name: 'Sierra Linen Set',
      slug: 'sierra-linen-set',
      category: 'Home',
      price: 214,
      compare_at_price: 246,
      image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
      images: ['https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80'],
      description: 'Seasonless hospitality-grade linen set designed for coastal homes and premium short-stay properties.',
      highlights: ['European flax', 'Hotel-weight weave', 'Pre-washed finish'],
      inventory: 19,
      sku: 'VER-SIERRA-214',
      status: 'Published',
      featured: true
    },
    {
      id: 'prod_verde_2',
      store_id: 'store_verde',
      name: 'Aster Table Pair',
      slug: 'aster-table-pair',
      category: 'Dining',
      price: 128,
      compare_at_price: null,
      image: 'https://images.unsplash.com/photo-1499933374294-4584851497cc?auto=format&fit=crop&w=1200&q=80',
      images: ['https://images.unsplash.com/photo-1499933374294-4584851497cc?auto=format&fit=crop&w=1200&q=80'],
      description: 'Twin side tables with compact footprint for residential suites, guest lounges, and layered living spaces.',
      highlights: ['Oak veneer top', 'Powder-coated steel base'],
      inventory: 11,
      sku: 'VER-ASTER-128',
      status: 'Published',
      featured: false
    },
    {
      id: 'prod_northstar_1',
      store_id: 'store_northstar',
      name: 'Summit Starter Kit',
      slug: 'summit-starter-kit',
      category: 'Office',
      price: 320,
      compare_at_price: null,
      image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80',
      images: ['https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80'],
      description: 'An account-based procurement bundle for new office launches and distributed team refresh programs.',
      highlights: ['Bulk order handling', 'Contract pricing compatible'],
      inventory: 7,
      sku: 'NST-SUMMIT-320',
      status: 'Published',
      featured: true
    }
  ],
  orders: [
    {
      id: '4108',
      store_id: 'store_aisle',
      status: 'Pending',
      total: 290,
      payment_status: 'Authorized',
      payment_method: 'Card',
      created_at: hoursAgo(6),
      customer_name: 'Amara Bello',
      customer: {
        name: 'Amara Bello',
        email: 'amara.bello@example.com',
        address: '17 Marina Road, Lagos, Nigeria 100001'
      },
      items: [
        { product_id: 'prod_aisle_1', name: 'Atlas Carryall', price: 145, quantity: 1, image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80' },
        { product_id: 'prod_aisle_1', name: 'Atlas Carryall', price: 145, quantity: 1, image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80' }
      ]
    },
    {
      id: '4107',
      store_id: 'store_aisle',
      status: 'Shipped',
      total: 190,
      payment_status: 'Captured',
      payment_method: 'Card',
      created_at: daysAgo(1, 13),
      customer_name: 'Marcus Reed',
      customer: {
        name: 'Marcus Reed',
        email: 'marcus.reed@example.com',
        address: '33 Rivington Street, London, United Kingdom EC2A 3QQ'
      },
      items: [
        { product_id: 'prod_aisle_2', name: 'Meridian Lamp', price: 118, quantity: 1, image: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=80' },
        { product_id: 'prod_aisle_4', name: 'Field Journal Set', price: 34, quantity: 2, image: 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=1200&q=80' }
      ]
    },
    {
      id: '4105',
      store_id: 'store_aisle',
      status: 'Delivered',
      total: 152,
      payment_status: 'Captured',
      payment_method: 'Apple Pay',
      created_at: daysAgo(4, 11),
      customer_name: 'Noah Alvarez',
      customer: {
        name: 'Noah Alvarez',
        email: 'noah.alvarez@example.com',
        address: '1080 Valencia Street, San Francisco, United States 94110'
      },
      items: [
        { product_id: 'prod_aisle_3', name: 'Relay Sleeve', price: 64, quantity: 1, image: 'https://images.unsplash.com/photo-1517336714739-489689fd1ca8?auto=format&fit=crop&w=1200&q=80' },
        { product_id: 'prod_aisle_5', name: 'Drift Espresso Set', price: 72, quantity: 1, image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80' },
        { product_id: 'prod_aisle_4', name: 'Field Journal Set', price: 16, quantity: 1, image: 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=1200&q=80' }
      ]
    },
    {
      id: '3171',
      store_id: 'store_verde',
      status: 'Pending',
      total: 214,
      payment_status: 'Authorized',
      payment_method: 'Card',
      created_at: hoursAgo(14),
      customer_name: 'Layla Al Mansoori',
      customer: {
        name: 'Layla Al Mansoori',
        email: 'layla.almansoori@example.com',
        address: 'Crescent Tower, Dubai, United Arab Emirates'
      },
      items: [
        { product_id: 'prod_verde_1', name: 'Sierra Linen Set', price: 214, quantity: 1, image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80' }
      ]
    },
    {
      id: '2088',
      store_id: 'store_northstar',
      status: 'Shipped',
      total: 640,
      payment_status: 'Invoice sent',
      payment_method: 'Invoice',
      created_at: daysAgo(2, 15),
      customer_name: 'Ethan Walker',
      customer: {
        name: 'Ethan Walker',
        email: 'ethan.walker@example.com',
        address: '240 Howard Street, San Francisco, United States 94105'
      },
      items: [
        { product_id: 'prod_northstar_1', name: 'Summit Starter Kit', price: 320, quantity: 2, image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80' }
      ]
    }
  ],
  supportConversations: [
    {
      id: 'support_1001',
      store_id: 'store_aisle',
      channel: 'Email',
      subject: 'Express delivery was not available at checkout',
      customer_name: 'Amara Bello',
      customer_email: 'amara.bello@example.com',
      region: 'Nigeria',
      status: 'open',
      priority: 'high',
      owner: 'Support Ops',
      last_message_at: hoursAgo(2),
      messages: [
        {
          author: 'Amara Bello',
          role: 'customer',
          sent_at: hoursAgo(4),
          body: 'I expected next-day delivery to appear for Lagos but only standard shipping showed up.'
        },
        {
          author: 'Aisle Support',
          role: 'support',
          sent_at: hoursAgo(3),
          body: 'Thanks for flagging this. We are checking the carrier matrix for your postal code now.'
        }
      ]
    },
    {
      id: 'support_1002',
      store_id: 'store_verde',
      channel: 'Chat',
      subject: 'Invoice needed for hospitality purchase',
      customer_name: 'Layla Al Mansoori',
      customer_email: 'layla.almansoori@example.com',
      region: 'United Arab Emirates',
      status: 'pending',
      priority: 'normal',
      owner: 'Concierge Desk',
      last_message_at: hoursAgo(9),
      messages: [
        {
          author: 'Layla Al Mansoori',
          role: 'customer',
          sent_at: hoursAgo(10),
          body: 'Can your team issue a tax invoice for our interior procurement file?'
        }
      ]
    },
    {
      id: 'support_1003',
      store_id: 'store_northstar',
      channel: 'Email',
      subject: 'Bulk order approval workflow request',
      customer_name: 'Ethan Walker',
      customer_email: 'ethan.walker@example.com',
      region: 'United States',
      status: 'open',
      priority: 'high',
      owner: 'B2B Enablement',
      last_message_at: hoursAgo(6),
      messages: [
        {
          author: 'Ethan Walker',
          role: 'customer',
          sent_at: hoursAgo(6),
          body: 'We need order approval by department managers before invoice generation. Is this available?'
        }
      ]
    },
    {
      id: 'support_1004',
      store_id: 'store_aisle',
      channel: 'Email',
      subject: 'Address update after order placement',
      customer_name: 'Marcus Reed',
      customer_email: 'marcus.reed@example.com',
      region: 'United Kingdom',
      status: 'resolved',
      priority: 'normal',
      owner: 'Support Ops',
      last_message_at: daysAgo(1, 16),
      messages: [
        {
          author: 'Marcus Reed',
          role: 'customer',
          sent_at: daysAgo(1, 14),
          body: 'Please update my shipping address to the rear entrance before dispatch.'
        },
        {
          author: 'Aisle Support',
          role: 'support',
          sent_at: daysAgo(1, 16),
          body: 'The warehouse has confirmed the address correction and your parcel is now cleared for dispatch.'
        }
      ]
    }
  ],
  incidents: [
    {
      id: 'incident_201',
      area: 'Checkout orchestration',
      severity: 'critical',
      status: 'monitoring',
      summary: 'Gateway failover increased card latency for West Africa transactions.',
      impact: 'Affecting elevated authorization times for NGN and USD cards routed through the regional cluster.',
      owner: 'Payments Reliability',
      opened_at: hoursAgo(18),
      updated_at: hoursAgo(1),
      notes: [
        { author: 'Payments Reliability', created_at: hoursAgo(5), body: 'Primary gateway restored. Monitoring fallback traffic and settlement confirmations.' }
      ]
    },
    {
      id: 'incident_202',
      area: 'Carrier label sync',
      severity: 'major',
      status: 'investigating',
      summary: 'DHL labels for Dubai-origin orders are intermittently delayed after order capture.',
      impact: 'Fulfillment teams must refresh label generation manually for some UAE shipments.',
      owner: 'Logistics Platform',
      opened_at: hoursAgo(11),
      updated_at: hoursAgo(2),
      notes: [
        { author: 'Logistics Platform', created_at: hoursAgo(2), body: 'Isolating a webhook retry mismatch with the carrier callback.' }
      ]
    },
    {
      id: 'incident_203',
      area: 'Tax export',
      severity: 'minor',
      status: 'resolved',
      summary: 'EU VAT export rounded two historical refunds incorrectly in the nightly report.',
      impact: 'Finance exports for two tenants required backfill. Customer-facing operations were not affected.',
      owner: 'Data Operations',
      opened_at: daysAgo(2, 9),
      updated_at: daysAgo(1, 12),
      notes: [
        { author: 'Data Operations', created_at: daysAgo(1, 12), body: 'Backfill completed and report verifier patched for future runs.' }
      ]
    }
  ],
  carts: {
    store_aisle: {
      items: [
        {
          product_id: 'prod_aisle_1',
          name: 'Atlas Carryall',
          price: 145,
          quantity: 1,
          image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80'
        },
        {
          product_id: 'prod_aisle_4',
          name: 'Field Journal Set',
          price: 34,
          quantity: 2,
          image: 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=1200&q=80'
        }
      ],
      total: 213
    },
    store_verde: {
      items: [],
      total: 0
    },
    store_northstar: {
      items: [],
      total: 0
    }
  }
};
