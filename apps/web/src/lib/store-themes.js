const fontPresets = [
  {
    key: 'jakarta',
    label: 'Jakarta Modern',
    description: 'Balanced, modern, and flexible for most catalogs.',
    bodyFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    displayFamily: "'Space Grotesk', 'Plus Jakarta Sans', sans-serif"
  },
  {
    key: 'editorial',
    label: 'Editorial Serif',
    description: 'Luxury-inspired display pairing with a refined body font.',
    bodyFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    displayFamily: "'Cormorant Garamond', Georgia, serif"
  },
  {
    key: 'signal',
    label: 'Signal Tech',
    description: 'Sharper geometric rhythm for product-forward brands.',
    bodyFamily: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    displayFamily: "'Space Grotesk', 'Manrope', sans-serif"
  },
  {
    key: 'gallery',
    label: 'Gallery Warmth',
    description: 'Soft contemporary body copy with a warmer editorial headline.',
    bodyFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    displayFamily: "'Fraunces', Georgia, serif"
  },
  {
    key: 'studio',
    label: 'Studio Contrast',
    description: 'Confident contrast for expressive but still minimal brands.',
    bodyFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    displayFamily: "'Syne', 'IBM Plex Sans', sans-serif"
  }
];

const fontPresetMap = Object.fromEntries(fontPresets.map((preset) => [preset.key, preset]));

