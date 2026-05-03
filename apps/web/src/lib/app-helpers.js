const createAppHelpers = (context) => {
  const {
    crypto,
    env,
    ROOT_DOMAIN,
    PORT,
    isLocalRoot,
    orderCookieName,
    couponCookieName,
    wishlistCookieName,
    recentlyViewedCookieName,
    catalogSortOptions,
    mergeProductPresentation,
    logoUpload,
    buildCookieOptions,
    buildSignedInternalHeaders,
    normalizeHostname,
    sanitizePlainText,
    sanitizeEmail,
    sanitizeSlug,
    sanitizeUrl,
    readSignedCookie,
    setSignedCookie,
    clearSignedCookie,
    safeRedirect,
    isPlatformRequestHost,
    PLATFORM_ROLES,
    commonRules,
    createHttpError,
    getStoreProductById,
    listPlatformStores,
    getOwnerSubscription
  } = context;

  const buildFormData = (req, keys = []) => {
    return keys.reduce((accumulator, key) => {
      if (req.body?.[key] !== undefined) {
        accumulator[key] = req.body[key];
      }
      return accumulator;
    }, {});
  };

  const hasPlanCapability = (entitlements = null, capability = '') => {
    return Boolean(entitlements?.capabilities?.[capability]);
  };

  const safeDecodeURIComponent = (value = '') => {
    try {
      return decodeURIComponent(String(value || ''));
    } catch {
      return String(value || '');
    }
  };

  const handleMultipartLogo = (renderer) => {
    return (req, res, next) => {
      return logoUpload.single('logo')(req, res, (error) => {
        if (!error) {
          return next();
        }

        return renderer(req, res, {
          logo: [error.message]
        }, 422);
      });
    };
  };

  const parseCheckbox = (value) => {
    return ['1', 'true', 'on', 'yes', 'published'].includes(String(value || '').trim().toLowerCase());
  };

  const normalizePromotionCode = (value = '') => {
    return sanitizePlainText(value || '', { maxLength: 80 })
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 80);
  };

  const isStorefrontHost = (req) => {
    return !isPlatformRequestHost(normalizeHostname(req.hostname || req.headers.host || ''));
  };

  const isStoreScopedPath = (pathname = '') => {
    return pathname === '/register'
      || pathname === '/products'
      || pathname === '/wishlist'
      || pathname.startsWith('/products/')
      || pathname === '/cart'
      || pathname === '/account'
      || pathname === '/orders'
      || pathname === '/checkout'
      || pathname === '/order-confirmation'
      || pathname.startsWith('/cart/')
      || pathname.startsWith('/wishlist/');
  };

  const resolveStore = (req) => {
    return req.currentStore || null;
  };

  const buildStorefrontUrl = (store) => {
    if (!store) {
      return '/';
    }

    const customDomain = normalizeHostname(store.custom_domain);
    if (customDomain) {
      return `https://${customDomain}`;
    }

    const subdomain = sanitizeSlug(store.subdomain || '');
    if (!subdomain) {
      return '/';
    }

    if (isLocalRoot) {
      return `http://${subdomain}.localhost:${PORT}`;
    }

    return `https://${subdomain}.${ROOT_DOMAIN}`;
  };

  const buildStoreAdminUrl = (store) => {
    if (!store) {
      return '/dashboard';
    }

    if (isLocalRoot) {
      return `http://localhost:${PORT}/admin?store=${encodeURIComponent(store.id)}`;
    }

    return `https://${ROOT_DOMAIN}/admin?store=${encodeURIComponent(store.id)}`;
  };

  const buildStorefrontAbsoluteUrl = (store, pathname = '/') => {
    const baseUrl = buildStorefrontUrl(store);
    try {
      return new URL(pathname, baseUrl).toString();
    } catch {
      const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
      if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
        return `${baseUrl}${normalizedPath}`;
      }
      return normalizedPath;
    }
  };

  const buildStorefrontAssetUrl = (store, value = '') => {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    if (raw.startsWith('/')) {
      return buildStorefrontAbsoluteUrl(store, raw);
    }

    return buildStorefrontAbsoluteUrl(store, `/${raw.replace(/^\/+/, '')}`);
  };

  const buildRequestBaseUrl = (req) => {
    const protocol = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      || (req.secure ? 'https' : 'http');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '')
      .split(',')[0]
      .trim();

    return host ? `${protocol}://${host}` : '';
  };

  const buildPlatformAbsoluteUrl = (req, pathname = '/') => {
    const baseUrl = buildRequestBaseUrl(req);
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    if (!baseUrl) {
      return normalizedPath;
    }

    try {
      return new URL(normalizedPath, baseUrl).toString();
    } catch {
      return `${baseUrl}${normalizedPath}`;
    }
  };

  const buildPlatformAssetUrl = (req, value = '') => {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    if (raw.startsWith('/')) {
      return buildPlatformAbsoluteUrl(req, raw);
    }

    return buildPlatformAbsoluteUrl(req, `/${raw.replace(/^\/+/, '')}`);
  };

  const resolveSafeLocalRedirect = (req, target, fallback = '/', store = null) => {
    const normalizedFallback = safeRedirect(req, fallback, '/', store);
    const fallbackPath = normalizedFallback.startsWith('/')
      ? normalizedFallback
      : '/';

    const redirectTarget = safeRedirect(req, target, fallbackPath, store);
    return redirectTarget.startsWith('/')
      ? redirectTarget
      : fallbackPath;
  };

  const resolveFormReturnTo = (req, fallback = '/', store = null) => {
    const candidate = req.body?.returnTo
      || req.query?.returnTo
      || req.query?.next
      || req.query?.redirect
      || '';
    return resolveSafeLocalRedirect(req, candidate, fallback, store);
  };

  const joinKeywordList = (...groups) => {
    return Array.from(new Set(groups
      .flat()
      .map((entry) => sanitizePlainText(entry || '', { maxLength: 80 }).toLowerCase())
      .filter(Boolean)))
      .slice(0, 18)
      .join(', ');
  };

  const buildStoreSeoDescription = (store) => {
    return sanitizePlainText(
      store?.seo_description
      || store?.description
      || `${store?.name || 'This store'} offers a carefully merchandised shopping experience with dependable checkout and clear operations.`,
      { maxLength: 320 }
    );
  };

  const buildStoreSeoKeywords = (store, additionalKeywords = []) => {
    return joinKeywordList(
      store?.seo_keywords ? String(store.seo_keywords).split(',') : [],
      [store?.name, store?.store_type, store?.subdomain],
      Array.isArray(store?.markets) ? store.markets : [],
      additionalKeywords
    );
  };

  const buildPlatformSeoDescription = (platformBrand = null) => {
    return sanitizePlainText(
      platformBrand?.shortDescription
      || 'A serious commerce workspace for design-led brands and retail operators.',
      { maxLength: 320 }
    );
  };

  const resolveStorefrontMetaRobots = (req, payload = {}) => {
    if (payload.metaRobots) {
      return payload.metaRobots;
    }

    const disallowedPaths = [
      '/account',
      '/orders',
      '/checkout',
      '/cart',
      '/wishlist',
      '/order-confirmation',
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password'
    ];
    if (disallowedPaths.some((entry) => req.path === entry || req.path.startsWith(`${entry}/`))) {
      return 'noindex, nofollow';
    }

    return 'index, follow';
  };

  const resolvePlatformMetaRobots = (req, payload = {}) => {
    if (payload.metaRobots) {
      return payload.metaRobots;
    }

    const publicIndexablePaths = new Set(['/', '/terms', '/privacy']);
    return publicIndexablePaths.has(req.path) ? 'index, follow' : 'noindex, nofollow';
  };

  const buildPlatformMeta = (req, payload = {}, platformBrand = null) => {
    const hasCanonicalPath = Object.prototype.hasOwnProperty.call(payload, 'canonicalPath');
    const canonicalPath = hasCanonicalPath ? payload.canonicalPath : (req.path || '/');
    const fallbackBrandLabel = platformBrand?.platformName || 'Aisle';

    return {
      pageTitle: payload.pageTitle || '',
      metaTitle: payload.metaTitle || payload.pageTitle || fallbackBrandLabel,
      metaDescription: payload.metaDescription || buildPlatformSeoDescription(platformBrand),
      metaKeywords: payload.metaKeywords || '',
      canonicalUrl: payload.canonicalUrl || (canonicalPath ? buildPlatformAbsoluteUrl(req, canonicalPath) : ''),
      socialImage: payload.socialImage || buildPlatformAssetUrl(req, '/brand/aisle-logo.svg'),
      metaType: payload.metaType || 'website',
      metaRobots: resolvePlatformMetaRobots(req, payload)
    };
  };

  const buildStorefrontMeta = (req, store, payload = {}) => {
    const hasCanonicalPath = Object.prototype.hasOwnProperty.call(payload, 'canonicalPath');
    const canonicalPath = hasCanonicalPath ? payload.canonicalPath : (req.path || '/');

    return {
      pageTitle: payload.pageTitle || '',
      metaTitle: payload.metaTitle || payload.pageTitle || store?.name || '',
      metaDescription: payload.metaDescription || buildStoreSeoDescription(store),
      metaKeywords: payload.metaKeywords || buildStoreSeoKeywords(store),
      canonicalUrl: payload.canonicalUrl || (canonicalPath ? buildStorefrontAbsoluteUrl(store, canonicalPath) : ''),
      socialImage: payload.socialImage || buildStorefrontAssetUrl(store, store?.logo || ''),
      metaType: payload.metaType || 'website',
      metaRobots: resolveStorefrontMetaRobots(req, payload)
    };
  };

  const getCurrentCustomer = (req) => req.currentCustomer || null;

  const getWishlistProductIds = (req, storeId) => {
    const raw = readSignedCookie(req, wishlistCookieName(storeId));
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((entry) => String(entry)).slice(0, 50);
    } catch {
      return [];
    }
  };

  const getAppliedCouponCode = (req, storeId) => {
    return normalizePromotionCode(readSignedCookie(req, couponCookieName(storeId)) || '');
  };

  const persistAppliedCoupon = (req, res, storeId, couponCode) => {
    const normalizedCode = normalizePromotionCode(couponCode);
    if (!normalizedCode) {
      clearSignedCookie(req, res, couponCookieName(storeId));
      return '';
    }

    setSignedCookie(req, res, couponCookieName(storeId), normalizedCode, {
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return normalizedCode;
  };

  const clearAppliedCoupon = (req, res, storeId) => {
    clearSignedCookie(req, res, couponCookieName(storeId));
  };

  const persistWishlist = (req, res, storeId, productIds) => {
    setSignedCookie(req, res, wishlistCookieName(storeId), JSON.stringify(productIds.slice(0, 50)), {
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  };

  const getRecentlyViewedProductIds = (req, storeId) => {
    const raw = readSignedCookie(req, recentlyViewedCookieName(storeId));
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((entry) => String(entry)).slice(0, 12);
    } catch {
      return [];
    }
  };

  const persistRecentlyViewed = (req, res, storeId, productId) => {
    const nextIds = [
      String(productId),
      ...getRecentlyViewedProductIds(req, storeId).filter((entry) => entry !== String(productId))
    ].slice(0, 12);

    setSignedCookie(req, res, recentlyViewedCookieName(storeId), JSON.stringify(nextIds), {
      maxAge: 14 * 24 * 60 * 60 * 1000
    });
  };

  const loadProductsByIds = async (req, store, productIds = [], options = {}) => {
    if (!store?.id) {
      return [];
    }

    const uniqueIds = Array.from(new Set(
      productIds
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    ));

    if (!uniqueIds.length) {
      return [];
    }

    const auth = options.auth || null;
    const resolved = await Promise.all(uniqueIds.map(async (productId) => {
      try {
        return await getStoreProductById(req, store, productId, auth ? { auth } : {});
      } catch (error) {
        if ([404, 403].includes(Number(error.status))) {
          return null;
        }

        throw error;
      }
    }));

    return resolved
      .filter(Boolean)
      .map(mergeProductPresentation);
  };

  const getRecentlyViewedProducts = async (req, store, options = {}) => {
    const storeId = store?.id;
    if (!storeId) {
      return [];
    }

    const excludeId = options.excludeId ? String(options.excludeId) : null;
    const limit = Math.max(1, Number(options.limit || 4));

    const ids = getRecentlyViewedProductIds(req, storeId)
      .filter((entry) => !excludeId || entry !== excludeId)
      .slice(0, limit);

    return loadProductsByIds(req, store, ids);
  };

  const requiresStoreContext = (req) => {
    return isStorefrontHost(req)
      || req.path.startsWith('/admin')
      || req.path.startsWith('/stores/')
      || isStoreScopedPath(req.path);
  };

  const shouldLoadStorefrontIdentity = (req) => {
    return isStorefrontHost(req) || isStoreScopedPath(req.path);
  };

  const sortProducts = (products = [], sort = 'featured') => {
    const list = [...products];

    switch (String(sort || 'featured').toLowerCase()) {
      case 'price-low':
        return list.sort((left, right) => Number(left.price || 0) - Number(right.price || 0));
      case 'price-high':
        return list.sort((left, right) => Number(right.price || 0) - Number(left.price || 0));
      case 'name':
        return list.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
      case 'newest':
        return list.sort((left, right) => {
          return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
        });
      case 'featured':
      default:
        return list.sort((left, right) => {
          if (Boolean(left.featured) !== Boolean(right.featured)) {
            return left.featured ? -1 : 1;
          }

          return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
        });
    }
  };

  const buildProductDiscovery = (products = []) => {
    const categories = new Map();
    const tags = new Map();

    products.forEach((product) => {
      const categoryName = sanitizePlainText(product.category || '', { maxLength: 120 });
      if (categoryName) {
        const slug = sanitizeSlug(categoryName);
        if (slug && !categories.has(slug)) {
          categories.set(slug, {
            name: categoryName,
            slug
          });
        }
      }

      (Array.isArray(product.tags) ? product.tags : []).forEach((tag) => {
        const tagName = sanitizePlainText(tag || '', { maxLength: 80 });
        const slug = sanitizeSlug(tagName);
        if (tagName && slug && !tags.has(slug)) {
          tags.set(slug, {
            name: tagName,
            slug
          });
        }
      });
    });

    return {
      categories: Array.from(categories.values()),
      tags: Array.from(tags.values())
    };
  };

  const buildStoreStats = ({ store = null, products = [], orders = [], customers = [] } = {}) => {
    const now = Date.now();
    const thirtyDaysAgoMs = now - (30 * 24 * 60 * 60 * 1000);
    const revenue30d = orders.reduce((sum, order) => {
      const createdAtMs = new Date(order.created_at || 0).getTime();
      const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
      const orderStatus = String(order.status || '').trim().toLowerCase();
      const wasPaid = paymentStatus === 'paid'
        || ['confirmed', 'shipped', 'delivered'].includes(orderStatus);
      const wasRefunded = paymentStatus === 'refunded' || orderStatus === 'refunded';

      if (!wasPaid || wasRefunded || !Number.isFinite(createdAtMs) || createdAtMs < thirtyDaysAgoMs) {
        return sum;
      }

      return sum + Number(order.total || 0);
    }, 0);

    return {
      totalProducts: products.length,
      publishedProducts: products.filter((entry) => String(entry.status || '').toLowerCase() === 'published').length,
      totalOrders: orders.length,
      revenue30d,
      customersCount: customers.length,
      openSupportTickets: 0,
      marketsCount: Array.isArray(store?.markets) ? store.markets.length : 0
    };
  };

  const buildStoreLaunchChecklist = ({ store = null, products = [], orders = [], paymentProviderConfigs = {} } = {}) => {
    const providerEntries = Object.values(paymentProviderConfigs || {});
    const hasActiveGateway = providerEntries.some((entry) => String(entry?.status || '').trim().toLowerCase() === 'active');
    const publishedProducts = products.filter((entry) => String(entry.status || '').toLowerCase() === 'published');
    const hasStoreIdentity = Boolean(
      sanitizePlainText(store?.name || '', { maxLength: 150 })
      && sanitizeEmail(store?.support_email || '')
      && sanitizePlainText(store?.fulfillment_sla || '', { maxLength: 120 })
    );

    return [
      {
        key: 'identity',
        title: 'Add store identity and support details',
        description: 'Customers should see a real support email, fulfillment promise, and branded storefront before launch.',
        complete: hasStoreIdentity,
        href: '/admin/settings',
        action: 'Open settings'
      },
      {
        key: 'catalog',
        title: 'Publish the first product',
        description: 'A store cannot reach its first sale until at least one product is live on the storefront.',
        complete: publishedProducts.length > 0,
        href: '/admin/products/new',
        action: 'Add product'
      },
      {
        key: 'payments',
        title: 'Activate Paystack or Flutterwave',
        description: 'Hosted checkout should be connected before shoppers reach the payment step.',
        complete: hasActiveGateway,
        href: '/admin/settings',
        action: 'Connect payments'
      },
      {
        key: 'launch',
        title: 'Get the first paid order',
        description: 'The final milestone is a verified payment that moves an order from pending into confirmed.',
        complete: orders.some((entry) => String(entry.payment_status || '').trim().toLowerCase() === 'paid'),
        href: '/admin/orders',
        action: 'Review orders'
      }
    ];
  };

  const resolveRequestedStoreId = (req) => {
    return sanitizePlainText(req.query.store || readSignedCookie(req, 'activeStoreId') || '', {
      maxLength: 120
    });
  };

  const parseLineList = (value = '', maxItems = 12, maxLength = 180) => {
    return String(value || '')
      .split(/\r?\n/)
      .map((entry) => sanitizePlainText(entry, { maxLength }))
      .filter(Boolean)
      .slice(0, maxItems);
  };

  const decorateProducts = (products = []) => {
    return products.map((product) => mergeProductPresentation(product));
  };

  const buildStoreContentPayload = (req) => {
    return {
      tagline: sanitizePlainText(req.body.tagline || '', { maxLength: 180 }),
      description: sanitizePlainText(req.body.description || '', { maxLength: 1500 }),
      fulfillment_sla: sanitizePlainText(req.body.fulfillment_sla || '', { maxLength: 120 }),
      return_window_days: Number(req.body.return_window_days || 30) || 30,
      seo_title: sanitizePlainText(req.body.seo_title || '', { maxLength: 120 }),
      seo_description: sanitizePlainText(req.body.seo_description || '', { maxLength: 320 }),
      seo_keywords: sanitizePlainText(req.body.seo_keywords || '', { maxLength: 255 }),
      announcement_text: sanitizePlainText(req.body.announcement_text || '', { maxLength: 180 }),
      hero_eyebrow: sanitizePlainText(req.body.hero_eyebrow || '', { maxLength: 80 }),
      hero_title: sanitizePlainText(req.body.hero_title || '', { maxLength: 180 }),
      hero_description: sanitizePlainText(req.body.hero_description || '', { maxLength: 500 }),
      hero_support: sanitizePlainText(req.body.hero_support || '', { maxLength: 160 }),
      primary_cta_text: sanitizePlainText(req.body.primary_cta_text || '', { maxLength: 50 }),
      secondary_cta_text: sanitizePlainText(req.body.secondary_cta_text || '', { maxLength: 50 }),
      featured_collection_title: sanitizePlainText(req.body.featured_collection_title || '', { maxLength: 160 }),
      featured_collection_description: sanitizePlainText(req.body.featured_collection_description || '', { maxLength: 320 }),
      footer_blurb: sanitizePlainText(req.body.footer_blurb || '', { maxLength: 400 })
    };
  };

  const buildStoreServicePayload = (req, options = {}) => {
    const payload = {
      name: sanitizePlainText(req.body.name || '', { maxLength: 150 }),
      custom_domain: normalizeHostname(req.body.custom_domain || '') || null,
      theme_color: sanitizePlainText(req.body.theme_color || '#0F766E', { maxLength: 20 }) || '#0F766E',
      store_type: sanitizePlainText(req.body.store_type || 'general', { maxLength: 50 }) || 'general',
      template_key: sanitizePlainText(req.body.template_key || req.body.template_picker || 'fashion', { maxLength: 50 }) || 'fashion',
      font_preset: sanitizePlainText(req.body.font_preset || 'jakarta', { maxLength: 50 }) || 'jakarta',
      support_email: sanitizeEmail(req.body.support_email || ''),
      contact_phone: sanitizePlainText(req.body.contact_phone || '', { maxLength: 50 }),
      shipping_origin_country: sanitizePlainText(req.body.shipping_origin_country || '', { maxLength: 120 }) || null,
      shipping_flat_rate: Math.max(0, Number(req.body.shipping_flat_rate || 0)),
      domestic_shipping_rate: Math.max(0, Number(req.body.domestic_shipping_rate || 0)),
      international_shipping_rate: Math.max(0, Number(req.body.international_shipping_rate || 0)),
      free_shipping_threshold: Math.max(0, Number(req.body.free_shipping_threshold || 0)),
      tax_rate: Math.max(0, Math.min(100, Number(req.body.tax_rate || 0))),
      tax_label: sanitizePlainText(req.body.tax_label || '', { maxLength: 80 }) || null,
      tax_apply_to_shipping: parseCheckbox(req.body.tax_apply_to_shipping),
      ssl_status: options.ssl_status || 'pending',
      is_active: options.is_active === undefined ? true : Boolean(options.is_active)
    };

    if (options.logoUrl !== undefined) {
      payload.logo_url = options.logoUrl || null;
    }

    return payload;
  };

  const buildProductServicePayload = (req) => {
    const primaryImage = sanitizeUrl(req.body.image || '');
    const galleryImages = parseLineList(req.body.gallery || '', 12, 500).map((entry) => sanitizeUrl(entry)).filter(Boolean);
    const mergedImages = Array.from(new Set([primaryImage, ...galleryImages].filter(Boolean))).slice(0, 12);
    const discountType = sanitizePlainText(req.body.discount_type || 'none', { maxLength: 20 }).toLowerCase() || 'none';
    const promotionType = sanitizePlainText(req.body.promotion_type || 'none', { maxLength: 20 }).toLowerCase() || 'none';

    return {
      title: sanitizePlainText(req.body.name || '', { maxLength: 180 }),
      category: sanitizePlainText(req.body.category || '', { maxLength: 120 }),
      sku: sanitizePlainText(req.body.sku || '', { maxLength: 120 }),
      description: sanitizePlainText(req.body.description || '', { maxLength: 3000 }),
      price: Number(req.body.price || 0),
      base_price: Number(req.body.price || 0),
      compare_at_price: req.body.compare_at_price === '' || req.body.compare_at_price === undefined
        ? null
        : Number(req.body.compare_at_price),
      discount_type: discountType,
      discount_value: req.body.discount_value === '' || req.body.discount_value === undefined
        ? null
        : Number(req.body.discount_value),
      promotion_type: promotionType,
      discount_label: sanitizePlainText(req.body.discount_label || '', { maxLength: 120 }),
      discount_starts_at: req.body.discount_starts_at || null,
      discount_ends_at: req.body.discount_ends_at || null,
      inventory_count: Number(req.body.inventory || 0),
      images: mergedImages,
      status: parseCheckbox(req.body.status) ? 'published' : 'draft'
    };
  };

  const buildProductPresentationPayload = (req) => {
    return {
      highlights: parseLineList(req.body.highlights || '', 12, 180),
      featured: parseCheckbox(req.body.featured)
    };
  };

  const buildProductDraft = (req, productId = null) => {
    const servicePayload = buildProductServicePayload(req);
    const presentationPayload = buildProductPresentationPayload(req);

    return {
      id: productId,
      name: servicePayload.title,
      category: servicePayload.category,
      sku: servicePayload.sku,
      description: servicePayload.description,
      price: servicePayload.price,
      base_price: servicePayload.base_price,
      compare_at_price: servicePayload.compare_at_price,
      discount_type: servicePayload.discount_type,
      discount_value: servicePayload.discount_value,
      promotion_type: servicePayload.promotion_type,
      discount_label: servicePayload.discount_label,
      discount_starts_at: servicePayload.discount_starts_at,
      discount_ends_at: servicePayload.discount_ends_at,
      inventory: servicePayload.inventory_count,
      image: servicePayload.images[0] || '',
      images: servicePayload.images,
      status: servicePayload.status === 'published' ? 'Published' : 'Draft',
      ...presentationPayload
    };
  };

  const filterCatalogProducts = (products = [], options = {}) => {
    const normalizedCategory = String(options.category || 'All').trim();
    const normalizedSearch = String(options.search || '').trim().toLowerCase();
    const normalizedTag = sanitizeSlug(options.tag || '');

    const filtered = products.filter((product) => {
      const matchesCategory = normalizedCategory === 'All'
        || sanitizeSlug(product.category || '') === sanitizeSlug(normalizedCategory)
        || String(product.category || '') === normalizedCategory;

      const matchesSearch = !normalizedSearch || [
        product.name,
        product.description,
        product.category,
        ...(Array.isArray(product.tags) ? product.tags : [])
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));

      const matchesTag = !normalizedTag || (Array.isArray(product.tags) && product.tags.some((tag) => sanitizeSlug(tag) === normalizedTag));

      return matchesCategory && matchesSearch && matchesTag;
    });

    return sortProducts(filtered, options.sort || 'featured');
  };

  const requirePlatformUser = (req, res, fallback = '/dashboard') => {
    if (req.platformAuth && req.currentPlatformUser) {
      return null;
    }

    const returnTo = resolveSafeLocalRedirect(req, req.originalUrl || fallback, fallback);
    res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    return res;
  };

  const isPlatformAdminUser = (user) => {
    const role = String(user?.role || user?.actorRole || '').trim().toLowerCase();
    return role === PLATFORM_ROLES.PLATFORM_OWNER || role === PLATFORM_ROLES.SUPPORT_AGENT;
  };

  const getPlatformHomePath = (identity = null) => {
    return isPlatformAdminUser(identity) ? '/platform-admin' : '/dashboard';
  };

  const requirePlatformAdmin = (req, res, fallback = '/platform-admin') => {
    if (req.platformAuth && req.currentPlatformUser && isPlatformAdminUser(req.currentPlatformUser)) {
      return null;
    }

    const returnTo = resolveSafeLocalRedirect(req, req.originalUrl || fallback, fallback);
    res.redirect(`/platform-admin/login?returnTo=${encodeURIComponent(returnTo)}`);
    return res;
  };

  const requireActiveStore = (req, res, fallback = '/dashboard') => {
    if (req.currentStore?.id) {
      return null;
    }

    res.redirect(`${fallback}?error=${encodeURIComponent('Choose a store before opening the admin workspace.')}`);
    return res;
  };

  const buildOwnerDashboardMetrics = (stores = [], subscription = null) => {
    return {
      storesCount: stores.length,
      liveStores: stores.filter((entry) => entry.is_active).length,
      subscriptionStatus: subscription?.status || 'inactive',
      subscriptionPlan: subscription?.plan || 'launch',
      trialEndsAt: subscription?.trial_ends_at || null,
      currentPeriodEnd: subscription?.current_period_end || null
    };
  };

  const buildInternalServiceHeaders = (req, storeId = '') => {
    const platformAuth = req.platformAuth || {};
    return buildSignedInternalHeaders({
      requestId: req.requestId || crypto.randomUUID(),
      forwardedHost: req.headers.host || req.hostname || '',
      storeId,
      userId: platformAuth.userId || '',
      actorRole: platformAuth.actorRole || PLATFORM_ROLES.STORE_OWNER,
      actorType: 'platform_user',
      secret: env.internalSharedSecret
    });
  };

  const setOrderTrackingCookie = (req, res, storeId, orderId) => {
    setSignedCookie(req, res, orderCookieName(storeId), String(orderId), {
      maxAge: 14 * 24 * 60 * 60 * 1000
    });
  };

  const setCurrencyPreferenceCookie = (req, res, name, value) => {
    setSignedCookie(req, res, name, value, {
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  };

  const clearTokenCookie = (res, name) => {
    res.clearCookie(name, buildCookieOptions(env, {
      maxAge: 0
    }));
  };

  const wantsJson = (req) => {
    return req.xhr
      || String(req.headers.accept || '').includes('application/json')
      || req.path.startsWith('/cart/')
      || req.path.startsWith('/wishlist/');
  };

  return {
    catalogSortOptions,
    commonRules,
    createHttpError,
    buildFormData,
    hasPlanCapability,
    handleMultipartLogo,
    safeDecodeURIComponent,
    parseCheckbox,
    isStorefrontHost,
    isStoreScopedPath,
    resolveStore,
    buildStorefrontUrl,
    buildStoreAdminUrl,
    buildStorefrontAbsoluteUrl,
    buildStorefrontAssetUrl,
    buildRequestBaseUrl,
    buildPlatformAbsoluteUrl,
    buildPlatformAssetUrl,
    resolveSafeLocalRedirect,
    resolveFormReturnTo,
    joinKeywordList,
    buildStoreSeoDescription,
    buildStoreSeoKeywords,
    buildPlatformSeoDescription,
    resolveStorefrontMetaRobots,
    resolvePlatformMetaRobots,
    buildPlatformMeta,
    buildStorefrontMeta,
    getCurrentCustomer,
    getWishlistProductIds,
    persistWishlist,
    getAppliedCouponCode,
    persistAppliedCoupon,
    clearAppliedCoupon,
    getRecentlyViewedProductIds,
    persistRecentlyViewed,
    loadProductsByIds,
    getRecentlyViewedProducts,
    requiresStoreContext,
    shouldLoadStorefrontIdentity,
    sortProducts,
    buildProductDiscovery,
    buildStoreStats,
    buildStoreLaunchChecklist,
    resolveRequestedStoreId,
    parseLineList,
    decorateProducts,
    buildStoreContentPayload,
    buildStoreServicePayload,
    buildProductServicePayload,
    buildProductPresentationPayload,
    buildProductDraft,
    normalizePromotionCode,
    filterCatalogProducts,
    isPlatformAdminUser,
    getPlatformHomePath,
    requirePlatformUser,
    requirePlatformAdmin,
    requireActiveStore,
    buildOwnerDashboardMetrics,
    buildInternalServiceHeaders,
    setOrderTrackingCookie,
    setCurrencyPreferenceCookie,
    clearTokenCookie,
    wantsJson,
    listPlatformStores,
    getOwnerSubscription
  };
};

module.exports = {
  createAppHelpers
};
