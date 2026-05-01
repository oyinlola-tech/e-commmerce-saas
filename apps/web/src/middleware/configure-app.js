const express = require('express');

const configureApp = (app, context, helpers, renderers) => {
  const {
    crypto,
    compression,
    cookieParser,
    expressLayouts,
    helmet,
    env,
    logger,
    viewsDir,
    logoDir,
    publicDir,
    pageRateLimiter,
    mutationRateLimiter,
    ensureVisitorId,
    normalizeHostname,
    isSecureRequest,
    createHttpError
  } = context;
  const {
    wantsJson
  } = helpers;
  const {
    renderErrorPage
  } = renderers;

  const htmlMinifier = (req, res, next) => {
    const originalSend = res.send.bind(res);
    res.send = (body) => {
      const contentType = String(res.getHeader('Content-Type') || '');
      if (typeof body === 'string' && contentType.includes('text/html')) {
        return originalSend(body.replace(/>\s+</g, '><').trim());
      }

      return originalSend(body);
    };

    next();
  };

  const isMultipartFormRequest = (req) => {
    return String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data');
  };

  const csrfProtectedMiddleware = (req, res, next) => {
    return context.doubleCsrfProtection(req, res, next);
  };

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', viewsDir);
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');

  app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    req.log = logger.child({
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl
    });
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  app.use(helmet({
    crossOriginResourcePolicy: false,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`
        ],
        styleSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          'https://fonts.googleapis.com'
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(compression());
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser(env.cookieSecret));
  app.use(htmlMinifier);
  app.use((req, res, next) => {
    ensureVisitorId(req, res);
    return next();
  });

  app.use((req, res, next) => {
    if (!env.isProduction) {
      return next();
    }

    if (isSecureRequest(req)) {
      return next();
    }

    const requestHost = normalizeHostname(req.headers.host);
    if (!requestHost) {
      if (wantsJson(req)) {
        return res.status(400).json({ error: 'Invalid host header.' });
      }

      return renderErrorPage(req, res, 400, createHttpError(400, 'Invalid host header.', null, { expose: true }));
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.redirect(308, `https://${requestHost}${req.originalUrl}`);
    }

    if (wantsJson(req)) {
      return res.status(400).json({ error: 'HTTPS is required.' });
    }

    return renderErrorPage(req, res, 400, createHttpError(400, 'HTTPS is required.', null, { expose: true }), {
      message: 'This action requires a secure HTTPS connection before it can continue.'
    });
  });

  app.use('/logos', express.static(logoDir, {
    immutable: true,
    maxAge: '1y',
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  app.use(express.static(publicDir, {
    setHeaders(res, filePath) {
      if (context.path.basename(filePath) === 'theme.css') {
        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
        return;
      }

      if (/\.[a-f0-9]{8,}\./i.test(context.path.basename(filePath))) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }

      res.setHeader('Cache-Control', `public, max-age=${env.staticAssetCacheSeconds}`);
    }
  }));

  app.use(pageRateLimiter);
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    return mutationRateLimiter(req, res, next);
  });

  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || isMultipartFormRequest(req)) {
      return next();
    }

    return csrfProtectedMiddleware(req, res, next);
  });
};

module.exports = {
  configureApp
};