const storeTemplates = [
  {
    key: 'fashion',
    label: 'Fashion Atelier',
    typeLabel: 'Fashion',
    description: 'Editorial presentation, taller product imagery, and size-confidence messaging.',
    defaultColor: '#9A3412',
    fontPreset: 'editorial',
    shell: 'fashion',
    classes: {
      heroGrid: 'lg:grid-cols-[1.02fr_0.98fr] lg:items-center',
      heroMediaGrid: 'sm:grid-cols-2',
      heroCardAspect: 'aspect-[4/5]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.82fr_1.18fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-4',
      catalogCardAspect: 'aspect-[4/5]',
      productGrid: 'lg:grid-cols-[0.92fr_1.08fr]',
      checkoutGrid: 'lg:grid-cols-[1.04fr_0.96fr]'
    },
    marketingTags: ['New season arrivals', 'Size support', 'Easy exchanges'],
    featureCards: [
      { label: 'Styling', title: 'Merchandising with editorial calm', body: 'Collections lead with fabric, silhouette, and outfit logic so browsing feels curated instead of crowded.' },
      { label: 'Confidence', title: 'Fit guidance built into the flow', body: 'Sizing, returns, and checkout reassurance stay visible where shoppers need them most.' },
      { label: 'Retention', title: 'Designed for repeat wardrobe drops', body: 'Fresh arrivals, wish-list energy, and visual rhythm encourage customers to come back often.' }
    ],
    trustPoints: ['Complimentary fit guidance before checkout', 'Fast exchange-friendly fulfillment window', 'Clean account area for reorder and tracking'],
    copy: {
      eyebrow: 'Seasonal edit',
      heroTitle: 'A modern fashion storefront with room for mood, movement, and repeat discovery.',
      heroBody: 'Built for apparel brands that need taller imagery, elevated typography, and a catalog flow that feels curated from landing page to checkout.',
      heroSupport: 'Use this template for ready-to-wear, capsule collections, shoes, accessories, and limited drops.',
      primaryCta: 'Shop the edit',
      secondaryCta: 'View account',
      catalogLabel: 'Collection',
      catalogTitle: 'Merchandise by drop, capsule, or best-seller.',
      catalogBody: 'Filters stay quiet while product cards do the storytelling, giving photography and price anchors room to work harder.',
      productLabel: 'Fit-first detail',
      productPromise: 'Surface sizing, fabrication, and styling context next to the add-to-cart moment so confidence stays high.',
      checkoutLabel: 'Wardrobe checkout',
      checkoutTitle: 'A checkout tuned for size confidence and quick conversion.',
      checkoutBody: 'Shipping, payment, and reassurance copy stay light but visible so customers can finish the purchase without second-guessing.'
    }
  },
  {
    key: 'electronics',
    label: 'Electronics Grid',
    typeLabel: 'Electronics',
    description: 'Spec-forward merchandising, sharper contrast, and faster comparison scanning.',
    defaultColor: '#2563EB',
    fontPreset: 'signal',
    shell: 'electronics',
    classes: {
      heroGrid: 'lg:grid-cols-[0.96fr_1.04fr] lg:items-stretch',
      heroMediaGrid: 'sm:grid-cols-2',
      heroCardAspect: 'aspect-[1/1]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.9fr_1.1fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-4',
      catalogCardAspect: 'aspect-[1/1]',
      productGrid: 'lg:grid-cols-[1.04fr_0.96fr]',
      checkoutGrid: 'lg:grid-cols-[0.98fr_1.02fr]'
    },
    marketingTags: ['Fast shipping', 'Warranty ready', 'Spec-first pages'],
    featureCards: [
      { label: 'Comparison', title: 'Built for quick decision-making', body: 'Technical products need clarity. This layout favors concise specs, strong hierarchy, and obvious CTAs.' },
      { label: 'Trust', title: 'Warranty and shipping cues stay close', body: 'Availability, support, and fulfilment promises remain visible across list and detail pages.' },
      { label: 'Conversion', title: 'Minimal noise around high-intent actions', body: 'The interface gives buyers clean pathways to compare, understand, and purchase without friction.' }
    ],
    trustPoints: ['Warranty and support messaging near checkout', 'Product specs emphasized above the fold', 'Clear inventory, shipping, and payment states'],
    copy: {
      eyebrow: 'Precision catalog',
      heroTitle: 'A sharper, faster storefront for devices, accessories, and technical products.',
      heroBody: 'This template leans into contrast, dense-but-readable information, and product blocks that help buyers compare features quickly.',
      heroSupport: 'Ideal for electronics, gadgets, peripherals, audio equipment, and technical accessories.',
      primaryCta: 'Browse devices',
      secondaryCta: 'Track orders',
      catalogLabel: 'Catalog',
      catalogTitle: 'Help shoppers compare without overwhelming them.',
      catalogBody: 'Cards hold the right amount of information up front while detail pages keep specs, benefits, and inventory tightly organized.',
      productLabel: 'Spec-forward detail',
      productPromise: 'Push the most important features, compatibility notes, and warranty cues into the product detail rhythm.',
      checkoutLabel: 'Secure checkout',
      checkoutTitle: 'Designed for confident technical purchases.',
      checkoutBody: 'Summary, shipping, and payment sections stay clean so the final step feels stable and trustworthy.'
    }
  },
  {
    key: 'home-decor',
    label: 'Home Gallery',
    typeLabel: 'Home Decor',
    description: 'Warmer storytelling, softer surfaces, and room-scene oriented product presentation.',
    defaultColor: '#B45309',
    fontPreset: 'gallery',
    shell: 'home-decor',
    classes: {
      heroGrid: 'lg:grid-cols-[1.08fr_0.92fr] lg:items-center',
      heroMediaGrid: 'sm:grid-cols-2',
      heroCardAspect: 'aspect-[4/4.8]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.78fr_1.22fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-3',
      catalogCardAspect: 'aspect-[4/4.8]',
      productGrid: 'lg:grid-cols-[1fr_1fr]',
      checkoutGrid: 'lg:grid-cols-[1.1fr_0.9fr]'
    },
    marketingTags: ['Layered spaces', 'Styling sets', 'Calm delivery cues'],
    featureCards: [
      { label: 'Story', title: 'Sell a mood, not just a SKU', body: 'Hero sections and product cards support room-led imagery and quieter copy for slower, more intentional browsing.' },
      { label: 'Pairing', title: 'Encourage basket building naturally', body: 'Related products feel like part of a scene, making cross-sell placement more organic.' },
      { label: 'Warmth', title: 'Minimal but not cold', body: 'This template keeps a premium calm while adding warmth through typography, surface tone, and spacing.' }
    ],
    trustPoints: ['Ideal for collections and room-led merchandising', 'Balanced spacing for premium photography', 'Assurance copy positioned without visual clutter'],
    copy: {
      eyebrow: 'Styled spaces',
      heroTitle: 'A home decor template that lets products feel placed, lived-in, and worth lingering on.',
      heroBody: 'For brands selling furniture, decor, tableware, lighting, or textiles, this layout adds warmth while staying clean and conversion-minded.',
      heroSupport: 'Use it when atmosphere matters as much as the item itself.',
      primaryCta: 'Explore the room',
      secondaryCta: 'Save your details',
      catalogLabel: 'Rooms & objects',
      catalogTitle: 'Give every product a little more breathing room.',
      catalogBody: 'Longer image ratios, softer panels, and editorial headlines create a calmer browse experience for considered purchases.',
      productLabel: 'Room-led detail',
      productPromise: 'Product pages balance dimensions, care notes, and styling highlights without losing the emotional pull of the imagery.',
      checkoutLabel: 'Calm checkout',
      checkoutTitle: 'A warm but low-friction finish to the purchase.',
      checkoutBody: 'Order summary, shipping details, and reassurance copy are arranged to feel steady and premium for higher-consideration carts.'
    }
  },
  {
    key: 'beauty',
    label: 'Beauty Ritual',
    typeLabel: 'Beauty',
    description: 'Soft contrast, ritual-based storytelling, and ingredient-friendly product detail pages.',
    defaultColor: '#DB2777',
    fontPreset: 'editorial',
    shell: 'beauty',
    classes: {
      heroGrid: 'lg:grid-cols-[0.98fr_1.02fr] lg:items-center',
      heroMediaGrid: 'sm:grid-cols-2',
      heroCardAspect: 'aspect-[4/4.6]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.86fr_1.14fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-4',
      catalogCardAspect: 'aspect-[4/4.6]',
      productGrid: 'lg:grid-cols-[0.95fr_1.05fr]',
      checkoutGrid: 'lg:grid-cols-[1.02fr_0.98fr]'
    },
    marketingTags: ['Ingredient story', 'Routine friendly', 'Subscription ready'],
    featureCards: [
      { label: 'Routine', title: 'Built around regimen and sequence', body: 'Beauty customers often buy as a set or routine. This template supports that kind of guided discovery.' },
      { label: 'Trust', title: 'Texture, ingredients, and claims stay readable', body: 'Product detail layouts give enough room for benefits and reassurance without feeling clinical.' },
      { label: 'Loyalty', title: 'Simple paths back to repeat purchase', body: 'The experience favors clarity and softness so replenishment journeys feel frictionless.' }
    ],
    trustPoints: ['Great for repeat-purchase categories', 'Supports ingredient and usage education', 'Checkout reassurance stays gentle and visible'],
    copy: {
      eyebrow: 'Daily ritual',
      heroTitle: 'A minimal beauty storefront for routines, replenishment, and product trust.',
      heroBody: 'Designed for skincare, cosmetics, fragrance, and wellness-adjacent beauty brands that need softer storytelling and strong clarity.',
      heroSupport: 'Use it to spotlight ingredients, benefits, and habit-forming repeat purchase flows.',
      primaryCta: 'Shop the ritual',
      secondaryCta: 'Review orders',
      catalogLabel: 'Routine builder',
      catalogTitle: 'Keep discovery light while still educating the customer.',
      catalogBody: 'Category chips, product cards, and supportive copy help shoppers understand what to use and why without clutter.',
      productLabel: 'Benefit-led detail',
      productPromise: 'Highlight regimen fit, ingredients, texture, and usage notes where they matter most.',
      checkoutLabel: 'Routine checkout',
      checkoutTitle: 'A softer, reassuring checkout for replenishment behavior.',
      checkoutBody: 'Trust copy, shipping expectations, and saved customer details work together to shorten the distance to repeat purchase.'
    }
  },
  {
    key: 'gourmet',
    label: 'Pantry Market',
    typeLabel: 'Food & Beverage',
    description: 'Ingredient-forward merchandising with shelf-like layouts for gourmet or packaged goods.',
    defaultColor: '#C2410C',
    fontPreset: 'gallery',
    shell: 'gourmet',
    classes: {
      heroGrid: 'lg:grid-cols-[1.1fr_0.9fr] lg:items-center',
      heroMediaGrid: 'sm:grid-cols-3',
      heroCardAspect: 'aspect-[4/4.4]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.8fr_1.2fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-4',
      catalogCardAspect: 'aspect-[4/4.4]',
      productGrid: 'lg:grid-cols-[1fr_1fr]',
      checkoutGrid: 'lg:grid-cols-[1.08fr_0.92fr]'
    },
    marketingTags: ['Shelf-ready', 'Bundle friendly', 'Fresh dispatch cues'],
    featureCards: [
      { label: 'Taste', title: 'Let flavor and provenance lead', body: 'This template gives space to tasting notes, sourcing, pairings, and packaging cues without feeling rustic or busy.' },
      { label: 'Basket size', title: 'Encourage bundle and pantry behavior', body: 'Product cards work well for sets, refills, and pairings, helping average order value grow naturally.' },
      { label: 'Clarity', title: 'Trust cues stay clean', body: 'Shipping windows, freshness notes, and support details remain close to the buying journey.' }
    ],
    trustPoints: ['Ideal for pantry staples and gifting sets', 'Supports tasting notes and pairings', 'Checkout highlights freshness and dispatch timing'],
    copy: {
      eyebrow: 'Curated pantry',
      heroTitle: 'A clean market-style template for gourmet goods, pantry staples, and giftable bundles.',
      heroBody: 'Designed to sell flavor, origin, and bundle logic in a way that feels premium, modern, and easy to customize.',
      heroSupport: 'Works especially well for packaged foods, beverages, snacks, coffee, and premium gifting.',
      primaryCta: 'Shop the pantry',
      secondaryCta: 'Manage account',
      catalogLabel: 'Shelf view',
      catalogTitle: 'Organize products like a good shelf: clear, appealing, and easy to combine.',
      catalogBody: 'Card sizing, copy rhythm, and checkout tone are built to support replenishment, bundles, and gifting moments.',
      productLabel: 'Origin & taste',
      productPromise: 'Tasting notes, usage moments, and dispatch expectations stay close to the purchase decision.',
      checkoutLabel: 'Fresh checkout',
      checkoutTitle: 'A streamlined finish for pantry and gifting orders.',
      checkoutBody: 'Summary and delivery cues do enough reassuring without distracting from the final conversion step.'
    }
  },
  {
    key: 'outdoors',
    label: 'Outdoor Terrain',
    typeLabel: 'Sports & Outdoors',
    description: 'Performance-led layout with stronger utility cues and rugged but minimal surfaces.',
    defaultColor: '#0F766E',
    fontPreset: 'studio',
    shell: 'outdoors',
    classes: {
      heroGrid: 'lg:grid-cols-[1fr_1fr] lg:items-center',
      heroMediaGrid: 'sm:grid-cols-2',
      heroCardAspect: 'aspect-[1/1]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.84fr_1.16fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-4',
      catalogCardAspect: 'aspect-[1/1]',
      productGrid: 'lg:grid-cols-[1.02fr_0.98fr]',
      checkoutGrid: 'lg:grid-cols-[1fr_1fr]'
    },
    marketingTags: ['Performance tested', 'Fast dispatch', 'Utility first'],
    featureCards: [
      { label: 'Use case', title: 'Built for utility-led buying', body: 'Customers can scan durability, intended use, and stock confidence quickly without losing a premium feel.' },
      { label: 'Momentum', title: 'Sharper CTA rhythm for higher intent', body: 'The layout keeps the path from discovery to add-to-cart fast and obvious, especially on mobile.' },
      { label: 'Trust', title: 'Performance reassurance is surfaced early', body: 'Highlights, shipping promises, and support notes reinforce confidence for gear-oriented purchases.' }
    ],
    trustPoints: ['Strong fit for equipment and gear', 'Utility highlights stay above the fold', 'Checkout keeps delivery and support cues prominent'],
    copy: {
      eyebrow: 'Built for movement',
      heroTitle: 'A minimal outdoor and performance template with stronger utility cues.',
      heroBody: 'Use it for sports, travel gear, outdoor equipment, or products where durability and function should read instantly.',
      heroSupport: 'The visual system is more energetic, but it stays clean enough to feel modern and premium.',
      primaryCta: 'Shop the gear',
      secondaryCta: 'View orders',
      catalogLabel: 'Gear wall',
      catalogTitle: 'Help customers find durable products fast.',
      catalogBody: 'Sharper contrast, simplified card layouts, and strong CTA placement make the catalog feel direct and capable.',
      productLabel: 'Performance detail',
      productPromise: 'Keep utility highlights, stock visibility, and support notes tight around the purchase decision.',
      checkoutLabel: 'Gear checkout',
      checkoutTitle: 'A checkout that keeps momentum high.',
      checkoutBody: 'Shoppers see only the essentials: shipping, payment, summary, and the reassurance needed to complete the order.'
    }
  },
  {
    key: 'kids',
    label: 'Playroom Edit',
    typeLabel: 'Kids & Toys',
    description: 'Friendly, bright, and organized without becoming noisy or cartoonish.',
    defaultColor: '#EA580C',
    fontPreset: 'jakarta',
    shell: 'kids',
    classes: {
      heroGrid: 'lg:grid-cols-[1.04fr_0.96fr] lg:items-center',
      heroMediaGrid: 'sm:grid-cols-2',
      heroCardAspect: 'aspect-[4/4.5]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.88fr_1.12fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-4',
      catalogCardAspect: 'aspect-[4/4.5]',
      productGrid: 'lg:grid-cols-[0.97fr_1.03fr]',
      checkoutGrid: 'lg:grid-cols-[1.05fr_0.95fr]'
    },
    marketingTags: ['Gift friendly', 'Parent clarity', 'Fast reorders'],
    featureCards: [
      { label: 'Clarity', title: 'Friendly without losing structure', body: 'This template introduces more warmth and roundness while keeping product, pricing, and checkout extremely readable.' },
      { label: 'Guidance', title: 'Useful for gift-led shopping', body: 'It works well when parents or gift buyers need fast clarity around age range, quality, and delivery timing.' },
      { label: 'Retention', title: 'Built for repeat and seasonal purchases', body: 'Catalog and account flows stay uncomplicated so returning customers can shop quickly.' }
    ],
    trustPoints: ['Works for gifting and repeat buying', 'Keeps parent-facing decisions clear', 'Soft shapes without sacrificing conversion clarity'],
    copy: {
      eyebrow: 'Playful picks',
      heroTitle: 'A bright, organized template for kids brands that still wants to feel premium.',
      heroBody: 'Built for toys, childrenswear, nursery products, school essentials, and family-focused catalogs that need warmth without clutter.',
      heroSupport: 'Rounded surfaces and calmer spacing keep the experience approachable for gift buyers and repeat customers alike.',
      primaryCta: 'Explore favorites',
      secondaryCta: 'Sign in',
      catalogLabel: 'Giftable catalog',
      catalogTitle: 'Keep discovery cheerful, structured, and easy to act on.',
      catalogBody: 'Customers can move from category browsing to purchase quickly, with enough warmth to reflect the audience without overwhelming them.',
      productLabel: 'Family-friendly detail',
      productPromise: 'Ideal for surfacing age range, materials, care, and helpful purchase reassurance.',
      checkoutLabel: 'Quick checkout',
      checkoutTitle: 'A friendlier path to conversion for family-focused buying.',
      checkoutBody: 'Checkout remains direct and minimal, with the right amount of support language for gift and repeat orders.'
    }
  },
  {
    key: 'jewelry',
    label: 'Jewelry Maison',
    typeLabel: 'Jewelry & Accessories',
    description: 'High-contrast luxury presentation with quieter product detail and premium assurance.',
    defaultColor: '#6B213C',
    fontPreset: 'editorial',
    shell: 'jewelry',
    classes: {
      heroGrid: 'lg:grid-cols-[0.94fr_1.06fr] lg:items-center',
      heroMediaGrid: 'sm:grid-cols-2',
      heroCardAspect: 'aspect-[4/5]',
      featureGrid: 'lg:grid-cols-3',
      catalogHeader: 'lg:grid-cols-[0.76fr_1.24fr] lg:items-end',
      catalogGrid: 'sm:grid-cols-2 xl:grid-cols-4',
      catalogCardAspect: 'aspect-[4/5]',
      productGrid: 'lg:grid-cols-[0.9fr_1.1fr]',
      checkoutGrid: 'lg:grid-cols-[1fr_1fr]'
    },
    marketingTags: ['Gift-ready', 'Premium care', 'Quiet luxury'],
    featureCards: [
      { label: 'Presence', title: 'Let the product feel precious', body: 'Larger display type, restrained copy, and taller imagery give fine products the space they need.' },
      { label: 'Trust', title: 'Premium reassurance without overexplaining', body: 'Shipping, care, and gifting details stay close to the CTA in a calm, polished way.' },
      { label: 'Conversion', title: 'A focused luxury buying path', body: 'This template removes excess UI noise so the emotional pull of the product stays central.' }
    ],
    trustPoints: ['Gift and care cues placed near conversion moments', 'Stronger premium visual rhythm', 'Supports higher-consideration checkout flows'],
    copy: {
      eyebrow: 'Refined collection',
      heroTitle: 'A quieter, more luxurious template for jewelry, watches, and premium accessories.',
      heroBody: 'Use it when restraint matters: strong imagery, fewer distractions, and premium reassurance woven into the path to purchase.',
      heroSupport: 'This template is ideal for high-consideration products that sell through atmosphere as much as specification.',
      primaryCta: 'Shop the collection',
      secondaryCta: 'View account',
      catalogLabel: 'Signature pieces',
      catalogTitle: 'Give every piece a little more importance.',
      catalogBody: 'Taller cards, calmer interfaces, and premium copy spacing help collections feel deliberate rather than busy.',
      productLabel: 'Premium detail',
      productPromise: 'Product pages are designed to highlight craftsmanship, gifting, care, and material trust without losing elegance.',
      checkoutLabel: 'Refined checkout',
      checkoutTitle: 'A more composed finish for premium purchases.',
      checkoutBody: 'The final step stays minimal, with thoughtful reassurance around delivery, payment, and post-purchase support.'
    }
  }
];

