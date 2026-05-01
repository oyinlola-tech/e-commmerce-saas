const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const client = require('prom-client');
const swaggerUi = require('swagger-ui-express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { doubleCsrf } = require('csrf-csrf');
const { body } = require('express-validator');
const {
  createServiceConfig,
  createLogger,
  createCache,
  createRedisRateLimitStore,
  verifyToken,
  requestJson,
  buildSignedInternalHeaders,
  verifySignedInternalHeaders,
  setPlatformTokenCookie,
  setCustomerTokenCookie,
  clearAuthCookies,
  PLATFORM_ROLES,
  normalizeHostname,
  normalizeOrigin,
  isSubdomainOf,
  isPlatformHost,
  isSecureRequest,
  validate,
  allowBodyFields,
  commonRules,
  asyncHandler,
  errorHandler
} = require('../../packages/shared');
const { createGatewayOpenApiSpec } = require('./src/openapi');

const config = createServiceConfig({
  appRoot: __dirname,
  serviceName: 'gateway',
  defaultPort: 4000,
  defaultDatabase: 'gateway_db'
});

const logger = createLogger('gateway');
const app = express();
const server = http.createServer(app);
let requestCache = null;

const STORE_RESOLUTION_CACHE_TTL_SECONDS = 60;
const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'];

const registry = new client.Registry();
const openApiSpec = createGatewayOpenApiSpec(config);
client.collectDefaultMetrics({ register: registry, prefix: 'aisle_gateway_' });

const requestCounter = new client.Counter({
  name: 'aisle_gateway_http_requests_total',
  help: 'Total gateway requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry]
});

const requestErrors = new client.Counter({
  name: 'aisle_gateway_http_errors_total',
  help: 'Total gateway error responses',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry]
});

const requestLatency = new client.Histogram({
  name: 'aisle_gateway_http_request_duration_seconds',
  help: 'Gateway request latency',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.75, 1.5, 3, 5],
  registers: [registry]
});

const resolveRouteLabel = (req) => {
  if (req.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }

  if (req.baseUrl) {
    return req.baseUrl;
  }

  return req.path || '/';
};

app.set('trust proxy', true);
app.use(helmet({
  crossOriginResourcePolicy: false,
  referrerPolicy: {
    policy: 'no-referrer'
  }
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  req.log = logger.child({
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl
  });

  const endTimer = requestLatency.startTimer({
    method: req.method,
    route: resolveRouteLabel(req)
  });

  res.on('finish', () => {
    const route = resolveRouteLabel(req);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode)
    };

    requestCounter.inc(labels);
    if (res.statusCode >= 400) {
      requestErrors.inc(labels);
    }

    endTimer(labels);
    req.log.info('request_completed', {
      statusCode: res.statusCode,
      route
    });
  });

  next();
});

app.use((req, res, next) => {
  if (!config.isProduction) {
    return next();
  }

  if (isSecureRequest(req)) {
    return next();
  }

  const requestHost = normalizeHostname(req.headers.host);
  if (!requestHost) {
    return res.status(400).json({ error: 'Invalid host header.' });
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(308, `https://${requestHost}${req.originalUrl}`);
  }

  return res.status(400).json({ error: 'HTTPS is required.' });
});

const buildRateLimiter = (options = {}) => {
  const limiterOptions = {
    windowMs: options.windowMs || 60 * 1000,
    limit: options.limit || 300,
    standardHeaders: true,
    legacyHeaders: false
  };

  if (options.store) {
    limiterOptions.store = options.store;
  }

  return rateLimit(limiterOptions);
};

const resolveRequestHost = (req) => {
  const signedInternalHeaders = verifySignedInternalHeaders(req.headers, config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });

  if (signedInternalHeaders && req.headers['x-actor-type'] === 'web_app') {
    const trustedTenantHost = String(req.headers['x-tenant-host'] || req.headers['x-forwarded-host'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();

    if (trustedTenantHost) {
      const normalizedTrustedHost = normalizeHostname(trustedTenantHost);
      if (!normalizedTrustedHost) {
        return '';
      }

      req.isTrustedWebRequest = true;
      return normalizedTrustedHost;
    }
  }

  return normalizeHostname(req.hostname || req.headers.host || '');
};

const extractToken = (req) => {
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }

  return req.cookies?.platform_token || req.cookies?.customer_token || null;
};

const { generateToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => config.internalSharedSecret,
  cookieName: 'aisle.gateway-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/'
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getSessionIdentifier: (req) => extractToken(req) || req.ip || 'anonymous',
  getTokenFromRequest: (req) => req.body?._csrf || req.headers['x-csrf-token'] || req.headers['csrf-token']
});

const resolveAuthContext = (req) => {
  const token = extractToken(req);
  if (!token) {
    return null;
  }

  try {
    return verifyToken(token, config.jwtSecret);
  } catch {
    return null;
  }
};

const createServiceHeaders = (req, overrides = {}) => {
  const auth = overrides.auth || req.gatewayContext?.auth || null;
  const storeId = overrides.storeId === undefined
    ? (req.storeContext?.store?.id || req.params?.storeId || '')
    : overrides.storeId;

  return buildSignedInternalHeaders({
    requestId: req.requestId,
    forwardedHost: overrides.forwardedHost || '',
    storeId,
    userId: overrides.userId === undefined ? auth?.user_id || '' : overrides.userId,
    actorRole: overrides.actorRole === undefined ? auth?.role || '' : overrides.actorRole,
    customerId: overrides.customerId === undefined ? auth?.customer_id || '' : overrides.customerId,
    actorType: overrides.actorType === undefined ? auth?.actor_type || '' : overrides.actorType,
    secret: config.internalSharedSecret
  });
};

const resolveStoreContext = async (req, res, next) => {
  const host = resolveRequestHost(req);
  const needsStoreResolution = !isPlatformHost(host, config.rootDomain)
    || req.path.startsWith('/api/chats')
    || req.path.startsWith('/api/support')
    || req.path.startsWith('/api/products')
    || req.path.startsWith('/api/cart')
    || req.path.startsWith('/api/customers')
    || req.path.startsWith('/api/orders')
    || req.path.startsWith('/api/checkout');

  req.publicHost = host;

  if (!host) {
    return res.status(400).json({ error: 'Invalid host header.' });
  }

  if (!needsStoreResolution) {
    return next();
  }

  try {
    const cacheKey = `gateway:store-resolution:${host}`;
    const response = requestCache
      ? await requestCache.getOrSetJson(cacheKey, STORE_RESOLUTION_CACHE_TTL_SECONDS, async () => {
        return requestJson(`${config.serviceUrls.store}/resolve?host=${encodeURIComponent(host)}`, {
          headers: {
            'x-request-id': req.requestId
          },
          timeoutMs: config.requestTimeoutMs
        });
      })
      : {
        value: await requestJson(`${config.serviceUrls.store}/resolve?host=${encodeURIComponent(host)}`, {
          headers: {
            'x-request-id': req.requestId
          },
          timeoutMs: config.requestTimeoutMs
        }),
        cacheHit: false
      };

    req.storeContext = response.value;
    res.setHeader('x-store-cache', response.cacheHit ? 'hit' : 'miss');

    if (!req.storeContext || !req.storeContext.store || !req.storeContext.store.is_active) {
      return res.status(404).json({ error: 'Store not found or inactive.' });
    }

    return next();
  } catch (error) {
    logger.error('Store resolution failed', {
      requestId: req.requestId,
      error: error.message,
      host
    });
    return res.status(error.status || 502).json({
      error: 'Unable to resolve store.'
    });
  }
};

const isOriginAllowed = (req, origin) => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  const requestHost = req.publicHost || resolveRequestHost(req);
  if (!requestHost) {
    return false;
  }

  if (normalizedOrigin.hostname === requestHost) {
    return true;
  }

  if (isPlatformHost(normalizedOrigin.hostname, config.rootDomain) && isPlatformHost(requestHost, config.rootDomain)) {
    return true;
  }

  if (isSubdomainOf(normalizedOrigin.hostname, config.rootDomain) && isSubdomainOf(requestHost, config.rootDomain)) {
    return true;
  }

  const store = req.storeContext?.store;
  if (!store) {
    return false;
  }

  const allowedHosts = [
    requestHost,
    store.custom_domain,
    store.subdomain ? `${store.subdomain}.${config.rootDomain}` : ''
  ]
    .map((entry) => normalizeHostname(entry))
    .filter(Boolean);

  return allowedHosts.includes(normalizedOrigin.hostname);
};

