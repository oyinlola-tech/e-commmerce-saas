const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const {
  createServiceConfig,
  createLogger,
  verifyToken,
  requestJson,
  buildSignedInternalHeaders,
  PLATFORM_ROLES
} = require('../../packages/shared');

const config = createServiceConfig({
  appRoot: __dirname,
  serviceName: 'gateway',
  defaultPort: 4000,
  defaultDatabase: 'gateway_db'
});
const logger = createLogger('gateway');
const app = express();
const server = http.createServer(app);

app.set('trust proxy', true);
app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

const isPlatformHost = (hostname = '') => {
  return [
    'localhost',
    '127.0.0.1',
    config.rootDomain,
    `www.${config.rootDomain}`
  ].includes(String(hostname || '').toLowerCase());
};

const extractToken = (req) => {
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }

  return req.cookies.platform_token || req.cookies.customer_token || null;
};

const resolveAuthContext = (req) => {
  const token = extractToken(req);
  if (!token) {
    return null;
  }

  try {
    return verifyToken(token, config.jwtSecret);
  } catch (error) {
    return null;
  }
};

const resolveStoreContext = async (req, res, next) => {
  const host = String(req.hostname || req.headers.host || '').split(':')[0];
  const needsStoreResolution = !isPlatformHost(host) || req.path.startsWith('/api/chats') || req.path.startsWith('/api/products') || req.path.startsWith('/api/cart') || req.path.startsWith('/api/customers') || req.path.startsWith('/api/orders') || req.path.startsWith('/api/checkout');

  if (!needsStoreResolution) {
    return next();
  }

  try {
    req.storeContext = await requestJson(`${config.serviceUrls.store}/resolve?host=${encodeURIComponent(host)}`, {
      headers: {
        'x-request-id': req.requestId
      },
      timeoutMs: config.requestTimeoutMs
    });

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

const attachGatewayContext = (req, res, next) => {
  const auth = resolveAuthContext(req);
  const storeId = req.storeContext?.store?.id || req.params?.storeId || '';

  if (auth && auth.actor_type === 'customer' && storeId && String(auth.store_id) !== String(storeId)) {
    return res.status(403).json({ error: 'Customer token does not belong to this store.' });
  }

  req.gatewayContext = {
    auth,
    internalHeaders: buildSignedInternalHeaders({
      requestId: req.requestId,
      storeId,
      userId: auth?.user_id || '',
      actorRole: auth?.role || '',
      customerId: auth?.customer_id || '',
      actorType: auth?.actor_type || '',
      secret: config.internalSharedSecret
    })
  };

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

const createServiceProxy = (target, pathRewrite) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    pathRewrite,
    on: {
      proxyReq: (proxyReq, req) => {
        const headers = req.gatewayContext?.internalHeaders || {};
        Object.entries(headers).forEach(([key, value]) => {
          proxyReq.setHeader(key, value);
        });
        proxyReq.setHeader('x-forwarded-host', req.headers.host || '');
      }
    }
  });
};

const platformProxy = {
  auth: createServiceProxy(config.serviceUrls.user, { '^/api/platform': '' }),
  stores: createServiceProxy(config.serviceUrls.store, { '^/api/platform': '' }),
  compliance: createServiceProxy(config.serviceUrls.compliance, { '^/api/platform': '' }),
  support: createServiceProxy(config.serviceUrls.support, { '^/api/platform': '' }),
  chats: createServiceProxy(config.serviceUrls.chat, { '^/api/platform': '' }),
  billing: createServiceProxy(config.serviceUrls.billing, { '^/api/platform': '' })
};

const storefrontProxies = {
  customers: createServiceProxy(config.serviceUrls.customer, {}),
  products: createServiceProxy(config.serviceUrls.product, {}),
  cart: createServiceProxy(config.serviceUrls.cart, {}),
  checkout: createServiceProxy(config.serviceUrls.order, {}),
  orders: createServiceProxy(config.serviceUrls.order, {}),
  chats: createServiceProxy(config.serviceUrls.chat, {})
};

const ownerPathRewrite = {
  '^/api/owner/stores/[^/]+': ''
};

const ownerProxies = {
  products: createServiceProxy(config.serviceUrls.product, ownerPathRewrite),
  orders: createServiceProxy(config.serviceUrls.order, ownerPathRewrite),
  customers: createServiceProxy(config.serviceUrls.customer, ownerPathRewrite),
  support: createServiceProxy(config.serviceUrls.support, ownerPathRewrite),
  chats: createServiceProxy(config.serviceUrls.chat, ownerPathRewrite),
  payments: createServiceProxy(config.serviceUrls.payment, ownerPathRewrite),
  settings: createServiceProxy(config.serviceUrls.store, ownerPathRewrite)
};

app.get('/health', async (req, res) => {
  return res.json({
    service: 'gateway',
    status: 'ok'
  });
});

app.use(resolveStoreContext);
app.use(attachGatewayContext);

app.use('/api/platform/auth', platformProxy.auth);
app.use('/api/platform/stores', requirePlatformUser(), platformProxy.stores);
app.use('/api/platform/compliance', requirePlatformUser([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT, PLATFORM_ROLES.STORE_OWNER]), platformProxy.compliance);
app.use('/api/platform/support', requirePlatformUser([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT, PLATFORM_ROLES.STORE_OWNER]), platformProxy.support);
app.use('/api/platform/chats', requirePlatformUser([PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT, PLATFORM_ROLES.STORE_OWNER]), platformProxy.chats);
app.use('/api/platform/billing', requirePlatformUser(), platformProxy.billing);

app.use('/api/owner/stores/:storeId/products', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.products);
app.use('/api/owner/stores/:storeId/orders', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.orders);
app.use('/api/owner/stores/:storeId/customers', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.customers);
app.use('/api/owner/stores/:storeId/support', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.support);
app.use('/api/owner/stores/:storeId/chats', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER, PLATFORM_ROLES.SUPPORT_AGENT]), ensureOwnerCanAccessStore, ownerProxies.chats);
app.use('/api/owner/stores/:storeId/payments', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER]), ensureOwnerCanAccessStore, ownerProxies.payments);
app.use('/api/owner/stores/:storeId/settings', requirePlatformUser([PLATFORM_ROLES.STORE_OWNER, PLATFORM_ROLES.PLATFORM_OWNER]), ensureOwnerCanAccessStore, ownerProxies.settings);

app.use('/api/customers/me', requireCustomer, storefrontProxies.customers);
app.use('/api/customers', storefrontProxies.customers);
app.use('/api/products', storefrontProxies.products);
app.use('/api/cart', storefrontProxies.cart);
app.use('/api/checkout', storefrontProxies.checkout);
app.use('/api/orders', requireCustomer, storefrontProxies.orders);
app.use('/api/chats', storefrontProxies.chats);

const supportSocketProxy = createServiceProxy(config.serviceUrls.support, {});
const chatSocketProxy = createServiceProxy(config.serviceUrls.chat, {});
app.use('/socket.io/support', supportSocketProxy);
app.use('/socket.io/chat', chatSocketProxy);

const webProxy = createProxyMiddleware({
  target: config.webAppUrl,
  changeOrigin: true,
  ws: true
});

app.use('/', webProxy);

server.on('upgrade', supportSocketProxy.upgrade);
server.on('upgrade', chatSocketProxy.upgrade);
server.on('upgrade', webProxy.upgrade);

server.listen(config.port, () => {
  logger.info('Gateway listening', {
    port: config.port,
    rootDomain: config.rootDomain
  });
});