const templateMap = Object.fromEntries(storeTemplates.map((template) => [template.key, template]));

const storeTypes = [
  {
    key: 'fashion',
    label: 'Fashion',
    description: 'Apparel, footwear, bags, and accessories with a more editorial merchandising tone.',
    recommendedTemplateKey: 'fashion',
    recommendedFontPreset: 'editorial'
  },
  {
    key: 'electronics',
    label: 'Electronics',
    description: 'Devices, gadgets, and technical accessories where comparison and spec clarity matter.',
    recommendedTemplateKey: 'electronics',
    recommendedFontPreset: 'signal'
  },
  {
    key: 'home-decor',
    label: 'Home Decor',
    description: 'Furniture, decor, lighting, and room-led catalogs that benefit from calmer visual pacing.',
    recommendedTemplateKey: 'home-decor',
    recommendedFontPreset: 'gallery'
  },
  {
    key: 'beauty',
    label: 'Beauty',
    description: 'Skincare, cosmetics, fragrance, and ritual-led assortments that need trust and softness.',
    recommendedTemplateKey: 'beauty',
    recommendedFontPreset: 'editorial'
  },
  {
    key: 'gourmet',
    label: 'Food & Beverage',
    description: 'Packaged foods, drinks, pantry goods, and gifting assortments with pairing-friendly merchandising.',
    recommendedTemplateKey: 'gourmet',
    recommendedFontPreset: 'gallery'
  },
  {
    key: 'outdoors',
    label: 'Sports & Outdoors',
    description: 'Gear, performance equipment, and durable goods with stronger utility cues.',
    recommendedTemplateKey: 'outdoors',
    recommendedFontPreset: 'studio'
  },
  {
    key: 'kids',
    label: 'Kids & Toys',
    description: 'Family-oriented products that should feel bright and friendly without losing structure.',
    recommendedTemplateKey: 'kids',
    recommendedFontPreset: 'jakarta'
  },
  {
    key: 'jewelry',
    label: 'Jewelry & Accessories',
    description: 'Higher-consideration products that benefit from quieter luxury styling and stronger reassurance.',
    recommendedTemplateKey: 'jewelry',
    recommendedFontPreset: 'editorial'
  }
];

