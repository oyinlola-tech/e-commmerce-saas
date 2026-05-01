const registerErrorRoutes = (app, deps) => {
  const { context, helpers, renderers } = deps;
  const {
    invalidCsrfTokenError,
    createHttpError,
    safeRedirect,
    logger,
    env
  } = context;
  const {
    wantsJson
  } = helpers;
  const {
    supportedErrorPageStatuses,
    renderErrorPage,
    resolveErrorHomeHref
  } = renderers;

  app.get('/error', (req, res) => {
    const requestedStatus = Number(req.query.status || 500);
    const supportedStatus = supportedErrorPageStatuses.has(requestedStatus) ? requestedStatus : 500;
    return renderErrorPage(req, res, supportedStatus);
  });

  app.use((req, res) => {
    return renderErrorPage(req, res, 404);
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    if (error === invalidCsrfTokenError || error.code === 'EBADCSRFTOKEN') {
      const message = 'Your session token expired. Please refresh the page and try again.';
      if (wantsJson(req)) {
        return res.status(403).json({ error: message });
      }

      return renderErrorPage(req, res, 403, createHttpError(403, message, null, { expose: true }), {
        primaryAction: {
          href: safeRedirect(req, req.headers.referer || '/', '/'),
          label: 'Refresh and retry'
        },
        secondaryAction: {
          href: resolveErrorHomeHref(req),
          label: 'Return home'
        }
      });
    }

    if (wantsJson(req)) {
      const status = Number(error.status || 500);
      return res.status(status).json({
        error: status >= 500 && env.isProduction
          ? 'An unexpected error occurred.'
          : (error.message || 'Request failed.'),
        details: error.details || undefined
      });
    }

    logger.error('web_request_failed', {
      requestId: req.requestId,
      path: req.originalUrl,
      error
    });

    return renderErrorPage(req, res, Number(error.status || 500), error);
  });
};

module.exports = {
  registerErrorRoutes
};