const gatewayCors = (req, res, next) => {
  return cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      return callback(null, isOriginAllowed(req, origin));
    },
    credentials: true,
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: ['x-request-id', 'x-cache', 'x-store-cache'],
    maxAge: 600
  })(req, res, next);
};

const shouldEnforceGatewayCsrf = (req) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return false;
  }

  const authorization = String(req.headers.authorization || '').trim();
  return !authorization.startsWith('Bearer ');
};

const buildGatewayContext = (req, auth = null) => {
  const storeId = req.storeContext?.store?.id || req.params?.storeId || '';

  return {
    auth,
    internalHeaders: createServiceHeaders(req, {
      auth,
      storeId
    })
  };
};

const attachGatewayProxyContext = (req, res, next) => {
  req.gatewayContext = buildGatewayContext(req, null);
  return next();
};

const attachGatewayAuthContext = (req, res, next) => {
  const auth = resolveAuthContext(req);
  const storeId = req.storeContext?.store?.id || req.params?.storeId || '';

  if (auth && auth.actor_type === 'customer' && storeId && String(auth.store_id) !== String(storeId)) {
    return res.status(403).json({ error: 'Customer token does not belong to this store.' });
  }

  req.gatewayContext = buildGatewayContext(req, auth);

  return next();
};

const requirePlatformUser = (allowedRoles = []) => {
  return (req, res, next) => {
    const auth = req.gatewayContext?.auth;
    if (!auth || auth.actor_type !== 'platform_user') {
      return res.status(401).json({ error: 'Platform authentication required.' });
    }

    if (allowedRoles.length && !allowedRoles.includes(auth.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource.' });
    }

    return next();
  };
};

const requireCustomer = (req, res, next) => {
  const auth = req.gatewayContext?.auth;
  if (!auth || auth.actor_type !== 'customer') {
    return res.status(401).json({ error: 'Customer authentication required.' });
  }

  return next();
};

const ensureOwnerCanAccessStore = async (req, res, next) => {
  const auth = req.gatewayContext?.auth;
  if (!auth || auth.actor_type !== 'platform_user') {
    return res.status(401).json({ error: 'Platform authentication required.' });
  }

  if ([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT].includes(auth.role)) {
    return next();
  }

  try {
    const storeId = req.params.storeId;
    const result = await requestJson(`${config.serviceUrls.store}/stores/${encodeURIComponent(storeId)}/access-check?user_id=${encodeURIComponent(auth.user_id)}`, {
      headers: req.gatewayContext.internalHeaders,
      timeoutMs: config.requestTimeoutMs
    });

    if (!result.allowed) {
      return res.status(403).json({ error: 'You do not own this store.' });
    }

    return next();
  } catch (error) {
    return res.status(error.status || 502).json({
      error: 'Unable to verify store access.'
    });
  }
};

const createServiceProxy = (target, pathRewrite, options = {}) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    xfwd: true,
    pathRewrite,
    proxyTimeout: options.proxyTimeout || config.requestTimeoutMs + 1000,
    timeout: options.timeout || config.requestTimeoutMs + 1000,
    on: {
      error: (error, req, res) => {
        req.log?.warn('upstream_unavailable', {
          target,
          error: error.message
        });

        if (res.headersSent) {
          return;
        }

        return res.status(503).json({
          error: options.serviceUnavailableMessage || 'This service is temporarily unavailable.'
        });
      },
      proxyReq: (proxyReq, req) => {
        const headers = req.gatewayContext?.internalHeaders || {};
        Object.entries(headers).forEach(([key, value]) => {
          proxyReq.setHeader(key, value);
        });
        proxyReq.setHeader('x-forwarded-host', req.headers.host || req.publicHost || '');
      }
    }
  });
};