const storeTypeMap = Object.fromEntries(storeTypes.map((storeType) => [storeType.key, storeType]));

const isValidHexColor = (value = '') => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value).trim());

const inferStoreTypeKey = (store = {}) => {
  const normalizedName = String(store.name || '').toLowerCase();
  const categories = Array.isArray(store.categories)
    ? store.categories
    : Array.isArray(store.products)
      ? store.products.map((product) => product.category)
      : [];
  const normalizedCategories = categories.map((entry) => String(entry || '').toLowerCase());

  if (normalizedName.includes('atelier') || normalizedCategories.some((entry) => ['home', 'dining', 'kitchen', 'decor'].includes(entry))) {
    return 'home-decor';
  }

  if (normalizedName.includes('supply') || normalizedCategories.some((entry) => ['tech', 'electronics', 'office'].includes(entry))) {
    return 'electronics';
  }

  if (normalizedCategories.some((entry) => ['beauty', 'skincare', 'fragrance', 'cosmetics'].includes(entry))) {
    return 'beauty';
  }

  if (normalizedCategories.some((entry) => ['food', 'beverage', 'coffee', 'snacks'].includes(entry))) {
    return 'gourmet';
  }

  if (normalizedCategories.some((entry) => ['outdoor', 'sports', 'travel', 'gear'].includes(entry))) {
    return 'outdoors';
  }

  if (normalizedCategories.some((entry) => ['kids', 'toys', 'baby', 'nursery'].includes(entry))) {
    return 'kids';
  }

  if (normalizedCategories.some((entry) => ['jewelry', 'watches', 'accessories'].includes(entry))) {
    return 'jewelry';
  }

  return 'fashion';
};

const getStoreType = (value, fallbackKey = 'fashion') => {
  const normalized = String(value || '').trim().toLowerCase();
  const normalizedFallback = String(fallbackKey || '').trim().toLowerCase();
  return storeTypeMap[normalized] || storeTypeMap[normalizedFallback] || storeTypes[0];
};

const getTemplate = (value, fallbackStore = {}) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (templateMap[normalized]) {
    return templateMap[normalized];
  }

  const fallbackTemplateKey = String(fallbackStore.template_key || '').trim().toLowerCase();
  if (templateMap[fallbackTemplateKey]) {
    return templateMap[fallbackTemplateKey];
  }

  const fallbackStoreType = getStoreType(fallbackStore.store_type, inferStoreTypeKey(fallbackStore));
  return templateMap[fallbackStoreType.recommendedTemplateKey] || storeTemplates[0];
};

const getFontPreset = (value, fallbackKey = 'jakarta') => {
  const normalized = String(value || '').trim().toLowerCase();
  return fontPresetMap[normalized] || fontPresetMap[fallbackKey] || fontPresets[0];
};

const createDefaultMessaging = (template, storeType, storeName) => {
  return {
    tagline: `${storeType.label} storefront for ${storeName}.`,
    description: `${storeName} uses the ${template.label} system to pair modern merchandising, lighter checkout friction, and easy visual customization across key storefront pages.`
  };
};