const bootstrap = async () => {
  const cache = await createCache(config, logger);
  requestCache = cache;
  const redisStore = cache.redis
    ? createRedisRateLimitStore({
      redis: cache.redis,
      prefix: `${config.redisPrefix}:ratelimit:global`,
      windowMs: 60 * 1000
    })
    : null;

  const authRedisStore = cache.redis
    ? createRedisRateLimitStore({
      redis: cache.redis,
      prefix: `${config.redisPrefix}:ratelimit:auth`,
      windowMs: 15 * 60 * 1000
    })
    : null;

  app.use(buildRateLimiter({
    windowMs: 60 * 1000,
    limit: Number(process.env.GATEWAY_RATE_LIMIT_MAX || 300),
    store: redisStore
  }));

  const authRateLimiter = buildRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.GATEWAY_AUTH_RATE_LIMIT_MAX || 20),
    store: authRedisStore
  });

  app.get('/health', async (req, res) => {
    try {
      return res.json({
        service: 'gateway',
        status: 'ok',
        cache: await cache.healthCheck()
      });
    } catch (error) {
      return res.status(500).json({
        service: 'gateway',
        status: 'error',
        error: error.message
      });
    }
  });

  app.get('/metrics', async (req, res) => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  app.get('/openapi.json', (req, res) => {
    res.json(openApiSpec);
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    explorer: true,
    customSiteTitle: 'Aisle Commerce API Docs'
  }));

  app.use(resolveStoreContext);
  app.use(gatewayCors);
  app.use(attachGatewayProxyContext);
  app.use('/api', cookieParser());
  app.use('/api', attachGatewayAuthContext);

  app.get('/api/csrf-token', (req, res) => {
    return res.json({
      csrfToken: generateToken(req, res)
    });
  });

  app.use('/api', (req, res, next) => {
    if (!shouldEnforceGatewayCsrf(req)) {
      return next();
    }

    return doubleCsrfProtection(req, res, next);
  });

  app.get('/api/platform/billing/plans', createServiceProxy(config.serviceUrls.billing, { '^/api/platform': '' }));

  app.post('/api/platform/auth/register', authRateLimiter, validate([
    allowBodyFields(['name', 'email', 'password', 'role', '_csrf']),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password(),
    body('role').optional().isIn(Object.values(PLATFORM_ROLES))
  ]), asyncHandler(async (req, res) => {
    const response = await requestJson(`${config.serviceUrls.user}/auth/register`, {
      method: 'POST',
      headers: createServiceHeaders(req, {
        actorType: 'web_gateway',
        userId: '',
        actorRole: ''
      }),
      body: req.body,
      timeoutMs: config.requestTimeoutMs
    });

    if (response.token) {
      setPlatformTokenCookie(req, res, response.token, config);
    }

    return res.status(201).json(response);
  }));

  app.post('/api/platform/auth/login', authRateLimiter, validate([
    allowBodyFields(['email', 'password', '_csrf']),
    commonRules.email(),
    body('password').isString().notEmpty().withMessage('Password is required.')
  ]), asyncHandler(async (req, res) => {
    const response = await requestJson(`${config.serviceUrls.user}/auth/login`, {
      method: 'POST',
      headers: createServiceHeaders(req, {
        actorType: 'web_gateway',
        userId: '',
        actorRole: ''
      }),
      body: req.body,
      timeoutMs: config.requestTimeoutMs
    });

    if (response.token) {
      setPlatformTokenCookie(req, res, response.token, config);
    }

    return res.json(response);
  }));

  app.post('/api/platform/auth/logout', validate([
    allowBodyFields(['_csrf'])
  ]), (req, res) => {
    clearAuthCookies(req, res, config);
    return res.status(204).send();
  });

  app.post('/api/customers/register', authRateLimiter, validate([
    allowBodyFields(['store_id', 'name', 'email', 'password', 'phone', 'addresses', 'metadata', '_csrf']),
    commonRules.name('name', 120),
    commonRules.email(),
    commonRules.password(),
    commonRules.phone(),
    body('addresses').optional().isArray({ max: 10 }),
    commonRules.jsonObject('metadata')
  ]), asyncHandler(async (req, res) => {
    const storeId = req.storeContext?.store?.id || req.body.store_id;
    const response = await requestJson(`${config.serviceUrls.customer}/customers/register`, {
      method: 'POST',
      headers: createServiceHeaders(req, {
        storeId,
        actorType: 'web_gateway',
        customerId: '',
        userId: '',
        actorRole: ''
      }),
      body: {
        ...req.body,
        store_id: storeId
      },
      timeoutMs: config.requestTimeoutMs
    });

    if (response.token) {
      setCustomerTokenCookie(req, res, response.token, config);
    }

    return res.status(201).json(response);
  }));

  app.post('/api/customers/login', authRateLimiter, validate([
    allowBodyFields(['store_id', 'email', 'password', '_csrf']),
    commonRules.email(),
    body('password').isString().notEmpty().withMessage('Password is required.')
  ]), asyncHandler(async (req, res) => {
    const storeId = req.storeContext?.store?.id || req.body.store_id;
    const response = await requestJson(`${config.serviceUrls.customer}/customers/login`, {
      method: 'POST',
      headers: createServiceHeaders(req, {
        storeId,
        actorType: 'web_gateway',
        customerId: '',
        userId: '',
        actorRole: ''
      }),
      body: {
        ...req.body,
        store_id: storeId
      },
      timeoutMs: config.requestTimeoutMs
    });

    if (response.token) {
      setCustomerTokenCookie(req, res, response.token, config);
    }

    return res.json(response);
  }));

  app.post('/api/customers/logout', validate([
    allowBodyFields(['_csrf'])
  ]), (req, res) => {
    clearAuthCookies(req, res, config);
    return res.status(204).send();
  });

  const platformProxy = {
    auth: createServiceProxy(config.serviceUrls.user, { '^/api/platform': '' }),
    stores: createServiceProxy(config.serviceUrls.store, { '^/api/platform': '' }),
    compliance: createServiceProxy(config.serviceUrls.compliance, { '^/api/platform': '' }),
    support: createServiceProxy(config.serviceUrls.support, { '^/api/platform': '' }, {
      serviceUnavailableMessage: 'Support service is temporarily unavailable.'
    }),
    chats: createServiceProxy(config.serviceUrls.chat, { '^/api/platform': '' }, {
      serviceUnavailableMessage: 'Chat service is temporarily unavailable.'
    }),
    billing: createServiceProxy(config.serviceUrls.billing, { '^/api/platform': '' }),
    notifications: createServiceProxy(config.serviceUrls.notification, { '^/api/platform': '' }, {
      serviceUnavailableMessage: 'Notification service is temporarily unavailable.'
    })
  };

  const storefrontProxies = {
    customers: createServiceProxy(config.serviceUrls.customer, {}),
    products: createServiceProxy(config.serviceUrls.product, {}),
    cart: createServiceProxy(config.serviceUrls.cart, {}),
    checkout: createServiceProxy(config.serviceUrls.order, {}),
    orders: createServiceProxy(config.serviceUrls.order, {}),
    chats: createServiceProxy(config.serviceUrls.chat, {}, {
      serviceUnavailableMessage: 'Chat service is temporarily unavailable.'
    }),
    support: createServiceProxy(config.serviceUrls.support, {}, {
      serviceUnavailableMessage: 'Support service is temporarily unavailable.'
    })
  };

  const ownerPathRewrite = {
    '^/api/owner/stores/[^/]+': ''
  };

  const ownerProxies = {
    products: createServiceProxy(config.serviceUrls.product, ownerPathRewrite),
    orders: createServiceProxy(config.serviceUrls.order, ownerPathRewrite),
    customers: createServiceProxy(config.serviceUrls.customer, ownerPathRewrite),
    support: createServiceProxy(config.serviceUrls.support, ownerPathRewrite, {
      serviceUnavailableMessage: 'Support service is temporarily unavailable.'
    }),
    chats: createServiceProxy(config.serviceUrls.chat, ownerPathRewrite, {
      serviceUnavailableMessage: 'Chat service is temporarily unavailable.'
    }),
    payments: createServiceProxy(config.serviceUrls.payment, ownerPathRewrite),
    settings: createServiceProxy(config.serviceUrls.store, ownerPathRewrite),
    notifications: createServiceProxy(config.serviceUrls.notification, ownerPathRewrite, {
      serviceUnavailableMessage: 'Notification service is temporarily unavailable.'
    })
  };
  const ownerLogoProxy = createServiceProxy(config.serviceUrls.store, {
    '^/api/owner/stores/([^/]+)/logo$': '/stores/$1/logo'
  });
  const logoProxy = createServiceProxy(config.serviceUrls.store, {}, {
    serviceUnavailableMessage: 'Store assets are temporarily unavailable.'
  });

  app.use('/api/platform/auth', platformProxy.auth);
  app.use('/api/platform/stores', requirePlatformUser(), platformProxy.stores);
  app.use('/api/platform/compliance', requirePlatformUser([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT, PLATFORM_ROLES.STORE_OWNER]), platformProxy.compliance);
  app.use('/api/platform/support', requirePlatformUser([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT, PLATFORM_ROLES.STORE_OWNER]), platformProxy.support);
  app.use('/api/platform/chats', requirePlatformUser([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT, PLATFORM_ROLES.STORE_OWNER]), platformProxy.chats);
  app.use('/api/platform/billing', requirePlatformUser(), platformProxy.billing);
  app.use('/api/platform/notifications', requirePlatformUser([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT, PLATFORM_ROLES.STORE_OWNER]), platformProxy.notifications);

  app.use('/api/owner/stores/:storeId/products', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.products);
  app.use('/api/owner/stores/:storeId/orders', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.orders);
  app.use('/api/owner/stores/:storeId/customers', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.customers);
  app.use('/api/owner/stores/:storeId/support', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.support);
  app.use('/api/owner/stores/:storeId/chats', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.chats);
  app.use('/api/owner/stores/:storeId/payments', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER]), ensureOwnerCanAccessStore, ownerProxies.payments);
  app.use('/api/owner/stores/:storeId/logo', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER]), ensureOwnerCanAccessStore, ownerLogoProxy);
  app.use('/api/owner/stores/:storeId/settings', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER]), ensureOwnerCanAccessStore, ownerProxies.settings);
  app.use('/api/owner/stores/:storeId/notifications', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.notifications);

  app.use('/api/customers/me', requireCustomer, storefrontProxies.customers);
  app.use('/api/customers', storefrontProxies.customers);
  app.use('/api/products', storefrontProxies.products);
  app.use('/api/cart', storefrontProxies.cart);
  app.use('/api/checkout', storefrontProxies.checkout);
  app.use('/api/orders', requireCustomer, storefrontProxies.orders);
  app.use('/api/chats', storefrontProxies.chats);
  app.use('/api/support', storefrontProxies.support);

  const supportSocketProxy = createServiceProxy(config.serviceUrls.support, {});
  const chatSocketProxy = createServiceProxy(config.serviceUrls.chat, {});
  const publicPaymentProxy = createProxyMiddleware({
    target: config.serviceUrls.payment,
    changeOrigin: true,
    xfwd: true,
    proxyTimeout: config.requestTimeoutMs + 1000,
    timeout: config.requestTimeoutMs + 1000,
    on: {
      error: (error, req, res) => {
        req.log?.warn('payment_proxy_failed', {
          error: error.message
        });

        if (res.headersSent) {
          return;
        }

        return res.status(503).json({
          error: 'Payment service is temporarily unavailable.'
        });
      }
    }
  });
  app.use('/socket.io/support', supportSocketProxy);
  app.use('/socket.io/chat', chatSocketProxy);
  app.use('/payments', publicPaymentProxy);
  app.use('/logos', logoProxy);

  const webProxy = createProxyMiddleware({
    target: config.webAppUrl,
    changeOrigin: true,
    ws: true,
    xfwd: true,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-forwarded-host', req.headers.host || req.publicHost || '');
        if (req.storeContext?.store?.id) {
          proxyReq.setHeader('x-store-id', String(req.storeContext.store.id));
        }
        if (req.gatewayContext?.auth) {
          proxyReq.setHeader('x-actor-type', req.gatewayContext.auth.actor_type || '');
          proxyReq.setHeader('x-actor-role', req.gatewayContext.auth.role || '');
          proxyReq.setHeader('x-user-id', req.gatewayContext.auth.user_id || '');
          proxyReq.setHeader('x-customer-id', req.gatewayContext.auth.customer_id || '');
        }
      }
    }
  });

  app.use('/', webProxy);

  app.use((error, req, res, next) => {
    if (error === invalidCsrfTokenError || error?.code === 'EBADCSRFTOKEN') {
      return res.status(403).json({
        error: 'Invalid CSRF token.'
      });
    }

    return next(error);
  });

  app.use(errorHandler({
    logger,
    isProduction: config.isProduction,
    serviceName: 'gateway'
  }));

  server.on('upgrade', supportSocketProxy.upgrade);
  server.on('upgrade', chatSocketProxy.upgrade);
  server.on('upgrade', webProxy.upgrade);

  server.listen(config.port, () => {
    logger.info('Gateway listening', {
      port: config.port,
      rootDomain: config.rootDomain
    });
  });

  const shutdown = async () => {
    logger.info('Shutting down gateway');
    server.close(async () => {
      await cache.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

bootstrap().catch((error) => {
  logger.error('Gateway failed to start', { error });
  process.exit(1);
});