const getStoreTheme = (store = {}) => {
  const storeType = getStoreType(store.store_type, inferStoreTypeKey(store));
  const template = getTemplate(store.template_key, store);
  const fontPreset = getFontPreset(store.font_preset, template.fontPreset);

  return {
    ...template,
    templateKey: template.key,
    templateLabel: template.label,
    storeType: storeType.key,
    storeTypeKey: storeType.key,
    storeTypeLabel: storeType.label,
    templateTypeLabel: template.typeLabel,
    typeLabel: storeType.label,
    accentColor: isValidHexColor(store.theme_color) ? String(store.theme_color) : template.defaultColor,
    fonts: fontPreset,
    themeColor: isValidHexColor(store.theme_color) ? String(store.theme_color) : template.defaultColor
  };
};

const getStoreConfiguration = (payload = {}, fallbackStore = {}) => {
  const mergedStore = {
    ...fallbackStore,
    ...payload
  };
  const storeType = getStoreType(payload.store_type, fallbackStore.store_type || inferStoreTypeKey(mergedStore));
  const template = getTemplate(payload.template_key, fallbackStore);
  const fontPreset = getFontPreset(payload.font_preset, String(fallbackStore.font_preset || '').trim().toLowerCase() || template.fontPreset);
  const storeName = String(payload.name || fallbackStore.name || 'New Store').trim() || 'New Store';
  const defaults = createDefaultMessaging(template, storeType, storeName);

  return {
    store_type: storeType.key,
    template_key: template.key,
    font_preset: fontPreset.key,
    theme_color: isValidHexColor(payload.theme_color) ? String(payload.theme_color) : (isValidHexColor(fallbackStore.theme_color) ? fallbackStore.theme_color : template.defaultColor),
    tagline: String(payload.tagline || fallbackStore.tagline || defaults.tagline).trim() || defaults.tagline,
    description: String(payload.description || fallbackStore.description || defaults.description).trim() || defaults.description
  };
};

module.exports = {
  fontPresets,
  storeTypes,
  storeTemplates,
  isValidHexColor,
  getStoreType,
  getFontPreset,
  getTemplate,
  getStoreTheme,
  getStoreConfiguration
};
